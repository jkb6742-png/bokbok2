const test = require('node:test');
const assert = require('node:assert');
globalThis.fetch = () => { throw new Error('테스트에서 실제 네트워크 호출 금지'); };
const th = require('../threads');

const blocking = errs => errs.filter(m => !th.isWarning(m));
const base = { platform: 'threads', body: 'ENFP는 계획보다 기분' };
const mkCtx = (secrets = { accessToken: 'THtoken1' }, config = {}) => ({
  platform: 'threads', config, log: () => { },
  getSecret: async k => secrets[k] ?? null, setSecret: async (k, v) => { secrets[k] = v; }, secrets,
});
function fake(handler) {
  const calls = [];
  th._setRequest(async (url, opts) => { calls.push({ url, ...opts }); return handler(url, opts, calls); });
  th._setSleep(async () => { });
  return calls;
}
test.afterEach(() => { th._setRequest(); th._setSleep(); });
const LIMIT = { data: [{ quota_usage: 1, config: { quota_total: 250, quota_duration: 86400 } }] };

test('validate: 글만 통과', () => assert.deepStrictEqual(th.validate(base), []));
test('validate: 500자 (태그 포함)', () => {
  assert.deepStrictEqual(th.validate({ ...base, body: '가'.repeat(500) }), []);
  assert.ok(blocking(th.validate({ ...base, body: '가'.repeat(495), tags: ['MBTI'] })).some(m => m.includes('500')));
});
test('validate: 로컬 이미지만 → 공개 주소 필요, http 거부, 21장 거부', () => {
  assert.ok(th.validate({ ...base, images: ['C:\\a.png'] }).includes('공개 이미지 주소(imageUrls)가 필요합니다'));
  assert.ok(blocking(th.validate({ ...base, imageUrls: ['http://x.com/a.jpg'] }))[0].includes('https'));
  assert.ok(blocking(th.validate({ ...base, imageUrls: Array(21).fill('https://x.com/a.jpg') })).some(m => m.includes('최대 20장')));
});
test('validate: 해시태그 2개 이상은 주의(비차단)', () => {
  const e = th.validate({ ...base, tags: ['MBTI', '#ENFP', 'mbti'] });
  assert.strictEqual(e.length, 1);
  assert.ok(th.isWarning(e[0]));
});
test('본문 조립: 태그 # 제거·중복 제거, 이미지 글이면 링크를 본문 끝에', () => {
  assert.strictEqual(th.buildText({ ...base, tags: ['#MBTI', 'mbti'] }), 'ENFP는 계획보다 기분\n\n#MBTI');
  assert.strictEqual(th.buildText({ ...base, link: 'https://b.com/1', imageUrls: ['https://x.com/a.jpg'] }), 'ENFP는 계획보다 기분\n\nhttps://b.com/1');
  assert.strictEqual(th.buildText({ ...base, link: 'https://b.com/1' }), base.body);
});

test('dryRun TEXT + link_attachment', async () => {
  const calls = fake(() => assert.fail('호출 금지'));
  const r = await th.publish(mkCtx(), { ...base, link: 'https://b.com/1' }, { dryRun: true });
  assert.strictEqual(calls.length, 0);
  assert.deepStrictEqual(r.payload.map(s => s.step), ['th.limit', 'th.text', 'th.container.status', 'th.publish', 'th.permalink']);
  assert.deepStrictEqual(r.payload[1], { step: 'th.text', method: 'POST', path: '/me/threads', params: { media_type: 'TEXT', text: base.body, link_attachment: 'https://b.com/1' } });
});
test('dryRun IMAGE / CAROUSEL, threadsUserId 사용', async () => {
  const one = await th.publish(mkCtx(undefined, { threadsUserId: '555' }), { ...base, imageUrls: ['https://x.com/a.jpg'] }, { dryRun: true });
  assert.deepStrictEqual(one.payload[1].params, { media_type: 'IMAGE', image_url: 'https://x.com/a.jpg', text: base.body });
  assert.strictEqual(one.payload[1].path, '/555/threads');
  const car = await th.publish(mkCtx(), { ...base, imageUrls: ['https://x.com/1.jpg', 'https://x.com/2.jpg'] }, { dryRun: true });
  assert.deepStrictEqual(car.payload.map(s => s.step), ['th.limit', 'th.carousel.child', 'th.carousel.child', 'th.container.status', 'th.container.status', 'th.carousel', 'th.container.status', 'th.publish', 'th.permalink']);
  assert.strictEqual(car.payload.find(s => s.step === 'th.carousel').params.children, '{child1},{child2}');
});

