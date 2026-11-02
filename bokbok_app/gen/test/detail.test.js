// 원고 세부 옵션(글자 수·말투·키워드 반복·강조·제목·Q&A·보조 키워드) 시험 — OpenAI 호출 없음
const test = require('node:test');
const assert = require('node:assert');
const w = require('../writer');
const F = require('./fixtures');

const plan = extra => w.planDraft({ ...F.INPUT, ...extra }, F.PROFILE, { history: [] });

test('planDraft: 세부 옵션 기본값과 범위 보정', () => {
  const P = plan({});
  assert.strictEqual(P.charTarget, null);
  assert.strictEqual(P.tone, 'profile');
  assert.strictEqual(P.kwRepeat, 'mid');
  const Q = plan({ charTarget: 99999, tone: 'yo', kwRepeat: 'high', emphasis: 'low', qaCount: '0', subKeywords: 'INTP 남자, INTP 연애, , INTP 이별' });
  assert.strictEqual(Q.charTarget, w.CHAR_MAX);
  assert.strictEqual(Q.qaCount, 0);
  assert.deepStrictEqual(Q.subKeywords, ['INTP 남자', 'INTP 이별']);   // 주 키워드와 같은 것은 뺀다
  assert.strictEqual(plan({ titleMode: 'fixed', fixedTitle: '' }).titleMode, 'auto');
});

test('buildMessages: 글자 수·말투·Q&A·보조 키워드·제목 지시가 프롬프트에 들어간다', () => {
  const P = plan({ charTarget: 2000, tone: 'hapnida', qaCount: '0', subKeywords: 'INTP 남자', titleMode: 'question', kwRepeat: 'low' });
  const { system, user } = w.buildMessages(null, F.PROFILE, P);
  assert.match(user, /약 2000자/);
  assert.match(system, /~합니다/);
  assert.match(system, /Q&A를 쓰지 않는다/);
  assert.match(system, /보조 키워드: "INTP 남자"/);
  assert.match(system, /질문 한 문장/);
  assert.match(system, /그대로 2~3번/);
});

test('measureDraft: 공백 제외/포함 글자·키워드 횟수', () => {
  const d = { keyword: '연애', blocks: [{ quote: '연애 이야기' }, { text: ['## 1. 연애 시작', '**연애**는 어렵다', '', '[[쉽다|#bdfbfa]] 아니다'] }] };
  const m = w.measureDraft(d);
  assert.strictEqual(m.chars, '연애이야기'.length + '1.연애시작'.length + '연애는어렵다'.length + '쉽다아니다'.length);
  assert.strictEqual(m.keywordCount, 2);   // 첫 인용구 제외
  assert.strictEqual(m.subtitles, 1);
  assert.strictEqual(m.bolds, 1);
  assert.strictEqual(m.highlights, 1);
});

test('softProblems: 글자 수 목표 밖·보조 키워드 누락을 잡는다', () => {
  const P = plan({ charTarget: 3000, subKeywords: '없는말' });
  const d = w.normalizeDraft(F.goodRaw(), P, { input: F.INPUT, profile: F.PROFILE });
  const soft = w.softProblems(d);
  assert.ok(soft.some(x => /목표 3000자보다 적음/.test(x)), soft.join('\n'));
  assert.ok(soft.some(x => /보조 키워드 "없는말"/.test(x)));
});

test('직접 입력 제목: 그대로 쓰고 키워드 위치 검사는 건너뛴다', () => {
  const P = plan({ titleMode: 'fixed', fixedTitle: '내가 정한 제목입니다' });
  const d = w.normalizeDraft(F.goodRaw(), P, { input: F.INPUT, profile: F.PROFILE });
  assert.strictEqual(d.title, '내가 정한 제목입니다');
  assert.ok(!w.validateDraft(d, { profile: F.PROFILE }).some(x => /제목에 키워드/.test(x)));
  assert.ok(w.softProblems(d).some(x => x.startsWith('(참고)')));
});

test('Q&A 안 씀인데 Q&A가 있으면 문제', () => {
  const P = plan({ qaCount: '0' });
  const d = w.normalizeDraft(F.goodRaw(), P, { input: F.INPUT, profile: F.PROFILE });
  assert.ok(w.validateDraft(d, { profile: F.PROFILE }).some(x => /Q&A 안 씀/.test(x)));
});

test('write: 글자 수만 빗나가면 1회 수정 요청, 수정본이 깨지면 첫 원고를 살린다', async () => {
  const f = F.fakeFetch([F.chatResp(F.goodRaw()), F.chatResp({ title: '', blocks: [], images: [] })]);
  require('../openai')._setFetch(f);
  const logs = [];
  const d = await w.write({ apiKey: 'sk-test', input: { ...F.INPUT, charTarget: 1000 }, profile: F.PROFILE, log: l => logs.push(l) });
  assert.strictEqual(f.calls.length, 2);
  assert.ok(d.title);
  assert.ok(d.stats && d.stats.chars > 0);
  assert.ok(d.warnings.some(x => /글자 수/.test(x)));
  assert.ok(logs.some(l => /첫 원고를 씁니다/.test(l)));
});
