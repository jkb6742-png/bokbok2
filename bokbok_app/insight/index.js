// 블로그 육성 데이터 엔진 — 공개 API
//   collect({blogId, kinds, settings, log, deps}) 수집 후 저장
//   latest(blogId)            가장 최근 스냅샷
//   trend(blogId, metric, days) 날짜별 값 [{date, value}]
//   dashboard(blogId, {settings}) UI 한 번에 그릴 객체
//   due(blogId, settings)     지금 모아야 할 종류
//   getConfig / setConfig     글별 타깃 키워드·추가 키워드·목표 (UI 저장용)
'use strict';
const path = require('path');
const store = require('./lib/store');
const { createClient } = require('./lib/http');
const { InsightError, kstDate, daysBetween, addDays, checkBlogId } = require('./lib/util');
const { primaryKeyword, norm } = require('./lib/keyword');
const { collectBlog } = require('./collectors/blog');
const { collectExposure, SECRET_KEYS: SEARCH_KEYS } = require('./collectors/exposure');
const { collectKeywords, SECRET_KEYS: AD_KEYS } = require('./collectors/keywords');
const { collectOwner } = require('./collectors/owner');
const metrics = require('./metrics');

const KINDS = ['blog', 'exposure', 'keywords', 'owner'];
// 종류별 최소 수집 간격(시간)
const INTERVAL_H = { blog: 20, exposure: 20, keywords: 24 * 7, owner: 22 };
const VOLUME_TTL_DAYS = 28;       // 검색량은 월 단위 값이라 4주에 한 번
const HISTORY_KEEP_DAYS = 400;

// 앱 설정 화면용 항목 (secret:true 는 engines/secrets.js 로 platform 'insight' 에 저장)
const configFields = [
  { key: 'strictRobots', label: 'robots.txt 비허용 주소 쓰지 않기', type: 'bool', default: false, hint: '켜면 공감·댓글·이웃 수(m.blog.naver.com/api)를 수집하지 않음' },
  { key: 'serp', label: '검색 화면에서 노출 확인', type: 'bool', default: false, hint: '키워드당 블로그 탭·통합검색 1쪽씩, 하루 최대 10개 키워드. search.naver.com robots.txt는 전체 비허용' },
  { key: 'serpTotal', label: '통합검색(스마트블록·AI 브리핑)도 확인', type: 'bool', default: true },
  { key: 'maxExposureChecks', label: '하루 노출 확인 글 수', type: 'number', default: 10 },
  { key: 'ownerStats', label: '주인 통계 읽기(로그인 프로필)', type: 'bool', default: false, hint: '하루 1번, 통계 화면 1장만 읽기 전용. 크롬 창이 열려 있으면 건너뜀' },
  { key: SEARCH_KEYS.hubId, label: 'NAVER API HUB 검색 Key ID', secret: true },
  { key: SEARCH_KEYS.hubKey, label: 'NAVER API HUB 검색 Key', secret: true },
  { key: SEARCH_KEYS.devId, label: '(구) 개발자센터 Client ID', secret: true },
  { key: SEARCH_KEYS.devSecret, label: '(구) 개발자센터 Client Secret', secret: true },
  { key: AD_KEYS.customerId, label: '검색광고 고객 ID(CUSTOMER_ID)', secret: true },
  { key: AD_KEYS.accessLicense, label: '검색광고 액세스라이선스', secret: true },
  { key: AD_KEYS.secretKey, label: '검색광고 비밀키', secret: true },
];

let secretsMod = null;
async function defaultGetSecret(key) {
  try { secretsMod = secretsMod || require(path.join(__dirname, '..', 'engines', 'secrets.js')); return await secretsMod.getSecret('insight', key); } catch { return null; }
}
async function readCreds(getSecret) {
  const g = async k => (await getSecret(k)) || null;
  const search = { hubId: await g(SEARCH_KEYS.hubId), hubKey: await g(SEARCH_KEYS.hubKey), devId: await g(SEARCH_KEYS.devId), devSecret: await g(SEARCH_KEYS.devSecret) };
  const ad = { customerId: await g(AD_KEYS.customerId), accessLicense: await g(AD_KEYS.accessLicense), secretKey: await g(AD_KEYS.secretKey) };
  return {
    search: (search.hubId && search.hubKey) || (search.devId && search.devSecret) ? search : null,
    ad: ad.customerId && ad.accessLicense && ad.secretKey ? ad : null,
  };
}

