// 육성 지표 계산 — 네트워크 없음, 저장된 데이터만으로 계산 (정의는 METRICS.md)
'use strict';
const { kstDate, kstParts, addDays, daysBetween, round, sum, avg, clamp, median, pctRank } = require('./lib/util');
const { norm, keywordPosition, tokens } = require('./lib/keyword');

const DEFAULT_GOALS = { postsPer30: 20 };
// 애드포스트 기준: 네이버는 숫자 기준을 공식 공개하지 않는다. 90일은 여러 자료 공통, 50글·일 100명은 업계 통설.
const DEFAULT_ADPOST = { minDays: 90, minPosts: 50, minDailyVisitors: 100 };
// 순위별 클릭률 추정(블로그 탭, 가정값 — 설정 ctrCurve 로 바꿀 수 있음)
const CTR_CURVE = [[1, 0.25], [2, 0.15], [3, 0.10], [5, 0.07], [10, 0.04], [20, 0.015], [30, 0.007], [100, 0.001]];
const ctrOf = (rank, curve = CTR_CURVE) => { if (rank == null) return 0; for (const [r, c] of curve) if (rank <= r) return c; return 0; };
// 순위 점수(dentalbox blog-index rankScore 이식)
function rankScore(rank) {
  if (rank == null) return 0;
  if (rank <= 1) return 100; if (rank <= 2) return 88; if (rank <= 3) return 78; if (rank <= 5) return 68;
  if (rank <= 10) return 52; if (rank <= 20) return 32; if (rank <= 30) return 18; if (rank <= 50) return 8; if (rank <= 100) return 3; return 0;
}
const COMP_W = { '낮음': 1, '중간': 0.6, '높음': 0.3 };
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

const postList = postsDb => Object.values((postsDb && postsDb.posts) || {}).filter(p => !p.deletedAt);
const lastHist = p => { const h = p.history || {}; const k = Object.keys(h).sort().pop(); return k ? h[k] : {}; };

// ── 발행 꾸준함 ──
function cadence(posts, today, goals = DEFAULT_GOALS) {
  const days = [...new Set(posts.map(p => p.date).filter(Boolean))].sort();
  const inLast = n => posts.filter(p => p.date && daysBetween(p.date, today) < n && daysBetween(p.date, today) >= 0).length;
  const posts7 = inLast(7), posts28 = inLast(28), posts30 = inLast(30), posts90 = inLast(90);
  const d90 = days.filter(d => daysBetween(d, today) < 90);
  const gaps = d90.slice(1).map((d, i) => daysBetween(d90[i], d));
  const lastDate = days[days.length - 1] || null;
  const currentGap = lastDate ? daysBetween(lastDate, today) : null;
  const maxGap = Math.max(currentGap ?? 0, ...(gaps.length ? gaps : [0]));
  let activeWeeks = 0;
  for (let w = 0; w < 4; w++) if (posts.some(p => p.date && daysBetween(p.date, today) >= w * 7 && daysBetween(p.date, today) < w * 7 + 7)) activeWeeks++;
  const target28 = (goals.postsPer30 || 20) * 28 / 30;
  const score = posts.length ? Math.round(40 * activeWeeks / 4 + 40 * Math.min(posts28 / target28, 1) + 20 * clamp(1 - (maxGap - 3) / 11, 0, 1)) : 0;
  return { posts7, posts28, posts30, posts90, perWeek: round(posts28 / 4), goal30: goals.postsPer30 || 20, goalPct: Math.round(posts30 / (goals.postsPer30 || 20) * 100), avgGap: round(avg(gaps)), maxGap90: maxGap, currentGap, lastDate, activeWeeks, consistencyScore: score, firstDate: days[0] || null };
}

// 글별 최신 노출 결과(ranks.json → logNo 기준)
function latestExposureByPost(ranksDb) {
  const out = {};
  for (const k of Object.values((ranksDb && ranksDb.keywords) || {})) {
    const dates = Object.keys(k.history || {}).sort();
    if (!dates.length || !k.logNo) continue;
    const e = { keyword: k.keyword, date: dates[dates.length - 1], ...k.history[dates[dates.length - 1]] };
    const prev = out[k.logNo];
    // 한 글에 키워드가 여럿이면 가장 좋은 순위를 대표로
    if (!prev || (e.rank ?? 999) < (prev.rank ?? 999) || (prev.status !== 'EXPOSED' && e.status === 'EXPOSED')) out[k.logNo] = { ...e, all: [...((prev && prev.all) || []), e] };
    else prev.all.push(e);
  }
  return out;
}

