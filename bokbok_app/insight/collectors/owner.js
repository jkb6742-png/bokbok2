// 수집기 5 (선택, settings.ownerStats=true): 블로그 주인만 보는 통계 — 그 계정의 로그인된 크롬 프로필로 읽기만 한다.
//  - 로그인 자동화·비밀번호 처리 없음. 로그인이 풀려 있으면 그냥 멈추고 안내.
//  - 하루 1회 이하, 화면 1장(admin.blog.naver.com/<id>/stat/today)만 열고, 화면이 스스로 부르는 통계 JSON을 엿듣는다.
//  - GET 이외 요청(로그 전송·좋아요 등)은 전부 막는다 → 아무것도 쓰지 않는다. naver 밖으로 이동도 막는다.
//  - 다른 창이 그 프로필을 쓰고 있으면(크롬 잠금) 열지 않고 건너뛴다.
//
// 실측(2026-11-01, jsrjkb6742 프로필, 1회 방문):
//   admin.blog.naver.com/<id>/stat/today → iframe blog.stat.naver.com/blog/daily/daily/cv?blogId=<id>
//   → XHR GET https://blog.stat.naver.com/api/blog/daily/cv?timeDimension=DATE&startDate=YYYY-MM-DD&exclude=
//     응답 { statusCode, message, result:{ statDataList:[ {dataId, data:{columnInfo:[...], rows:{열이름:[값...]}}, utime} ×8 ] } }
//     첫 표의 열은 date·cv·cv_p (15일치). 나머지 7개 표의 dataId·열 이름은 값 노출을 피하려고 기록하지 않아 확인 못 함
//     → 열 이름으로 분류(아래 classify)하는 방식으로 설계했고, 방문자·유입 검색어·유입 경로·인기 글 매핑은 "미확인".
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { InsightError, kstDate } = require('../lib/util');

const chromeEnv = require('../../../chrome');   // _도구\chrome.js: puppeteer-core 모듈·크롬 경로 자동 탐색
const ALLOWED = /^https?:\/\/([a-z0-9-]+\.)*(naver\.com|naver\.net|pstatic\.net|navercorp\.com)(\/|$)/;

// naver_post/common.js 와 같은 규칙
function profileDir(blogId) {
  const LOCAL = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return blogId === 'jsrjkb6742' ? path.join(LOCAL, 'naver-blog-profile') : path.join(LOCAL, 'bokbok', 'profiles', blogId);
}

// 크롬이 프로필을 쓰는 중이면 <프로필>\lockfile 을 독점으로 열고 있다(Windows). 열리면(또는 없으면) 비어 있는 것.
function profileLock(dir, fsx = fs) {
  if (!fsx.existsSync(dir)) return { locked: false, missing: true };
  const lf = path.join(dir, 'lockfile');
  if (!fsx.existsSync(lf)) return { locked: false };
  try { const fd = fsx.openSync(lf, 'r+'); fsx.closeSync(fd); return { locked: false, stale: true }; }
  catch (e) { return { locked: true, reason: e.code || e.message }; }
}

// statDataList → [{dataId, columns, rows:[{열:값}]}]
function normalizeStat(json) {
  const list = json && json.result && json.result.statDataList;
  if (!Array.isArray(list)) return [];
  return list.map(s => {
    const d = s.data || {};
    const cols = Array.isArray(d.columnInfo) ? d.columnInfo.map(c => (typeof c === 'string' ? c : c && (c.name || c.key))).filter(Boolean) : Object.keys(d.rows || {});
    const rows = [];
    const r = d.rows || {};
    const n = Math.max(0, ...cols.map(c => (Array.isArray(r[c]) ? r[c].length : 0)));
    for (let i = 0; i < n; i++) { const o = {}; for (const c of cols) o[c] = Array.isArray(r[c]) ? r[c][i] : undefined; rows.push(o); }
    return { dataId: s.dataId ?? null, columns: cols, rows, utime: s.utime || null };
  });
}

