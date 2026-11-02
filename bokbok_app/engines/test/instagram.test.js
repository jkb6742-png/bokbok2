const test = require('node:test');
const assert = require('node:assert');
globalThis.fetch = () => { throw new Error('테스트에서 실제 네트워크 호출 금지'); };
const ig = require('../instagram');

const blocking = errs => errs.filter(m => !ig.isWarning(m));
const base = { platform: 'instagram', body: '오늘의 MBTI 이야기', imageUrls: ['https://cdn.example.com/a.jpg'] };
const mkCtx = (secrets = { accessToken: 'EAAtoken123' }, config = { igUserId: '1784' }) => ({
  platform: 'instagram', config, log: () => { },
  getSecret: async k => secrets[k] ?? null, setSecret: async (k, v) => { secrets[k] = v; }, secrets,
});
function fake(handler) {
  const calls = [];
  ig._setRequest(async (url, opts) => { calls.push({ url, ...opts }); return handler(url, opts, calls); });
  ig._setSleep(async () => { });
  return calls;
}
test.afterEach(() => { ig._setRequest(); ig._setSleep(); });

test('validate: 통과', () => assert.deepStrictEqual(ig.validate(base), []));
test('validate: 로컬 이미지만 있으면 공개 주소 필요', () => {
  assert.ok(ig.validate({ ...base, imageUrls: [], images: ['C:\\a.png'] }).includes('공개 이미지 주소(imageUrls)가 필요합니다'));
});
test('validate: 이미지 0장 / http / 11장', () => {
  assert.ok(blocking(ig.validate({ ...base, imageUrls: [] })).length);
  assert.ok(blocking(ig.validate({ ...base, imageUrls: ['http://x.com/a.jpg'] }))[0].includes('https'));
  assert.ok(blocking(ig.validate({ ...base, imageUrls: Array(11).fill('https://x.com/a.jpg') })).some(m => m.includes('최대 10장')));
});
test('validate: 캡션 2200자·해시태그 30개', () => {
  assert.ok(blocking(ig.validate({ ...base, body: '가'.repeat(2201) })).some(m => m.includes('2200')));
  assert.deepStrictEqual(blocking(ig.validate({ ...base, body: '가'.repeat(2200) })), []);
  const tags = Array.from({ length: 31 }, (_, i) => 't' + i);
  assert.ok(blocking(ig.validate({ ...base, tags })).some(m => m.includes('해시태그')));
  assert.deepStrictEqual(blocking(ig.validate({ ...base, tags: tags.slice(0, 30) })), []);
});
test('validate: 링크·PNG는 주의(비차단)', () => {
  const e = ig.validate({ ...base, body: '자세히 https://blog.naver.com/x', imageUrls: ['https://x.com/a.png'] });
  assert.strictEqual(e.length, 2);
  assert.ok(e.every(ig.isWarning));
});
test('캡션: 제목+본문+태그, # 제거·중복 제거·본문 해시태그 재추가 안 함', () => {
  const c = ig.buildCaption({ title: '제목', body: '본문 #INFP', tags: ['#infp', 'MBTI', 'mbti', ' 연애 '] });
  assert.strictEqual(c, '제목\n\n본문 #INFP\n\n#MBTI #연애');
});

test('dryRun 단일 이미지: 네트워크 없이 단계 목록', async () => {
  const calls = fake(() => { throw new Error('호출되면 안 됨'); });
  const r = await ig.publish(mkCtx(), { ...base, tags: ['MBTI'] }, { dryRun: true });
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(r.dryRun, true);
  assert.deepStrictEqual(r.payload.map(s => s.step), ['ig.limit', 'ig.media', 'ig.container.status', 'ig.publish', 'ig.permalink']);
  assert.deepStrictEqual(r.payload[1].params, { image_url: base.imageUrls[0], caption: '오늘의 MBTI 이야기\n\n#MBTI' });
  assert.strictEqual(r.payload[1].path, '/1784/media');
  assert.ok(!JSON.stringify(r.payload).includes('EAAtoken'));
});
test('dryRun 캐러셀: 자식 → 상태 → CAROUSEL', async () => {
  const urls = ['https://x.com/1.jpg', 'https://x.com/2.jpg', 'https://x.com/3.jpg'];
  const r = await ig.publish(mkCtx(), { ...base, imageUrls: urls }, { dryRun: true });
  const st = r.payload.map(s => s.step);
  assert.deepStrictEqual(st.slice(0, 4), ['ig.limit', 'ig.media.child', 'ig.media.child', 'ig.media.child']);
  const car = r.payload.find(s => s.step === 'ig.media.carousel');
  assert.deepStrictEqual(car.params, { media_type: 'CAROUSEL', children: '{child1},{child2},{child3}', caption: base.body });
  assert.strictEqual(r.payload[1].params.is_carousel_item, 'true');
});
test('publish: 검증 실패면 던짐', async () => {
  await assert.rejects(ig.publish(mkCtx(), { ...base, imageUrls: [] }, { dryRun: true }), /원고 확인 필요/);
});

