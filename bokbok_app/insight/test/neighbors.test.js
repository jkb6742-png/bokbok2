// 이웃 후보 점수: 활발·같은 주제면 후보, 광고성·죽은 블로그면 탈락
const test = require('node:test');
const assert = require('node:assert');
const { score } = require('../neighbors');

const mk = (o = {}) => ({
  profile: { blogName: '테스트', totalPosts: 120, subscribers: 300, ...o.profile },
  activity: { last30: 6, lastPostAgo: 2, ...o.activity },
  engagement: o.engagement === null ? null : { avgSympathy30: 8, avgComments30: 3, ...o.engagement },
  recent: o.recent || [{ title: 'INTP 연애 특징 정리' }, { title: 'INTP 궁합 베스트' }, { title: '주말 일기' }, { title: 'INTP 직업 추천' }],
  categories: o.categories || [{ name: 'MBTI 이야기', posts: 40 }],
  content: { tags: [] },
});

test('활발하고 같은 주제면 후보', () => {
  const r = score(mk(), { keywords: ['INTP 연애', 'MBTI'] });
  assert.ok(r.good, JSON.stringify(r));
  assert.ok(r.score >= 55);
  assert.ok(r.reasons.some(x => /같은 주제/.test(x)));
  assert.strictEqual(r.stats.blogName, '테스트');
});

test('광고·협찬성 제목이 많으면 탈락', () => {
  const r = score(mk({ recent: [{ title: '[협찬] 다이어트 보조제 후기' }, { title: '체험단 모집 광고' }, { title: '대출 상담 무료' }, { title: 'INTP 연애' }] }), { keywords: ['INTP 연애'] });
  assert.ok(!r.good, JSON.stringify(r));
  assert.ok(r.reasons.some(x => /광고/.test(x)));
});

test('오래 멈춘 작은 블로그는 탈락', () => {
  const r = score(mk({ profile: { totalPosts: 5, subscribers: 3 }, activity: { last30: 0, lastPostAgo: 200 }, engagement: null }), { keywords: ['INTP 연애'] });
  assert.ok(!r.good);
  assert.ok(r.reasons.some(x => /마지막 글이 200일 전/.test(x)));
});

test('보고서가 없으면 0점', () => {
  const r = score(null, { keywords: ['x'] });
  assert.strictEqual(r.score, 0); assert.ok(!r.good);
});
