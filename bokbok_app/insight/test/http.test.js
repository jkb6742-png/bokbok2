'use strict';
const test = require('node:test'), assert = require('node:assert');
const { createClient, fakeFetch } = require('../lib/http');

test('같은 호스트는 최소 2초 간격, 다른 호스트는 기다리지 않음', async () => {
  let t = 0; const waits = [];
  const c = createClient({ fetch: fakeFetch([[/./, { body: '{}' }]]), sleep: async ms => { waits.push(ms); t += ms; }, now: () => t, random: () => 0 });
  await c.request('https://a.naver.com/1'); await c.request('https://a.naver.com/2'); await c.request('https://b.naver.com/1');
  assert.deepStrictEqual(waits, [2000]);
  assert.strictEqual(c.calls, 3);
});

test('흔들림(jitter)이 간격에 더해짐', async () => {
  let t = 0; const waits = [];
  const c = createClient({ fetch: fakeFetch([[/./, { body: '{}' }]]), sleep: async ms => { waits.push(ms); t += ms; }, now: () => t, random: () => 0.5, jitterMs: 1000 });
  await c.request('https://a.naver.com/1'); await c.request('https://a.naver.com/2');
  assert.deepStrictEqual(waits, [2500]);
});

test('500 은 최대 2번 다시 시도한 뒤 한국어 오류', async () => {
  let n = 0;
  const c = createClient({ fetch: fakeFetch([[/./, () => { n++; return { status: 503, body: 'x' }; }]]), sleep: async () => { } });
  await assert.rejects(c.request('https://a.naver.com/x', { step: '시험' }), e => /시험 실패: 응답 오류\(503\)/.test(e.message) && e.status === 503);
  assert.strictEqual(n, 3);
});

test('시간 초과는 재시도 후 "시간 초과(15초)"', async () => {
  let n = 0;
  const abort = () => { n++; const e = new Error('aborted'); e.name = 'AbortError'; return e; };
  const c = createClient({ fetch: fakeFetch([[/./, abort]]), sleep: async () => { } });
  await assert.rejects(c.request('https://a.naver.com/x', { step: '글 목록' }), e => e.code === 'TIMEOUT' && /글 목록 시간 초과\(15초\)/.test(e.message));
  assert.strictEqual(n, 3);
});

test('404 는 재시도 없이 실패, 204 는 성공', async () => {
  let n = 0;
  const c = createClient({ fetch: fakeFetch([['/nf', () => { n++; return { status: 404, body: '' }; }], ['/empty', { status: 204, body: '' }]]), sleep: async () => { } });
  await assert.rejects(c.request('https://a.naver.com/nf'), /404/);
  assert.strictEqual(n, 1);
  const r = await c.request('https://a.naver.com/empty');
  assert.strictEqual(r.status, 204);
});
