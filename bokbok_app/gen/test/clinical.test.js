// 임상 증례 모드: 사진 순서대로 계획·프롬프트, 의료광고 검사, 사진 복사
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const openai = require('../openai');
const pipeline = require('../pipeline');
const writer = require('../writer');
const clinical = require('../clinical');
const { PROFILE, INPUT, fakeFetch, chatResp, PNG, tmpDir } = require('./fixtures');

writer._setCardValidator(null);
openai._setSleep(async () => {});
test.afterEach(() => { openai._setFetch(null); pipeline._setRenderer(null); });

const CIN = { ...INPUT, keyword: '임플란트 골이식', length: '짧게', charTarget: 500, imageMode: 'clinical', photos: ['a.jpg', 'b.jpg', 'c.jpg'], imageCount: 4, cardTemplates: ['compare'], layout: 'compare',
  clinical: { field: '임플란트', caseNote: '40대 남성, 하악 우측 구치부 결손', photoNotes: [{ stage: 'first', note: '초진 파노라마' }, { stage: 'during', note: '골이식 후 식립' }, { stage: 'followup', note: '보철 완료' }] } };

function rawClinical() {
  const T = (...l) => ({ text: l });
  return {
    title: '임플란트 골이식 과정 | 뼈가 부족할 때 이렇게 진행합니다', category: 'MBTI 연애', imageStyle: 'photo',
    tags: ['임플란트골이식', '임플란트', '골이식', '구치부임플란트', '임플란트과정', '치과'],
    blocks: [
      { quote: '임플란트 골이식, 순서대로 보여 드립니다' },
      T('임플란트 골이식은 잇몸뼈가 부족할 때', '뼈를 먼저 보강하고 식립하는 치료다.', '40대 남성 환자분이 오른쪽 아래 어금니가', '빠진 채로 오래 지내다 내원하셨다.', '', '## 1. 초진에서 확인한 것', '파노라마로 뼈의 높이와 폭을 봤다.', '임플란트 골이식이 필요한 상태였다.', '신경관과의 거리도 함께 확인했다.', '뼈가 얇으면 바로 심기 어렵다.'),
      { img: 0 },
      T('위 사진은 초진 때 찍은 파노라마다.', '오른쪽 아래 어금니 자리가 비어 있다.', '', '## 2. 골이식과 식립', '부족한 부분에 뼈 이식재를 채웠다.', '같은 날 임플란트를 심을 수 있었다.', '잇몸을 봉합하고 회복 기간을 뒀다.', '이 과정은 사람마다 다르게 계획한다.'),
      { img: 1 },
      T('위 사진은 식립 직후 모습이다.', '이식재가 뼈 주변을 채우고 있다.', '', '## 3. 보철까지 마친 뒤', '약 세 달 뒤 뼈가 자리를 잡았다.', '그 위에 크라운을 올려 마무리했다.', '씹는 힘이 돌아왔다고 하셨다.', '치료 결과는 개인에 따라 다를 수 있다.'),
      { img: 2 },
      T('위 사진은 보철을 올린 뒤 모습이다.', '양쪽 어금니 높이가 맞춰졌다.', '임플란트 골이식 전 상태와 비교하면', '뼈의 폭이 달라진 것이 보인다.'),
      { line: true }, { quote: '치료 후 주의할 점' },
      T('## 부작용과 주의사항', '이식 부위가 며칠 붓고 멍이 들 수 있다.', '봉합 부위는 세게 헹구지 않는다.', '흡연은 뼈가 붙는 것을 방해한다.', '딱딱한 음식은 당분간 피한다.', '통증이 심해지면 바로 내원해야 한다.'),
      { line: true }, { quote: '정리하면' },
      T('## Q. 임플란트 골이식은 꼭 해야 하나요?', '뼈가 충분하면 생략하고 바로 심는다.', '', '## Q. 골이식 후 얼마나 기다리나요?', '보통 몇 달 두고 보지만 사람마다 다르다.', '', '궁금한 점은 댓글로 남겨 주셔도 된다.'),
      { link: true }, { hashtags: true },
    ],
    images: [{ kind: 'ai', prompt: '초진 파노라마', alt: '초진 파노라마' }, { kind: 'ai', prompt: '골이식 후 식립', alt: '식립 직후' }, { kind: 'ai', prompt: '보철 완료', alt: '보철 완료' }],
  };
}