// ── 노출 요약 ──
function exposureSummary(ranksDb, posts) {
  const latest = latestExposureByPost(ranksDb);
  const rows = Object.entries(latest).map(([logNo, e]) => ({ logNo, ...e }));
  const judged = rows.filter(r => r.status && !['PENDING', 'UNCHECKED'].includes(r.status));
  const exposed = judged.filter(r => r.status === 'EXPOSED');
  const ranks = exposed.map(r => r.rank).filter(n => typeof n === 'number');
  const kwRows = Object.values((ranksDb && ranksDb.keywords) || {});
  return {
    checkedPosts: rows.length, judged: judged.length, exposed: exposed.length,
    exposureRate: judged.length ? Math.round(exposed.length / judged.length * 100) : null,
    top10: ranks.filter(r => r <= 10).length, top3: ranks.filter(r => r <= 3).length,
    avgRank: ranks.length ? round(avg(ranks)) : null, medianRank: median(ranks),
    smartBlock: rows.filter(r => (r.smart || []).some(s => s.target)).length,
    aiCited: rows.filter(r => r.ai && r.ai.cited).length,
    missing: rows.filter(r => r.status === 'MISSING').length, outOfRange: rows.filter(r => r.status === 'OUT_OF_RANGE').length,
    pending: rows.filter(r => r.status === 'PENDING').length,
    cannibal: kwRows.map(k => { const d = Object.keys(k.history || {}).sort().pop(); const h = d ? k.history[d] : null; return h && (h.ownHits || []).length >= 2 ? { keyword: k.keyword, posts: h.ownHits } : null; }).filter(Boolean),
    coverage: posts.length ? Math.round(rows.length / posts.length * 100) : null,
    latest,
  };
}

// 키워드 검색량 맵 가져오기
const volOf = (kwDb, kw) => (kwDb && kwDb.volumes && kwDb.volumes[norm(kw)]) || null;

// ── 검색 유입 추정(키워드 검색량 × 순위별 클릭률) ──
function searchTraffic(ranksDb, kwDb, curve) {
  let total = 0; const rows = [];
  for (const k of Object.values((ranksDb && ranksDb.keywords) || {})) {
    const d = Object.keys(k.history || {}).sort().pop(); if (!d) continue;
    const h = k.history[d]; const v = volOf(kwDb, k.keyword);
    if (!v) continue;
    const est = Math.round(v.total * ctrOf(h.rank, curve));
    total += est;
    rows.push({ keyword: k.keyword, volume: v.total, compIdx: v.compIdx, rank: h.rank ?? null, estMonthly: est, potentialTop3: Math.round(v.total * ctrOf(3, curve)) });
  }
  return { estMonthly: total, rows: rows.sort((a, b) => b.potentialTop3 - a.potentialTop3) };
}

// ── 글별 성과 점수 ──
function postScores(posts, latest, today, kwDb) {
  const eng = p => { const h = lastHist(p); return (h.s || 0) + 2 * (h.c || 0) + 3 * (h.sh || 0); };
  // 나이 보정: 발행 후 7일 미만은 반응이 덜 쌓였으므로 7일 기준으로 환산
  const engRate = p => { const age = p.date ? Math.max(daysBetween(p.date, today), 1) : 30; return eng(p) * (age < 7 ? 7 / age : 1); };
  const all = posts.map(engRate);
  return posts.map(p => {
    const e = latest[p.logNo];
    const h = lastHist(p);
    const kw = e ? e.keyword : null;
    const v = kw ? volOf(kwDb, kw) : null;
    const engPct = pctRank(all, engRate(p)) ?? 0;
    const expo = e ? (e.status === 'EXPOSED' ? Math.max(rankScore(e.rank), (e.smart || []).some(s => s.target) ? 60 : 0) : 0) : null;
    const score = Math.round(expo == null ? engPct * 100 : 50 * engPct + 50 * expo / 100);
    return {
      logNo: p.logNo, title: p.title, date: p.date, category: p.categoryName || p.categoryNo || '(분류 없음)',
      sympathy: h.s ?? null, comments: h.c ?? null, shares: h.sh ?? null, images: p.images ?? null, tags: (p.tags || []).length,
      keyword: kw, rank: e ? e.rank ?? null : null, status: e ? e.status : 'UNCHECKED', smart: e ? (e.smart || []).filter(s => s.target).map(s => `${s.label} ${s.pos}위`) : [],
      aiCited: !!(e && e.ai && e.ai.cited), volume: v ? v.total : null,
      titleLen: (p.title || '').length, kwInTitle: kw ? keywordPosition(p.title, kw) : null,
      score,
    };
  }).sort((a, b) => b.score - a.score);
}