const getConfig = blogId => ({ keywords: {}, extraKeywords: [], goals: {}, adpost: {}, ...store.load(blogId, 'config', {}) });
function setConfig(blogId, patch) {
  const cur = getConfig(blogId);
  const next = { ...cur, ...patch };
  if (patch.keywords) {
    next.keywords = { ...cur.keywords };
    for (const [logNo, list] of Object.entries(patch.keywords)) {
      if (!/^\d{6,}$/.test(logNo)) throw new InsightError('글 번호 형식이 아닙니다', { code: 'CONFIG' });
      const kws = (Array.isArray(list) ? list : [list]).map(s => String(s).trim()).filter(s => s && s.length <= 40).slice(0, 5);
      if (kws.length) next.keywords[logNo] = kws; else delete next.keywords[logNo];
    }
  }
  if (patch.extraKeywords) next.extraKeywords = [...new Set(patch.extraKeywords.map(s => String(s).trim()).filter(s => s && s.length <= 40))].slice(0, 100);
  store.save(blogId, 'config', next);
  return next;
}

// 글 목록 저장소에 합치기
function mergePosts(db, collected, today) {
  const posts = { ...(db.posts || {}) };
  const seen = new Set();
  for (const p of collected.posts) {
    seen.add(p.logNo);
    const cur = posts[p.logNo] || { firstSeenAt: collected.fetchedAt, history: {} };
    const { comments, sympathy, shares, ...meta } = p;
    const next = { ...cur, ...meta, deletedAt: undefined };
    if (collected.profile.metricsAvailable && (sympathy != null || comments != null)) next.history = { ...cur.history, [today]: { s: sympathy ?? null, c: comments ?? null, sh: shares ?? null } };
    else if (comments != null) next.history = { ...cur.history, [today]: { ...(cur.history[today] || {}), c: comments } };
    for (const d of Object.keys(next.history)) if (daysBetween(d, today) > HISTORY_KEEP_DAYS) delete next.history[d];
    posts[p.logNo] = next;
  }
  // 전체 목록을 다 받았을 때만 사라진 글 표시
  if (collected.posts.length >= (collected.profile.totalPosts || Infinity)) for (const k of Object.keys(posts)) if (!seen.has(k) && !posts[k].deletedAt) posts[k] = { ...posts[k], deletedAt: collected.fetchedAt };
  return { updatedAt: collected.fetchedAt, posts };
}

// 노출 확인 대상 고르기: 오늘 안 본 것 중 한 번도 안 본 글 → 최근 45일 글 → 나머지, 각각 오래전에 본 순
function pickTargets(postsDb, ranksDb, config, today) {
  const kw = (ranksDb && ranksDb.keywords) || {};
  const lastChecked = key => { const h = kw[key] && kw[key].history; const d = h ? Object.keys(h).sort().pop() : null; return d || null; };
  const list = [];
  for (const p of Object.values(postsDb.posts || {})) {
    if (p.deletedAt || p.open === false || p.searchYn === false) continue;
    const kws = (config.keywords && config.keywords[p.logNo]) || [primaryKeyword(p.title)];
    for (const k of kws) {
      const key = norm(k) + '|' + p.logNo;
      const last = lastChecked(key);
      if (last === today) continue;
      const age = p.date ? daysBetween(p.date, today) : 999;
      list.push({ key, keyword: k, logNo: p.logNo, title: p.title, addedAt: p.addedAt || (p.date ? Date.parse(p.date + 'T12:00:00+09:00') : null), tier: !last ? 0 : age <= 45 ? 1 : 2, last: last || '' });
    }
  }
  for (const k of config.extraKeywords || []) {
    const key = norm(k) + '|*';
    const last = lastChecked(key);
    if (last !== today) list.push({ key, keyword: k, logNo: null, title: null, addedAt: null, tier: last ? 1 : 0, last: last || '' });
  }
  return list.sort((a, b) => a.tier - b.tier || a.last.localeCompare(b.last) || (b.addedAt || 0) - (a.addedAt || 0));
}

function mergeRanks(db, results, today) {
  const keywords = { ...(db.keywords || {}) };
  for (const r of results) {
    const key = norm(r.keyword) + '|' + (r.logNo || '*');
    const cur = keywords[key] || { keyword: r.keyword, logNo: r.logNo, history: {} };
    cur.history = { ...cur.history, [today]: { status: r.status, rank: r.tab ? r.tab.rank : null, depth: r.depth ?? null, indexed: r.indexed, smart: r.smart, ai: r.ai, ownHits: r.ownHits, via: r.via, top10AgeDays: r.top10AgeDays ?? null, sections: r.sections } };
    for (const d of Object.keys(cur.history)) if (daysBetween(d, today) > HISTORY_KEEP_DAYS) delete cur.history[d];
    keywords[key] = cur;
  }
  return { updatedAt: Date.now(), keywords };
}

