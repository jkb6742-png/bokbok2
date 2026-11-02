// 히든 이미지(고정 이미지): 규칙 문구 → 슬롯, 계획·프롬프트·다듬기·검사, 레이아웃 검사에서 제외, 파이프라인 복사
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const hidden = require('../hidden');
const writer = require('../writer');
const layouts = require('../layouts');
const pipeline = require('../pipeline');
const openai = require('../openai');
const { PROFILE, INPUT, goodRaw, fakeFetch, chatResp, PNG, tmpDir } = require('./fixtures');

writer._setCardValidator(null);
openai._setSleep(async () => {});
test.afterEach(() => { openai._setFetch(null); pipeline._setRenderer(null); });

test('ruleToSlot: 이미지 아래 문구로 자리를 정한다', () => {
  assert.strictEqual(hidden.ruleToSlot('맨처음'), 'intro');
  assert.strictEqual(hidden.ruleToSlot('원장 소개'), 'intro');
  assert.strictEqual(hidden.ruleToSlot('중간'), 'middle');
  assert.strictEqual(hidden.ruleToSlot('맨 마지막'), 'outro');
  assert.strictEqual(hidden.ruleToSlot('글 끝 안내'), 'outro');
  assert.strictEqual(hidden.ruleToSlot('지도'), 'map');
  assert.strictEqual(hidden.ruleToSlot('오시는 길'), 'map');
  assert.strictEqual(hidden.ruleToSlot(''), 'custom');
  assert.strictEqual(hidden.ruleToSlot('이벤트 배너'), 'custom');
  // 같은 슬롯 두 번이면 두 번째는 custom, 6장 초과는 버림
  const n = hidden.normalize([{ file: 'a.png', rule: '맨처음' }, { file: 'b.png', rule: '처음' }, { file: 'c.png', slot: 'map', caption: '약도' }]);
  assert.deepStrictEqual(n.map(x => x.slot), ['intro', 'custom', 'map']);
  assert.strictEqual(n[1].label, '처음');
  assert.strictEqual(hidden.normalize(Array.from({ length: 9 }, (_, i) => ({ file: `h${i}.png` }))).length, 6);
});

const HID = [{ file: 'intro.png', slot: 'intro', caption: '원장 프로필 사진', path: '' }, { file: 'outro.jpg', slot: 'outro', caption: '진료 안내', path: '' }];

test('planDraft·buildMessages: 고정 이미지 번호는 본문 사진 뒤, 프롬프트에 자리 설명이 들어간다', () => {
  const P = writer.planDraft({ ...INPUT, hidden: HID }, PROFILE, { history: [] });
  assert.strictEqual(P.imageCount, 4);
  assert.deepStrictEqual(P.hidden.map(h => [h.slot, h.index]), [['intro', 4], ['outro', 5]]);
  const { system, user } = writer.buildMessages(null, PROFILE, P);
  assert.match(system, /정확히 6장 = 본문 사진 4 \+ 고정 이미지 2/);
  assert.match(system, /4번: 원장 소개 자리 — 자리: 도입 본문이 끝난 자리/);
  assert.match(system, /5번: 글 끝 안내/);
  assert.match(system, /"kind":"hidden"/);
  assert.match(user, /고정 이미지 2장\(원장 소개 자리, 글 끝 안내\)/);
  assert.ok(!/고정 이미지/.test(writer.buildMessages(null, PROFILE, writer.planDraft(INPUT, PROFILE, { history: [] })).system));
});

// goodRaw(기본형 4장)에 intro(4)·outro(5)를 끼운다: 도입 본문→[4]→인사 본문→첫 구분선 … 마지막 본문 뒤 [5]→본문→구분선→정리
function rawWithHidden() {
  const r = goodRaw();
  const B = r.blocks;
  const l1 = B.findIndex(b => b.line);                                        // 첫 구분선
  B.splice(l1, 0, { img: 4 }, { text: ['안녕하세요, 복복이입니다.', '오늘도 INTP 이야기입니다.'] });
  const ci = B.map(b => b.quote !== undefined).lastIndexOf(true);            // 정리 인용구
  const lineBefore = ci - 1;                                                  // 그 앞 구분선
  B.splice(lineBefore, 0, { img: 5 }, { text: ['댓글로 궁금한 점을 남겨도 된다.'] });
  r.images.push({ kind: 'hidden' }, { kind: 'hidden' });
  return r;
}