// ── 카테고리별 효율 ──
function categoryStats(scores) {
  const g = {};
  for (const s of scores) (g[s.category] = g[s.category] || []).push(s);
  return Object.entries(g).map(([name, a]) => {
    const judged = a.filter(x => !['UNCHECKED', 'PENDING'].includes(x.status));
    return {
      category: name, posts: a.length,
      avgSympathy: round(avg(a.map(x => x.sympathy || 0))), avgComments: round(avg(a.map(x => x.comments || 0))),
      exposureRate: judged.length ? Math.round(judged.filter(x => x.status === 'EXPOSED').length / judged.length * 100) : null,
      avgScore: Math.round(avg(a.map(x => x.score)) || 0),
    };
  }).sort((a, b) => b.avgScore - a.avgScore);
}

// ── 요일·시간대별 발행 효과 ──
function timing(posts, scores) {
  const byNo = Object.fromEntries(scores.map(s => [s.logNo, s]));
  const wd = WEEKDAY.map((n, i) => ({ key: i, label: n, posts: 0, scores: [], exposed: 0, judged: 0 }));
  const hr = [['새벽', 0, 6], ['오전', 6, 12], ['오후', 12, 18], ['저녁', 18, 24]].map(([label, a, b]) => ({ label, from: a, to: b, posts: 0, scores: [], exposed: 0, judged: 0 }));
  let exact = 0;
  for (const p of posts) {
    const s = byNo[p.logNo]; if (!s) continue;
    const t = p.addedAt || (p.date ? Date.parse(p.date + 'T12:00:00+09:00') : null); if (!t) continue;
    const { weekday, hour } = kstParts(t);
    const buckets = [wd[weekday]];
    if (p.addedAt) { exact++; buckets.push(hr.find(h => hour >= h.from && hour < h.to)); }
    for (const b of buckets) { b.posts++; b.scores.push(s.score); if (!['UNCHECKED', 'PENDING'].includes(s.status)) { b.judged++; if (s.status === 'EXPOSED') b.exposed++; } }
  }
  const fin = b => ({ label: b.label, posts: b.posts, avgScore: b.posts ? Math.round(avg(b.scores)) : null, exposureRate: b.judged ? Math.round(b.exposed / b.judged * 100) : null, enough: b.posts >= 3 });
  return { weekday: wd.map(fin), hourBand: hr.map(fin), exactTimes: exact };
}

// ── 방문자 시계열: 주인 통계(정확) 우선, 없으면 누적 방문자 차이(근사) ──
function visitorSeries(snaps) {
  const owner = {};
  for (const s of snaps) for (const d of ((s.owner && s.owner.daily) || [])) owner[d.date] = d;
  const pub = [];
  for (let i = 1; i < snaps.length; i++) {
    const a = snaps[i - 1], b = snaps[i];
    const ta = a.profile && a.profile.totalVisitorCount, tb = b.profile && b.profile.totalVisitorCount;
    if (ta == null || tb == null || tb < ta) continue;
    const gap = Math.max(daysBetween(a.date, b.date), 1);
    pub.push({ date: b.date, visitors: Math.round((tb - ta) / gap), approx: true });
  }
  const map = {};
  for (const p of pub) map[p.date] = { date: p.date, visitors: p.visitors, views: null, source: '누적 방문자 차이(근사)' };
  for (const d of Object.values(owner)) map[d.date] = { date: d.date, visitors: d.visitors ?? (map[d.date] && map[d.date].visitors) ?? null, views: d.views ?? null, source: '주인 통계' };
  return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
}