const running = new Set();

async function collect({ blogId, kinds, settings = {}, log = () => { }, deps = {} } = {}) {
  checkBlogId(blogId);
  if (running.has(blogId)) throw new InsightError('이미 이 블로그를 수집하는 중입니다', { code: 'BUSY' });
  running.add(blogId);
  const now = deps.now || Date.now;
  const today = kstDate(now());
  const want = (kinds && kinds.length ? kinds : ['blog', 'exposure', 'keywords', ...(settings.ownerStats ? ['owner'] : [])]).filter(k => KINDS.includes(k));
  const client = deps.client || createClient({ fetch: deps.fetch, sleep: deps.sleep, now, log, hostIntervals: { 'openapi.naver.com': 300, 'naverapihub.apigw.ntruss.com': 300, 'api.searchad.naver.com': 1000 } });
  const creds = await readCreds(deps.getSecret || defaultGetSecret);
  const config = getConfig(blogId);
  const state = store.load(blogId, 'state', {});
  const prevSnap = store.loadSnapshot(blogId, today) || {};
  const snap = { ...prevSnap, date: today, blogId, runs: { ...(prevSnap.runs || {}) } };
  const ran = [], skipped = [], errors = [];
  const mark = (kind, ok, extra = {}) => { snap.runs[kind] = { at: now(), ok, ...extra }; state[kind] = { at: now(), ok }; };

  try {
    let postsDb = store.load(blogId, 'posts', { posts: {} });
    let ranksDb = store.load(blogId, 'ranks', { keywords: {} });
    let kwDb = store.load(blogId, 'keywords', { volumes: {}, related: {} });

    if (want.includes('blog')) {
      try {
        log('블로그 공개 정보 수집 시작');
        const b = await collectBlog({ client, blogId, settings, log, now });
        postsDb = mergePosts(postsDb, b, today); store.save(blogId, 'posts', postsDb);
        snap.profile = { ...b.profile, fetchedAt: b.fetchedAt, source: b.source };
        errors.push(...b.errors.map(e => ({ kind: 'blog', ...e })));
        mark('blog', true, { source: b.source, partial: b.errors.length > 0 }); ran.push('blog');
      } catch (e) { errors.push({ kind: 'blog', source: e.source, message: e.message }); mark('blog', false, { error: e.message }); }
    }

    if (want.includes('exposure')) {
      if (!creds.search && !settings.serp) { skipped.push({ kind: 'exposure', reason: '블로그 검색 API 키가 없고 "검색 화면에서 노출 확인"도 꺼져 있음' }); }
      else {
        try {
          const targets = pickTargets(postsDb, ranksDb, config, today);
          if (!targets.length) skipped.push({ kind: 'exposure', reason: '오늘 확인할 글이 없음(이미 확인함)' });
          else {
            log(`검색 노출 확인: 대상 ${targets.length}건 중 최대 ${settings.maxExposureChecks || (creds.search ? 30 : 10)}건`);
            const x = await collectExposure({ client, blogId, targets, settings, creds: creds.search, log, now });
            ranksDb = mergeRanks(ranksDb, x.results, today); store.save(blogId, 'ranks', ranksDb);
            errors.push(...x.errors.map(e => ({ kind: 'exposure', ...e })));
            mark('exposure', x.results.length > 0, { source: x.source, checked: x.results.length }); ran.push('exposure');
          }
        } catch (e) { errors.push({ kind: 'exposure', source: e.source, message: e.message }); mark('exposure', false, { error: e.message }); }
      }
    }

    if (want.includes('keywords')) {
      if (!creds.ad) skipped.push({ kind: 'keywords', reason: '검색광고 API 키가 없음(검색량·경쟁도·연관 키워드 생략)' });
      else {
        try {
          const all = [...new Set(Object.values(ranksDb.keywords || {}).map(k => k.keyword).concat(config.extraKeywords || []))];
          const stale = all.filter(k => { const v = kwDb.volumes[norm(k)]; return !v || daysBetween(kstDate(v.fetchedAt), today) >= VOLUME_TTL_DAYS; });
          if (!stale.length) skipped.push({ kind: 'keywords', reason: `검색량이 ${VOLUME_TTL_DAYS}일 안에 조회됨` });
          else {
            const k = await collectKeywords({ client, keywords: stale, creds: creds.ad, settings, log, now });
            kwDb = { updatedAt: k.fetchedAt, volumes: { ...kwDb.volumes, ...k.volumes }, related: { ...kwDb.related, ...k.related } };
            store.save(blogId, 'keywords', kwDb);
            errors.push(...k.errors.map(e => ({ kind: 'keywords', ...e })));
            mark('keywords', true, { source: k.source, looked: Object.keys(k.volumes).length }); ran.push('keywords');
          }
        } catch (e) { errors.push({ kind: 'keywords', source: e.source, message: e.message }); mark('keywords', false, { error: e.message }); }
      }
    }

    if (want.includes('owner')) {
      if (!settings.ownerStats) skipped.push({ kind: 'owner', reason: '주인 통계 읽기가 꺼져 있음' });
      else {
        try {
          const o = await collectOwner({ blogId, settings, log, now, launch: deps.launch, fsx: deps.fs, waitMs: deps.ownerWaitMs });
          snap.owner = o; mark('owner', true, { source: o.source }); ran.push('owner');
        } catch (e) {
          if (e.code === 'LOCKED') skipped.push({ kind: 'owner', reason: e.message });
          else errors.push({ kind: 'owner', source: e.source || 'owner', message: e.message });
          mark('owner', false, { error: e.message, code: e.code });
        }
      }
    }

    // KPI 계산해 스냅샷에 남김(추세용)
    const snaps = store.listSnapshots(blogId).filter(d => d !== today).map(d => store.loadSnapshot(blogId, d)).filter(Boolean).concat([snap]);
    const c = metrics.compute({ postsDb, ranksDb, kwDb, snaps, config, profile: snap.profile || {}, owner: snap.owner, today });
    snap.kpis = c.kpis;
    snap.exposure = { checkedPosts: c.exposure.checkedPosts, judged: c.exposure.judged, exposed: c.exposure.exposed, exposureRate: c.exposure.exposureRate, top10: c.exposure.top10 };
    snap.signals = c.signals;
    snap.errors = errors;
    snap.updatedAt = now();
    store.saveSnapshot(blogId, today, snap);
    store.save(blogId, 'state', state);
    return { ok: errors.length === 0, date: today, ran, skipped, errors, kpis: c.kpis };
  } finally { running.delete(blogId); }
}