test('normalizeDraft·validateDraft: 히든은 계획대로 붙고(파일·자리), 본문 사진 규칙·레이아웃 검사에서 빠진다', () => {
  const input = { ...INPUT, hidden: HID };
  const P = writer.planDraft(input, PROFILE, { history: [] });
  const d = writer.normalizeDraft(rawWithHidden(), P, { input, profile: PROFILE });
  assert.strictEqual(d.images.length, 6);
  assert.deepStrictEqual(d.images.slice(4).map(im => [im.kind, im.slot, im.file, im.source]), [['hidden', 'intro', '05_히든.png', 'intro.png'], ['hidden', 'outro', '06_히든.jpg', 'outro.jpg']]);
  assert.deepStrictEqual(d.hidden.map(h => h.slot), ['intro', 'outro']);
  assert.deepStrictEqual(writer.validateDraft(d, { profile: PROFILE }), []);
  // 레이아웃(기본형) 검사는 히든을 뺀 사진 4장 기준
  const Im = d.images.filter(im => im.kind !== 'hidden'), Bm = d.blocks.filter(b => !(b.img !== undefined && b.img >= 4));
  assert.deepStrictEqual(layouts.validateLayout('classic', { ...d, blocks: Bm, images: Im }), []);
  // 히든을 빠뜨리거나 두 번 넣으면 잡는다
  const miss = writer.normalizeDraft(rawWithHidden(), P, { input, profile: PROFILE });
  miss.blocks = miss.blocks.filter(b => b.img !== 5);
  assert.match(writer.validateDraft(miss, { profile: PROFILE }).join('|'), /고정 이미지 5번.*지금 0번/);
  const dup = writer.normalizeDraft(rawWithHidden(), P, { input, profile: PROFILE });
  const at = dup.blocks.findIndex(b => b.img === 4); dup.blocks.splice(at + 2, 0, { img: 4 }, { text: ['다시'] });
  assert.match(writer.validateDraft(dup, { profile: PROFILE }).join('|'), /고정 이미지 4번.*지금 2번/);
  // 모델이 images에 hidden을 안 적어도 붙는다
  const raw2 = rawWithHidden(); raw2.images = raw2.images.slice(0, 4);
  assert.strictEqual(writer.normalizeDraft(raw2, P, { input, profile: PROFILE }).images.length, 6);
  // 히든 없는 입력이면 예전과 같다
  const d0 = writer.normalizeDraft(goodRaw(), writer.planDraft(INPUT, PROFILE, { history: [] }), { input: INPUT, profile: PROFILE });
  assert.strictEqual(d0.images.length, 4); assert.deepStrictEqual(d0.hidden, []);
  assert.deepStrictEqual(writer.validateDraft(d0, { profile: PROFILE }), []);
});

test('임상 모드 + 히든: 임상 검사는 본문 사진만 센다', () => {
  const clinical = require('../clinical');
  const d = { title: '임플란트 골이식', clinical: { form: 'stage' }, images: [{ kind: 'ai' }, { kind: 'hidden', slot: 'intro', file: '02_히든.png' }], imageMode: 'clinical', aiIndexes: [0], input: { photos: ['a.jpg'] }, blocks: [
    { quote: '임플란트 골이식 순서' }, { text: ['도입', '', '## 1. 초진', '설명 … 치료 결과는 개인에 따라 다를 수 있다.'] }, { img: 0 }, { text: ['사진 설명'] },
    { line: true }, { quote: '원장 인사' }, { img: 1 }, { text: ['안녕하세요, 원장입니다.'] },
    { line: true }, { quote: '치료 후 주의할 점' }, { text: ['## 부작용과 주의사항', '붓기'] }, { line: true }, { quote: '정리' }, { text: ['## Q. 요약?', '답'] }, { link: true }, { hashtags: true }] };
  assert.deepStrictEqual(clinical.validate({ ...d, blocks: d.blocks.filter(b => b.img !== 1), images: d.images.slice(0, 1) }), []);
  const p = writer.validateDraft({ ...d, keyword: '임플란트 골이식', tags: ['a', 'b', 'c', 'd', 'e'], deco: 'off', charTarget: 100 }, { profile: {} });
  assert.ok(!p.some(x => /임상 사진은 1~8장|images는|사진 블록은/.test(x)), p.join('|'));
});

test('pipeline: 히든 파일을 원고 폴더로 복사하고 원고.txt에 [사진]으로 넣는다', async () => {
  const src = tmpDir('hid'), out = tmpDir('hidout');
  const files = ['intro.png', 'outro.jpg'].map(n => { const f = path.join(src, n); fs.writeFileSync(f, Buffer.concat([PNG, Buffer.alloc(200)])); return f; });
  const input = { ...INPUT, imageMode: 'cards', hidden: HID.map((h, i) => ({ ...h, path: files[i] })) };
  const raw = rawWithHidden(); raw.images = raw.images.map((im, i) => i === 0 ? { kind: 'card', template: 'checklist', alt: 'c', data: { title: '체크', items: ['하나', '둘', '셋'] } } : im);
  openai._setFetch(fakeFetch([chatResp(raw)]));
  pipeline._setRenderer(async (jobs, opts) => jobs.map(j => { fs.writeFileSync(path.join(opts.outDir, j.file), Buffer.concat([PNG, Buffer.alloc(200)])); return { width: 10, height: 10 }; }));
  const r = await pipeline.generate({ input, profile: PROFILE, settings: { model: 'gpt-5' }, apiKey: 'sk-test', outRoot: out, log: () => {}, step: () => {} });
  const hid = r.draft.images.filter(im => im.kind === 'hidden');
  assert.strictEqual(hid.length, 2);
  assert.ok(hid.every(im => fs.existsSync(path.join(r.dir, im.file)) && !im.src));
  assert.match(r.txt, /\[사진\] 05_히든\.png/); assert.match(r.txt, /\[사진\] 06_히든\.jpg/);
  // 파일이 없으면 분명한 오류
  const bad = { ...input, hidden: [{ ...HID[0], path: path.join(src, 'none.png') }] };
  openai._setFetch(fakeFetch([chatResp((() => { const x = rawWithHidden(); x.images = x.images.slice(0, 5).map((im, i) => i === 0 ? { kind: 'card', template: 'checklist', alt: 'c', data: { title: '체크', items: ['하나', '둘', '셋'] } } : im); x.blocks = x.blocks.filter(b => b.img !== 5); return x; })())]));
  await assert.rejects(() => pipeline.generate({ input: bad, profile: PROFILE, settings: { model: 'gpt-5' }, apiKey: 'sk-test', outRoot: out, log: () => {}, step: () => {} }), /고정 이미지 파일을 찾을 수 없습니다/);
});
