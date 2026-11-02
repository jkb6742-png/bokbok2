'use strict';
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path'), os = require('os');
const { fj } = require('./helpers');
const O = require('../collectors/owner');

test('프로필 경로는 naver_post/common.js 규칙과 같음', () => {
  assert.match(O.profileDir('jsrjkb6742'), /naver-blog-profile$/);
  assert.match(O.profileDir('other1'), /bokbok[\\/]profiles[\\/]other1$/);
});

test('잠금 감지: lockfile 을 못 열면 잠김, 열리면(남은 파일) 사용 가능', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'prof-'));
  assert.deepStrictEqual(O.profileLock(d), { locked: false });
  fs.writeFileSync(path.join(d, 'lockfile'), '');
  assert.strictEqual(O.profileLock(d).locked, false);
  const busy = { existsSync: () => true, openSync: () => { const e = new Error('busy'); e.code = 'EBUSY'; throw e; }, closeSync() { } };
  assert.deepStrictEqual(O.profileLock(d, busy), { locked: true, reason: 'EBUSY' });
  assert.strictEqual(O.profileLock(path.join(d, 'none')).missing, true);
});

test('통계 표 정리·분류: 조회수·방문자·유입 검색어·유입 경로', () => {
  const tables = O.normalizeStat(fj('owner_stat_today.json'));
  assert.strictEqual(tables.length, 4);
  assert.deepStrictEqual(tables[0].columns, ['date', 'cv', 'cv_p']);
  const c = O.classify(tables);
  assert.deepStrictEqual(c.daily[1], { date: '2026-10-31', views: 55, visitors: 41 });
  assert.deepStrictEqual(c.keywords[0], { keyword: 'infp 특징', value: 0.42 });
  assert.strictEqual(c.sources[0].name, '네이버 통합검색_모바일');
});

// 가짜 브라우저: goto 때 통계 응답 이벤트를 흘려보냄
function fakeLaunch({ finalUrl, calls }) {
  return async opts => {
    calls.opts = opts;
    const handlers = {};
    const page = {
      setRequestInterception: async v => { calls.intercept = v; },
      on: (ev, fn) => { handlers[ev] = fn; },
      mainFrame: () => 'main',
      goto: async url => {
        calls.goto = url;
        const mk = (method, u, type = 'xhr', nav = false) => ({ method: () => method, url: () => u, isNavigationRequest: () => nav, frame: () => 'main', resourceType: () => type, abort: () => calls.aborted.push(u), continue: () => calls.continued.push(u) });
        handlers.request(mk('POST', 'https://lcs.naver.com/log'));
        handlers.request(mk('GET', 'https://evil.example.com/', 'document', true));
        handlers.request(mk('GET', 'https://blog.stat.naver.com/api/blog/daily/cv?timeDimension=DATE'));
        await handlers.response({ url: () => 'https://blog.stat.naver.com/api/blog/daily/cv?timeDimension=DATE&startDate=2026-11-01&exclude=&_=1', text: async () => JSON.stringify(fj('owner_stat_today.json')) });
        await handlers.response({ url: () => 'https://admin.blog.naver.com/x.json', text: async () => '{}' });
      },
      url: () => finalUrl,
    };
    return { newPage: async () => page, close: async () => { calls.closed = true; } };
  };
}

test('collectOwner: 읽기 전용(POST·외부 이동 차단), 통계만 저장, 브라우저 닫음', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'prof-'));
  const calls = { aborted: [], continued: [] };
  const r = await O.collectOwner({ blogId: 'jsrjkb6742', settings: { ownerStats: true, profileDir: d }, launch: fakeLaunch({ finalUrl: 'https://admin.blog.naver.com/jsrjkb6742/stat/today', calls }), waitMs: 0, now: () => Date.parse('2026-11-01T10:00:00+09:00') });
  assert.strictEqual(calls.opts.headless, true);
  assert.strictEqual(calls.opts.userDataDir, d);
  assert.deepStrictEqual(calls.aborted, ['https://lcs.naver.com/log', 'https://evil.example.com/']);
  assert.ok(calls.closed);
  assert.deepStrictEqual(r.source, ['blog.stat.naver.com/api/blog/daily/cv']);
  assert.strictEqual(r.daily.length, 3);
  assert.strictEqual(r.keywords.length, 2);
  assert.strictEqual(r.untestedMapping, true);
});

test('collectOwner: 꺼져 있음 / 잠김 / 로그인 풀림 은 한국어 안내', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'prof-'));
  await assert.rejects(O.collectOwner({ blogId: 'jsrjkb6742', settings: {} }), /꺼져 있습니다/);
  const busy = { existsSync: () => true, openSync: () => { throw Object.assign(new Error('x'), { code: 'EBUSY' }); }, closeSync() { } };
  await assert.rejects(O.collectOwner({ blogId: 'jsrjkb6742', settings: { ownerStats: true, profileDir: d }, fsx: busy }), e => e.code === 'LOCKED' && /창이 열려 있어/.test(e.message));
  const calls = { aborted: [], continued: [] };
  await assert.rejects(O.collectOwner({ blogId: 'jsrjkb6742', settings: { ownerStats: true, profileDir: d }, launch: fakeLaunch({ finalUrl: 'https://nid.naver.com/nidlogin.login', calls }), waitMs: 0 }), e => e.code === 'LOGIN');
  assert.ok(calls.closed);
});