function latest(blogId) {
  const d = store.listSnapshots(blogId).pop();
  return d ? store.loadSnapshot(blogId, d) : null;
}

function loadAll(blogId) {
  return {
    postsDb: store.load(blogId, 'posts', { posts: {} }), ranksDb: store.load(blogId, 'ranks', { keywords: {} }), kwDb: store.load(blogId, 'keywords', { volumes: {}, related: {} }),
    snaps: store.listSnapshots(blogId).map(d => store.loadSnapshot(blogId, d)).filter(Boolean), config: getConfig(blogId),
  };
}

// metric: KPI 이름(METRICS.md 표 참고) | 'visitors' | 'views' | 'rank:<키워드>' | 'post:<logNo>:sympathy|comments'
function trend(blogId, metric, days = 30, today = kstDate()) {
  checkBlogId(blogId);
  const from = addDays(today, -(days - 1));
  const inRange = d => d >= from && d <= today;
  const all = loadAll(blogId);
  if (metric === 'visitors' || metric === 'views') return metrics.visitorSeries(all.snaps).filter(v => inRange(v.date)).map(v => ({ date: v.date, value: v[metric], source: v.source }));
  if (metric.startsWith('rank:')) {
    const k = norm(metric.slice(5));
    const rows = Object.values(all.ranksDb.keywords || {}).filter(r => norm(r.keyword) === k);
    const out = {};
    for (const r of rows) for (const [d, h] of Object.entries(r.history)) if (inRange(d) && (out[d] == null || (h.rank ?? 999) < (out[d] ?? 999))) out[d] = h.rank ?? null;
    return Object.entries(out).sort().map(([date, value]) => ({ date, value }));
  }
  if (metric.startsWith('post:')) {
    const [, logNo, f] = metric.split(':');
    const p = all.postsDb.posts[logNo]; if (!p) return [];
    const key = { sympathy: 's', comments: 'c', shares: 'sh' }[f] || 's';
    return Object.entries(p.history || {}).filter(([d]) => inRange(d)).sort().map(([date, h]) => ({ date, value: h[key] ?? null }));
  }
  return all.snaps.filter(s => inRange(s.date) && s.kpis && metric in s.kpis).map(s => ({ date: s.date, value: s.kpis[metric] }));
}

const KPI_DEFS = [
  ['totalPosts', '전체 글', '개'], ['posts30', '최근 30일 발행', '편'], ['consistencyScore', '발행 꾸준함', '점'], ['visitors', '일 방문자', '명'],
  ['subscriberCount', '이웃', '명'], ['exposureRate', '노출 성공률', '%'], ['top10', '10위 안 글', '개'], ['avgRank', '평균 순위', '위'],
  ['smartBlock', '스마트블록 노출', '개'], ['aiCited', 'AI 브리핑 인용', '개'], ['estSearchTraffic', '추정 월 검색 유입', '명'], ['readinessScore', '애드포스트 준비도', '점'],
];

