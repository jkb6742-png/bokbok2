// 사람처럼 보이는 입력 습관: 오타 내고 고치기 · 문장 끝에서 생각하며 멈추기
//   TYPO_N   원고 1편에 오타를 내고 고치는 횟수 (기본 0)
//   THINK_N  원고 1편에 문장 끝에서 1.5~4초 멈추는 횟수 (기본 0)
//   write.js가 setBudget({ chars })로 원고 전체 글자 수를 알려 주면, 횟수가 글 전체에 고르게 흩어진다.
// 글의 최종 내용은 절대 바뀌지 않는다: 잘못 친 글자는 반드시 Backspace로 지우고 원래 글자를 다시 친다.
'use strict';
const { sleep } = require('./common');

const budget = { typo: Number(process.env.TYPO_N ?? 0) || 0, think: Number(process.env.THINK_N ?? 0) || 0, chars: 1500, used: { typo: 0, think: 0 } };
function setBudget({ chars, typo, think } = {}) {
  if (Number.isFinite(chars) && chars > 0) budget.chars = chars;
  if (Number.isFinite(typo)) budget.typo = Math.max(0, typo);
  if (Number.isFinite(think)) budget.think = Math.max(0, think);
  budget.used = { typo: 0, think: 0 };
}
const stats = () => ({ typo: budget.used.typo, think: budget.used.think });

// 키보드에서 이웃한 키 (두벌식 자판 기준 자모·영문·숫자)
const ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
function neighborLatin(ch) {
  const low = ch.toLowerCase();
  for (const r of ROWS) {
    const i = r.indexOf(low);
    if (i < 0) continue;
    const cands = [r[i - 1], r[i + 1]].filter(Boolean);
    const pick = cands[Math.floor(Math.random() * cands.length)];
    return ch === low ? pick : pick.toUpperCase();
  }
  return null;
}
// 한글: 받침을 빠뜨리거나 잘못 넣고, 모음을 옆 모음으로 잘못 친 꼴
function wrongHangul(ch) {
  const c = ch.charCodeAt(0) - 0xac00;
  if (c < 0 || c > 11171) return null;
  const cho = Math.floor(c / 588), jung = Math.floor((c % 588) / 28), jong = c % 28;
  const kinds = [];
  if (jong) kinds.push(() => cho * 588 + jung * 28);                                  // 받침 빠뜨림
  else kinds.push(() => cho * 588 + jung * 28 + [1, 4, 8, 16, 17, 19, 21][Math.floor(Math.random() * 7)]); // 받침 잘못 붙음
  kinds.push(() => cho * 588 + ((jung + (Math.random() < 0.5 ? 1 : 20)) % 21) * 28 + jong); // 모음 옆 키
  kinds.push(() => ((cho + 1) % 19) * 588 + jung * 28 + jong);                      // 자음 옆 키
  const v = kinds[Math.floor(Math.random() * kinds.length)]();
  const out = String.fromCharCode(0xac00 + v);
  return out === ch ? null : out;
}
function wrongChar(ch) {
  if (/[가-힣]/.test(ch)) return wrongHangul(ch);
  if (/[a-zA-Z0-9]/.test(ch)) return neighborLatin(ch);
  return null;
}

const rnd = (a, b) => a + Math.random() * (b - a);
// 오타 한 번: 잘못 친 글자(때로는 다음 글자까지) → 알아채는 시간 → 지우기 → 다시 치기
//   type(ch) 글자 입력, press(key) 키 누름, delay(ch) 글자 하나 치는 데 걸리는 시간
//   돌려주는 값: 이 동작이 소비한 다음 글자 수(0 또는 1)
async function typo(ch, next, { type, press, delay }) {
  const w = wrongChar(ch);
  if (!w) return 0;
  const kind = Math.random();
  let consumed = 0;
  if (kind < 0.55) {                       // 바로 알아채고 고침
    await type(w); await sleep(delay(w) + rnd(250, 700));
    await press('Backspace'); await sleep(rnd(120, 350));
    await type(ch); await sleep(delay(ch));
  } else if (kind < 0.85 && next && /[가-힣a-zA-Z0-9 ]/.test(next)) {   // 한 글자 더 치고 알아챔
    await type(w); await sleep(delay(w));
    await type(next); await sleep(delay(next) + rnd(300, 800));
    await press('Backspace'); await sleep(rnd(90, 200));
    await press('Backspace'); await sleep(rnd(150, 400));
    await type(ch); await sleep(delay(ch));
    await type(next); await sleep(delay(next));
    consumed = 1;
  } else {                                 // 같은 글자를 두 번 침
    await type(ch); await sleep(delay(ch));
    await type(ch); await sleep(delay(ch) + rnd(200, 600));
    await press('Backspace'); await sleep(rnd(150, 400));
  }
  budget.used.typo++;
  return consumed;
}

// 이번 글자에서 오타를 낼지: 남은 횟수를 남은 글자 수에 고르게
function wantTypo(ch, textLen) {
  if (budget.typo - budget.used.typo <= 0 || textLen < 6) return false;
  if (!/[가-힣a-zA-Z0-9]/.test(ch)) return false;
  return Math.random() < budget.typo / budget.chars;
}
// 문장 끝(마침표·물음표·'다/요/죠' 뒤 공백)에서 잠깐 생각하며 멈출지
function wantThink(ch, next) {
  if (budget.think - budget.used.think <= 0) return false;
  const end = /[.!?]/.test(ch) || (/[다요죠]/.test(ch) && (next === ' ' || next === undefined));
  if (!end) return false;
  const sentences = Math.max(5, budget.chars / 40);
  return Math.random() < budget.think / sentences;
}
async function think() { budget.used.think++; await sleep(rnd(1500, 4000)); }

module.exports = { setBudget, stats, wrongChar, typo, wantTypo, wantThink, think, budget };
