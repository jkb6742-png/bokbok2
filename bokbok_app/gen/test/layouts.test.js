const test = require('node:test');
const assert = require('node:assert');
const layouts = require('../layouts');
const styles = require('../styles');

const seq = vals => { let i = 0; return () => vals[i++ % vals.length]; };
const randoms = Array.from({ length: 50 }, (_, i) => (i * 0.137) % 1);

test('레이아웃 6종 + 지시문·검사 함수', () => {
  assert.deepStrictEqual(layouts.LAYOUT_IDS, ['classic', 'qa', 'list', 'story', 'compare', 'howto']);
  for (const id of layouts.LAYOUT_IDS) {
    const p = layouts.layoutPrompt(id, 4);
    assert.match(p, /\[레이아웃: /);
    assert.match(p, /"img":3/);
    assert.strictEqual(typeof layouts.LAYOUTS[id].validate, 'function');
  }
});

test('pickLayout: 최근 3개 레이아웃 피함', () => {
  const history = [{ layout: 'classic' }, { layout: 'qa' }, { layout: 'list' }, { layout: 'story' }];
  for (const r of randoms) {
    const id = layouts.pickLayout(history, { rand: () => r });
    assert.ok(['story', 'compare', 'howto'].includes(id), id);
  }
});

test('pickLayout: 카드 묶음에 필수 카드가 없는 레이아웃은 빼고 고름', () => {
  for (const r of randoms) {
    const id = layouts.pickLayout([], { rand: () => r, cardTemplates: ['points', 'checklist'] });
    assert.ok(!['compare', 'howto'].includes(id), id);
  }
});

test('allowedCards: 필수 카드 자동 추가, 잘못된 묶음은 오류', () => {
  assert.deepStrictEqual(layouts.allowedCards('compare', ['points']), ['points', 'compare']);
  assert.deepStrictEqual(layouts.allowedCards('howto', ['steps', 'points']), ['steps', 'points']);
  assert.deepStrictEqual(layouts.allowedCards('classic'), layouts.CARD_TEMPLATES);
  assert.throws(() => layouts.allowedCards('classic', ['nope']), /카드 템플릿 묶음/);
});

test('pickVariant: 최근 글과 다른 정리 제목·도입', () => {
  const history = [{ variant: { closingHeading: '오늘의 포스팅을 정리하면?', intro: layouts.COMMON_INTROS[0] } }];
  for (const r of randoms) {
    const v = layouts.pickVariant('classic', history, () => r);
    assert.notStrictEqual(v.closingHeading, '오늘의 포스팅을 정리하면?');
    assert.notStrictEqual(v.intro, layouts.COMMON_INTROS[0]);
  }
  // 무작위성: 여러 rand에서 2가지 이상 나옴
  const set = new Set(randoms.map(r => layouts.pickVariant('qa', [], () => r).closingHeading));
  assert.ok(set.size >= 3);
});

test('styles: 6종 + 최근 3개 피하기 + 금지 규칙 포함 프롬프트', () => {
  assert.deepStrictEqual(styles.STYLE_IDS, ['photo', 'character', 'flat', 'watercolor', '3d', 'minimal', 'editorial']);
  const h = [{ imageStyle: 'photo' }, { imageStyle: 'flat' }, { imageStyle: '3d' }, { imageStyle: 'minimal' }];
  assert.deepStrictEqual(styles.styleCandidates(h), ['character', 'watercolor', 'minimal', 'editorial']);
  for (const r of randoms) assert.ok(!['photo', 'flat', '3d'].includes(styles.pickStyle(h, () => r)));
  const p = styles.buildImagePrompt('한강 공원 벤치 위 커피 두 잔', 'watercolor', { color: '#3F9470' });
  assert.match(p, /한강 공원/);
  assert.match(p, /watercolor/i);
  assert.match(p, /no text/i);
  assert.match(p, /no logos/i);
  assert.match(p, /watermark/i);
  assert.match(p, /real or famous people/i);
  assert.match(p, /#3F9470/);
  assert.throws(() => styles.buildImagePrompt('  ', 'photo'), /비어/);
  void seq;
});