const has = (cols, re) => cols.find(c => re.test(c));
// 열 이름으로 표 종류 추정. cv=조회수, uv=순방문자, 그 밖은 열 이름 규칙(미확인).
function classify(tables) {
  const out = { daily: {}, keywords: [], sources: [], topPosts: [], demographics: [], unknown: [] };
  for (const t of tables) {
    const c = t.columns;
    const dateCol = has(c, /^(date|statDate|day)$/i);
    const kwCol = has(c, /(query|keyword|searchWord)/i);
    const srcCol = has(c, /(referer|referrer|channel|inflow|source|domain)/i);
    const postCol = has(c, /(title|logNo|uri|contentId)/i);
    const demoCol = has(c, /(gender|age)/i);
    const valCol = has(c, /^(cv|uv|pv|cnt|count|value|ratio|rate|share)$/i) || c.find(x => t.rows.some(r => typeof r[x] === 'number'));
    if (dateCol && !kwCol && !srcCol && !postCol) {
      for (const r of t.rows) {
        const day = String(r[dateCol]).slice(0, 10);
        const d = out.daily[day] = out.daily[day] || { date: day };
        for (const col of c) if (col !== dateCol && typeof r[col] === 'number' && !/_p$/.test(col)) {
          const key = /^cv$/i.test(col) ? 'views' : /^uv$/i.test(col) ? 'visitors' : col;
          d[key] = r[col];
        }
      }
    } else if (kwCol) out.keywords.push(...t.rows.map(r => ({ keyword: r[kwCol], value: valCol ? r[valCol] : null })));
    else if (postCol) out.topPosts.push(...t.rows.map(r => ({ title: r[has(c, /title/i)] ?? null, logNo: r[has(c, /logNo/i)] != null ? String(r[has(c, /logNo/i)]) : null, value: valCol ? r[valCol] : null })));
    else if (srcCol) out.sources.push(...t.rows.map(r => ({ name: r[srcCol], value: valCol ? r[valCol] : null })));
    else if (demoCol) out.demographics.push(...t.rows);
    else out.unknown.push({ dataId: t.dataId, columns: c });
  }
  out.daily = Object.values(out.daily).sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

async function defaultLaunch(opts) {
  let p;
  try { p = chromeEnv.puppeteer; } catch { throw new InsightError('puppeteer-core를 찾을 수 없어 주인 통계를 읽지 못합니다 (_도구 에서 npm install)', { code: 'CONFIG', source: 'owner' }); }
  return p.launch(opts);
}
// 크롬 경로: 설정값 → 자동 탐색(chrome.js). 못 찾으면 한국어 안내
function chromePath(settings) {
  if (settings.chromePath) return settings.chromePath;
  try { return chromeEnv.CHROME; } catch (e) { throw new InsightError(e.message, { code: 'CONFIG', source: 'owner' }); }
}

async function collectOwner({ blogId, settings = {}, log = () => { }, launch = defaultLaunch, now = Date.now, fsx = fs, waitMs }) {
  if (!settings.ownerStats) throw new InsightError('주인 통계 수집이 꺼져 있습니다(설정에서 켜야 함)', { code: 'CONFIG', source: 'owner' });
  const dir = settings.profileDir || profileDir(blogId);
  const lock = profileLock(dir, fsx);
  if (lock.missing) throw new InsightError('이 계정의 로그인 프로필이 없습니다. 블로그 모듈에서 한 번 로그인해 주세요', { code: 'LOGIN', source: 'owner' });
  if (lock.locked) throw new InsightError('이 계정의 크롬 창이 열려 있어 통계를 읽지 않고 건너뜁니다. 창을 닫은 뒤 다시 시도하세요', { code: 'LOCKED', source: 'owner' });

  const browser = await launch({ executablePath: chromePath(settings), headless: true, userDataDir: dir, args: ['--lang=ko-KR', '--no-first-run'] });
  const captured = [];
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', req => {
      const top = req.isNavigationRequest && req.isNavigationRequest() && req.frame && req.frame() === page.mainFrame();
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) return req.abort();      // 읽기만
      if (top && !ALLOWED.test(req.url())) return req.abort();
      if (['image', 'media', 'font'].includes(req.resourceType && req.resourceType())) return req.abort();  // 가볍게
      req.continue();
    });
    page.on('response', async res => {
      const u = res.url();
      if (!/^https:\/\/blog\.stat\.naver\.com\/api\//.test(u)) return;
      try { captured.push({ url: u.replace(/&_=[^&]*/, ''), json: JSON.parse(await res.text()) }); } catch { }
    });
    await page.goto(`https://admin.blog.naver.com/${encodeURIComponent(blogId)}/stat/today`, { waitUntil: 'networkidle2', timeout: 30000 });
    if (/nid\.naver\.com/.test(page.url())) throw new InsightError('로그인이 풀려 있습니다. 블로그 모듈에서 직접 로그인한 뒤 다시 시도하세요', { code: 'LOGIN', source: 'owner' });
    await new Promise(r => setTimeout(r, waitMs ?? (3000 + Math.random() * 3000)));   // 화면이 표를 다 부를 때까지(사람처럼 잠깐 보기)
  } finally {
    await browser.close().catch(() => { });
  }
  if (!captured.length) throw new InsightError('통계 화면에서 데이터를 받지 못했습니다(화면 구조 변경 가능)', { code: 'PARSE', source: 'owner' });
  const tables = captured.flatMap(c => normalizeStat(c.json).map(t => ({ ...t, api: new URL(c.url).pathname })));
  const cls = classify(tables);
  log(`주인 통계: 표 ${tables.length}개, 일별 ${cls.daily.length}일`);
  return {
    source: [...new Set(captured.map(c => 'blog.stat.naver.com' + new URL(c.url).pathname))], fetchedAt: now(), date: kstDate(now()),
    daily: cls.daily, keywords: cls.keywords.slice(0, 50), sources: cls.sources.slice(0, 30), topPosts: cls.topPosts.slice(0, 30), demographics: cls.demographics.slice(0, 40),
    tablesSeen: tables.map(t => ({ api: t.api, dataId: t.dataId, columns: t.columns, rows: t.rows.length })),
    untestedMapping: true,
  };
}

module.exports = { collectOwner, profileDir, profileLock, normalizeStat, classify };
