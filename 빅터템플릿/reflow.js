// 원고.txt 본문을 모바일에서 읽기 쉽게 다시 흘린다. 사용: node reflow.js <원고.txt> [출력.txt]
//  - 긴 문단(한 줄 200~400자) → 문장마다 한 줄, 한 줄 45자 안쪽(쉼표에서 나눔)
//  - 문단 사이는 [빈줄] (엔진이 같은 본문 칸 안의 빈 줄로 친다)
//  - "📌 목차" 인용구 블록은 제거
//  - 인용구·구분선·[사진]·✔·→·## 줄은 그대로
const fs = require('fs');
const [src, outArg] = process.argv.slice(2);
const out = outArg || src;
const MAX = 45;

function splitSentences(s) {
  // 한국어 문장 끝(다./요./죠./까?/니다.) 뒤 공백에서 나눔. 숫자 소수점·따옴표 안은 보존
  const parts = []; let cur = '';
  const toks = s.split(/(?<=[다요죠음함됨까]\.|[?!]|\."|\.”)\s+/);
  for (const t of toks) { if (!t) continue; parts.push(t.trim()); }
  return parts.length ? parts : [s];
}
function wrapLine(s) {
  if (s.length <= MAX) return [s];
  // 45자 안쪽에서 마지막 ', ' 또는 ' ' 에서 나눈다. 형광펜·굵게 표기 안쪽에서는 안 나눔
  const lines = []; let rest = s;
  while (rest.length > MAX) {
    let cut = -1;
    const limit = Math.min(MAX, rest.length - 8);
    const c1 = rest.lastIndexOf(', ', limit); if (c1 > 12) cut = c1 + 1;
    if (cut < 0) { const c2 = rest.lastIndexOf(' ', limit); if (c2 > 12) cut = c2; }
    if (cut < 0) break;
    // 표기 안쪽이면 그 앞 공백으로
    const head = rest.slice(0, cut);
    const openB = (head.match(/\*\*/g) || []).length % 2 === 1, openM = (head.match(/\[\[/g) || []).length > (head.match(/\]\]/g) || []).length;
    if (openB || openM) { const c3 = head.lastIndexOf(' ', head.lastIndexOf(openB ? '**' : '[[') - 1); if (c3 > 12) cut = c3; else break; }
    lines.push(rest.slice(0, cut).trim()); rest = rest.slice(cut).trim();
  }
  if (rest) lines.push(rest);
  return lines;
}

const raw = fs.readFileSync(src, 'utf8').replace(/^﻿/, '').replace(/\r/g, '');
const idx = raw.indexOf('\n\n');
const head = raw.slice(0, idx), body = raw.slice(idx + 2);
const outLines = []; let inToc = false;
const srcLines = body.split('\n');
for (let i = 0; i < srcLines.length; i++) {
  const l = srcLines[i], t = l.trim();
  if (/^>\s*📌/.test(t)) { inToc = true; continue; }
  if (inToc) { if (t.startsWith('>')) continue; inToc = false; if (t === '') continue; }
  if (t === '' || t === '---' || /^---\[/.test(t) || t.startsWith('>') || /^\[(사진|링크|해시태그|빈줄)\]/.test(t) || /^## /.test(t)) { outLines.push(t); continue; }
  if (/^[✔→]/.test(t)) { outLines.push(t); continue; }
  // 일반 문단: 문장 → 줄
  const prev = outLines[outLines.length - 1];
  if (prev !== undefined && prev !== '' && !/^\[빈줄\]$/.test(prev) && !prev.startsWith('>') && !prev.startsWith('[사진]') && prev !== '---') outLines.push('[빈줄]');
  for (const s of splitSentences(t)) for (const w of wrapLine(s)) outLines.push(w);
}
// ✔ 묶음 앞에도 빈 줄
const final = [];
for (let i = 0; i < outLines.length; i++) {
  const t = outLines[i], prev = final[final.length - 1];
  if (/^[✔→]/.test(t) && prev && prev !== '' && !/^[✔→]/.test(prev) && prev !== '[빈줄]' && !prev.startsWith('>') && !prev.startsWith('[사진]')) final.push('[빈줄]');
  final.push(t);
}
// 연속 빈 줄 정리
const cleaned = final.join('\n').replace(/\n{3,}/g, '\n\n').replace(/(\[빈줄\]\n)+\n/g, '\n').replace(/\n\n\[빈줄\]/g, '\n\n');
fs.writeFileSync(out, head + '\n\n' + cleaned.replace(/\n*$/, '\n'), 'utf8');
const chars = cleaned.replace(/\[(사진|빈줄|해시태그)\][^\n]*/g, '').replace(/\[\[([^|]+)\|#[0-9a-fA-F]+\]\]/g, '$1').replace(/\*\*/g, '').replace(/^>\s?/gm, '').replace(/---/g, '').replace(/\s/g, '').length;
const longest = Math.max(...cleaned.split('\n').filter(x => !/^\[|^>/.test(x)).map(x => x.length));
console.log('reflow', out, 'chars', chars, 'longest line', longest);
