// 레딧 엔진 시험 — 실제 네트워크 호출 없음(가짜 request 주입)
const test = require('node:test');
const assert = require('node:assert');
const reddit = require('../reddit');

function makeCtx(over = {}) {
  const store = { ...(over.secrets || {}) };
  const logs = [];
  return {
    platform: 'reddit',
    config: { clientId: 'abcCLIENT', redditUsername: 'bokbok_kr', ...(over.config || {}) },
    getSecret: async k => (k in store ? store[k] : null),
    setSecret: async (k, v) => { store[k] = v; },
    redirectUri: 'http://127.0.0.1:3600/oauth/reddit/callback',
    state: 'st-123',
    log: l => logs.push(l),
    store, logs,
  };
}
const fresh = () => ({ accessToken: 'AT-live', tokenExpiresAt: String(Date.now() + 3600e3), refreshToken: 'RT-1' });
function fake(routes) {
  const calls = [];
  reddit._setRequest(async (url, opts) => {
    calls.push({ url, ...opts });
    for (const [re, fn] of routes) if (re.test(url)) return typeof fn === 'function' ? fn(url, opts, calls) : fn;
    throw new Error('예상 못한 호출 ' + url);
  });
  return calls;
}
const ok = (data, headers = {}) => ({ status: 200, headers, data });
test.beforeEach(() => reddit._resetRate());
test.after(() => reddit._setRequest(null));

const selfPost = (o = {}) => ({ platform: 'reddit', title: 'INFJ 친구가 갑자기 연락을 끊는 이유', body: '본문입니다.\n둘째 줄', target: { subreddit: 'mbti' }, ...o });

// ---- validate
test('validate: 정상 텍스트 글 통과', () => assert.deepStrictEqual(reddit.validate(selfPost()), []));
test('validate: 서브레딧은 config 기본값·r/ 접두어 허용', () => {
  assert.deepStrictEqual(reddit.validate(selfPost({ target: {} }), { subreddit: 'r/INFJ' }), []);
  assert.match(reddit.validate(selfPost({ target: {} })).join(), /서브레딧 미지정/);
});
test('validate: 서브레딧 이름 형식', () => {
  assert.match(reddit.validate(selfPost({ target: { subreddit: 'a' } })).join(), /형식/);
  assert.match(reddit.validate(selfPost({ target: { subreddit: 'bad-name' } })).join(), /형식/);
  assert.match(reddit.validate(selfPost({ target: { subreddit: 'x'.repeat(22) } })).join(), /형식/);
});
test('validate: 제목 300자', () => {
  assert.deepStrictEqual(reddit.validate(selfPost({ title: '가'.repeat(300) })), []);
  assert.match(reddit.validate(selfPost({ title: '가'.repeat(301) })).join(), /300자/);
  assert.match(reddit.validate(selfPost({ title: '  ' })).join(), /제목 없음/);
});
test('validate: 텍스트 글은 본문 필요', () => {
  assert.match(reddit.validate(selfPost({ body: '', options: { kind: 'self' } })).join(), /본문 필요/);
});
test('validate: 링크 글은 https', () => {
  assert.deepStrictEqual(reddit.validate(selfPost({ body: '', link: 'https://blog.naver.com/x/1' })), []);
  assert.match(reddit.validate(selfPost({ body: '', link: 'http://a.com' })).join(), /https/);
  assert.match(reddit.validate(selfPost({ body: '', link: 'nope', options: { kind: 'link' } })).join(), /https/);
});
test('validate: 이미지 글 거부', () => {
  assert.match(reddit.validate(selfPost({ images: ['C:\\a.png'] })).join(), /레딧 이미지 글은 아직 지원 안 함/);
  assert.match(reddit.validate(selfPost({ imageUrls: ['https://a/b.png'] })).join(), /레딧 이미지 글은 아직 지원 안 함/);
});

