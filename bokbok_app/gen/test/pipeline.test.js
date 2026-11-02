const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const pipeline = require('../pipeline');
const writer = require('../writer');
const openai = require('../openai');
const manuscript = require('../../../naver_post/manuscript');
const { PROFILE, INPUT, goodRaw, fakeFetch, chatResp, imageResp, PNG, tmpDir } = require('./fixtures');

writer._setCardValidator(null);
openai._setSleep(async () => {});
const KEY = 'sk-proj-PIPELINEKEY0987654321';
const SETTINGS = { model: 'gpt-5', imageModel: 'gpt-image-1', imageQuality: 'medium' };

// 가짜 카드 렌더(작업자 L 의 renderCards 와 같은 모양)
function fakeRenderer() {
  const calls = [];
  const fn = async (cards, opts) => {
    calls.push({ cards, opts });
    return cards.map(c => { fs.writeFileSync(path.join(opts.outDir, c.file), PNG); return { file: c.file, width: 860, height: 640 }; });
  };
  fn.calls = calls;
  return fn;
}

let root;
test.beforeEach(() => { root = tmpDir('bokbok-pipe-'); });
test.afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); openai._setFetch(null); pipeline._setRenderer(null); });

test('generate: draft.json·이미지·원고.txt 저장, 단계 순서, load() 통과', async () => {
  const f = fakeFetch([chatResp(goodRaw()), imageResp()]);
  openai._setFetch(f);
  const R = fakeRenderer(); pipeline._setRenderer(R);
  const steps = [], logs = [];
  const input = { ...INPUT, preset: '연애 프리셋 A' };
  const r = await pipeline.generate({ input, profile: PROFILE, settings: SETTINGS, apiKey: KEY, outRoot: root, log: m => logs.push(m), step: (n, i, t) => steps.push(`${i}/${t} ${n}`), rand: () => 0 });

  assert.deepStrictEqual(steps, ['1/4 원고 작성', '2/4 대표 이미지 생성', '3/4 카드 렌더', '4/4 원고 저장']);
  assert.ok(r.dir.startsWith(path.join(root, 'testblog')));
  assert.match(path.basename(r.dir), /^\d{8}_\d{4}_INTP_연애$/);
  for (const fname of ['draft.json', '원고.txt', '01_대표.png', '02_핵심정리.png', '03_비교.png', '04_체크리스트.png']) assert.ok(fs.existsSync(path.join(r.dir, fname)), fname);

  const d = JSON.parse(fs.readFileSync(path.join(r.dir, 'draft.json'), 'utf8'));
  assert.strictEqual(d.layout, 'classic');
  assert.strictEqual(d.imageStyle, 'character');
  assert.strictEqual(d.deco, 'auto');
  assert.strictEqual(d.model, 'gpt-5');
  assert.strictEqual(d.preset, '연애 프리셋 A');
  assert.strictEqual(d.input.keyword, 'INTP 연애');
  assert.ok(d.createdAt && d.variant && d.variant.closingHeading);
  assert.strictEqual(d.images[1].width, 860);

  // 렌더러 호출 모양
  assert.strictEqual(R.calls.length, 1);
  assert.deepStrictEqual(R.calls[0].cards.map(c => c.template), ['points', 'compare', 'checklist']);
  assert.deepStrictEqual(Object.keys(R.calls[0].opts).sort(), ['color', 'deco', 'footer', 'log', 'outDir']);
  assert.strictEqual(R.calls[0].opts.footer, '복복이 MBTI');
  assert.strictEqual(R.calls[0].opts.color, '#3F9470');

  // 이미지 요청 = 스타일+금지 규칙 붙은 프롬프트
  const imgBody = f.calls[1].body;
  assert.match(imgBody.prompt, /chibi/);
  assert.match(imgBody.prompt, /no text/i);
  assert.strictEqual(imgBody.quality, 'medium');

  const S = manuscript.load(path.join(r.dir, '원고.txt'));
  assert.strictEqual(S.title, d.title);
  assert.strictEqual(S.images.length, 4);
  assert.strictEqual(r.txt, fs.readFileSync(path.join(r.dir, '원고.txt'), 'utf8'));
  assert.ok(!logs.join('\n').includes('PIPELINEKEY'));
  assert.ok(!fs.readFileSync(path.join(r.dir, 'draft.json'), 'utf8').includes('PIPELINEKEY'));
});

test('generate: 이미지 실패 → 원고는 남기고 한국어 오류', async () => {
  openai._setFetch(fakeFetch([chatResp(goodRaw()), { status: 400, json: { error: { code: 'moderation_blocked', message: 'blocked by safety' } } }]));
  pipeline._setRenderer(fakeRenderer());
  await assert.rejects(pipeline.generate({ input: INPUT, profile: PROFILE, settings: SETTINGS, apiKey: KEY, outRoot: root, rand: () => 0 }), /대표 이미지 생성 실패.*정책에 걸렸습니다/);
  const dirs = fs.readdirSync(path.join(root, 'testblog'));
  assert.strictEqual(dirs.length, 1);
  assert.ok(fs.existsSync(path.join(root, 'testblog', dirs[0], 'draft.json')));
});

