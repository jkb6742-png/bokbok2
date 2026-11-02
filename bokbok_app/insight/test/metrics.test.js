'use strict';
const test = require('node:test'), assert = require('node:assert');
const M = require('../metrics');
const { addDays } = require('../lib/util');

const TODAY = '2026-11-01';
const mk = (n, daysAgo, extra = {}) => ({ logNo: String(224400000000 + n), title: `INFP 특징 글 ${n}`, date: addDays(TODAY, -daysAgo), categoryName: extra.cat || 'MBTI', history: { [TODAY]: { s: extra.s ?? 1, c: extra.c ?? 0, sh: 0 } }, images: extra.images ?? 4, tags: ['INFP'], searchYn: true, open: true, ...extra });

test('발행 꾸준함: 4주 매주, 28일 10편, 최대 공백', () => {
  const posts = [0, 2, 5, 8, 11, 14, 17, 20, 23, 26].map((d, i) => mk(i, d));
  const c = M.cadence(posts, TODAY, { postsPer30: 20 });
  assert.strictEqual(c.posts28, 10);
  assert.strictEqual(c.activeWeeks, 4);
  assert.strictEqual(c.maxGap90, 3);
  assert.strictEqual(c.currentGap, 0);
  // 40*1 + 40*min(10/18.67,1) + 20*1 = 81
  assert.strictEqual(c.consistencyScore, 81);
  assert.strictEqual(c.goalPct, 50);
});

test('발행 공백 길면 점수 깎임', () => {
  const posts = [20, 21].map((d, i) => mk(i, d));
  const c = M.cadence(posts, TODAY);
  assert.strictEqual(c.currentGap, 20);
  assert.strictEqual(c.activeWeeks, 2);
  assert.ok(c.consistencyScore < 30);
});

const rankDb = entries => ({ keywords: Object.fromEntries(entries.map(([kw, logNo, hist]) => [kw + '|' + logNo, { keyword: kw, logNo, history: hist }])) });

test('노출 요약·글 점수·검색 유입 추정', () => {
  const posts = [mk(1, 3), mk(2, 4), mk(3, 5)];
  const r = rankDb([
    ['INFP 특징', posts[0].logNo, { [TODAY]: { status: 'EXPOSED', rank: 2, smart: [{ label: '인기글·스마트블록', pos: 1, target: true }], ai: { cited: true } } }],
    ['INFJ 특징', posts[1].logNo, { [TODAY]: { status: 'EXPOSED', rank: 15, ownHits: [{ logNo: 'a', rank: 15 }, { logNo: 'b', rank: 40 }] } }],
    ['ENFP 특징', posts[2].logNo, { [TODAY]: { status: 'MISSING', rank: null } }],
  ]);
  const kw = { volumes: { 'infp특징': { total: 10000, compIdx: '중간' }, 'infj특징': { total: 5000, compIdx: '낮음' } }, related: {} };
  const e = M.exposureSummary(r, posts);
  assert.strictEqual(e.exposureRate, 67);
  assert.strictEqual(e.top10, 1);
  assert.strictEqual(e.smartBlock, 1);
  assert.strictEqual(e.aiCited, 1);
  assert.strictEqual(e.cannibal.length, 1);
  const t = M.searchTraffic(r, kw);
  assert.strictEqual(t.estMonthly, 10000 * 0.15 + 5000 * 0.015);
  const s = M.postScores(posts, e.latest, TODAY, kw);
  assert.strictEqual(s[0].logNo, posts[0].logNo);
  assert.strictEqual(s[s.length - 1].status, 'MISSING');
});

test('저품질 신호: 최근 글 5개 연속 미노출 + 색인 누락', () => {
  const posts = [1, 2, 3, 4, 5].map(d => mk(d, d));
  const r = rankDb(posts.map((p, i) => ['k' + i, p.logNo, { [TODAY]: { status: i < 3 ? 'MISSING' : 'OUT_OF_RANGE', rank: null } }]));
  const sig = M.lowQualitySignals({ snaps: [], ranksDb: r, posts, today: TODAY, visitors: [] });
  assert.ok(sig.some(s => s.code === 'NEW_POSTS_UNEXPOSED' && s.level === 'high'));
  assert.ok(sig.some(s => s.code === 'NOT_INDEXED'));
});

