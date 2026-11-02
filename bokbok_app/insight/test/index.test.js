'use strict';
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path'), os = require('os');
const { fx, fj, tempData, blogRoutes, fakeFetch, noSleep } = require('./helpers');

const DATA = tempData();   // index 를 부르기 전에 BOKBOK_DATA 지정
const insight = require('../index');

const day = n => Date.parse('2026-10-30T09:00:00+09:00') + n * 86400000;
let visitorTotal = 4000;
function routes() {
  const r = blogRoutes();
  r[3] = [/m\.blog\.naver\.com\/api\/blogs\/jsrjkb6742$/, () => { const j = fj('m_blog_info.json'); j.result.totalVisitorCount = (visitorTotal += 60); return { body: j }; }];
  r.push(['ssc=tab.blog.all', { body: fx('serp_blog_tab.html') }], ['where=nexearch', { body: fx('serp_total.html') }], ['keywordstool', { body: fj('keywordstool.json') }]);
  return r;
}
const adCreds = { searchad_customer_id: '1', searchad_access_license: 'L', searchad_secret_key: 'S' };
const deps = (n, extra = {}) => ({ fetch: fakeFetch(routes(), extra.seen), sleep: noSleep, now: () => day(n), getSecret: async k => adCreds[k] || null, ...extra.deps });
const settings = { serp: true, maxExposureChecks: 3 };

test('collect: 3일 수집 → 저장 파일·스냅샷·KPI', async () => {
  insight.setConfig('jsrjkb6742', { keywords: { '224460097766': ['NF 유형 특징'] }, extraKeywords: ['MBTI 궁합'] });
  const seen = [];
  const r1 = await insight.collect({ blogId: 'jsrjkb6742', settings, deps: deps(0, { seen }) });
  assert.deepStrictEqual(r1.ran, ['blog', 'exposure', 'keywords']);
  assert.ok(r1.skipped.length === 0, JSON.stringify(r1.skipped));
  const dir = path.join(DATA, 'insight', 'jsrjkb6742');
  for (const f of ['posts.json', 'ranks.json', 'keywords.json', 'state.json', 'config.json', 'snapshots/2026-10-30.json']) assert.ok(fs.existsSync(path.join(dir, f)), f);
  // 노출 확인은 하루 최대 3건 → 검색 화면 6쪽
  assert.strictEqual(seen.filter(s => s.url.includes('search.naver.com')).length, 6);
  await insight.collect({ blogId: 'jsrjkb6742', settings, deps: deps(1) });
  const r3 = await insight.collect({ blogId: 'jsrjkb6742', settings, deps: deps(2) });
  assert.strictEqual(r3.kpis.totalPosts, 14);
  assert.strictEqual(r3.kpis.visitors, 60);                // 누적 방문자 하루 차이
  const posts = JSON.parse(fs.readFileSync(path.join(dir, 'posts.json'), 'utf8')).posts;
  assert.strictEqual(Object.keys(posts['224460097766'].history).length, 3);
  const ranks = JSON.parse(fs.readFileSync(path.join(dir, 'ranks.json'), 'utf8')).keywords;
  assert.strictEqual(ranks['nf유형특징|224460097766'].history['2026-10-30'].rank, 1);
  assert.strictEqual(Object.keys(ranks).length, 9);        // 하루 3건 × 3일, 매일 다른 글
  // 검색량은 4주 캐시 → 첫날 조회한 키워드는 다시 묻지 않음(새로 생긴 키워드만 조회)
  const vols = JSON.parse(fs.readFileSync(path.join(dir, 'keywords.json'), 'utf8')).volumes;
  assert.strictEqual(vols['nf유형특징'].fetchedAt, day(0));
});

test('같은 날 다시 모으면 스냅샷 합침, 노출은 이미 본 글 건너뜀', async () => {
  const r = await insight.collect({ blogId: 'jsrjkb6742', kinds: ['exposure'], settings: { ...settings, maxExposureChecks: 50 }, deps: deps(2) });
  assert.deepStrictEqual(r.ran, ['exposure']);
  const snap = insight.latest('jsrjkb6742');
  assert.strictEqual(snap.date, '2026-11-01');
  assert.ok(snap.profile && snap.runs.blog && snap.runs.exposure);
});

test('trend: KPI·방문자·키워드 순위·글 공감', () => {
  const t = insight.trend('jsrjkb6742', 'totalPosts', 7, '2026-11-01');
  assert.deepStrictEqual(t.map(x => x.value), [14, 14, 14]);
  const v = insight.trend('jsrjkb6742', 'visitors', 7, '2026-11-01');
  assert.deepStrictEqual(v.map(x => x.value), [60, 60]);
  const rk = insight.trend('jsrjkb6742', 'rank:NF 유형 특징', 7, '2026-11-01');
  assert.strictEqual(rk[0].value, 1);
  const ps = insight.trend('jsrjkb6742', 'post:224460097766:sympathy', 7, '2026-11-01');
  assert.strictEqual(ps.length, 3);
});

test('dashboard: UI 가 그릴 한 덩어리', async () => {
  const d = await insight.dashboard('jsrjkb6742', { settings, today: '2026-11-01', getSecret: async k => adCreds[k] || null });
  assert.strictEqual(d.kpis.length, 12);
  assert.ok(d.kpis.every(k => 'value' in k && 'label' in k));
  assert.strictEqual(d.charts.weeklyPosts.length, 12);
  assert.ok(Array.isArray(d.charts.visitors) && d.charts.visitors.length === 2);
  assert.strictEqual(d.tables.posts.length, 14);
  assert.ok(d.tables.categories.length >= 1);
  assert.ok(d.checklist.items.length === 6);
  assert.ok(Array.isArray(d.recommendations));
  assert.ok(d.notes.some(n => /주인 통계/.test(n)));
  assert.ok(d.notes.some(n => /근사값/.test(n)));
  assert.doesNotThrow(() => JSON.stringify(d));
});

test('due: 방금 모았으면 false, 20시간 뒤 true, 주인 통계는 설정 따라', () => {
  const now = day(2) + 3600000;
  const d = insight.due('jsrjkb6742', {}, now);
  assert.strictEqual(d.blog, false);
  assert.strictEqual(d.owner, false);
  assert.strictEqual(insight.due('jsrjkb6742', {}, day(2) + 21 * 3600000).blog, true);
  assert.strictEqual(insight.due('jsrjkb6742', { ownerStats: true }, now).owner, true);
});

test('주인 통계: 프로필 잠겨 있으면 건너뜀(오류 아님)', async () => {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'prof-'));
  const busy = { existsSync: () => true, openSync: () => { throw Object.assign(new Error('x'), { code: 'EBUSY' }); }, closeSync() { } };
  const r = await insight.collect({ blogId: 'jsrjkb6742', kinds: ['owner'], settings: { ownerStats: true, profileDir: prof }, deps: deps(2, { deps: { fs: busy } }) });
  assert.strictEqual(r.errors.length, 0);
  assert.match(r.skipped[0].reason, /창이 열려 있어/);
});

test('키도 화면 모드도 없으면 노출 생략 안내, 잘못된 아이디는 거부', async () => {
  const r = await insight.collect({ blogId: 'jsrjkb6742', kinds: ['exposure', 'keywords'], settings: {}, deps: { ...deps(3), getSecret: async () => null } });
  assert.deepStrictEqual(r.skipped.map(s => s.kind), ['exposure', 'keywords']);
  await assert.rejects(insight.collect({ blogId: '../x' }), /형식/);
  assert.throws(() => insight.setConfig('jsrjkb6742', { keywords: { abc: ['x'] } }), /글 번호/);
});
