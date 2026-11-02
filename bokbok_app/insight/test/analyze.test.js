// 블로그 링크 분석 — 주소 해석·지표 계산 (네트워크 없음)
const test = require('node:test');
const assert = require('node:assert');
const A = require('../analyze');

test('parseBlogUrl: 여러 주소 모양에서 아이디 뽑기', () => {
  assert.strictEqual(A.parseBlogUrl('jsrjkb6742'), 'jsrjkb6742');
  assert.strictEqual(A.parseBlogUrl('https://blog.naver.com/jsrjkb6742/224461106127'), 'jsrjkb6742');
  assert.strictEqual(A.parseBlogUrl('m.blog.naver.com/jsrjkb6742'), 'jsrjkb6742');
  assert.strictEqual(A.parseBlogUrl('https://blog.naver.com/PostView.naver?blogId=abc_12&logNo=1'), 'abc_12');
  assert.strictEqual(A.parseBlogUrl('https://abc123.blog.me'), 'abc123');
  assert.strictEqual(A.parseBlogUrl('https://blog.naver.com/PostView.naver'), null);
  assert.strictEqual(A.parseBlogUrl('https://example.com/abc'), null);
  assert.strictEqual(A.parseBlogUrl(''), null);
});

test('buildReport: 활동·반응·카테고리·제목 단어', () => {
  const now = Date.parse('2026-11-01T12:00:00+09:00');
  const day = n => new Date(now - n * 86400000);
  const ymd = d => new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  const posts = [0, 2, 4, 9, 40, 100].map((n, i) => ({ logNo: String(1000 - i), title: `INFJ 연애 특징 ${i}편`, date: ymd(day(n)), addedAt: day(n).getTime(), categoryName: i < 4 ? 'MBTI' : '일상', sympathy: i, comments: i % 2, images: 3, searchYn: i !== 5 }));
  const r = A.buildReport({ fetchedAt: now, source: ['x'], errors: [], profile: { blogId: 'abc', blogName: '테스트', totalPosts: 6, subscriberCount: 10, totalVisitorCount: 600, metricsAvailable: true }, posts }, now);
  assert.strictEqual(r.analyzed.covered, true);
  assert.strictEqual(r.activity.last7, 3);
  assert.strictEqual(r.activity.last30, 4);
  assert.strictEqual(r.profile.visitorsPerPost, 100);
  assert.strictEqual(r.profile.firstPostDate, ymd(day(100)));
  assert.strictEqual(r.categories[0].name, 'MBTI');
  assert.ok(r.content.titleWords.some(w => w.word === 'INFJ' && w.count === 6));
  assert.strictEqual(r.engagement.top[0].logNo, '995');
  assert.ok(r.signals.some(s => /검색 비허용/.test(s.text)));
  assert.strictEqual(r.recent.length, 6);
});

test('buildReport: 일부만 가져오면 운영 기간은 비우고 안내', () => {
  const now = Date.now();
  const r = A.buildReport({ profile: { blogId: 'abc', totalPosts: 500, metricsAvailable: false }, posts: [{ logNo: '1', title: 'a', date: new Date(now).toISOString().slice(0, 10) }] }, now);
  assert.strictEqual(r.profile.ageDays, null);
  assert.strictEqual(r.engagement, null);
  assert.ok(r.signals.some(s => /500편 중/.test(s.text)));
});