test('planDraft: 임상 모드는 사진 수 = 이미지 수, 전부 사진 자리, 카드 없음, 레이아웃 기본형', () => {
  const P = writer.planDraft(CIN, PROFILE, { history: [] });
  assert.strictEqual(P.imageMode, 'clinical');
  assert.strictEqual(P.imageCount, 3); assert.deepStrictEqual(P.aiIndexes, [0, 1, 2]);
  assert.strictEqual(P.layout, 'classic');
  assert.strictEqual(P.clinical.field, '임플란트');
  assert.strictEqual(P.clinical.photoNotes[1].stage, 'during');
  assert.throws(() => writer.planDraft({ ...CIN, photos: [] }, PROFILE, { history: [] }), /임상 사진/);
  const { system, user } = writer.buildMessages(null, PROFILE, P);
  assert.match(system, /임상 증례 글/);
  assert.match(system, /0번: \[초진\] 초진 파노라마/);
  assert.match(system, /부작용과 주의사항/);
  assert.match(system, /이 글에는 card가 없다/);
  assert.match(user, /임상 사진 3장, 카드 없음/);
  assert.match(user, /진료 분야: 임플란트/);
});

test('validate: 보장·과장·환자 인용·주의사항 누락을 잡는다', () => {
  const P = writer.planDraft(CIN, PROFILE, { history: [] });
  const good = writer.normalizeDraft(rawClinical(), P, { input: CIN, profile: PROFILE });
  assert.deepStrictEqual(writer.validateDraft(good, { profile: PROFILE }), []);
  const bad = rawClinical();
  bad.blocks[1].text[0] = '임플란트 골이식은 통증 없는 완벽한 치료다.';
  bad.blocks = bad.blocks.filter(b => !(b.text && b.text[0] === '## 부작용과 주의사항'));
  bad.blocks = bad.blocks.map(b => b.text ? { text: b.text.map(l => l.replace('치료 결과는 개인에 따라 다를 수 있다.', '결과가 좋았다.')) } : b);
  const d = writer.normalizeDraft(bad, P, { input: CIN, profile: PROFILE });
  const p = writer.validateDraft(d, { profile: PROFILE }).join(' | ');
  assert.match(p, /금지 표현\(완벽\)/); assert.match(p, /통증 없음/);
  assert.match(p, /부작용과 주의사항" 소주제가 없음/);
  assert.match(p, /개인에 따라/);
  assert.deepStrictEqual(clinical.validate({ title: '', blocks: [{ text: ['환자분이 말씀하시길 좋다고'] }] }).filter(x => /환자 말/.test(x)).length, 1);
});

test('pipeline: 임상 사진을 순서대로 복사하고 kind=photo, OpenAI 이미지 호출 없음', async () => {
  const dir = tmpDir('clin'), out = tmpDir('clinout');
  const photos = ['a.jpg', 'b.jpg', 'c.jpg'].map(n => { const f = path.join(dir, n); fs.writeFileSync(f, PNG); return f; });
  const f = fakeFetch([chatResp(rawClinical())]); openai._setFetch(f);
  pipeline._setRenderer(() => async () => []);
  const r = await pipeline.generate({ input: { ...CIN, photos }, profile: PROFILE, settings: { model: 'gpt-5', imageModel: 'gpt-image-1' }, apiKey: 'sk-test', outRoot: out, log: () => {}, step: () => {} });
  assert.strictEqual(r.draft.images.length, 3);
  assert.ok(r.draft.images.every(im => im.kind === 'photo'));
  assert.deepStrictEqual(r.draft.images.map(im => im.source), ['a.jpg', 'b.jpg', 'c.jpg']);
  assert.ok(fs.existsSync(path.join(r.dir, r.draft.images[2].file)));
  assert.strictEqual(r.draft.clinical.field, '임플란트');
  assert.strictEqual(f.calls.length, 1, 'OpenAI 는 글 1번만');
});

test('원고 프롬프트(profile.prompt)가 시스템 프롬프트에 그대로 들어가고, 사진 설명도 들어간다', () => {
  const P = writer.planDraft(CIN, PROFILE, { history: [] });
  const { system } = writer.buildMessages(null, { ...PROFILE, prompt: '- 우리 치과는 평촌 OO치과.\n- 글마다 상담 문단을 넣을 것.' }, P);
  assert.match(system, /블로그 주인이 적은 원고 프롬프트/);
  assert.match(system, /평촌 OO치과/);
  assert.match(system, /2번: \[경과·완료\] 보철 완료/);
  const { system: s2 } = writer.buildMessages(null, PROFILE, P);
  assert.ok(!/원고 프롬프트/.test(s2));
});
