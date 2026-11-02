'use strict';
const test = require('node:test'), assert = require('node:assert');
const { fx, fj, fakeFetch, noSleep } = require('./helpers');
const { createClient } = require('../lib/http');
const X = require('../collectors/exposure');

const NOW = Date.parse('2026-11-01T10:00:00+09:00');
const target = { keyword: 'NF 유형 특징', logNo: '224460097766', title: 'NF 유형 특징 | INFJ·INFP·ENFJ·ENFP 차이, 다정함에도 종류가 있다', addedAt: Date.parse('2026-10-31T14:13:00+09:00') };

test('블로그 탭 화면: r= 순위로 30건, 내 글 3개 위치', () => {
  const list = X.parseSerpBlogTab(fx('serp_blog_tab.html'));
  assert.strictEqual(list.length, 30);
  const mine = list.filter(i => i.blogId === 'jsrjkb6742').map(i => [i.rank, i.logNo]);
  assert.deepStrictEqual(mine, [[1, '224460097766'], [11, '224454476567'], [13, '224455062088']]);
});

test('통합검색 화면: 영역 순서, 스마트블록 안 위치, AI 브리핑 인용', () => {
  const t = X.parseSerpTotal(fx('serp_total.html'));
  assert.deepStrictEqual(t.sections.map(s => s.label), ['AI 브리핑', '인기글·스마트블록', '연관 검색어', '인기글·스마트블록', '동영상·클립', '이미지']);
  const mine = t.items.filter(i => i.blogId === 'jsrjkb6742');
  assert.deepStrictEqual(mine.map(i => [i.area, i.order, i.pos]), [['urB_coR', 2, 2]]);
  assert.strictEqual(t.ai.present, true);
  assert.strictEqual(t.ai.citations.length, 2);
  assert.ok(!t.ai.citations.some(c => c.blogId === 'jsrjkb6742'));
});

test('주소에서 블로그 아이디·글 번호 (남의 사이트 숫자 오인 방지)', () => {
  assert.deepStrictEqual(X.extractPost('https://m.blog.naver.com/AbC/224460097766?x=1'), { blogId: 'abc', logNo: '224460097766' });
  assert.deepStrictEqual(X.extractPost('https://blog.naver.com/PostView.naver?blogId=abc&logNo=1234567'), { blogId: 'abc', logNo: '1234567' });
  assert.strictEqual(X.extractPost('https://cksmel.tistory.com/8891699'), null);
});

test('공식 검색 API 판정: 노출 2위 (dentalbox 방식)', async () => {
  const seen = [];
  const client = createClient({ fetch: fakeFetch([['search/v1/blog', { body: fj('search_api_sim.json') }]], seen), sleep: noSleep });
  const r = await X.collectExposure({ client, blogId: 'jsrjkb6742', targets: [target], creds: { hubId: 'a', hubKey: 'b' }, now: () => NOW });
  const e = r.results[0];
  assert.strictEqual(e.status, 'EXPOSED');
  assert.strictEqual(e.tab.rank, 2);
  assert.strictEqual(e.top10AgeDays, 12);  // 상위 3개 글 나이 [1,12,61] 중앙값
  assert.strictEqual(seen[0].opts.headers['X-NCP-APIGW-API-KEY-ID'], 'a');
  assert.match(seen[0].url, /sort=sim/);
});

test('공식 검색 API 판정: sim 에 없고 date 에도 없으면 MISSING, 갓 올린 글은 PENDING', async () => {
  const client = createClient({ fetch: fakeFetch([['search/v1/blog', { body: fj('search_api_empty.json') }]]), sleep: noSleep });
  const r = await X.collectExposure({ client, blogId: 'jsrjkb6742', targets: [target], creds: { hubId: 'a', hubKey: 'b' }, now: () => NOW + 3 * 86400000 });
  assert.strictEqual(r.results[0].status, 'MISSING');
  const r2 = await X.collectExposure({ client, blogId: 'jsrjkb6742', targets: [{ ...target, addedAt: NOW - 3600000 }], creds: { hubId: 'a', hubKey: 'b' }, now: () => NOW });
  assert.strictEqual(r2.results[0].status, 'PENDING');
});

test('검색 화면 모드: 블로그 탭 1위 + 통합검색 스마트블록 2위', async () => {
  const seen = []; const waits = [];
  const client = createClient({ fetch: fakeFetch([['ssc=tab.blog.all', { body: fx('serp_blog_tab.html') }], ['where=nexearch', { body: fx('serp_total.html') }]], seen), sleep: async ms => waits.push(ms), now: () => 0 });
  const r = await X.collectExposure({ client, blogId: 'jsrjkb6742', targets: [target], settings: { serp: true }, now: () => NOW });
  const e = r.results[0];
  assert.strictEqual(e.status, 'EXPOSED');
  assert.strictEqual(e.tab.rank, 1);
  assert.deepStrictEqual(e.smart.map(s => [s.label, s.sectionOrder, s.pos, s.target]), [['인기글·스마트블록', 2, 2, true]]);
  assert.strictEqual(e.ai.cited, false);
  assert.strictEqual(e.ownHits.length, 3);                // 같은 키워드에 내 글 3개 → 잠식 신호
  assert.strictEqual(seen.length, 2);
  assert.ok(waits[0] >= 2000);                             // 같은 호스트 두 번째 호출 전 2초 이상
});

test('키도 화면 모드도 없으면 설정 안내 오류', async () => {
  const client = createClient({ fetch: fakeFetch([]), sleep: noSleep });
  await assert.rejects(X.collectExposure({ client, blogId: 'jsrjkb6742', targets: [target] }), /API 키를 넣거나/);
});

test('API 키 오류(401)면 한국어 안내 후 남은 키워드 중단', async () => {
  let n = 0;
  const client = createClient({ fetch: fakeFetch([[/./, () => { n++; return { status: 401, body: '{}' }; }]]), sleep: noSleep });
  const r = await X.collectExposure({ client, blogId: 'jsrjkb6742', targets: [target, { ...target, keyword: 'INFP' }], creds: { devId: 'a', devSecret: 'b' }, now: () => NOW });
  assert.strictEqual(r.results.length, 0);
  assert.match(r.errors[0].message, /키가 올바르지 않습니다/);
  assert.strictEqual(n, 1);
});
