const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const writer = require('../writer');
const layouts = require('../layouts');
const openai = require('../openai');
const manuscript = require('../../../naver_post/manuscript');
const { PROFILE, INPUT, goodRaw, fakeFetch, chatResp, PNG, tmpDir } = require('./fixtures');

writer._setCardValidator(null); // 내장 검사만(작업자 L 모듈과 무관하게)
openai._setSleep(async () => {});
test.after(() => openai._setFetch(null));

const plan = (input = INPUT, opts = {}) => writer.planDraft(input, PROFILE, { rand: () => 0, ...opts });
const draftOf = (raw = goodRaw(), input = INPUT) => writer.normalizeDraft(raw, plan(input), { input, profile: PROFILE, model: 'gpt-5' });
const clone = o => JSON.parse(JSON.stringify(o));

test('좋은 원고는 문제 0건', () => {
  assert.deepStrictEqual(writer.validateDraft(draftOf(), { profile: PROFILE }), []);
});

test('normalize: 파일 이름·스타일 프롬프트·기록 필드', () => {
  const d = draftOf();
  assert.deepStrictEqual(d.images.map(i => i.file), ['01_대표.png', '02_핵심정리.png', '03_비교.png', '04_체크리스트.png']);
  assert.match(d.images[0].prompt, /Scene: 카페 창가/);
  assert.match(d.images[0].prompt, /chibi/);       // character 스타일
  assert.match(d.images[0].prompt, /no text/i);
  for (const k of ['layout', 'imageStyle', 'deco', 'variant', 'input', 'createdAt', 'model', 'cardTemplates', 'preset'])
    assert.ok(k in d, k);
  assert.strictEqual(d.layout, 'classic');
  assert.strictEqual(d.imageStyle, 'character');
});

test('buildMessages: 핵심 규칙이 프롬프트에 들어감', () => {
  const P = plan({ ...INPUT, notes: '연애 초반 이야기 위주', deco: 'off' });
  const { system, user } = writer.buildMessages(INPUT, PROFILE, P);
  for (const s of ['INTP 30대 직장인', '15~28자', '#bdfbfa', '#c8f5c8', '[레이아웃: 기본형]', 'Q&A 2~3개', '5~10개', '지어낸 통계', '보장', '결론적으로', '"MBTI 연애"', 'JSON', '장식 기호를 쓰지 않는다', P.variant.closingHeading, '유형을 깎아내리지 않는다'])
    assert.ok(system.includes(s), s);
  assert.match(user, /키워드: INTP 연애/);
  assert.match(user, /연애 초반 이야기 위주/);
  // 지정 없이도 동작
  assert.match(writer.buildMessages({ keyword: '테스트' }, {}).system, /JSON/);
});

test('긴 줄 자동 줄나눔(굵게 유지) + 너무 긴 줄은 문제', () => {
  const lines = writer.wrapLine('나는 좋아하는 사람이 생기면 **그 사람의 말버릇부터 하나하나** 기억해 두는 편이다');
  assert.ok(lines.length >= 2);
  for (const l of lines) assert.ok([...l.replace(/\*\*/g, '')].length <= 30, l);
  assert.strictEqual(lines.join(' ').replace(/\*\*/g, '').replace(/\s+/g, ' '), '나는 좋아하는 사람이 생기면 그 사람의 말버릇부터 하나하나 기억해 두는 편이다');
  for (const l of lines) assert.strictEqual((l.match(/\*\*/g) || []).length % 2, 0, l);
  // 띄어쓰기 없는 긴 줄은 못 나눔 → 문제
  const raw = goodRaw(); raw.blocks[1].text.push('가나다라마바사아자차카타파하가나다라마바사아자차카타파하가나다라마바사');
  assert.ok(writer.validateDraft(draftOf(raw)).some(p => p.includes('한 줄이 너무 김')));
});

