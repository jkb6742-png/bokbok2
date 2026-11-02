// 수집기 3: 검색 노출 (내 글의 타깃 키워드만, 하루 적은 횟수)
//
// 방법 1 (권장, 키 필요) — 네이버 공식 블로그 검색 API. dentalbox src/lib/naver-search.ts 이식.
//   NAVER API HUB: https://naverapihub.apigw.ntruss.com/search/v1/blog  (X-NCP-APIGW-API-KEY-ID / X-NCP-APIGW-API-KEY)
//   구 개발자센터: https://openapi.naver.com/v1/search/blog.json         (X-Naver-Client-Id / X-Naver-Client-Secret)
//   판정(dentalbox judge): 키워드 sort=sim 100위 안 → 노출(순위). 없으면 제목 sort=date 100위로 색인 여부 확인
//   → 색인됐지만 밖(OUT_OF_RANGE) / 검색에 없음(MISSING) / 발행 24시간 미만(PENDING).
//   이 PC에는 키가 없어 실제 호출은 확인 못 함(형식은 공식 문서·dentalbox 코드 기준).
//
// 방법 2 (선택, settings.serp=true) — 검색 결과 화면을 사람이 보듯 1쪽만 읽는다.
//   블로그 탭: https://search.naver.com/search.naver?ssc=tab.blog.all&query=  → 1쪽 30건, 각 결과의 data-cr-on="r=<순위>"
//   통합검색: https://search.naver.com/search.naver?where=nexearch&query=   → 영역 순서(layout "main":[{area,rank}]),
//     영역(data-slog-container) 안의 글 위치(r=), AI 브리핑(abL_*) 안 인용 글 주소.
//   2026-11-01 "NF 유형 특징" 1회씩 실측해 구조 확인(test/fixtures/serp_*.html, 남의 블로그 아이디는 other# 로 가림).
//   search.naver.com 의 robots.txt 는 전체 Disallow 라 기본값은 꺼짐. 켜면 키워드당 2쪽, 호스트 간격 2초 이상.
'use strict';
const { InsightError, stripTags, kstDate } = require('../lib/util');

const PENDING_HOURS = 24;

function extractPost(url) {
  const m = String(url || '').match(/^https?:\/\/(?:m\.)?blog\.naver\.com\/([A-Za-z0-9_-]+)\/(\d{6,})/i)
    || String(url || '').match(/^https?:\/\/(?:m\.)?blog\.naver\.com\/PostView\.n(?:aver|hn)\?blogId=([A-Za-z0-9_-]+)&(?:amp;)?logNo=(\d+)/i);
  return m ? { blogId: m[1].toLowerCase(), logNo: m[2] } : null;
}
const ymd8 = v => (/^\d{8}$/.test(v || '') ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : null);

// 공식 API 응답 → [{rank, blogId, logNo, title, postDate}]
function parseSearchApi(json, start = 1) {
  if (!json || !Array.isArray(json.items)) throw new InsightError('검색 API 응답 형식이 다릅니다', { code: 'PARSE', source: 'search-api' });
  return json.items.map((it, i) => ({ rank: start + i, ...(extractPost(it.link) || { blogId: null, logNo: null }), title: stripTags(it.title), postDate: ymd8(it.postdate) }));
}

// 블로그 탭 화면 → [{rank, blogId, logNo}]
function parseSerpBlogTab(html) {
  const h = String(html || '');
  const out = [], seen = new Set();
  const re = /data-url="([^"]+)"[^>]*?data-cr-on="r=(\d+)&(?:amp;)?i=[^"&]*&(?:amp;)?a=([^"&]+)/g;
  let m;
  while ((m = re.exec(h))) {
    const p = extractPost(m[1]);
    if (!p || seen.has(p.logNo)) continue;
    seen.add(p.logNo); out.push({ rank: Number(m[2]), ...p });
  }
  if (out.length) return out.sort((a, b) => a.rank - b.rank);
  // 표시 방식이 바뀌어 r= 가 없으면 처음 나온 순서로
  const re2 = /https?:\/\/(?:m\.)?blog\.naver\.com\/[A-Za-z0-9_-]+\/\d{6,}/g;
  while ((m = re2.exec(h))) { const p = extractPost(m[0]); if (p && !seen.has(p.logNo)) { seen.add(p.logNo); out.push({ rank: out.length + 1, ...p }); } }
  return out;
}

function areaLabel(area) {
  const a = String(area || '');
  if (/^abL/.test(a)) return 'AI 브리핑';
  if (/^urB_imM/.test(a)) return '이미지';
  if (/^urB_/.test(a)) return '인기글·스마트블록';
  if (/^(vdB|clp|vid)/.test(a)) return '동영상·클립';
  if (/^kwX/.test(a)) return '연관 검색어';
  if (/^nws/.test(a)) return '뉴스';
  if (/^kin/.test(a)) return '지식iN';
  if (/^(pwl|ad)/.test(a)) return '광고';
  return '기타';
}

