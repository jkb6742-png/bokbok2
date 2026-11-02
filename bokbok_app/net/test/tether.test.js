// 네트워크 엔진 — 네트워크·휴대폰 없이 판정 논리만
const test = require('node:test');
const assert = require('node:assert');
const T = require('../tether');

test('USB 테더링 어댑터 이름 판별, 유선 랜카드는 아님', () => {
  const re = T._internal.USB_RE;
  assert.ok(re.test('이더넷 3 Remote NDIS based Internet Sharing Device'));
  assert.ok(re.test('Apple Mobile Device Ethernet'));
  assert.ok(!re.test('이더넷 2 Realtek PCIe GbE Family Controller'));
});

test('지역 라벨 한글화', () => {
  assert.strictEqual(T.regionLabel({ country: 'KR', region: 'Gyeonggi-do', city: 'Icheon-si' }), '경기 이천');
  assert.strictEqual(T.regionLabel({ country: 'KR', region: 'Seoul', city: 'Seoul' }), '서울');
  assert.strictEqual(T.regionLabel({ country: 'JP', region: 'Tokyo', city: 'Tokyo' }), 'JP Tokyo');
  assert.strictEqual(T.regionKey({ country: 'KR', region: 'Seoul' }), 'KR/서울');
});

test('신호등: 연결 없음=빨강, 유선=주황, 피할 지역=주황, 테더링=초록', () => {
  const g = { country: 'KR', region: 'Seoul', city: 'Seoul' };
  assert.strictEqual(T.light({ ip: null, link: { connected: false }, geo: null, settings: {} }).color, 'red');
  assert.strictEqual(T.light({ ip: null, link: { connected: true, label: '유선 인터넷' }, geo: null, settings: {} }).color, 'red');
  assert.strictEqual(T.light({ ip: '1.2.3.4', link: { connected: true, kind: 'lan', tethered: false, label: '유선 인터넷' }, geo: g, settings: {} }).color, 'amber');
  assert.strictEqual(T.light({ ip: '1.2.3.4', link: { connected: true, kind: 'lan', tethered: false, label: '유선 인터넷' }, geo: g, settings: { tetherOnly: false } }).color, 'green');
  assert.strictEqual(T.light({ ip: '1.2.3.4', link: { connected: true, kind: 'usb', tethered: true, label: 'USB 테더링' }, geo: g, settings: { avoidRegions: ['KR/서울'] } }).color, 'amber');
  const ok = T.light({ ip: '1.2.3.4', link: { connected: true, kind: 'usb', tethered: true, label: 'USB 테더링' }, geo: g, settings: {} });
  assert.strictEqual(ok.color, 'green'); assert.match(ok.reason, /서울/);
});

test('waitForIp: IP가 바뀌면 바로 돌아온다', async () => {
  let n = 0;
  const ip = await T._internal.waitForIp({ getIp: async () => (++n < 2 ? '1.1.1.1' : '2.2.2.2'), prevIp: '1.1.1.1', timeoutMs: 20000, log: () => { } });
  assert.strictEqual(ip, '2.2.2.2');
});