test('검사: 팔레트 밖 색·이모지·금지 표현·퍼센트·태그·장식', () => {
  const raw = goodRaw();
  raw.blocks[1].text.push('', '[[ENFP|#00a84b]] 친구가 웃었다 😀', '연구에 따르면 87%가 그렇다');
  raw.tags = ['INTP', 'INTP'];
  const p = writer.validateDraft(draftOf(raw)).join('\n');
  assert.match(p, /#00a84b는 팔레트에 없음/);
  assert.match(p, /이모지: 😀/);
  assert.match(p, /금지 표현 "연구에 따르면"/);
  assert.match(p, /수치\(%\)/);
  assert.match(p, /태그는 5~10개/);
  // 장식 off 인데 ✔ 사용
  const off = writer.validateDraft(draftOf(goodRaw(), { ...INPUT, deco: 'off' })).join('\n');
  assert.match(off, /장식 안 씀 설정인데 기호 사용/);
  // ★ 같은 특수기호
  const r2 = goodRaw(); r2.blocks[1].text.push('', '★ 별표는 안 된다');
  assert.match(writer.validateDraft(draftOf(r2)).join('\n'), /쓰면 안 되는 기호/);
});

test('검사: 블록 순서 규칙(구분선→인용구, 사진→본문, 끝 링크·해시태그)', () => {
  const raw = goodRaw();
  raw.blocks.splice(3, 1); // 구분선 뒤 인용구 삭제 → 구분선 다음 사진
  const p = writer.validateDraft(draftOf(raw)).join('\n');
  assert.match(p, /구분선 다음은 인용구/);
  // 링크·해시태그 빠지면 자동 보정
  const r2 = goodRaw(); r2.blocks = r2.blocks.slice(0, -2);
  const d2 = draftOf(r2);
  assert.ok(d2.blocks.at(-2).link && d2.blocks.at(-1).hashtags);
  // 이어진 본문 블록은 합침
  const r3 = goodRaw(); r3.blocks.splice(2, 0, { text: ['덧붙인 줄이다'] });
  const d3 = draftOf(r3);
  assert.ok(!d3.blocks.some((b, i) => b.text && d3.blocks[i - 1] && d3.blocks[i - 1].text));
});

test('검사: cardTemplates 묶음 밖 카드는 문제, 레이아웃 필수 카드는 자동 허용', () => {
  const input = { ...INPUT, cardTemplates: ['points', 'checklist'] };
  const p = writer.validateDraft(draftOf(goodRaw(), input)).join('\n');
  assert.match(p, /카드 템플릿 "compare"은 쓸 수 없음/);
  const P = plan({ ...INPUT, layout: 'compare', cardTemplates: ['points'] });
  assert.deepStrictEqual(P.cardTemplates, ['points', 'compare']);
  assert.throws(() => plan({ ...INPUT, cardTemplates: ['wrong'] }), /알 수 없는 카드 템플릿/);
  assert.throws(() => plan({ ...INPUT, layout: 'howto', imageCount: 2, aiCount: 2 }), /steps 카드가 1장 이상/);
  // auto + 묶음 → 필수 카드가 묶음에 있는 레이아웃만
  for (let i = 0; i < 20; i++) {
    const L = writer.planDraft({ keyword: 'x', cardTemplates: ['points'] }, {}, { rand: () => i / 20 }).layout;
    assert.ok(!['compare', 'howto'].includes(L));
  }
});

test('검사: 카드 data 필수값·개수', () => {
  const raw = goodRaw();
  raw.images[1].data.items = [{ head: '하나', body: '' }];
  raw.images[2].data.left = { label: 'A' };
  const p = writer.validateDraft(draftOf(raw)).join('\n');
  assert.match(p, /points 카드: items는 3~5개/);
  assert.match(p, /compare 카드: left.items는 2~5개/);
});

test('aiCount 2 → 0번과 가운데가 ai', () => {
  const P = plan({ ...INPUT, aiCount: 2, imageCount: 5 });
  assert.deepStrictEqual(P.aiIndexes, [0, 2]);
  const raw = goodRaw(); // 2번이 card라서 문제
  const d = writer.normalizeDraft(raw, plan({ ...INPUT, aiCount: 2 }), { input: { ...INPUT, aiCount: 2 }, profile: PROFILE });
  assert.match(writer.validateDraft(d).join('\n'), /images\[2\]는 ai 이미지여야 함/);
});

test('레이아웃 검사: 각 레이아웃 규칙', () => {
  const d = draftOf();
  const has = (id, re) => assert.ok(layouts.validateLayout(id, d).some(x => re.test(x)), id);
  has('qa', /인용구는 제목·정리 2개만/);
  has('list', /번호 소주제가 5개 이상/);
  has('story', /본문 중간 인용구는 1~2개/);
  has('compare', /vs\/차이\/비교/);
  has('howto', /steps 카드/);
  assert.deepStrictEqual(layouts.validateLayout('classic', d), []);

  // 질문형 정상 예
  const qa = {
    title: 't', images: [{ kind: 'ai' }, { kind: 'card', template: 'points' }],
    blocks: [{ quote: 'q' }, { text: ['도입'] }, { img: 0 }, { text: ['## Q. 하나?', '답', '## Q. 둘?', '답'] }, { img: 1 },
      { text: ['## Q. 셋?', '답', '## Q. 넷?', '답'] }, { line: true }, { quote: '정리' }, { text: ['## Q. 요약?', '답'] }, { link: true }, { hashtags: true }],
  };
  assert.deepStrictEqual(layouts.validateLayout('qa', qa), []);
  // 리스트형 정상 예
  const list = { ...qa, blocks: [{ quote: 'q' }, { text: ['도입'] }, { img: 0 }, { text: ['## 1. a', '## 2. b', '## 3. c'] }, { img: 1 }, { text: ['## 4. d', '## 5. e'] }, { line: true }, { quote: '정리' }, { text: ['## Q. x?', '답'] }, { link: true }, { hashtags: true }] };
  assert.deepStrictEqual(layouts.validateLayout('list', list), []);
  // 방법형 정상 예
  const howto = { ...qa, images: [{ kind: 'ai' }, { kind: 'card', template: 'steps' }], blocks: [{ quote: 'q' }, { text: ['도입'] }, { img: 0 }, { text: ['준비'] }, { line: true }, { quote: '해 보기' }, { text: ['## STEP 1. a', '## STEP 2. b'] }, { img: 1 }, { text: ['## STEP 3. c'] }, { line: true }, { quote: '정리' }, { text: ['## Q. x?', '답'] }, { link: true }, { hashtags: true }] };
  assert.deepStrictEqual(layouts.validateLayout('howto', howto), []);
  // 경험담형 정상 예
  const story = { ...qa, blocks: [{ quote: 'q' }, { text: ['내가 처음 그 말을 들은 건', '나는 몰랐다', '나도 그랬다'] }, { img: 0 }, { text: ['처음'] }, { line: true }, { quote: '전환점' }, { text: ['과정'] }, { img: 1 }, { text: ['깨달음'] }, { line: true }, { quote: '정리' }, { text: ['## Q. x?', '답'] }, { link: true }, { hashtags: true }] };
  assert.deepStrictEqual(layouts.validateLayout('story', story), []);
});

test('toTxt → manuscript.load() 왕복(실제 png 파일)', () => {
  const dir = tmpDir();
  try {
    const d = draftOf();
    for (const im of d.images) fs.writeFileSync(path.join(dir, im.file), PNG);
    const txt = writer.toTxt(d, dir);
    const file = path.join(dir, '원고.txt');
    fs.writeFileSync(file, txt);
    const S = manuscript.load(file);
    assert.strictEqual(S.title, d.title);
    assert.strictEqual(S.category, d.category);
    assert.deepStrictEqual(S.tags, d.tags);
    assert.deepStrictEqual(S.images, d.images.map(im => path.join(dir, im.file)));
    assert.deepStrictEqual(S.blocks, d.blocks);
    // 사진이 없으면 load 실패
    fs.rmSync(path.join(dir, d.images[3].file));
    assert.throws(() => manuscript.load(file), /사진 파일 없음/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('write: 첫 응답에 문제 → 수정 1회 → 통과', async () => {
  const bad = goodRaw({ title: '사람들이 자주 궁금해하는 연애 이야기 INTP 연애 정리' }); // 키워드가 제목 뒤쪽
  const f = fakeFetch([chatResp(bad), chatResp(goodRaw())]);
  openai._setFetch(f);
  const logs = [];
  const d = await writer.write({ apiKey: 'sk-test-abcdef123456', model: 'gpt-5', input: INPUT, profile: PROFILE, log: m => logs.push(m), rand: () => 0 });
  assert.strictEqual(d.title, goodRaw().title);
  assert.strictEqual(f.calls.length, 2);
  const msgs = f.calls[1].body.messages;
  assert.deepStrictEqual(msgs.map(m => m.role), ['system', 'user', 'assistant', 'user']);
  assert.match(msgs[3].content, /제목 앞쪽/);
  assert.ok(logs.some(l => /수정 요청 1회/.test(l)));
  assert.ok(!logs.join('\n').includes('sk-test'));
});

test('write: 수정 후에도 문제 → 한국어 오류(problems·draft 포함)', async () => {
  const bad = goodRaw({ tags: ['하나'] });
  openai._setFetch(fakeFetch([chatResp(bad), chatResp(bad)]));
  const e = await writer.write({ apiKey: 'sk-test-abcdef123456', input: INPUT, profile: PROFILE, rand: () => 0 }).catch(e => e);
  assert.match(e.message, /원고 검사를 통과하지 못했습니다/);
  assert.ok(e.problems.some(p => /태그/.test(p)));
  assert.ok(e.draft && e.draft.title);
});

test('write: imageStyle auto → 후보 안에서 모델 선택 반영, 후보 밖이면 대체', async () => {
  const history = [{ imageStyle: 'photo' }, { imageStyle: 'character' }, { imageStyle: 'flat' }];
  openai._setFetch(fakeFetch([chatResp(goodRaw({ imageStyle: 'watercolor' }))]));
  const d = await writer.write({ apiKey: 'k-123456', input: { ...INPUT, imageStyle: 'auto' }, profile: PROFILE, history, rand: () => 0 });
  assert.strictEqual(d.imageStyle, 'watercolor');
  assert.match(d.images[0].prompt, /watercolor/i);
  openai._setFetch(fakeFetch([chatResp(goodRaw({ imageStyle: 'photo' }))]));
  const d2 = await writer.write({ apiKey: 'k-123456', input: { ...INPUT, imageStyle: 'auto' }, profile: PROFILE, history, rand: () => 0 });
  assert.ok(!['photo', 'character', 'flat'].includes(d2.imageStyle), d2.imageStyle);
});

test('buildMessages: 다음 글 설계(formBrief)가 있으면 "최근 글과 다른 형태로" 절로 들어가고, 없으면 빠진다', () => {
  const brief = '최근 5편 형태 분석 → 다음 글 설계\n· 제목: 물음표로 끝나는 질문';
  const P = plan({ ...INPUT, formBrief: brief });
  const { user } = writer.buildMessages(INPUT, PROFILE, P);
  assert.match(user, /# 최근 글과 다른 형태로 쓸 것/);
  assert.ok(user.includes('· 제목: 물음표로 끝나는 질문'));
  const { user: u2 } = writer.buildMessages(INPUT, PROFILE, plan(INPUT));
  assert.doesNotMatch(u2, /최근 글과 다른 형태로/);
});
