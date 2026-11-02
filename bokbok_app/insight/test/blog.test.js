'use strict';
const test = require('node:test'), assert = require('node:assert');
const { fx, fj, blogRoutes, fakeFetch, noSleep } = require('./helpers');
const { createClient } = require('../lib/http');
const B = require('../collectors/blog');

const FETCHED = Date.parse('2026-11-01T03:30:00+09:00');

test('PostTitleListAsync: 이스케이프 섞인 JSON 파싱, 제목 디코딩, 상대 날짜 변환', () => {
  const t = B.parseTitleList(fx('ptl_p1.txt'), FETCHED);
  assert.strictEqual(t.totalCount, 14);
  assert.strictEqual(t.posts.length, 14);
  assert.strictEqual(t.posts[0].logNo, '224460097766');
  assert.match(t.posts[0].title, /^NF 유형 특징 \| INFJ·INFP/);
  assert.strictEqual(t.posts[0].date, '2026-10-31');           // "13시간 전"
  assert.strictEqual(t.posts[1].date, '2026-10-27');
  assert.ok(t.posts.some(p => p.title.includes("'따뜻한 로봇'")));   // &#39; 디코딩
  assert.strictEqual(t.posts.find(p => p.logNo === '224120191615').commentCount, 11);
});

test('날짜 문자열 변환', () => {
  assert.strictEqual(B.parseListDate('2025. 12. 9.', FETCHED), '2025-12-09');
  assert.strictEqual(B.parseListDate('5분 전', FETCHED), '2026-11-01');
  assert.strictEqual(B.parseListDate('어제', FETCHED), '2026-10-31');
  assert.strictEqual(B.parseListDate('??', FETCHED), null);
});

test('모바일 글 목록: 공감·댓글·사진 수·발행 시각', () => {
  const items = B.parseMobilePostList(fj('m_post_list_p1.json'));
  assert.strictEqual(items.length, 14);
  const p = items[0];
  assert.strictEqual(p.logNo, '224460097766');
  assert.strictEqual(p.images, 4);
  assert.strictEqual(typeof p.addedAt, 'number');
  assert.strictEqual(p.categoryName, 'NF 이상가 분석');
  assert.strictEqual(p.searchYn, true);
  assert.throws(() => B.parseMobilePostList({ isSuccess: false }), /형식/);
});

test('블로그 정보: 이웃 수·누적 방문자', () => {
  const i = B.parseBlogInfo(fj('m_blog_info.json'));
  assert.strictEqual(i.blogName, '복복이의 이것저것');
  assert.strictEqual(typeof i.subscriberCount, 'number');
  assert.strictEqual(typeof i.totalVisitorCount, 'number');
});

test('RSS: 발행 시각·태그', () => {
  const r = B.parseRss(fx('rss.xml'));
  assert.strictEqual(r.title, '복복이의 이것저것');
  assert.ok(r.items.length >= 10);
  assert.strictEqual(r.items[0].logNo, '224460097766');
  assert.strictEqual(r.items[0].publishedAt, Date.parse('2026-10-31T14:13:00+09:00'));
  assert.ok(r.items[0].tags.includes('INFP'));
});

test('collectBlog: 네 출처를 합치고, 요청 간격을 지킴', async () => {
  const seen = []; const waits = [];
  const client = createClient({ fetch: fakeFetch(blogRoutes(), seen), sleep: async ms => waits.push(ms), now: () => 0 });
  const r = await B.collectBlog({ client, blogId: 'jsrjkb6742', now: () => FETCHED });
  assert.strictEqual(r.errors.length, 0);
  assert.strictEqual(r.profile.totalPosts, 14);
  assert.strictEqual(r.profile.blogName, '복복이의 이것저것');
  assert.strictEqual(r.posts.length, 14);
  const p = r.posts.find(x => x.logNo === '224460097766');
  assert.ok(p.tags.length > 5 && p.images === 4 && p.addedAt);
  assert.strictEqual(seen.length, 4);                 // 글 목록 1 + 모바일 1(14개 <30) + 정보 1 + RSS 1
  assert.ok(seen.filter(s => s.url.includes('m.blog')).every(s => s.opts.headers.Referer));
  assert.ok(waits.length >= 1 && waits.every(w => w >= 2000));   // m.blog 두 번째 호출 전 대기
});

test('strictRobots: m.blog.naver.com/api 를 부르지 않음', async () => {
  const seen = [];
  const client = createClient({ fetch: fakeFetch(blogRoutes(), seen), sleep: noSleep });
  const r = await B.collectBlog({ client, blogId: 'jsrjkb6742', settings: { strictRobots: true }, now: () => FETCHED });
  assert.ok(!seen.some(s => s.url.includes('m.blog.naver.com')));
  assert.strictEqual(r.profile.metricsAvailable, false);
  assert.strictEqual(r.profile.subscriberCount, null);
});

test('일부 실패는 errors 로, 전부 실패면 한국어 오류', async () => {
  const routes = blogRoutes(); routes[4] = ['rss.blog.naver.com', { status: 404, body: '' }];
  const client = createClient({ fetch: fakeFetch(routes), sleep: noSleep });
  const r = await B.collectBlog({ client, blogId: 'jsrjkb6742', now: () => FETCHED });
  assert.match(r.errors[0].message, /RSS가 꺼져/);
  const bad = createClient({ fetch: fakeFetch([[/./, { status: 404, body: '' }]]), sleep: noSleep, retries: 0 });
  await assert.rejects(B.collectBlog({ client: bad, blogId: 'jsrjkb6742' }), /글 목록을 하나도 받지 못했습니다/);
});
