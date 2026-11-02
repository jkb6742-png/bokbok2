// 참고 이미지: imageEdit(multipart) 요청 모양 · pipeline이 refs 있으면 /images/edits 로 간다
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const openai = require('../openai');
const pipeline = require('../pipeline');
const writer = require('../writer');
const { PROFILE, INPUT, goodRaw, fakeFetch, chatResp, imageResp, PNG, tmpDir } = require('./fixtures');

writer._setCardValidator(null);
openai._setSleep(async () => {});
const KEY = 'sk-proj-REFKEY000000000000';
test.afterEach(() => { openai._setFetch(null); pipeline._setRenderer(null); });

test('imageEdit: image[] 여러 장 + prompt 가 multipart 로 /images/edits 에 간다', async () => {
  const f = fakeFetch([imageResp()]);
  openai._setFetch(f);
  const buf = await openai.imageEdit({ apiKey: KEY, prompt: '창가의 노트북', refs: [{ buf: PNG, name: 'a.png', type: 'image/png' }, { buf: PNG, name: 'b.jpg', type: 'image/jpeg' }] });
  assert.ok(Buffer.isBuffer(buf) && buf.length > 100);
  const c = f.calls[0];
  assert.strictEqual(c.url, 'https://api.openai.com/v1/images/edits');
  assert.match(c.opts.headers['Content-Type'], /^multipart\/form-data; boundary=/);
  const body = c.opts.body.toString('latin1');
  assert.strictEqual((body.match(/name="image\[\]"/g) || []).length, 2);
  assert.match(body, /filename="b\.jpg"/);
  assert.match(body, /name="model"\r\n\r\ngpt-image-1/);
  assert.match(body, /Do NOT copy their subjects/);
  assert.ok(Buffer.from(body, 'latin1').toString('utf8').includes('창가의 노트북'));
});

test('imageEdit: refs 없으면 일반 생성, dall-e 면 거절', async () => {
  const f = fakeFetch([imageResp()]);
  openai._setFetch(f);
  await openai.imageEdit({ apiKey: KEY, prompt: 'x', refs: [] });
  assert.strictEqual(f.calls[0].url, 'https://api.openai.com/v1/images/generations');
  await assert.rejects(openai.imageEdit({ apiKey: KEY, model: 'dall-e-3', prompt: 'x', refs: [{ buf: PNG }] }), /gpt-image/);
});

test('pipeline.generate: input.refs 가 있으면 참고 이미지로 그리고, 없는 파일은 건너뛴다', async () => {
  const root = tmpDir('bokbok-refs-');
  try {
    const ref = path.join(root, 'ref1.png'); fs.writeFileSync(ref, PNG);
    const f = fakeFetch([chatResp(goodRaw()), imageResp()]);
    openai._setFetch(f);
    pipeline._setRenderer(async (cards, opts) => cards.map(c => { fs.writeFileSync(path.join(opts.outDir, c.file), PNG); return { file: c.file, width: 860, height: 640 }; }));
    const logs = [];
    const r = await pipeline.generate({ input: { ...INPUT, refs: [ref, path.join(root, '없는파일.png')] }, profile: PROFILE, settings: { model: 'gpt-5', imageModel: 'gpt-image-1', imageQuality: 'medium' }, apiKey: KEY, outRoot: root, log: m => logs.push(m), step: () => {}, rand: () => 0 });
    assert.strictEqual(f.calls[1].url, 'https://api.openai.com/v1/images/edits');
    assert.ok(logs.some(l => /참고 이미지 1장/.test(l)));
    assert.ok(logs.some(l => /건너뜀/.test(l)));
    const d = JSON.parse(fs.readFileSync(path.join(r.dir, 'draft.json'), 'utf8'));
    assert.deepStrictEqual(d.input.refs.length, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