// ---- authUrl / authCallback
test('authUrl: 파라미터', () => {
  const u = new URL(reddit.authUrl(makeCtx()));
  assert.strictEqual(u.origin + u.pathname, 'https://www.reddit.com/api/v1/authorize');
  const p = Object.fromEntries(u.searchParams);
  assert.deepStrictEqual(p, {
    client_id: 'abcCLIENT', response_type: 'code', state: 'st-123',
    redirect_uri: 'http://127.0.0.1:3600/oauth/reddit/callback', duration: 'permanent', scope: 'identity submit read flair',
  });
});
test('authCallback: state 불일치·거부', async () => {
  fake([]);
  await assert.rejects(reddit.authCallback(makeCtx(), { state: 'other', code: 'c' }), /state/);
  await assert.rejects(reddit.authCallback(makeCtx(), { error: 'access_denied', state: 'st-123' }), /거부/);
});
test('authCallback: 코드 교환(installed app = 빈 secret Basic) 후 토큰 저장·계정 조회', async () => {
  const calls = fake([
    [/access_token$/, ok({ access_token: 'AT-new', token_type: 'bearer', expires_in: 3600, refresh_token: 'RT-new', scope: 'identity submit read flair' })],
    [/\/api\/v1\/me$/, ok({ name: 'bokbok_kr', id: 'abc1' })],
  ]);
  const ctx = makeCtx();
  const r = await reddit.authCallback(ctx, { state: 'st-123', code: 'CODE1' });
  assert.deepStrictEqual(r, { account: { name: 'bokbok_kr', handle: 'u/bokbok_kr', id: 'abc1' } });
  const tok = calls[0];
  assert.strictEqual(tok.method, 'POST');
  assert.strictEqual(tok.headers.Authorization, 'Basic ' + Buffer.from('abcCLIENT:').toString('base64'));
  assert.strictEqual(tok.headers['User-Agent'], 'windows:bokbok.publisher:2.0.0 (by /u/bokbok_kr)');
  assert.deepStrictEqual(tok.form, { grant_type: 'authorization_code', code: 'CODE1', redirect_uri: ctx.redirectUri });
  assert.strictEqual(calls[1].headers.Authorization, 'Bearer AT-new');
  assert.strictEqual(ctx.store.accessToken, 'AT-new');
  assert.strictEqual(ctx.store.refreshToken, 'RT-new');
  assert.ok(Number(ctx.store.tokenExpiresAt) > Date.now() + 3500e3);
  assert.ok(!ctx.logs.join('\n').includes('AT-new'));
});
test('authCallback: web app 은 secret 포함 Basic', async () => {
  const calls = fake([
    [/access_token$/, ok({ access_token: 'A', expires_in: 3600, refresh_token: 'R' })],
    [/\/me$/, ok({ name: 'n', id: 'i' })],
  ]);
  await reddit.authCallback(makeCtx({ secrets: { clientSecret: 'SEC' } }), { state: 'st-123', code: 'c' });
  assert.strictEqual(calls[0].headers.Authorization, 'Basic ' + Buffer.from('abcCLIENT:SEC').toString('base64'));
});
test('authCallback: invalid_grant 한국어 오류', async () => {
  fake([[/access_token$/, ok({ error: 'invalid_grant' })]]);
  await assert.rejects(reddit.authCallback(makeCtx(), { state: 'st-123', code: 'old' }), /만료되었거나 이미 사용됨/);
});

