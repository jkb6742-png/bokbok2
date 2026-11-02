const test = require('node:test');
const assert = require('node:assert');
const openai = require('../openai');
const { fakeFetch, chatResp, imageResp, resp } = require('./fixtures');

const KEY = 'sk-proj-SECRETKEY1234567890abcdef';
openai._setSleep(async () => {});
test.after(() => { openai._setFetch(null); openai._setSleep(null); });

test('chatJSON: 요청 모양(JSON 모드·max_completion_tokens·Bearer)과 결과', async () => {
  const f = fakeFetch([chatResp({ a: 1 })]);
  openai._setFetch(f);
  const r = await openai.chatJSON({ apiKey: KEY, model: 'gpt-5', system: 's', user: 'u JSON', reasoningEffort: 'low' });
  assert.deepStrictEqual(r, { a: 1 });
  const c = f.calls[0];
  assert.strictEqual(c.url, 'https://api.openai.com/v1/chat/completions');
  assert.strictEqual(c.opts.headers.Authorization, `Bearer ${KEY}`);
  assert.deepStrictEqual(c.body.response_format, { type: 'json_object' });
  assert.ok(c.body.max_completion_tokens > 0);
  assert.strictEqual(c.body.reasoning_effort, 'low');
  assert.strictEqual(c.body.temperature, undefined);
  assert.deepStrictEqual(c.body.messages.map(m => m.role), ['system', 'user']);
});

test('chatJSON: JSON 해석 실패 시 1회 다시 요청', async () => {
  const f = fakeFetch([chatResp('이건 JSON 아님'), chatResp('```json\n{"ok":true}\n```')]);
  openai._setFetch(f);
  assert.deepStrictEqual(await openai.chatJSON({ apiKey: KEY, system: 's', user: 'u' }), { ok: true });
  assert.strictEqual(f.calls.length, 2);
  assert.match(f.calls[1].body.messages.at(-1).content, /JSON/);
});

test('chatJSON: 두 번 다 JSON 아니면 오류', async () => {
  openai._setFetch(fakeFetch([chatResp('x'), chatResp('y')]));
  await assert.rejects(openai.chatJSON({ apiKey: KEY, system: 's', user: 'u' }), /JSON으로 읽을 수 없습니다/);
});

test('chatJSON: 길이 제한으로 잘리면 바로 오류', async () => {
  openai._setFetch(fakeFetch([{ json: { choices: [{ message: { content: '{"a":' }, finish_reason: 'length' }] } }]));
  await assert.rejects(openai.chatJSON({ apiKey: KEY, system: 's', user: 'u' }), /길이 제한/);
});

test('401 → 키 오류, 키는 메시지에 없음', async () => {
  openai._setFetch(fakeFetch([{ status: 401, json: { error: { message: `Incorrect API key provided: ${KEY}`, code: 'invalid_api_key' } } }]));
  const e = await openai.chatJSON({ apiKey: KEY, system: 's', user: 'u' }).catch(e => e);
  assert.match(e.message, /API 키가 맞지 않습니다/);
  assert.ok(!e.message.includes(KEY) && !e.message.includes('SECRETKEY'));
});

test('429 insufficient_quota → 한도 오류(재시도 없음)', async () => {
  const f = fakeFetch([{ status: 429, json: { error: { message: 'You exceeded your current quota', code: 'insufficient_quota' } } }]);
  openai._setFetch(f);
  await assert.rejects(openai.chatJSON({ apiKey: KEY, system: 's', user: 'u' }), e => e.kind === 'quota' && /크레딧/.test(e.message));
  assert.strictEqual(f.calls.length, 1);
});

test('429 rate limit → 1회 재시도 후 성공 / 계속이면 속도 제한 오류', async () => {
  const rl = { status: 429, json: { error: { message: 'Rate limit reached', code: 'rate_limit_exceeded' } } };
  openai._setFetch(fakeFetch([rl, chatResp({ ok: 1 })]));
  assert.deepStrictEqual(await openai.chatJSON({ apiKey: KEY, system: 's', user: 'u' }), { ok: 1 });
  openai._setFetch(fakeFetch([rl, rl]));
  await assert.rejects(openai.chatJSON({ apiKey: KEY, system: 's', user: 'u' }), e => e.kind === 'rate' && /속도 제한/.test(e.message));
});

test('image: 400 content_policy → 정책 오류', async () => {
  openai._setFetch(fakeFetch([{ status: 400, json: { error: { message: 'Your request was rejected by the safety system', code: 'content_policy_violation' } } }]));
  await assert.rejects(openai.image({ apiKey: KEY, prompt: 'p' }), /이미지 프롬프트가 정책에 걸렸습니다/);
});

test('image: b64 → Buffer, gpt-image-1 요청 모양', async () => {
  const f = fakeFetch([imageResp()]);
  openai._setFetch(f);
  const buf = await openai.image({ apiKey: KEY, prompt: 'scene', quality: 'low' });
  assert.ok(Buffer.isBuffer(buf) && buf.length > 100);
  assert.strictEqual(buf.readUInt32BE(0), 0x89504e47);
  const b = f.calls[0].body;
  assert.strictEqual(f.calls[0].url, 'https://api.openai.com/v1/images/generations');
  assert.deepStrictEqual([b.model, b.size, b.quality, b.n, b.response_format], ['gpt-image-1', '1536x1024', 'low', 1, undefined]);
});

test('시간 초과 → 한국어 오류', async () => {
  openai._setFetch((url, opts) => new Promise((_, rej) => opts.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); })));
  await assert.rejects(openai.chatJSON({ apiKey: KEY, system: 's', user: 'u', timeoutMs: 30 }), /시간 초과/);
});

test('연결 오류 메시지에서도 키 가림', async () => {
  openai._setFetch(async () => { throw new Error(`boom Bearer ${KEY} token=${KEY}`); });
  const e = await openai.image({ apiKey: KEY, prompt: 'p' }).catch(e => e);
  assert.match(e.message, /연결 실패/);
  assert.ok(!e.message.includes('SECRETKEY'));
});

test('키 없음 → 바로 오류(요청 안 함)', async () => {
  const f = fakeFetch([]);
  openai._setFetch(f);
  await assert.rejects(openai.chatJSON({ system: 's', user: 'u' }), /키가 없습니다/);
  assert.strictEqual(f.calls.length, 0);
});

test('mapError: 5xx·403·404', () => {
  assert.match(openai.mapError(503, {}, KEY).message, /서버 오류/);
  assert.match(openai.mapError(403, { error: { message: 'org must be verified' } }, KEY).message, /권한/);
  assert.match(openai.mapError(404, { error: { code: 'model_not_found' } }, KEY).message, /모델을 찾을 수 없습니다/);
  void resp;
});
