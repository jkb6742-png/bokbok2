// 이미지 방식: ai / photos(내 사진) / cards(글자 카드만)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const openai = require('../openai');
const pipeline = require('../pipeline');
const writer = require('../writer');
const { PROFILE, INPUT, goodRaw, fakeFetch, chatResp, PNG, tmpDir } = require('./fixtures');

writer._setCardValidator(null);
openai._setSleep(async () => {});
const KEY = 'sk-proj-PHOTOKEY00000000000';
const S = { model: 'gpt-5', imageModel: 'gpt-image-1', imageQuality: 'medium' };
const fakeRenderer = () => async (cards, opts) => cards.map(c => { fs.writeFileSync(path.join(opts.outDir, c.file), PNG); return { file: c.file, width: 860, height: 640 }; });
test.afterEach(() => { openai._setFetch(null); pipeline._setRenderer(null); });

test('spreadSlots / planDraft: 방식별 AI 자리', () => {
  assert.deepStrictEqual(writer.spreadSlots(0, 4), []);
  assert.deepStrictEqual(writer.spreadSlots(1, 4), [0]);
  assert.deepStrictEqual(writer.spreadSlots(2, 4), [0, 2]);
  assert.deepStrictEqual(writer.spreadSlots(3, 6), [0, 2, 4]);
  assert.deepStrictEqual(writer.spreadSlots(5, 4), [0, 1, 2, 3]);
  const P = writer.planDraft({ ...INPUT, imageMode: 'cards' }, PROFILE, { history: [] });
  assert.strictEqual(P.aiCount, 0); assert.deepStrictEqual(P.aiIndexes, []);
  const Q = writer.planDraft({ ...INPUT, imageMode: 'photos', photos: ['a.jpg', 'b.jpg', 'c.jpg'] }, PROFILE, { history: [] });
  assert.strictEqual(Q.aiCount, 3); assert.deepStrictEqual(Q.aiIndexes, [0, 1, 2]);
  assert.throws(() => writer.planDraft({ ...INPUT, imageMode: 'photos', photos: [] }, PROFILE, { history: [] }), /사진을 1장 이상/);
  const { user } = writer.buildMessages(null, PROFILE, Q);
  assert.match(user, /내 사진 3장 \+ 카드 1장/);
});

// goodRaw 는 0번만 ai, 나머지 card 인 4장짜리 원고 → photos 1장 / cards 는 raw 를 맞춰 준다
function rawFor(mode, photos) {
  const r = goodRaw();
  const P = writer.planDraft({ ...INPUT, imageMode: mode, photos }, PROFILE, { history: [] });
  r.images = r.images.map((im, i) => P.aiIndexes.includes(i) ? (im.kind === 'ai' ? im : { kind: 'ai', prompt: '사진 설명', alt: '사진' }) : (im.kind === 'card' ? im : r.images.find(x => x.kind === 'card')));
  return r;
}

test('pipeline: 내 사진 방식은 OpenAI 이미지 호출 없이 사진을 복사하고 kind=photo', async () => {
  const root = tmpDir('bokbok-photo-');
  try {
    const p1 = path.join(root, 'cafe.jpg'); fs.writeFileSync(p1, PNG);
    const f = fakeFetch([chatResp(rawFor('photos', [p1]))]);
    openai._setFetch(f); pipeline._setRenderer(fakeRenderer());
    const steps = [];
    const r = await pipeline.generate({ input: { ...INPUT, imageMode: 'photos', photos: [p1] }, profile: PROFILE, settings: S, apiKey: KEY, outRoot: root, log: () => {}, step: n => steps.push(n), rand: () => 0 });
    assert.strictEqual(f.calls.length, 1, 'OpenAI 는 글 1번만');
    assert.ok(steps.includes('내 사진 넣기'));
    const d = JSON.parse(fs.readFileSync(path.join(r.dir, 'draft.json'), 'utf8'));
    assert.strictEqual(d.images[0].kind, 'photo');
    assert.strictEqual(d.images[0].file, '01_사진.jpg');
    assert.ok(fs.existsSync(path.join(r.dir, '01_사진.jpg')));
    assert.match(r.txt, /\[사진\] 01_사진\.jpg/);
    await assert.rejects(pipeline.regenImage({ dir: r.dir, index: 0, apiKey: KEY, settings: S, profile: PROFILE }), /다시 생성할 수 없습니다/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('pipeline: 글자 카드만 방식은 이미지 생성 단계에서 아무 호출도 없다', async () => {
  const root = tmpDir('bokbok-cards-');
  try {
    const f = fakeFetch([chatResp(rawFor('cards'))]);
    openai._setFetch(f); pipeline._setRenderer(fakeRenderer());
    const r = await pipeline.generate({ input: { ...INPUT, imageMode: 'cards' }, profile: PROFILE, settings: S, apiKey: KEY, outRoot: root, log: () => {}, step: () => {}, rand: () => 0 });
    assert.strictEqual(f.calls.length, 1);
    const d = JSON.parse(fs.readFileSync(path.join(r.dir, 'draft.json'), 'utf8'));
    assert.ok(d.images.every(im => im.kind === 'card'));
    assert.strictEqual(d.imageMode, 'cards');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