test('publish 실제 경로(가짜 fetch): 캐러셀 → 상태 대기 → 발행 → permalink', async () => {
  let n = 0;
  const polls = {};
  const calls = fake((url, o) => {
    if (url.endsWith('/content_publishing_limit')) return { data: [{ quota_usage: 3, config: { quota_total: 50, quota_duration: 86400 } }] };
    if (url.endsWith('/1784/media') && o.method === 'POST') return { id: 'c' + (++n) };
    if (url.endsWith('/1784/media_publish')) { assert.strictEqual(o.form.creation_id, 'c3'); return { id: 'M9' }; }
    if (o.query && o.query.fields === 'status_code,status') { const id = url.split('/').pop(); polls[id] = (polls[id] || 0) + 1; return { status_code: polls[id] < 2 ? 'IN_PROGRESS' : 'FINISHED' }; }
    if (url.endsWith('/M9')) return { permalink: 'https://www.instagram.com/p/abc/' };
    throw new Error('예상 밖 호출 ' + url);
  });
  const r = await ig.publish(mkCtx(), { ...base, imageUrls: ['https://x.com/1.jpg', 'https://x.com/2.jpg'] });
  assert.deepStrictEqual(r, { id: 'M9', url: 'https://www.instagram.com/p/abc/', dryRun: false });
  const car = calls.find(c => c.form && c.form.media_type === 'CAROUSEL');
  assert.strictEqual(car.form.children, 'c1,c2');
  assert.strictEqual(car.form.access_token, 'EAAtoken123');
  assert.ok(calls[0].url.startsWith('https://graph.facebook.com/'));
  assert.deepStrictEqual(polls, { c1: 2, c2: 2, c3: 2 });
});
test('publish: IGAA 토큰이면 graph.instagram.com, permalink 실패는 무시', async () => {
  const calls = fake((url, o) => {
    if (url.endsWith('/content_publishing_limit')) return { data: [{ quota_usage: 0, config: { quota_total: 50 } }] };
    if (o.method === 'POST' && url.endsWith('/media')) return { id: 'c1' };
    if (o.query && o.query.fields === 'status_code,status') return { status_code: 'FINISHED' };
    if (url.endsWith('/media_publish')) return { id: 'M1' };
    return { error: { message: 'no permalink' } };
  });
  const r = await ig.publish(mkCtx({ accessToken: 'IGAAxyz' }), base);
  assert.strictEqual(r.id, 'M1');
  assert.strictEqual(r.url, null);
  assert.ok(calls.every(c => c.url.startsWith('https://graph.instagram.com/')));
});
test('publish: 한도 소진이면 컨테이너 만들기 전에 멈춤', async () => {
  const calls = fake(url => url.endsWith('/content_publishing_limit') ? { data: [{ quota_usage: 50, config: { quota_total: 50 } }] } : assert.fail('호출 금지'));
  await assert.rejects(ig.publish(mkCtx(), base), /발행 한도\(50건\)를 다 썼습니다/);
  assert.strictEqual(calls.length, 1);
});
test('publish: 컨테이너 ERROR / 20회 초과 시간초과', async () => {
  fake((url, o) => {
    if (url.endsWith('/content_publishing_limit')) return { data: [{ quota_usage: 0, config: { quota_total: 50 } }] };
    if (o.method === 'POST') return { id: 'c1' };
    return { status_code: 'ERROR', status: 'Error: 2207026' };
  });
  await assert.rejects(ig.publish(mkCtx(), base), /컨테이너 처리 실패: Error: 2207026/);
  let polls = 0;
  fake((url, o) => {
    if (url.endsWith('/content_publishing_limit')) return { data: [{ quota_usage: 0, config: { quota_total: 50 } }] };
    if (o.method === 'POST') return { id: 'c1' };
    polls++;
    return { status_code: 'IN_PROGRESS' };
  });
  await assert.rejects(ig.publish(mkCtx(), base), /대기 시간 초과/);
  assert.strictEqual(polls, 20);
});

test('check: 계정명과 남은 한도', async () => {
  fake(url => url.endsWith('/content_publishing_limit') ? { data: [{ quota_usage: 7, config: { quota_total: 50 } }] } : { id: '1784', username: 'bokbok_mbti' });
  const r = await ig.check(mkCtx());
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.name, '@bokbok_mbti');
  assert.match(r.detail, /7\/50건 \(남은 43건\)/);
});
test('check: 토큰 없음 / API 오류 → ok:false', async () => {
  assert.strictEqual((await ig.check(mkCtx({}))).ok, false);
  fake(() => ({ error: { message: 'Invalid OAuth access token' } }));
  const r = await ig.check(mkCtx());
  assert.strictEqual(r.ok, false);
  assert.match(r.detail, /Invalid OAuth/);
});
test('configFields', () => {
  assert.deepStrictEqual(ig.configFields.map(f => [f.key, !!f.secret, !!f.required]), [['igUserId', false, true], ['accessToken', true, true]]);
});
