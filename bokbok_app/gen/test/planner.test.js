// 자동 기획: 브리핑 구성 · GPT 후보 정리 · GEO 규칙이 글 프롬프트에 들어가는지
const test = require('node:test');
const assert = require('node:assert');
const planner = require('../planner');
const writer = require('../writer');
const openai = require('../openai');
const { PROFILE, INPUT, fakeFetch, chatResp } = require('./fixtures');

openai._setSleep(async () => {});
test.afterEach(() => openai._setFetch(null));

test('buildBrief: 블로그 성격·성과 글·기회·기존 제목이 들어간다', () => {
  const b = planner.buildBrief({
    profile: PROFILE,
    posts: [{ title: 'INTP 연애 특징', date: '2026-10-01', sympathy: 13, comments: 11, score: 80, keyword: 'INTP 연애' }, { title: '약한 글', date: '2026-09-01', sympathy: 0, comments: 0, score: 5 }],
    recs: [{ type: 'NEW_KEYWORD', title: '다음 글 키워드 후보', reason: '검색량 있음', items: [{ keyword: 'INTP 궁합', volume: 1200 }] }, { type: 'IMAGES', title: '사진', reason: '무시' }],
    report: { profile: { totalPosts: 15, subscribers: 41 }, activity: { last30: 6, perWeek90: 0.5 }, content: { titleWords: [{ word: 'INTP', count: 13 }] }, categories: [{ name: 'INTP의 잡생각', posts: 11, avgEngagement: 4.8 }] },
    existingTitles: ['INTP 연애 특징'], draftTitles: ['초안 제목'],
  });
  assert.match(b, /복복이 MBTI/);
  assert.match(b, /반응·성과가 좋았던 글/);
  assert.match(b, /INTP 궁합 월 1200/);
  assert.ok(!/사진 3장/.test(b));
  assert.match(b, /반응이 약했던 글: 약한 글/);
  assert.match(b, /- 초안 제목/);
});

test('plan: 후보 정리(카테고리 검증·중복 키워드 제거·기존 제목 제외)', async () => {
  openai._setFetch(fakeFetch([chatResp({ candidates: [
    { keyword: 'INTP 궁합', subKeywords: ['INTP ENFJ', 'INTP 궁합', 'INTP 연애 궁합'], title: 'INTP 궁합 | 잘 맞는 유형 3가지', topic: 't', category: 'MBTI 연애', titleMode: 'number', layout: 'list', reason: 'r' },
    { keyword: 'intp 궁합', title: '중복', topic: 't' },
    { keyword: 'INTP 연애', title: 'INTP 연애 특징', topic: '기존 글과 같은 제목', category: '없는 카테고리', titleMode: 'weird', layout: 'nope' },
    { keyword: 'INTP 직업', title: 'INTP 직업 추천', topic: 't', category: '없는 카테고리', titleMode: 'weird', layout: 'nope' },
  ] })]));
  const r = await planner.plan({ apiKey: 'sk-test', brief: 'b', profile: PROFILE, n: 3, avoidTitles: ['INTP 연애 특징'] });
  assert.deepStrictEqual(r.candidates.map(c => c.keyword), ['INTP 궁합', 'INTP 직업']);
  assert.deepStrictEqual(r.candidates[0].subKeywords, ['INTP ENFJ', 'INTP 연애 궁합']);
  assert.strictEqual(r.candidates[0].category, 'MBTI 연애');
  assert.strictEqual(r.candidates[1].category, '');
  assert.strictEqual(r.candidates[1].titleMode, 'auto');
  assert.strictEqual(r.candidates[1].layout, 'auto');
});

test('GEO 규칙이 글쓰기 시스템 프롬프트에 항상 들어간다', () => {
  const { system } = writer.buildMessages(INPUT, PROFILE);
  assert.match(system, /검색·AI 검색·애드포스트 최적화/);
  assert.match(system, /정의 문장을 1개/);
});