// 통합검색 화면 → { sections:[{area,order,label}], items:[{area,label,order,pos,blogId,logNo}], ai:{present,citations} }
function parseSerpTotal(html) {
  const h = String(html || '');
  const order = new Map();
  const lay = h.match(/"main"\s*:\s*\[([^\]]*)\]/);
  if (lay) {
    const re = /"area"\s*:\s*"([^"*]+)[^"]*"\s*,\s*"rank"\s*:\s*(\d+)/g; let m;
    while ((m = re.exec(lay[1]))) order.set(m[1], Number(m[2]));
  }
  const marks = []; const re = /data-slog-container="([^"]+)"/g; let m;
  while ((m = re.exec(h))) marks.push([m.index, m[1]]);
  const sections = [], items = [], citations = [];
  let fallbackOrder = 0;
  for (let i = 0; i < marks.length; i++) {
    const [at, area] = marks[i];
    if (sections.some(s => s.area === area)) continue;
    const seg = h.slice(at, i + 1 < marks.length ? marks[i + 1][0] : h.length);
    const ord = order.get(area) ?? (order.size ? null : ++fallbackOrder);
    if (ord == null) continue;   // 레이아웃에 없는 영역(검색 옵션·페이지 이동 등)
    const sec = { area, order: ord, label: areaLabel(area) };
    sections.push(sec);
    if (/^abL/.test(area)) {
      const seen = new Set(); const r2 = /https?:\/\/(?:m\.)?blog\.naver\.com\/[A-Za-z0-9_-]+\/\d{6,}/g; let k;
      while ((k = r2.exec(seg))) { const p = extractPost(k[0]); if (p && !seen.has(p.logNo)) { seen.add(p.logNo); citations.push(p); } }
      continue;
    }
    const seen = new Set();
    const r3 = /data-url="([^"]+)"[^>]*?data-cr-on="r=(\d+)/g; let k;
    while ((k = r3.exec(seg))) { const p = extractPost(k[1]); if (p && !seen.has(p.logNo)) { seen.add(p.logNo); items.push({ area, label: sec.label, order: ord, pos: Number(k[2]), ...p }); } }
  }
  sections.sort((a, b) => a.order - b.order);
  return { sections, items, ai: { present: sections.some(s => /^abL/.test(s.area)), citations } };
}

// 키 이름(secrets.js, platform 'insight')
const SECRET_KEYS = { hubId: 'search_hub_id', hubKey: 'search_hub_key', devId: 'search_dev_id', devSecret: 'search_dev_secret' };

function apiSpec(creds) {
  if (!creds) return null;
  if (creds.hubId && creds.hubKey) return { endpoint: 'https://naverapihub.apigw.ntruss.com/search/v1/blog', headers: { 'X-NCP-APIGW-API-KEY-ID': creds.hubId, 'X-NCP-APIGW-API-KEY': creds.hubKey }, source: 'naverapihub search/v1/blog' };
  if (creds.devId && creds.devSecret) return { endpoint: 'https://openapi.naver.com/v1/search/blog.json', headers: { 'X-Naver-Client-Id': creds.devId, 'X-Naver-Client-Secret': creds.devSecret }, source: 'openapi.naver.com v1/search/blog' };
  return null;
}

async function apiSearch(client, spec, query, sort, depth) {
  const items = [];
  for (let start = 1; start <= depth; start += 100) {
    const display = Math.min(100, depth - start + 1);
    const q = new URLSearchParams({ query, display: String(display), start: String(start), sort });
    let r;
    try { r = await client.request(`${spec.endpoint}?${q}`, { headers: spec.headers, step: `검색 API(${sort})`, source: spec.source }); }
    catch (e) {
      if (e.status === 401 || e.status === 403) throw new InsightError('블로그 검색 API 키가 올바르지 않습니다(설정에서 확인)', { code: 'CONFIG', status: e.status, source: spec.source });
      throw e;
    }
    const got = parseSearchApi(r.json, start);
    items.push(...got);
    if (got.length < display) break;
  }
  return items;
}

const serpUrl = (q, tab) => tab ? `https://search.naver.com/search.naver?ssc=tab.blog.all&query=${encodeURIComponent(q)}` : `https://search.naver.com/search.naver?where=nexearch&query=${encodeURIComponent(q)}`;