test('publish 실제 경로(가짜 fetch)', async () => {
  let polls = 0;
  const calls = fake((url, o) => {
    if (url.endsWith('/threads_publishing_limit')) return LIMIT;
    if (url.endsWith('/me/threads')) return { id: 'C1' };
    if (url.endsWith('/C1')) return { status: ++polls < 3 ? 'IN_PROGRESS' : 'FINISHED' };
    if (url.endsWith('/me/threads_publish')) { assert.strictEqual(o.form.creation_id, 'C1'); return { id: 'P1' }; }
    if (url.endsWith('/P1')) return { permalink: 'https://www.threads.net/@bokbok/post/abc' };
    assert.fail('예상 밖 ' + url);
  });
  const r = await th.publish(mkCtx(), base);
  assert.deepStrictEqual(r, { id: 'P1', url: 'https://www.threads.net/@bokbok/post/abc', dryRun: false });
  assert.strictEqual(polls, 3);
  assert.ok(calls.every(c => c.url.startsWith('https://graph.threads.net/v1.0/')));
  assert.strictEqual(calls[1].form.access_token, 'THtoken1');
});
test('publish: 한도 소진 → 멈춤, 컨테이너 ERROR → error_message', async () => {
  const calls = fake(() => ({ data: [{ quota_usage: 250, config: { quota_total: 250 } }] }));
  await assert.rejects(th.publish(mkCtx(), base), /발행 한도\(250건\)를 다 썼습니다/);
  assert.strictEqual(calls.length, 1);
  fake((url, o) => url.endsWith('_limit') ? LIMIT : o.method === 'POST' ? { id: 'C1' } : { status: 'ERROR', error_message: 'UNKNOWN' });
  await assert.rejects(th.publish(mkCtx(), base), /컨테이너 처리 실패: UNKNOWN/);
});

test('check: 만료 7일 이내면 갱신 후 저장', async () => {
  const soon = new Date(Date.now() + 3 * 86400e3).toISOString();
  const ctx = mkCtx({ accessToken: 'OLD', tokenExpiresAt: soon });
  const calls = fake((url, o) => {
    if (url === 'https://graph.threads.net/refresh_access_token') {
      assert.strictEqual(o.query.grant_type, 'th_refresh_token');
      assert.strictEqual(o.query.access_token, 'OLD');
      return { access_token: 'NEW', token_type: 'bearer', expires_in: 5184000 };
    }
    if (url.endsWith('/threads_publishing_limit')) return LIMIT;
    return { id: '555', username: 'bokbok' };
  });
  const r = await th.check(ctx);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.name, '@bokbok');
  assert.strictEqual(ctx.secrets.accessToken, 'NEW');
  assert.ok(Date.parse(ctx.secrets.tokenExpiresAt) > Date.now() + 59 * 86400e3);
  assert.match(r.detail, /방금 갱신/);
  assert.match(r.detail, /1\/250건 \(남은 249건\)/);
  assert.ok(calls.slice(1).every(c => c.query.access_token === 'NEW'));
});
test('check: 만료 여유 있으면 갱신 안 함', async () => {
  const later = new Date(Date.now() + 30 * 86400e3).toISOString();
  const calls = fake(url => url.endsWith('_limit') ? LIMIT : { id: '555', username: 'bokbok' });
  const r = await th.check(mkCtx({ accessToken: 'T', tokenExpiresAt: later }));
  assert.ok(r.ok);
  assert.ok(!calls.some(c => c.url.includes('refresh')));
  assert.match(r.detail, new RegExp('토큰 만료 ' + later.slice(0, 10)));
});
test('check: 갱신 실패(24시간 미만 토큰 등)해도 연결 확인은 진행', async () => {
  const ctx = mkCtx({ accessToken: 'T' });
  fake(url => url.includes('refresh') ? { error: { message: 'Session has not been active long enough' } } : url.endsWith('_limit') ? LIMIT : { id: '555', username: 'bokbok' });
  const r = await th.check(ctx);
  assert.ok(r.ok);
  assert.match(r.detail, /토큰 갱신 실패/);
  assert.strictEqual(ctx.secrets.accessToken, 'T');
});
test('check: 토큰 없음 → ok:false', async () => assert.strictEqual((await th.check(mkCtx({}))).ok, false));
test('configFields', () => {
  assert.deepStrictEqual(th.configFields.map(f => [f.key, !!f.secret, !!f.required]), [['threadsUserId', false, false], ['accessToken', true, true]]);
});