// ---- 토큰 자동 갱신
test('만료된 토큰은 refresh_token 으로 갱신 후 호출', async () => {
  const calls = fake([
    [/access_token$/, ok({ access_token: 'AT-2', expires_in: 3600 })],
    [/\/api\/v1\/me$/, ok({ name: 'bokbok_kr', link_karma: 10, comment_karma: 5, total_karma: 15 }, { 'x-ratelimit-remaining': '99.0', 'x-ratelimit-reset': '300', 'x-ratelimit-used': '1' })],
  ]);
  const ctx = makeCtx({ secrets: { accessToken: 'AT-old', tokenExpiresAt: String(Date.now() - 1000), refreshToken: 'RT-1' } });
  const r = await reddit.check(ctx);
  assert.strictEqual(calls[0].form.grant_type, 'refresh_token');
  assert.strictEqual(calls[0].form.refresh_token, 'RT-1');
  assert.strictEqual(calls[1].headers.Authorization, 'Bearer AT-2');
  assert.strictEqual(ctx.store.accessToken, 'AT-2');
  assert.strictEqual(ctx.store.refreshToken, 'RT-1');   // 갱신 응답엔 새 refresh_token 없음 → 기존 유지
  assert.strictEqual(r.ok, true);
  assert.match(r.detail, /u\/bokbok_kr/);
  assert.match(r.detail, /카르마 15/);
  assert.match(r.detail, /남은 호출 99회/);
});
test('check: 연결 안 됨', async () => {
  fake([]);
  const r = await reddit.check(makeCtx());
  assert.strictEqual(r.ok, false);
  assert.match(r.detail, /연결되지 않음/);
});
test('401 이면 강제 갱신 후 한 번 재시도', async () => {
  let n = 0;
  const calls = fake([
    [/access_token$/, ok({ access_token: 'AT-3', expires_in: 3600 })],
    [/\/me$/, () => (++n === 1 ? { status: 401, headers: {}, data: { message: 'Unauthorized', error: 401 } } : ok({ name: 'x', total_karma: 1 }))],
  ]);
  const r = await reddit.check(makeCtx({ secrets: fresh() }));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(calls.at(-1).headers.Authorization, 'Bearer AT-3');
});