async function dashboard(blogId, { settings = {}, today = kstDate(), getSecret } = {}) {
  checkBlogId(blogId);
  const all = loadAll(blogId);
  const last = all.snaps[all.snaps.length - 1] || {};
  const c = metrics.compute({ ...all, profile: last.profile || {}, owner: last.owner || null, today });
  const past = d => { const t = addDays(today, -d); const s = [...all.snaps].reverse().find(x => x.date <= t && x.kpis); return s ? s.kpis : null; };
  const k7 = past(7);
  const kpis = KPI_DEFS.map(([key, label, unit]) => ({ key, label, unit, value: c.kpis[key] ?? null, delta7: k7 && typeof c.kpis[key] === 'number' && typeof k7[key] === 'number' ? Math.round((c.kpis[key] - k7[key]) * 10) / 10 : null, better: key === 'avgRank' ? 'down' : 'up' }));
  // 주간 발행 수(최근 12주)
  const weekly = [];
  for (let w = 11; w >= 0; w--) {
    const end = addDays(today, -w * 7), start = addDays(end, -6);
    weekly.push({ week: start, posts: c.posts.filter(p => p.date && p.date >= start && p.date <= end).length });
  }
  const topKw = c.traffic.rows.slice(0, 5).map(r => r.keyword);
  const creds = await readCreds(getSecret || defaultGetSecret);
  const notes = [];
  if (!creds.search && !settings.serp) notes.push('검색 노출: 블로그 검색 API 키를 넣거나 "검색 화면에서 노출 확인"을 켜면 볼 수 있습니다');
  if (!creds.ad) notes.push('검색량·경쟁도·키워드 추천: 검색광고 API 키가 필요합니다');
  if (!settings.ownerStats) notes.push('조회수·유입 검색어·유입 경로: "주인 통계 읽기"를 켜면 볼 수 있습니다');
  if (settings.strictRobots) notes.push('robots.txt 엄격 모드: 공감·댓글·이웃 수를 모으지 않습니다');
  if (c.visitors.some(v => v.source !== '주인 통계')) notes.push('일 방문자는 누적 방문자 수의 하루 차이로 계산한 근사값입니다(주인 통계를 켜면 정확한 값)');
  return {
    blogId, generatedAt: Date.now(), today,
    profile: last.profile || null, lastRuns: last.runs || {}, due: due(blogId, settings),
    kpis,
    charts: {
      visitors: c.visitors.slice(-60),
      weeklyPosts: weekly,
      exposureRate: trend(blogId, 'exposureRate', 60, today),
      subscribers: trend(blogId, 'subscriberCount', 60, today),
      consistency: trend(blogId, 'consistencyScore', 60, today),
      ranks: topKw.map(k => ({ keyword: k, series: trend(blogId, 'rank:' + k, 60, today) })),
    },
    tables: {
      posts: c.scores, categories: c.cats, keywords: c.traffic.rows,
      timing: c.timing, cadence: c.cad,
      exposure: { ...c.exposure, latest: undefined },
      owner: last.owner ? { date: last.owner.date, keywords: last.owner.keywords, sources: last.owner.sources, topPosts: last.owner.topPosts, demographics: last.owner.demographics } : null,
    },
    checklist: c.readiness,
    signals: c.signals,
    recommendations: c.recs,
    notes,
  };
}

function due(blogId, settings = {}, now = Date.now()) {
  checkBlogId(blogId);
  const st = store.load(blogId, 'state', {});
  const out = {};
  let next = Infinity;
  for (const k of KINDS) {
    if (k === 'owner' && !settings.ownerStats) { out[k] = false; continue; }
    const at = st[k] && st[k].at;
    const ok = st[k] && st[k].ok;
    // 실패했으면 3시간 뒤 다시
    const wait = (ok === false ? 3 : INTERVAL_H[k]) * 3600000;
    out[k] = !at || now - at >= wait;
    next = Math.min(next, at ? at + wait : now);
  }
  out.kinds = KINDS.filter(k => out[k] === true);
  out.nextAt = Number.isFinite(next) ? new Date(next).toISOString() : null;
  return out;
}

module.exports = { collect, latest, trend, dashboard, due, getConfig, setConfig, configFields, KINDS, _internal: { mergePosts, pickTargets, mergeRanks, readCreds } };
