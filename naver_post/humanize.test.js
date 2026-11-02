// node --test humanize.test.js : 오타·멈춤을 넣어도 최종 글자가 원문과 같은지
const test = require('node:test');
const assert = require('node:assert');
const H = require('./humanize');
const { human } = require('./editor');

// 가짜 키보드: sendCharacter·Backspace만 받아 최종 문자열을 만든다
function fakePage() {
  const typed = [];
  const log = { chars: 0, back: 0 };
  return {
    typed, log,
    keyboard: {
      sendCharacter: async c => { typed.push(c); log.chars++; },
      press: async k => { if (k === 'Backspace') { typed.pop(); log.back++; } },
      up: async () => { },
    },
  };
}
const TEXT = '요즘 INTP 연애 특징을 정리해 봤다. 생각보다 표현이 서툴러요. 그래도 진심은 있죠 abc 123';

test('wrongChar: 한글·영문·숫자는 다른 글자, 기호·공백은 null', () => {
  for (let i = 0; i < 200; i++) {
    const w = H.wrongChar('학'); assert.ok(w === null || (w !== '학' && /[가-힣]/.test(w)));
    const e = H.wrongChar('a'); assert.ok(e && e !== 'a' && /[a-z]/.test(e));
  }
  assert.strictEqual(H.wrongChar(' '), null);
  assert.strictEqual(H.wrongChar('.'), null);
});

test('오타 12회·멈춤 5회를 넣어도 최종 글자는 원문과 같다', async () => {
  const sleep = require('./common').sleep;
  // 실제 대기는 건너뛴다
  const timers = require('node:timers');
  const orig = global.setTimeout;
  global.setTimeout = (fn, ms) => orig(fn, 0);
  try {
    for (let round = 0; round < 20; round++) {
      H.setBudget({ chars: TEXT.length, typo: 12, think: 5 });
      const page = fakePage();
      await human(page, TEXT);
      assert.strictEqual(page.typed.join(''), TEXT);
      const s = H.stats();
      assert.ok(s.typo <= 12 && s.think <= 5);
      if (s.typo) assert.ok(page.log.back >= s.typo);
    }
  } finally { global.setTimeout = orig; }
});

test('횟수 0이면 Backspace가 한 번도 없다', async () => {
  const orig = global.setTimeout;
  global.setTimeout = (fn, ms) => orig(fn, 0);
  try {
    H.setBudget({ chars: TEXT.length, typo: 0, think: 0 });
    const page = fakePage();
    await human(page, TEXT);
    assert.strictEqual(page.typed.join(''), TEXT);
    assert.strictEqual(page.log.back, 0);
    assert.deepStrictEqual(H.stats(), { typo: 0, think: 0 });
  } finally { global.setTimeout = orig; }
});
