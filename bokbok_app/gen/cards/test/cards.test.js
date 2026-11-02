// node --test gen/cards/test/cards.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { renderCards, validateCard, makePalette, contrast, parseHex } = require('../render.js');

const os = require('os');
const OUT = process.env.CARDS_OUT || path.join(os.tmpdir(), 'bokbok-cards-test');   // PC마다 다른 임시 폴더

const SAMPLE = {
  points: {
    title: '겨울철 실내 습도 관리 핵심 4가지',
    items: [
      { head: '적정 습도는 40~60%', body: '너무 낮으면 목이 쉽게 건조해지고, 너무 높으면 결로와 곰팡이가 생기기 쉽습니다.' },
      { head: '가습기는 매일 물 교체', body: '받아 둔 물을 그대로 두면 물때가 생기므로 하루에 한 번 비우고 말려 줍니다.' },
      { head: '환기는 짧고 자주', body: '하루 두세 번, 10분 정도 창을 열면 실내 공기가 바뀌면서 습도도 안정됩니다.' },
      { head: '빨래 건조도 도움', body: '젖은 수건이나 빨래를 실내에 널어 두면 자연스럽게 습도를 올릴 수 있습니다.' },
    ],
  },
  compare: {
    title: '전기요 vs 온수매트 한눈에 비교',
    left: { label: '전기요', items: ['가격 부담이 적음', '빠르게 따뜻해짐', '세탁이 간편한 편', '건조함을 느낄 수 있음'] },
    right: { label: '온수매트', items: ['초기 비용이 높은 편', '온기가 은은하게 유지', '물 보충·관리 필요', '건조함이 덜한 편'] },
  },
  checklist: {
    title: '이사 전날 꼭 확인할 것',
    items: ['관리비·공과금 정산 날짜 확인', '냉장고 비우고 전원 미리 끄기', '귀중품·서류는 따로 챙겨 직접 옮기기', '새 집 현관 비밀번호와 열쇠 받기', '인터넷·도시가스 이전 신청 마치기'],
  },
  steps: {
    title: '원두 핸드드립 내리는 순서',
    steps: [
      { head: '원두 분쇄하기', body: '한 잔 기준 15g 정도를 굵은 설탕 크기로 갈아 줍니다.' },
      { head: '뜸 들이기', body: '원두가 젖을 만큼만 물을 붓고 30초 정도 기다립니다.' },
      { head: '나눠서 붓기', body: '가운데부터 작은 원을 그리며 두세 번에 나눠 천천히 붓습니다.' },
      { head: '농도 맞추기', body: '진하면 뜨거운 물을 조금 더해 입맛에 맞게 조절합니다.' },
    ],
  },
};

const LONG = {
  points: {
    title: '아주 긴 제목이 들어와도 잘리지 않고 두 줄 안에서 자연스럽게 줄바꿈되는지 확인하는 카드',
    subtitle: '부제목도 길게 들어올 수 있으니 함께 확인합니다',
    items: [
      { head: '머리글이 지나치게 길어서 한 줄에 다 들어가지 않는 경우를 시험하는 항목입니다', body: '본문은 아흔 자를 훌쩍 넘기는 긴 설명으로, GPT가 가끔 이렇게 길게 쓰는 경우가 있어서 글자 크기를 줄이고 줄을 바꿔서라도 끝까지 보여야 합니다. 잘리면 안 되고 카드 높이가 늘어나야 하며 마지막 글자까지 그대로 나와야 합니다. 끝.' },
      { head: 'Supercalifragilisticexpialidocious_Long_English_Token_Without_Spaces_1234567890', body: 'https://example.com/very/long/url/that/has/no/spaces/at/all/and/should/still/wrap/inside/the/card/without/overflowing' },
      { head: '<script>alert(1)</script> & "따옴표" 태그 문자', body: '<b>굵게</b> 표시는 글자 그대로 나와야 합니다 &amp; 엔티티도 그대로.' },
    ],
  },
};

test('validateCard: 정상 샘플은 오류 없음', () => {
  for (const [t, d] of Object.entries(SAMPLE)) assert.deepStrictEqual(validateCard(t, d), [], t);
});