// ---- publish
test('publish dryRun: 텍스트 글 payload', async () => {
  const calls = fake([]);
  const r = await reddit.publish(makeCtx(), selfPost({ link: 'https://blog.naver.com/jsrjkb6742/1', options: { flairId: 'f-1', nsfw: false } }), { dryRun: true });
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(r.dryRun, true);
  assert.strictEqual(r.payload.endpoint, 'https://oauth.reddit.com/api/submit');
  assert.deepStrictEqual(r.payload.form, {
    api_type: 'json', sr: 'mbti', kind: 'self', title: 'INFJ 친구가 갑자기 연락을 끊는 이유',
    resubmit: 'true', sendreplies: 'true', nsfw: 'false', spoiler: 'false',
    text: '본문입니다.\n둘째 줄\n\nhttps://blog.naver.com/jsrjkb6742/1', flair_id: 'f-1',
  });
});
test('publish dryRun: 링크 글 payload', async () => {
  fake([]);
  const r = await reddit.publish(makeCtx(), selfPost({ body: '', link: 'https://example.com/a', options: { nsfw: true } }), { dryRun: true });
  assert.strictEqual(r.payload.form.kind, 'link');
  assert.strictEqual(r.payload.form.url, 'https://example.com/a');
  assert.strictEqual(r.payload.form.nsfw, 'true');
  assert.ok(!('text' in r.payload.form));
});
test('publish: validate 실패면 호출 안 함', async () => {
  const calls = fake([]);
  await assert.rejects(reddit.publish(makeCtx(), selfPost({ images: ['a.png'] })), /이미지 글/);
  assert.strictEqual(calls.length, 0);
});
test('publish: 성공 응답 파싱', async () => {
  const calls = fake([[/\/api\/submit$/, ok({ json: { errors: [], data: { id: '1abcde', name: 't3_1abcde', url: 'https://www.reddit.com/r/mbti/comments/1abcde/infj/' } } }, { 'x-ratelimit-remaining': '98', 'x-ratelimit-reset': '200' })]]);
  const r = await reddit.publish(makeCtx({ secrets: fresh() }), selfPost());
  assert.deepStrictEqual(r, { id: 't3_1abcde', url: 'https://www.reddit.com/r/mbti/comments/1abcde/infj/', dryRun: false });
  assert.strictEqual(calls[0].method, 'POST');
  assert.strictEqual(calls[0].headers.Authorization, 'Bearer AT-live');
  assert.strictEqual(calls[0].form.api_type, 'json');
  assert.strictEqual(reddit._rate.remaining, 98);
});
test('publish: RATELIMIT 오류 → 대기시간 포함 한국어', async () => {
  fake([[/\/api\/submit$/, ok({ json: { errors: [['RATELIMIT', 'you are doing that too much. try again in 9 minutes.', 'ratelimit']] } })]]);
  await assert.rejects(reddit.publish(makeCtx({ secrets: fresh() }), selfPost()), e => /너무 자주/.test(e.message) && /9분 뒤/.test(e.message) && e.status === 429);
});
test('publish: SUBREDDIT_NOEXIST·NO_LINKS·플레어 필수', async () => {
  for (const [code, re] of [['SUBREDDIT_NOEXIST', /서브레딧이 없음/], ['NO_LINKS', /링크 글을 허용 안 함/], ['SUBMIT_VALIDATION_FLAIR_REQUIRED', /플레어 필수/]]) {
    fake([[/\/api\/submit$/, ok({ json: { errors: [[code, 'x', 'sr']] } })]]);
    await assert.rejects(reddit.publish(makeCtx({ secrets: fresh() }), selfPost()), re);
  }
});
test('레이트리밋: 남은 호출 0 + 리셋 길면 호출 없이 실패', async () => {
  const calls = fake([[/\/api\/v1\/me$/, ok({ name: 'x' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '400' })]]);
  const ctx = makeCtx({ secrets: fresh() });
  await reddit.check(ctx);
  await assert.rejects(reddit.publish(ctx, selfPost()), /한도 소진 — \d+초 뒤/);
  assert.strictEqual(calls.length, 1);
});
test('레이트리밋: 리셋이 짧으면 기다렸다 진행', async () => {
  const calls = fake([
    [/\/api\/v1\/me$/, ok({ name: 'x' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '0.05' })],
    [/\/api\/submit$/, ok({ json: { errors: [], data: { name: 't3_z', url: 'https://www.reddit.com/r/mbti/comments/z/t/' } } })],
  ]);
  const ctx = makeCtx({ secrets: fresh() });
  await reddit.check(ctx);
  const r = await reddit.publish(ctx, selfPost());
  assert.strictEqual(r.id, 't3_z');
  assert.strictEqual(calls.length, 2);
});
test('HTTP 429 + 리셋 길면 한국어 실패', async () => {
  fake([[/\/api\/submit$/, { status: 429, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '500' }, data: '' }]]);
  await assert.rejects(reddit.publish(makeCtx({ secrets: fresh() }), selfPost()), /호출 한도 초과 — 500초/);
});

// ---- 보조
test('getFlairs·getRules 파싱', async () => {
  const calls = fake([
    [/link_flair_v2$/, ok([{ id: 'f1', text: 'Discussion', text_editable: false, mod_only: false }])],
    [/about\/rules$/, ok({ rules: [{ short_name: 'No spam', kind: 'all', description: '...' }] })],
  ]);
  const ctx = makeCtx({ secrets: fresh() });
  assert.deepStrictEqual(await reddit.getFlairs(ctx, 'r/mbti'), [{ id: 'f1', text: 'Discussion', editable: false, modOnly: false }]);
  assert.deepStrictEqual(await reddit.getRules(ctx, 'mbti'), [{ name: 'No spam', kind: 'all', description: '...' }]);
  assert.strictEqual(calls[0].url, 'https://oauth.reddit.com/r/mbti/api/link_flair_v2');
});
test('인터페이스 모양', () => {
  assert.strictEqual(reddit.platform, 'reddit');
  const keys = reddit.configFields.map(f => f.key);
  for (const k of ['clientId', 'clientSecret', 'redditUsername']) assert.ok(keys.includes(k));
  assert.strictEqual(reddit.configFields.find(f => f.key === 'clientSecret').secret, true);
  assert.strictEqual(reddit.limits.titleMax, 300);
});
