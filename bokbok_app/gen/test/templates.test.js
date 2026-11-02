// 기본 글 형태 템플릿 3개 자동 구성 + 임상 글 형태 3종
const test = require('node:test');
const assert = require('node:assert');
const templates = require('../templates');
const writer = require('../writer');
const clinical = require('../clinical');
const { PROFILE, INPUT } = require('./fixtures');

writer._setCardValidator(null);

test('일반 블로그: 제목 패턴(잘 된 글 가중) 상위 3개 레이아웃, 서로 다르고 이유가 붙는다', () => {
  const titles = ['NF 유형 특징 | INFJ·INFP 차이', 'NT 유형 특징 | INTJ·INTP 차이', 'INTP 연애 어떻게 하나?', 'SJ 유형 특징 4가지', 'INTP가 생각하는 약속의 의미'];
  const winners = ['NF 유형 특징 | INFJ·INFP 차이', 'SJ 유형 특징 4가지'];
  const r = templates.suggest({ profile: { persona: '30대 INTP 블로거' }, titles, winners, avgImages: 4.2, history: [{ imageMode: 'ai' }, { imageMode: 'ai' }, { imageMode: 'cards' }] });
  assert.strictEqual(r.kind, 'general');
  assert.strictEqual(r.presets.length, 3);
  assert.strictEqual(new Set(r.presets.map(p => p.layout)).size, 3);
  assert.ok(['compare', 'list'].includes(r.presets[0].layout), '차이·N가지가 잘 된 글에 있으니 비교형/리스트형이 앞');
  assert.ok(r.presets.every(p => /^기본 \d · /.test(p.name)));
  assert.ok(r.presets.every(p => p.imageCount === 4));
  assert.deepStrictEqual(r.presets.map(p => p.imageMode), ['ai', 'cards', 'ai']);
  assert.match(r.reasons[0], /잘 된 글 2편 중/);
  assert.ok(r.presets.every(p => typeof p.note === 'string' && p.note.length > 10));
});

test('데이터가 없으면 기본 순서(기본형·질문형·리스트형)로 채운다', () => {
  const r = templates.suggest({ profile: {}, titles: [], winners: [] });
  assert.deepStrictEqual(r.presets.map(p => p.layout), ['classic', 'qa', 'list']);
  assert.strictEqual(r.presets[1].titleMode, 'question');
  assert.strictEqual(r.presets[1].qaCount, '3');
});

test('치과 블로그(프로필·제목·지난 초안으로 판별)는 임상 글 형태 3종, 질문 제목이 많으면 질문 답변형이 앞', () => {
  const r = templates.suggest({ profile: { persona: '평촌 OO치과 원장' }, titles: ['임플란트 골이식 과정'], winners: [] });
  assert.strictEqual(r.kind, 'clinical');
  assert.deepStrictEqual(r.presets.map(p => p.clinicalForm), ['stage', 'qa', 'guide']);
  assert.ok(r.presets.every(p => p.imageMode === 'clinical' && p.charTarget === 2000));
  const r2 = templates.suggest({ profile: {}, titles: ['임플란트 뼈이식 꼭 해야 하나요?', '치아교정 몇 살에 시작할까?', '사랑니 발치 아픈 이유', '충치 치료 순서'], winners: ['임플란트 뼈이식 꼭 해야 하나요?'] });
  assert.strictEqual(r2.kind, 'clinical');
  assert.strictEqual(r2.presets[0].clinicalForm, 'qa');
  assert.ok(templates.isDental({ profile: {}, titles: ['a', 'b'], history: [{ imageMode: 'clinical' }, { imageMode: 'clinical' }, { imageMode: 'ai' }] }));
  assert.ok(!templates.isDental({ profile: { persona: 'MBTI 블로거' }, titles: ['INTP 특징'], history: [] }));
});

const CIN = { ...INPUT, keyword: '임플란트 골이식', charTarget: 500, imageMode: 'clinical', photos: ['a.jpg', 'b.jpg'], imageCount: 4, cardTemplates: ['compare'], layout: 'compare',
  clinical: { field: '임플란트', caseNote: '', photoNotes: [{ stage: 'first', note: '초진' }, { stage: 'after', note: '식립 직후' }] } };

test('임상 글 형태: 조합의 clinicalForm 이 계획·프롬프트·검사에 반영된다', () => {
  const Pq = writer.planDraft({ ...CIN, clinicalForm: 'qa' }, PROFILE, { history: [] });
  assert.strictEqual(Pq.clinical.form, 'qa');
  const { system } = writer.buildMessages(null, PROFILE, Pq);
  assert.match(system, /질문 답변형/); assert.match(system, /## Q\. 질문\?/);
  const Pg = writer.planDraft({ ...CIN, clinical: { ...CIN.clinical, form: 'guide' } }, PROFILE, { history: [] });
  assert.match(writer.buildMessages(null, PROFILE, Pg).system, /이런 경우 이 치료를 생각합니다/);
  const Ps = writer.planDraft(CIN, PROFILE, { history: [] });
  assert.strictEqual(Ps.clinical.form, 'stage');
  assert.strictEqual(writer.planDraft({ ...CIN, clinicalForm: 'nope' }, PROFILE, { history: [] }).clinical.form, 'stage');

  // 검사: 질문 답변형은 "## Q." 가 사진 수 이상이어야 하고, 판단 기준형은 기준 소주제가 있어야 한다
  const base = (subs, extra = []) => ({ title: '임플란트 골이식', clinical: { form: 'qa' }, blocks: [
    { quote: '제목' }, { text: ['도입', '', subs[0], '답 … 치료 결과는 개인에 따라 다를 수 있다.'] }, { img: 0 }, { text: ['사진 설명', '', subs[1], '답'] }, { img: 1 },
    { text: ['사진 설명'] }, { line: true }, { quote: '치료 후 주의할 점' }, { text: ['## 부작용과 주의사항', '붓기'] }, { line: true }, { quote: '정리' }, { text: ['## Q. 요약?', '답', ...extra] }, { link: true }, { hashtags: true }] });
  assert.deepStrictEqual(clinical.validate(base(['## Q. 뼈가 부족하면 못 하나요?', '## Q. 얼마나 걸리나요?'])), []);
  assert.match(clinical.validate(base(['## 1. 초진', '## 2. 식립'])).join('|'), /질문 답변형: 사진 2장인데/);
  const g = base(['## 1. 뼈의 높이', '## 2. 신경관 거리']); g.clinical.form = 'guide';
  assert.match(clinical.validate(g).join('|'), /판단 기준형: "## 이런 경우/);
  g.blocks[1].text.splice(2, 0, '## 이런 경우 이 치료를 생각합니다', '기준 1', '');
  assert.deepStrictEqual(clinical.validate(g), []);
});