test('validateCard: 필수값·개수·길이 규칙', () => {
  assert.match(validateCard('nope', {})[0], /알 수 없는 카드 템플릿/);
  assert.match(validateCard('points', null)[0], /객체가 아닙니다/);
  assert.ok(validateCard('points', { items: SAMPLE.points.items }).some((e) => /title/.test(e)));
  assert.ok(validateCard('points', { title: 'a', items: SAMPLE.points.items.slice(0, 2) }).some((e) => /3~5개/.test(e)));
  assert.ok(validateCard('points', { title: 'a', items: [...SAMPLE.points.items, ...SAMPLE.points.items] }).some((e) => /3~5개/.test(e)));
  assert.ok(validateCard('points', { title: 'a', items: [{ head: '', body: 'x' }, { head: 'b', body: 'x' }, { head: 'c', body: 'x' }] }).some((e) => /head가 비었/.test(e)));
  assert.ok(validateCard('points', { title: 'x'.repeat(40), items: SAMPLE.points.items }).some((e) => /32자/.test(e)));
  assert.ok(validateCard('steps', { title: 'a', steps: [] }).some((e) => /비었습니다/.test(e)));
  assert.ok(validateCard('steps', { title: 'a', steps: SAMPLE.steps.steps.map((s) => ({ ...s, body: '가'.repeat(100) })) }).some((e) => /90자/.test(e)));
  assert.ok(validateCard('checklist', { title: 'a', items: ['1', '2'] }).some((e) => /3~6개/.test(e)));
  assert.ok(validateCard('checklist', { title: 'a', items: ['1', '', '3'] }).some((e) => /빈 문장/.test(e)));
  assert.ok(validateCard('checklist', { title: 'a', items: ['1', '2', '가'.repeat(61)] }).some((e) => /60자/.test(e)));
  assert.ok(validateCard('compare', { title: 'a', left: { label: 'A', items: ['1', '2'] } }).some((e) => /right/.test(e)));
  assert.ok(validateCard('compare', { title: 'a', left: { label: '', items: ['1', '2'] }, right: { label: 'B', items: ['1'] } }).some((e) => /left.label/.test(e)));
  assert.ok(validateCard('compare', { title: 'a', left: { label: 'A', items: ['1', '2'] }, right: { label: 'B', items: ['1'] } }).some((e) => /2~5개/.test(e)));
  assert.ok(validateCard('compare', { title: 'a', left: { label: '가'.repeat(15), items: ['1', '2'] }, right: { label: 'B', items: ['1', '2'] } }).some((e) => /14자/.test(e)));
});

test('makePalette: 대비 보장', () => {
  for (const c of ['#03C75A', '#3F9470', '#E0694C', '#FFD400', '#7C63B8', '#222222', 'zzz']) {
    const p = makePalette(c);
    const W = [255, 255, 255];
    assert.ok(contrast(parseHex(p.deep), parseHex(p.bg)) >= 4.5, `deep on bg ${c}`);
    assert.ok(contrast(parseHex(p.ink), W) >= 7, `ink ${c}`);
    assert.ok(contrast(parseHex(p.sub), W) >= 4.5, `sub ${c}`);
    assert.ok(contrast(parseHex(p['on-fill']), parseHex(p.fill)) >= 3, `on-fill ${c}`);
  }
});

function pngSize(file) {
  const b = fs.readFileSync(file);
  assert.strictEqual(b.toString('ascii', 1, 4), 'PNG');
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), bytes: b.length };
}

test('renderCards: 4종 × 장식 3단계 × 색 2개 + 긴 글', { timeout: 300000 }, async () => {
  const cards = [];
  for (const color of ['#03C75A', '#E0694C']) {
    const tag = color.slice(1);
    for (const deco of ['off', 'auto', 'rich']) {
      const set = Object.entries(SAMPLE).map(([t, d]) => ({ template: t, data: d, file: `${t}_${deco}_${tag}.png` }));
      cards.push({ color, deco, set });
    }
  }
  const logs = [];
  let n = 0;
  for (const { color, deco, set } of cards) {
    const res = await renderCards(set, { color, deco, outDir: OUT, footer: '복복이 블로그', log: (m) => logs.push(m) });
    assert.strictEqual(res.length, 4);
    for (const r of res) {
      const s = pngSize(r.file);
      assert.ok(s.bytes > 0);
      assert.strictEqual(s.width, 1720);
      assert.strictEqual(r.width, 1720);
      assert.strictEqual(s.height, r.height);
      n++;
    }
  }
  assert.strictEqual(n, 24);
  // 긴 글: 잘리지 않고 높이가 늘어나야 함
  const longLogs = [];
  const [long] = await renderCards([{ template: 'points', data: LONG.points, file: 'points_long_3F9470' }],
    { color: '#3F9470', deco: 'rich', outDir: OUT, footer: '복복이 블로그', log: (m) => longLogs.push(m) });
  const s = pngSize(long.file);
  assert.strictEqual(s.width, 1720);
  assert.ok(long.file.endsWith('.png'));
  assert.ok(!longLogs.some((m) => /가로 넘침/.test(m)), longLogs.join('\n'));
  assert.ok(longLogs.some((m) => /글자 축소/.test(m)), '긴 글은 글자 축소가 일어나야 함');
  assert.ok(!logs.some((m) => /가로 넘침/.test(m)), logs.join('\n'));
});

test('renderCards: 구조 오류는 브라우저 띄우기 전에 거부', async () => {
  await assert.rejects(renderCards([{ template: 'points', data: { title: '' , items: [] }, file: 'x.png' }], { outDir: OUT }), /카드 데이터 오류/);
  await assert.rejects(renderCards([{ template: 'points', data: SAMPLE.points, file: 'x.png' }], { outDir: OUT, deco: 'many' }), /off\/auto\/rich/);
});
