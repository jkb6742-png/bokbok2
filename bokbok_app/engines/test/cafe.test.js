// 네이버 카페 엔진 시험 — 실제 네트워크 호출 없음(가짜 request 주입)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const cafe = require('../cafe');
const { ApiError } = require('../common');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bokbok-cafe-'));
const img = path.join(tmp, 'a.png');
fs.writeFileSync(img, Buffer.from('89504e470d0a1a0a', 'hex'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function makeCtx(secrets = {}, config = {}) {
  const store = { clientSecret: 'SEC', ...secrets };
  const logs = [];
  return {
    platform: 'cafe', store, logs,
    config: { clientId: 'CID', defaultClubId: '12345678', defaultMenuId: '3', ...config },
    getSecret: async k => (k in store ? store[k] : null),
    setSecret: async (k, v) => { store[k] = v; },
    redirectUri: 'http://127.0.0.1:3600/oauth/cafe/callback',
    state: 'st-xyz', log: l => logs.push(l),
  };
}
const fresh = () => ({ accessToken: 'AT', refreshToken: 'RT', tokenExpiresAt: String(Date.now() + 3600e3) });
const stale = () => ({ accessToken: 'OLD', refreshToken: 'RT', tokenExpiresAt: String(Date.now() + 60e3) });
const okArticle = { message: { '@type': 'response', status: '200', result: { msg: 'Success', cafeUrl: 'mycafe', articleId: 42, articleUrl: 'https://cafe.naver.com/mycafe/42' } } };
const profile = { resultcode: '00', message: 'success', response: { id: 'uid1', nickname: '복복이', email: 'x@naver.com' } };

function fakeRequest(routes) {
  const calls = [];
  const fn = async (url, opt = {}) => {
    calls.push({ url, opt });
    for (const [match, handler] of routes) if (url.includes(match)) return typeof handler === 'function' ? handler(url, opt, calls) : handler;
    throw new Error('예상 못한 호출: ' + url);
  };
  fn.calls = calls;
  return fn;
}
test.afterEach(() => cafe._setRequest(null));

const basePost = () => ({ platform: 'cafe', title: '제목 & 테스트', body: '첫 줄 <b>굵게</b>\n둘째 줄', target: {} });

// ---------- 메타 ----------
test('인터페이스·설정 항목', () => {
  assert.strictEqual(cafe.platform, 'cafe');
  const keys = cafe.configFields.map(f => f.key);
  assert.deepStrictEqual(keys, ['clientId', 'clientSecret', 'defaultClubId', 'defaultMenuId']);
  const sec = cafe.configFields.find(f => f.key === 'clientSecret');
  assert.ok(sec.secret && sec.required);
  assert.ok(cafe.configFields.find(f => f.key === 'clientId').required);
  const hint = cafe.configFields[0].hint;
  assert.match(hint, /http:\/\/127\.0\.0\.1:3600\/oauth\/cafe\/callback/);
  assert.match(hint, /카페/); assert.match(hint, /네이버 로그인/);
  for (const k of ['dailyMax', 'minIntervalMin', 'titleMax', 'bodyMax', 'imagesMax']) assert.ok(cafe.limits[k] > 0, k);
  assert.ok(cafe.limits.dailyMax <= 200);
});

// ---------- validate ----------
test('validate: 정상 원고 통과(설정 기본값 사용)', () => {
  assert.deepStrictEqual(cafe.validate(basePost(), { defaultClubId: '1', defaultMenuId: '2' }), []);
  assert.deepStrictEqual(cafe.validate({ ...basePost(), images: [img] }, { defaultClubId: '1', defaultMenuId: '2' }), []);
});
test('validate: 제목·본문', () => {
  assert.ok(cafe.validate({ ...basePost(), title: '' }).some(e => /제목/.test(e)));
  assert.ok(cafe.validate({ ...basePost(), title: 'ㄱ'.repeat(cafe.limits.titleMax + 1) }).some(e => /제목이/.test(e)));
  assert.deepStrictEqual(cafe.validate({ ...basePost(), title: 'ㄱ'.repeat(cafe.limits.titleMax) }), []);
  assert.ok(cafe.validate({ ...basePost(), body: '  ' }).some(e => /본문/.test(e)));
  assert.ok(cafe.validate({ ...basePost(), body: 'a'.repeat(cafe.limits.bodyMax + 1) }).some(e => /본문이/.test(e)));
});
test('validate: clubId/menuId 숫자·필수', () => {
  assert.ok(cafe.validate({ ...basePost(), target: { clubId: 'abc', menuId: '1' } }).some(e => /clubId.*숫자/.test(e)));
  assert.ok(cafe.validate({ ...basePost(), target: { clubId: '1', menuId: '1a' } }).some(e => /menuId.*숫자/.test(e)));
  // config 를 넘기면 누락도 오류
  const errs = cafe.validate(basePost(), {});
  assert.ok(errs.some(e => /clubId/.test(e)) && errs.some(e => /menuId/.test(e)));
  // 원고 target 이 설정 기본값보다 우선
  assert.deepStrictEqual(cafe._internal.resolveTarget({ target: { clubId: '9', menuId: '8' } }, { defaultClubId: '1', defaultMenuId: '2' }), { clubId: '9', menuId: '8' });
});
test('validate: 이미지 장수·형식·존재, imageUrls만 있는 경우', () => {
  const many = Array(cafe.limits.imagesMax + 1).fill(img);
  assert.ok(cafe.validate({ ...basePost(), images: many }).some(e => /이미지는/.test(e)));
  assert.ok(cafe.validate({ ...basePost(), images: ['C:\\x\\a.bmp'] }).some(e => /형식/.test(e)));
  assert.ok(cafe.validate({ ...basePost(), images: [path.join(tmp, 'none.png')] }).some(e => /없음/.test(e)));
  assert.ok(cafe.validate({ ...basePost(), imageUrls: ['https://e.com/a.png'] }).some(e => /로컬 이미지/.test(e)));
});

// ---------- 본문 변환·인코딩 ----------
test('본문: HTML 이스케이프 + 줄바꿈 <br> + 이미지 자리표시 + 링크·태그', () => {
  const html = cafe._internal.buildContent({ body: 'a<script>x</script>&"\'\r\nb\nc', images: [img, img], link: 'https://l.ink/x', tags: ['MBTI', '#INFP'] });
  assert.strictEqual(html, 'a&lt;script&gt;x&lt;/script&gt;&amp;&quot;&#39;<br>b<br>c<br><br>https://l.ink/x<br><br>#MBTI #INFP<br><img src="#0" /><br><img src="#1" />');
  assert.ok(!/<script/i.test(html));
});
test('인코딩: form 전송 바이트는 UTF-8 이중 URL 인코딩(공식 Java 샘플과 동일)', () => {
  const v = cafe._internal.encodeValue('카페 a+b&c');
  assert.strictEqual(v, '%EC%B9%B4%ED%8E%98%20a%2Bb%26c');
  const wire = new URLSearchParams({ subject: v }).toString();
  assert.strictEqual(wire, 'subject=%25EC%25B9%25B4%25ED%258E%2598%2520a%252Bb%2526c');
  // 서버 처리 재현: form 디코드 → URL 디코드 한 번 더 → 원문
  const formDecoded = new URLSearchParams(wire).get('subject');
  assert.strictEqual(decodeURIComponent(formDecoded), '카페 a+b&c');
});

// ---------- authUrl / authCallback ----------
test('authUrl 파라미터', () => {
  const u = new URL(cafe.authUrl(makeCtx()));
  assert.strictEqual(u.origin + u.pathname, 'https://nid.naver.com/oauth2.0/authorize');
  assert.strictEqual(u.searchParams.get('response_type'), 'code');
  assert.strictEqual(u.searchParams.get('client_id'), 'CID');
  assert.strictEqual(u.searchParams.get('redirect_uri'), 'http://127.0.0.1:3600/oauth/cafe/callback');
  assert.strictEqual(u.searchParams.get('state'), 'st-xyz');
});
test('authCallback: state 불일치·오류는 거부, 네트워크 호출 없음', async () => {
  const req = fakeRequest([]); cafe._setRequest(req);
  await assert.rejects(cafe.authCallback(makeCtx(), { code: 'c', state: 'evil' }), /state/);
  await assert.rejects(cafe.authCallback(makeCtx(), { state: 'st-xyz', error: 'access_denied', error_description: 'Canceled By User' }), /access_denied/);
  await assert.rejects(cafe.authCallback(makeCtx(), { state: 'st-xyz' }), /code/);
  assert.strictEqual(req.calls.length, 0);
});
test('authCallback: 코드 교환 → 토큰 저장 → 프로필 이름', async () => {
  const req = fakeRequest([
    ['oauth2.0/token', { access_token: 'NEWAT', refresh_token: 'NEWRT', token_type: 'bearer', expires_in: '3600' }],
    ['/v1/nid/me', profile],
  ]);
  cafe._setRequest(req);
  const ctx = makeCtx();
  const t0 = Date.now();
  const r = await cafe.authCallback(ctx, { code: 'CODE1', state: 'st-xyz' });
  assert.deepStrictEqual(r, { account: { name: '복복이', handle: 'x@naver.com', id: 'uid1' } });
  assert.strictEqual(ctx.store.accessToken, 'NEWAT');
  assert.strictEqual(ctx.store.refreshToken, 'NEWRT');
  const exp = Number(ctx.store.tokenExpiresAt);
  assert.ok(exp >= t0 + 3600e3 && exp <= Date.now() + 3600e3);
  const q = req.calls[0].opt.query;
  assert.strictEqual(req.calls[0].opt.method, 'POST');
  assert.deepStrictEqual(q, { grant_type: 'authorization_code', client_id: 'CID', client_secret: 'SEC', code: 'CODE1', state: 'st-xyz' });
  assert.strictEqual(req.calls[1].opt.headers.Authorization, 'Bearer NEWAT');
});
test('authCallback: 토큰 응답 error 필드(HTTP 200)도 실패 처리', async () => {
  cafe._setRequest(fakeRequest([['oauth2.0/token', { error: 'invalid_request', error_description: 'no valid data in session' }]]));
  await assert.rejects(cafe.authCallback(makeCtx(), { code: 'c', state: 'st-xyz' }), /invalid_request/);
});

// ---------- 토큰 갱신 ----------
test('만료 임박 시 refresh_token 으로 자동 갱신(기존 refresh_token 유지)', async () => {
  const req = fakeRequest([
    ['oauth2.0/token', { access_token: 'REFRESHED', token_type: 'bearer', expires_in: '3600' }],
    ['/v1/nid/me', profile],
  ]);
  cafe._setRequest(req);
  const ctx = makeCtx(stale());
  const r = await cafe.check(ctx);
  assert.strictEqual(r.ok, true); assert.strictEqual(r.name, '복복이');
  assert.deepStrictEqual(req.calls[0].opt.query, { grant_type: 'refresh_token', client_id: 'CID', client_secret: 'SEC', refresh_token: 'RT' });
  assert.strictEqual(ctx.store.accessToken, 'REFRESHED');
  assert.strictEqual(ctx.store.refreshToken, 'RT');
  assert.strictEqual(req.calls[1].opt.headers.Authorization, 'Bearer REFRESHED');
});
test('유효한 토큰이면 갱신하지 않음', async () => {
  const req = fakeRequest([['/v1/nid/me', profile]]);
  cafe._setRequest(req);
  const r = await cafe.check(makeCtx(fresh()));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(req.calls.length, 1);
  assert.match(r.detail, /만료/);
});
test('check: 토큰 없음 / 갱신 실패', async () => {
  cafe._setRequest(fakeRequest([]));
  assert.deepStrictEqual(await cafe.check(makeCtx()), { ok: false, name: '', detail: '네이버 로그인 연결 필요' });
  cafe._setRequest(fakeRequest([['oauth2.0/token', { error: 'invalid_grant', error_description: 'expired' }]]));
  const r = await cafe.check(makeCtx(stale()));
  assert.strictEqual(r.ok, false); assert.match(r.detail, /invalid_grant/);
});

// ---------- publish ----------
test('publish dryRun(form): 네트워크 없이 인코딩된 payload', async () => {
  const req = fakeRequest([]); cafe._setRequest(req);
  const r = await cafe.publish(makeCtx(), { ...basePost(), options: { openyn: true, ccl: false, bogus: 1 } }, { dryRun: true });
  assert.strictEqual(req.calls.length, 0);
  assert.strictEqual(r.dryRun, true);
  const p = r.payload;
  assert.strictEqual(p.url, 'https://openapi.naver.com/v1/cafe/12345678/menu/3/articles');
  assert.strictEqual(p.contentType, 'application/x-www-form-urlencoded');
  assert.strictEqual(p.decoded.subject, '제목 & 테스트');
  assert.strictEqual(p.decoded.content, '첫 줄 &lt;b&gt;굵게&lt;/b&gt;<br>둘째 줄');
  assert.strictEqual(p.fields.subject, encodeURIComponent('제목 & 테스트'));
  assert.ok(p.wireBody.includes('subject=' + encodeURIComponent(encodeURIComponent('제목 & 테스트'))));
  assert.strictEqual(p.fields.openyn, 'true'); assert.strictEqual(p.fields.ccl, 'false');
  assert.ok(!('bogus' in p.fields));
  assert.deepStrictEqual(p.files, []);
});
test('publish dryRun(multipart): image 필드 반복, 원고 target 우선', async () => {
  cafe._setRequest(fakeRequest([]));
  const r = await cafe.publish(makeCtx(), { ...basePost(), images: [img, img], target: { clubId: '777', menuId: '9' } }, { dryRun: true });
  const p = r.payload;
  assert.strictEqual(p.url, 'https://openapi.naver.com/v1/cafe/777/menu/9/articles');
  assert.strictEqual(p.contentType, 'multipart/form-data');
  assert.strictEqual(p.wireBody, null);
  assert.deepStrictEqual(p.files.map(f => [f.field, f.index, f.name, f.type, f.bytes]), [['image', 0, 'a.png', 'image/png', 8], ['image', 1, 'a.png', 'image/png', 8]]);
  assert.match(p.decoded.content, /<img src="#0" \/><br><img src="#1" \/>$/);
});
test('publish: 검사 실패면 호출 안 함', async () => {
  const req = fakeRequest([]); cafe._setRequest(req);
  await assert.rejects(cafe.publish(makeCtx({}, { defaultClubId: '' }), basePost(), { dryRun: true }), /clubId/);
  assert.strictEqual(req.calls.length, 0);
});
test('publish 실제 경로(form): 응답 파싱 → {id,url}', async () => {
  const req = fakeRequest([['/v1/cafe/', okArticle]]); cafe._setRequest(req);
  const r = await cafe.publish(makeCtx(fresh()), basePost());
  assert.deepStrictEqual(r, { id: '42', url: 'https://cafe.naver.com/mycafe/42', dryRun: false });
  const c = req.calls[0];
  assert.strictEqual(c.opt.method, 'POST');
  assert.strictEqual(c.opt.headers.Authorization, 'Bearer AT');
  assert.strictEqual(c.opt.form.subject, encodeURIComponent('제목 & 테스트'));
  assert.strictEqual(c.opt.retries, 0);   // 중복 게시 방지
});
test('publish 실제 경로(multipart): 필드·파일 구성, articleUrl 없으면 cafeUrl로 조립', async () => {
  const resp = { message: { status: '200', result: { cafeUrl: 'mycafe', articleId: 7 } } };
  const req = fakeRequest([['/v1/cafe/', resp]]); cafe._setRequest(req);
  const r = await cafe.publish(makeCtx(fresh()), { ...basePost(), images: [img] });
  assert.deepStrictEqual(r, { id: '7', url: 'https://cafe.naver.com/mycafe/7', dryRun: false });
  const mp = req.calls[0].opt.multipart;
  assert.deepStrictEqual(mp.map(x => x.name), ['subject', 'content', 'image']);
  assert.strictEqual(mp[0].value, encodeURIComponent('제목 & 테스트'));
  assert.strictEqual(mp[2].file.type, 'image/png');
  assert.ok(!req.calls[0].opt.form);
});
test('publish: 401이면 토큰 강제 갱신 후 1회 재시도', async () => {
  let n = 0;
  const req = fakeRequest([
    ['oauth2.0/token', { access_token: 'AT2', expires_in: '3600' }],
    ['/v1/cafe/', (u, opt) => { if (n++ === 0) throw new ApiError('401', { status: 401, body: {} }); return okArticle; }],
  ]);
  cafe._setRequest(req);
  const ctx = makeCtx(fresh());
  const r = await cafe.publish(ctx, basePost());
  assert.strictEqual(r.id, '42');
  assert.deepStrictEqual(req.calls.map(c => c.url.includes('token') ? 'token' : 'cafe'), ['cafe', 'token', 'cafe']);
  assert.strictEqual(req.calls[2].opt.headers.Authorization, 'Bearer AT2');
});
test('publish: 카페 오류 코드(AP005 등)를 메시지로', async () => {
  const body = { message: { status: '500', error: { code: 'AP005', msg: '스팸 보관함으로 이동했습니다.' } } };
  cafe._setRequest(fakeRequest([['/v1/cafe/', () => { throw new ApiError('403', { status: 403, body }); }]]));
  await assert.rejects(cafe.publish(makeCtx(fresh()), basePost()), e => e.status === 403 && /AP005/.test(e.message));
  cafe._setRequest(fakeRequest([['/v1/cafe/', body]]));
  await assert.rejects(cafe.publish(makeCtx(fresh()), basePost()), /AP005/);
});