// ── 저품질 의심 신호 ──
function lowQualitySignals({ snaps, ranksDb, posts, today, visitors }) {
  const sig = [];
  // 1) 노출률 급락: 최근 3회 평균이 이전 14회 평균의 절반 이하
  const er = snaps.map(s => s.kpis && s.kpis.exposureRate).filter(v => typeof v === 'number');
  if (er.length >= 6) {
    const recent = avg(er.slice(-3)), before = avg(er.slice(-17, -3));
    if (before >= 20 && recent <= before * 0.5) sig.push({ level: 'high', code: 'EXPOSURE_DROP', message: `노출률이 ${Math.round(before)}% → ${Math.round(recent)}%로 떨어졌습니다` });
  }
  // 2) 새 글 연속 미노출: 발행 1~10일 지난 최근 글 5개가 모두 노출 안 됨 (dentalbox LOWQUALITY_STREAK=5)
  const latest = latestExposureByPost(ranksDb);
  const recentPosts = posts.filter(p => p.date && daysBetween(p.date, today) >= 1 && daysBetween(p.date, today) <= 10 && latest[p.logNo] && !['PENDING', 'UNCHECKED'].includes(latest[p.logNo].status)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  if (recentPosts.length >= 5 && recentPosts.every(p => latest[p.logNo].status !== 'EXPOSED')) sig.push({ level: 'high', code: 'NEW_POSTS_UNEXPOSED', message: '최근 글 5개가 모두 검색에 노출되지 않았습니다' });
  const missing = recentPosts.filter(p => latest[p.logNo].status === 'MISSING');
  if (missing.length >= 2) sig.push({ level: 'mid', code: 'NOT_INDEXED', message: `최근 글 ${missing.length}개가 검색 결과에 아예 없습니다(색인 누락)` });
  // 3) 노출되던 키워드 이탈: 전날 30위 안 → 오늘 밖이 3개 이상
  let lost = 0;
  for (const k of Object.values((ranksDb && ranksDb.keywords) || {})) {
    const ds = Object.keys(k.history || {}).sort(); if (ds.length < 2) continue;
    const a = k.history[ds[ds.length - 2]], b = k.history[ds[ds.length - 1]];
    if (a.rank != null && a.rank <= 30 && (b.rank == null || b.rank > 30) && daysBetween(ds[ds.length - 2], ds[ds.length - 1]) <= 3) lost++;
  }
  if (lost >= 3) sig.push({ level: 'mid', code: 'RANK_LOST', message: `상위 30위 안에 있던 키워드 ${lost}개가 한 번에 빠졌습니다` });
  // 4) 방문자 급감: 최근 7일 평균이 이전 21일 평균의 50% 이하
  const v = visitors.map(x => x.visitors).filter(n => typeof n === 'number');
  if (v.length >= 14) {
    const r7 = avg(v.slice(-7)), b21 = avg(v.slice(-28, -7));
    if (b21 >= 10 && r7 <= b21 * 0.5) sig.push({ level: 'mid', code: 'VISITOR_DROP', message: `일 방문자가 ${Math.round(b21)}명 → ${Math.round(r7)}명으로 줄었습니다` });
  }
  // 5) 검색 비허용·비공개 글
  const hidden = posts.filter(p => p.searchYn === false || p.open === false).length;
  if (hidden) sig.push({ level: 'low', code: 'HIDDEN_POSTS', message: `검색 비허용이거나 전체공개가 아닌 글이 ${hidden}개 있습니다` });
  return sig;
}

// ── 애드포스트 준비도 ──
function adpostReadiness({ cad, profile, visitors, signals, posts, today, adpost = DEFAULT_ADPOST }) {
  const items = [];
  const ageDays = cad.firstDate ? daysBetween(cad.firstDate, today) : null;
  items.push({ key: 'age', label: `블로그 운영 ${adpost.minDays}일 이상`, value: ageDays, target: adpost.minDays, unit: '일', status: ageDays == null ? 'unknown' : ageDays >= adpost.minDays ? 'ok' : 'todo', note: '공개된 개설일이 없어 첫 글 날짜로 계산', progress: ageDays == null ? 0 : Math.min(ageDays / adpost.minDays, 1) });
  const nPosts = profile.totalPosts ?? posts.length;
  items.push({ key: 'posts', label: `게시글 ${adpost.minPosts}개 이상`, value: nPosts, target: adpost.minPosts, unit: '개', status: nPosts >= adpost.minPosts ? 'ok' : 'todo', progress: Math.min(nPosts / adpost.minPosts, 1) });
  const v30 = visitors.filter(x => daysBetween(x.date, today) <= 30 && typeof x.visitors === 'number');
  const avgV = v30.length ? Math.round(avg(v30.map(x => x.visitors))) : null;
  items.push({ key: 'visitors', label: `일 방문자 ${adpost.minDailyVisitors}명 이상(최근 30일 평균)`, value: avgV, target: adpost.minDailyVisitors, unit: '명', status: avgV == null ? 'unknown' : avgV >= adpost.minDailyVisitors ? 'ok' : 'todo', note: v30.length < 7 ? `방문자 기록 ${v30.length}일치(7일 이상 쌓여야 정확)` : null, progress: avgV == null ? 0 : Math.min(avgV / adpost.minDailyVisitors, 1) });
  items.push({ key: 'cadence', label: '최근 4주 매주 발행', value: cad.activeWeeks, target: 4, unit: '주', status: cad.activeWeeks >= 4 ? 'ok' : 'todo', progress: cad.activeWeeks / 4 });
  const bad = signals.filter(s => s.level === 'high');
  items.push({ key: 'quality', label: '저품질 의심 신호 없음', value: bad.length, target: 0, unit: '건', status: bad.length ? 'todo' : 'ok', progress: bad.length ? 0 : 1 });
  const hidden = posts.filter(p => p.searchYn === false || p.open === false).length;
  items.push({ key: 'public', label: '모든 글 전체공개·검색 허용', value: hidden, target: 0, unit: '개 예외', status: hidden ? 'todo' : 'ok', progress: posts.length ? 1 - hidden / posts.length : 1 });
  const W = { age: 20, posts: 25, visitors: 30, cadence: 10, quality: 10, public: 5 };
  const score = Math.round(sum(items.map(i => W[i.key] * i.progress)));
  const eta = [];
  if (ageDays != null && ageDays < adpost.minDays) eta.push({ label: '운영 기간 충족', date: addDays(cad.firstDate, adpost.minDays) });
  if (nPosts < adpost.minPosts && cad.posts28 > 0) eta.push({ label: '글 수 충족(현재 속도)', date: addDays(today, Math.ceil((adpost.minPosts - nPosts) / (cad.posts28 / 28))) });
  return { score, items, eta, criteriaNote: '네이버는 애드포스트 승인 숫자 기준을 공개하지 않습니다. 90일·50글·일 100명은 널리 쓰이는 참고 기준이며 설정에서 바꿀 수 있습니다.' };
}

// ── 추천 ──
function recommendations({ scores, exposure, kwDb, ranksDb, posts, cad, timingRes, owner, traffic, config }) {
  const recs = [];
  const myTokens = new Set(posts.flatMap(p => [...tokens(p.title), ...(p.tags || []).flatMap(tokens), ...tokens(p.categoryName)]));
  const targeted = new Set(Object.values((ranksDb && ranksDb.keywords) || {}).map(k => norm(k.keyword)));
  // 1) 다음에 쓸 키워드: 연관 키워드 중 검색량 있고, 아직 안 노린, 내 주제와 맞는 것
  const cand = new Map();
  for (const [hint, rel] of Object.entries((kwDb && kwDb.related) || {})) for (const r of rel) {
    const k = norm(r.keyword); if (targeted.has(k) || cand.has(k) || r.total < 30) continue;
    const overlap = tokens(r.keyword).filter(t => myTokens.has(t)).length + ([...myTokens].some(t => k.includes(t) && t.length >= 3) ? 1 : 0);
    if (!overlap) continue;
    cand.set(k, { keyword: r.keyword, volume: r.total, compIdx: r.compIdx, mobileShare: r.mobileShare, from: hint, score: round(Math.log10(r.total + 10) * (COMP_W[r.compIdx] ?? 0.5) * Math.min(1 + overlap * 0.25, 2), 2) });
  }
  // 주인 통계 유입 검색어 중 아직 안 노린 것(이미 사람들이 이 말로 들어옴)
  for (const k of (owner && owner.keywords) || []) {
    const nk = norm(k.keyword); if (!nk || targeted.has(nk)) continue;
    const v = volOf(kwDb, k.keyword);
    const prev = cand.get(nk);
    cand.set(nk, { ...(prev || { keyword: k.keyword, volume: v ? v.total : null, compIdx: v ? v.compIdx : null }), inflow: k.value, score: round(((prev && prev.score) || 1) + 1, 2) });
  }
  const newKw = [...cand.values()].sort((a, b) => b.score - a.score).slice(0, 15);
  if (newKw.length) recs.push({ type: 'NEW_KEYWORD', priority: 1, title: '다음 글 키워드 후보', reason: '검색량이 있고 경쟁이 낮은데 아직 내 글이 없는 키워드', items: newKw });
  // 2) 순위 끌어올리기: 11~30위
  const push = scores.filter(s => s.rank != null && s.rank > 10 && s.rank <= 30).map(s => ({ logNo: s.logNo, title: s.title, keyword: s.keyword, rank: s.rank, volume: s.volume })).sort((a, b) => (b.volume || 0) - (a.volume || 0));
  if (push.length) recs.push({ type: 'PUSH_TOP10', priority: 2, title: '조금만 올리면 1쪽(10위 안)', reason: '11~30위 글 — 제목 앞에 키워드, 본문 보강, 같은 주제 후속 글로 연결', items: push.slice(0, 10) });
  // 3) 미노출 글 점검
  const miss = scores.filter(s => s.status === 'MISSING').map(s => ({ logNo: s.logNo, title: s.title, keyword: s.keyword, date: s.date }));
  if (miss.length) recs.push({ type: 'FIX_MISSING', priority: 1, title: '검색에 없는 글', reason: '발행 24시간이 지났는데 제목으로 검색해도 안 나옴 — 중복 문서·금칙어·외부 링크 과다 여부 확인', items: miss });
  // 4) 키워드 잠식
  if (exposure.cannibal.length) recs.push({ type: 'CANNIBAL', priority: 3, title: '내 글끼리 같은 키워드 경쟁', reason: '한 키워드에 내 글 2개 이상 — 하나에 집중하고 다른 글은 세부 키워드로', items: exposure.cannibal });
  // 5) 제목 점검
  const titleFix = scores.filter(s => s.keyword && (s.kwInTitle === -1 || s.kwInTitle > 10 || s.titleLen < 12 || s.titleLen > 45)).map(s => ({ logNo: s.logNo, title: s.title, keyword: s.keyword, issue: s.kwInTitle === -1 ? '제목에 키워드 없음' : s.kwInTitle > 10 ? '키워드가 제목 뒤쪽' : s.titleLen < 12 ? '제목이 짧음' : '제목이 김' }));
  if (titleFix.length) recs.push({ type: 'TITLE', priority: 3, title: '제목 손볼 글', reason: '키워드는 제목 앞쪽, 길이 12~45자', items: titleFix.slice(0, 10) });
  // 6) 사진 적은 글
  const fewImg = scores.filter(s => s.images != null && s.images < 3).map(s => ({ logNo: s.logNo, title: s.title, images: s.images }));
  if (fewImg.length) recs.push({ type: 'IMAGES', priority: 4, title: '사진 3장 미만 글', reason: '사진·도표가 적은 글은 체류 시간이 짧아지기 쉬움', items: fewImg.slice(0, 10) });
  // 7) 발행 공백
  if (cad.currentGap != null && cad.currentGap >= 3) recs.push({ type: 'GAP', priority: 1, title: `${cad.currentGap}일째 새 글 없음`, reason: `최근 30일 ${cad.posts30}편 / 목표 ${cad.goal30}편`, items: [] });
  // 8) 발행 시간대
  const bestHour = timingRes.hourBand.filter(h => h.enough && h.avgScore != null).sort((a, b) => b.avgScore - a.avgScore)[0];
  const bestDay = timingRes.weekday.filter(h => h.enough && h.avgScore != null).sort((a, b) => b.avgScore - a.avgScore)[0];
  if (bestHour || bestDay) recs.push({ type: 'TIMING', priority: 4, title: '반응 좋았던 발행 때', reason: '글 3편 이상 쌓인 요일·시간대 중 평균 성과 점수가 가장 높은 곳', items: [bestDay && { kind: '요일', label: bestDay.label, avgScore: bestDay.avgScore, posts: bestDay.posts }, bestHour && { kind: '시간대', label: bestHour.label, avgScore: bestHour.avgScore, posts: bestHour.posts }].filter(Boolean) });
  // 9) 검색량 큰데 순위 낮은 키워드(기회)
  const opp = traffic.rows.filter(r => r.rank == null || r.rank > 10).slice(0, 10);
  if (opp.length) recs.push({ type: 'OPPORTUNITY', priority: 2, title: '검색량 대비 손해 보는 키워드', reason: '3위 안에 들면 기대되는 월 유입이 큰 순', items: opp });
  return recs.sort((a, b) => a.priority - b.priority);
}

// 스냅샷에 저장할 숫자 KPI (trend 용)
function kpisFrom(d) {
  const lastV = d.visitors.length ? d.visitors[d.visitors.length - 1] : null;
  return {
    totalPosts: d.profile.totalPosts ?? null, subscriberCount: d.profile.subscriberCount ?? null, totalVisitorCount: d.profile.totalVisitorCount ?? null,
    visitors: lastV ? lastV.visitors : null, views: lastV ? lastV.views : null,
    posts7: d.cad.posts7, posts30: d.cad.posts30, consistencyScore: d.cad.consistencyScore, currentGap: d.cad.currentGap,
    sympathyTotal: sum(d.posts.map(p => lastHist(p).s || 0)), commentTotal: sum(d.posts.map(p => lastHist(p).c || 0)),
    exposureRate: d.exposure.exposureRate, exposed: d.exposure.exposed, top10: d.exposure.top10, avgRank: d.exposure.avgRank, smartBlock: d.exposure.smartBlock, aiCited: d.exposure.aiCited,
    estSearchTraffic: d.traffic.estMonthly, readinessScore: d.readiness.score, signals: d.signals.length,
  };
}

// 전체 계산 (dashboard·snapshot kpis 공용)
function compute({ postsDb, ranksDb, kwDb, snaps, config = {}, profile = {}, owner = null, today = kstDate() }) {
  const posts = postList(postsDb);
  const goals = { ...DEFAULT_GOALS, ...(config.goals || {}) };
  const cad = cadence(posts, today, goals);
  const exposure = exposureSummary(ranksDb, posts);
  const traffic = searchTraffic(ranksDb, kwDb, config.ctrCurve);
  const scores = postScores(posts, exposure.latest, today, kwDb);
  const cats = categoryStats(scores);
  const timingRes = timing(posts, scores);
  const visitors = visitorSeries(snaps);
  const signals = lowQualitySignals({ snaps, ranksDb, posts, today, visitors });
  const readiness = adpostReadiness({ cad, profile, visitors, signals, posts, today, adpost: { ...DEFAULT_ADPOST, ...(config.adpost || {}) } });
  const recs = recommendations({ scores, exposure, kwDb, ranksDb, posts, cad, timingRes, owner, traffic, config });
  const out = { today, posts, cad, exposure, traffic, scores, cats, timing: timingRes, visitors, signals, readiness, recs, profile };
  out.kpis = kpisFrom(out);
  return out;
}

module.exports = { compute, cadence, exposureSummary, searchTraffic, postScores, categoryStats, timing, visitorSeries, lowQualitySignals, adpostReadiness, recommendations, rankScore, ctrOf, latestExposureByPost, DEFAULT_ADPOST, DEFAULT_GOALS, CTR_CURVE, WEEKDAY };