test('generate: 원고 검사 실패 → _실패 폴더에 기록, 반복 방지 기록엔 안 들어감', async () => {
  const bad = goodRaw({ tags: ['하나'] });
  openai._setFetch(fakeFetch([chatResp(bad), chatResp(bad)]));
  await assert.rejects(pipeline.generate({ input: INPUT, profile: PROFILE, settings: SETTINGS, apiKey: KEY, outRoot: root, rand: () => 0 }), /원고 검사를 통과하지 못했습니다/);
  assert.strictEqual(fs.readdirSync(path.join(root, 'testblog', '_실패')).length, 1);
  assert.deepStrictEqual(pipeline.readHistory(root, 'testblog'), []);
});

test('readHistory + auto: 최근 3개와 다른 레이아웃·스타일·정리 제목', () => {
  const base = path.join(root, 'testblog');
  const recs = [['20261030_0900', 'classic', 'photo', '오늘의 포스팅을 정리하면?'], ['20261031_0900', 'qa', 'character', '한 번에 정리해 보면'], ['20261101_0900', 'list', 'flat', '마지막으로 정리'], ['20261020_0900', 'story', 'minimal', 'x']];
  for (const [name, layout, imageStyle, closingHeading] of recs) {
    fs.mkdirSync(path.join(base, name), { recursive: true });
    fs.writeFileSync(path.join(base, name, 'draft.json'), JSON.stringify({ title: name, layout, imageStyle, variant: { closingHeading }, createdAt: `${name.slice(0, 4)}-${name.slice(4, 6)}-${name.slice(6, 8)}T09:00:00Z` }));
  }
  const h = pipeline.readHistory(root, 'testblog');
  assert.deepStrictEqual(h.map(x => x.layout), ['list', 'qa', 'classic', 'story']);
  for (let i = 0; i < 30; i++) {
    const P = writer.planDraft({ keyword: '키워드', layout: 'auto', imageStyle: 'auto' }, PROFILE, { history: h, rand: () => i / 30 });
    assert.ok(!['list', 'qa', 'classic'].includes(P.layout), P.layout);
    assert.deepStrictEqual(P.styleCandidates, ['watercolor', '3d', 'minimal', 'editorial']);
    assert.ok(!['오늘의 포스팅을 정리하면?', '한 번에 정리해 보면', '마지막으로 정리'].includes(P.variant.closingHeading));
  }
});

test('regenImage: ai는 새 장면으로 다시 생성, card는 다시 렌더', async () => {
  openai._setFetch(fakeFetch([chatResp(goodRaw()), imageResp()]));
  const R = fakeRenderer(); pipeline._setRenderer(R);
  const { dir } = await pipeline.generate({ input: INPUT, profile: PROFILE, settings: SETTINGS, apiKey: KEY, outRoot: root, rand: () => 0 });

  const f2 = fakeFetch([imageResp()]);
  openai._setFetch(f2);
  const a = await pipeline.regenImage({ dir, index: 0, prompt: '밤의 책상 위 스탠드 불빛과 펼친 노트', apiKey: KEY, settings: SETTINGS, profile: PROFILE });
  assert.strictEqual(a.file, '01_대표.png');
  assert.match(f2.calls[0].body.prompt, /스탠드 불빛/);
  assert.match(f2.calls[0].body.prompt, /chibi/);
  const d = pipeline.readDraft(dir);
  assert.strictEqual(d.images[0].scene, '밤의 책상 위 스탠드 불빛과 펼친 노트');
  assert.ok(d.images[0].regeneratedAt);

  const c = await pipeline.regenImage({ dir, index: 2, apiKey: KEY, settings: SETTINGS, profile: PROFILE });
  assert.strictEqual(c.file, '03_비교.png');
  assert.deepStrictEqual(R.calls.at(-1).cards, [{ template: 'compare', data: d.images[2].data, file: '03_비교.png' }]);
  assert.strictEqual(R.calls.at(-1).opts.deco, 'auto');
  await assert.rejects(pipeline.regenImage({ dir, index: 9, apiKey: KEY, settings: SETTINGS, profile: PROFILE }), /사진이 원고에 없습니다/);
});

test('saveTxt: 올바르면 저장, 형식 오류·사진 없음이면 거부하고 기존 파일 유지', async () => {
  const dir = path.join(root, 'd'); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'a.png'), PNG);
  const ok = `제목: 시험 제목\n카테고리: MBTI 연애\n태그: 가, 나\n사진폴더: ${dir}\n\n> 인용구\n[사진] a.png\n본문 줄\n[링크]\n[해시태그]\n`;
  const r = pipeline.saveTxt(dir, ok);
  assert.strictEqual(r.images, 1);
  assert.throws(() => pipeline.saveTxt(dir, '카테고리: x\n\n본문'), /원고 형식 오류: 머리말에 "제목:"/);
  assert.throws(() => pipeline.saveTxt(dir, ok.replace('a.png', 'b.png')), /사진 파일 없음/);
  assert.strictEqual(fs.readFileSync(path.join(dir, '원고.txt'), 'utf8'), ok);
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['a.png', '원고.txt']);
});
