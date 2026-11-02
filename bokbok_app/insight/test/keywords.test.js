'use strict';
const test = require('node:test'), assert = require('node:assert');
const crypto = require('crypto');
const { fj, fakeFetch, noSleep } = require('./helpers');
const { createClient } = require('../lib/http');
const K = require('../collectors/keywords');

const creds = { customerId: '1234567', accessLicense: 'LIC', secretKey: 'SECRET' };

test('서명: base64(HMAC-SHA256("ts.GET./keywordstool", secret))', () => {
  const want = crypto.createHmac('sha256', 'SECRET').update('1700000000000.GET./keywordstool').digest('base64');
  assert.strictEqual(K.sign('SECRET', '1700000000000', 'GET', '/keywordstool'), want);
});

test('응답 파싱: "< 10" 은 5 + lowVolume, 모바일 비중', () => {
  const rows = K.parseKeywordTool(fj('keywordstool.json'));
  const low = rows.find(r => r.keyword === 'INFJ연예인');
  assert.strictEqual(low.total, 10); assert.strictEqual(low.lowVolume, true);
  const a = rows.find(r => r.keyword === 'NF유형특징');
  assert.strictEqual(a.total, 3220); assert.strictEqual(a.compIdx, '낮음'); assert.strictEqual(a.mobileShare, 90);
});

test('collectKeywords: 헤더·힌트(공백 제거, 5개씩)·연관 키워드', async () => {
  const seen = [];
  const client = createClient({ fetch: fakeFetch([['keywordstool', { body: fj('keywordstool.json') }]], seen), sleep: noSleep });
  const kws = ['NF 유형 특징', 'a', 'b', 'c', 'd', 'e'];
  const r = await K.collectKeywords({ client, keywords: kws, creds, now: () => 1700000000000 });
  assert.strictEqual(seen.length, 2);
  const u = new URL(seen[0].url);
  assert.strictEqual(u.searchParams.get('hintKeywords'), 'NF유형특징,a,b,c,d');
  const h = seen[0].opts.headers;
  assert.strictEqual(h['X-API-KEY'], 'LIC'); assert.strictEqual(h['X-Customer'], '1234567'); assert.strictEqual(h['X-Timestamp'], '1700000000000');
  assert.strictEqual(h['X-Signature'], K.sign('SECRET', '1700000000000', 'GET', '/keywordstool'));
  assert.strictEqual(r.volumes['nf유형특징'].total, 3220);
  assert.ok(r.related['nf유형특징'].some(x => x.keyword === 'INFP특징'));
});

test('키가 없으면 설정 안내, 401 이면 키 오류', async () => {
  const client = createClient({ fetch: fakeFetch([[/./, { status: 401, body: '{}' }]]), sleep: noSleep });
  await assert.rejects(K.collectKeywords({ client, keywords: ['a'], creds: null }), /검색광고 API 키/);
  await assert.rejects(K.collectKeywords({ client, keywords: ['a'], creds }), /키가 올바르지 않습니다/);
});