test('저품질 신호: 노출률 급락·방문자 급감', () => {
  const snaps = Array.from({ length: 20 }, (_, i) => ({ date: addDays(TODAY, i - 19), kpis: { exposureRate: i < 17 ? 60 : 20 } }));
  const visitors = Array.from({ length: 28 }, (_, i) => ({ date: addDays(TODAY, i - 27), visitors: i < 21 ? 100 : 30 }));
  const sig = M.lowQualitySignals({ snaps, ranksDb: { keywords: {} }, posts: [], today: TODAY, visitors });
  assert.ok(sig.some(s => s.code === 'EXPOSURE_DROP'));
  assert.ok(sig.some(s => s.code === 'VISITOR_DROP'));
});

test('방문자: 누적 방문자 차이(근사), 주인 통계가 있으면 우선', () => {
  const snaps = [
    { date: '2026-10-29', profile: { totalVisitorCount: 1000 } },
    { date: '2026-10-30', profile: { totalVisitorCount: 1050 } },
    { date: '2026-11-01', profile: { totalVisitorCount: 1150 }, owner: { daily: [{ date: '2026-11-01', views: 90, visitors: 70 }] } },
  ];
  const v = M.visitorSeries(snaps);
  assert.deepStrictEqual(v.map(x => [x.date, x.visitors]), [['2026-10-30', 50], ['2026-11-01', 70]]);
  assert.strictEqual(v[1].source, '주인 통계');
});

test('애드포스트 준비도: 항목·점수·예상일', () => {
  const posts = Array.from({ length: 14 }, (_, i) => mk(i, i * 2));
  const cad = M.cadence(posts, TODAY);
  const r = M.adpostReadiness({ cad, profile: { totalPosts: 14 }, visitors: [{ date: TODAY, visitors: 50 }], signals: [], posts, today: TODAY });
  const byKey = Object.fromEntries(r.items.map(i => [i.key, i]));
  assert.strictEqual(byKey.posts.status, 'todo');
  assert.strictEqual(byKey.age.value, 26);
  assert.strictEqual(byKey.visitors.value, 50);
  assert.ok(r.score > 0 && r.score < 100);
  assert.ok(r.eta.some(e => e.label.startsWith('운영 기간')));
  assert.match(r.criteriaNote, /공개하지 않습니다/);
});

test('추천: 주제 맞는 연관 키워드만, 11~30위 끌어올리기, 공백 경고', () => {
  const posts = [mk(1, 5, { title: 'INFP 특징 정리' })];
  const r = rankDb([['INFP 특징', posts[0].logNo, { [TODAY]: { status: 'EXPOSED', rank: 14 } }]]);
  const kw = { volumes: { 'infp특징': { total: 21200, compIdx: '중간' } }, related: { 'infp특징': [
    { keyword: 'INFP연애', total: 8000, compIdx: '낮음' }, { keyword: '강아지사료', total: 35000, compIdx: '높음' }, { keyword: 'INFP특징', total: 21200, compIdx: '중간' }] } };
  const c = M.compute({ postsDb: { posts: Object.fromEntries(posts.map(p => [p.logNo, p])) }, ranksDb: r, kwDb: kw, snaps: [], today: TODAY, owner: { keywords: [{ keyword: 'infp 직장', value: 0.3 }] } });
  const nk = c.recs.find(x => x.type === 'NEW_KEYWORD');
  assert.ok(nk.items.some(i => i.keyword === 'INFP연애'));
  assert.ok(!nk.items.some(i => i.keyword === '강아지사료'));
  assert.ok(!nk.items.some(i => i.keyword === 'INFP특징'));   // 이미 노리는 키워드 제외
  assert.ok(nk.items.some(i => i.keyword === 'infp 직장' && i.inflow === 0.3));
  assert.strictEqual(c.recs.find(x => x.type === 'PUSH_TOP10').items[0].rank, 14);
  assert.ok(c.recs.some(x => x.type === 'GAP'));
  assert.strictEqual(typeof c.kpis.readinessScore, 'number');
});