// 글 하나(키워드 하나) 판정
async function judge({ client, spec, settings, blogId, target, now }) {
  const me = blogId.toLowerCase();
  const out = { keyword: target.keyword, logNo: target.logNo || null, checkedAt: now, tab: null, indexed: null, ownHits: [], smart: [], ai: null, status: 'UNCHECKED', via: [] };
  const ageH = target.addedAt ? (now - target.addedAt) / 3600000 : null;
  const isMine = it => it.blogId === me;

  if (spec) {
    const depth = Math.max(100, Math.min(Number(settings.apiDepth) || 100, 1000));
    const sim = await apiSearch(client, spec, target.keyword, 'sim', depth);
    out.via.push('api');
    out.ownHits = sim.filter(isMine).map(it => ({ logNo: it.logNo, rank: it.rank }));
    const hit = target.logNo ? sim.find(it => isMine(it) && it.logNo === target.logNo) : sim.find(isMine);
    const fresh = sim.slice(0, 10).map(it => it.postDate).filter(Boolean).map(d => Math.max(0, Math.round((now - Date.parse(d + 'T00:00:00+09:00')) / 86400000)));
    out.top10AgeDays = fresh.length ? fresh.sort((a, b) => a - b)[fresh.length >> 1] : null;   // 상위 10개 글 나이 중앙값
    out.depth = depth;
    if (hit) { out.tab = { rank: hit.rank, depth, via: 'api' }; out.indexed = true; out.status = 'EXPOSED'; }
    else if (target.logNo && target.title) {
      const dt = await apiSearch(client, spec, target.title, 'date', 100);
      out.indexed = dt.some(it => isMine(it) && it.logNo === target.logNo);
      out.status = out.indexed ? 'OUT_OF_RANGE' : (ageH != null && ageH < PENDING_HOURS ? 'PENDING' : 'MISSING');
    } else out.status = 'OUT_OF_RANGE';
  }

  if (settings.serp) {
    if (!spec) {
      const r = await client.request(serpUrl(target.keyword, true), { headers: { Referer: 'https://search.naver.com/' }, step: '블로그 탭 화면', source: 'search.naver.com 블로그 탭' });
      const list = parseSerpBlogTab(r.text);
      out.via.push('serp-tab');
      out.ownHits = list.filter(isMine).map(it => ({ logNo: it.logNo, rank: it.rank }));
      const hit = target.logNo ? list.find(it => isMine(it) && it.logNo === target.logNo) : list.find(isMine);
      out.depth = list.length;
      if (hit) { out.tab = { rank: hit.rank, depth: list.length, via: 'serp' }; out.status = 'EXPOSED'; }
      else out.status = ageH != null && ageH < PENDING_HOURS ? 'PENDING' : 'NOT_FOUND';
    }
    if (settings.serpTotal !== false) {
      const r = await client.request(serpUrl(target.keyword, false), { headers: { Referer: 'https://search.naver.com/' }, step: '통합검색 화면', source: 'search.naver.com 통합검색' });
      const t = parseSerpTotal(r.text);
      out.via.push('serp-total');
      out.smart = t.items.filter(isMine).map(it => ({ area: it.area, label: it.label, sectionOrder: it.order, pos: it.pos, logNo: it.logNo, target: !target.logNo || it.logNo === target.logNo }));
      out.sections = t.sections.map(s => s.label);
      out.ai = { present: t.ai.present, cited: t.ai.citations.some(isMine), citedLogNos: t.ai.citations.filter(isMine).map(c => c.logNo) };
      if (out.status !== 'EXPOSED' && out.smart.some(s => s.target)) out.status = 'EXPOSED';
    }
  }
  return out;
}

async function collectExposure({ client, blogId, targets, settings = {}, creds = null, log = () => { }, now = Date.now }) {
  const spec = apiSpec(creds);
  if (!spec && !settings.serp) throw new InsightError('검색 노출을 보려면 블로그 검색 API 키를 넣거나 "검색 화면 확인"을 켜야 합니다', { code: 'CONFIG', source: 'exposure' });
  const max = Math.max(1, Math.min(Number(settings.maxExposureChecks) || (spec ? 30 : 10), spec ? 200 : 30));
  const results = [], errors = [];
  for (const t of targets.slice(0, max)) {
    try { results.push(await judge({ client, spec, settings, blogId, target: t, now: now() })); }
    catch (e) {
      errors.push({ source: e.source || 'exposure', keyword: t.keyword, message: e.message });
      if (e.code === 'CONFIG' || e.status === 429) break;   // 키 오류·호출 제한이면 더 하지 않음
    }
  }
  log(`검색 노출 ${results.length}건 확인${errors.length ? `, 실패 ${errors.length}건` : ''}`);
  return { source: [spec ? spec.source : null, settings.serp ? 'search.naver.com' : null].filter(Boolean), fetchedAt: now(), date: kstDate(now()), results, errors };
}

module.exports = { collectExposure, judge, parseSearchApi, parseSerpBlogTab, parseSerpTotal, extractPost, areaLabel, apiSpec, SECRET_KEYS, PENDING_HOURS };
