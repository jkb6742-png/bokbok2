// 원고 지문: 본문 원문은 남기지 않고 해시·벡터·구조만 만든다
const crypto = require('crypto');
const N = require('./normalize');
const T = require('./thresholds');

function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
const sha256 = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

// ── 구조 지문(공용 규격, LOGMETER와 공유) ── FINGERPRINT_SPEC.md 참고
// structureFromBlocks 는 의존성 없는 순수 함수: blocks = [{type:'P'|'H'|'Q'|'T'|'I'|'D'|'L'|'X', text?}]
const FINGERPRINT_VERSION = 'fp-1.0';
const ALPHABET = 'PHQTIDLX';
function structureFromBlocks(blocks) {
  let out = '';
  for (const b of blocks || []) {
    const t = String((b && b.type) || '').toUpperCase();
    if (t.length !== 1 || !ALPHABET.includes(t)) continue;   // 모르는 요소(링크·지도 등)는 버림
    if ((t === 'P' || t === 'L') && out[out.length - 1] === t) continue;   // 연속 P·연속 L 은 하나로
    out += t;
  }
  return out;
}

// 원고(.txt / layout.js 블록) → 공용 블록 목록
const LIST_RE = /^\s*(✔|✓|☑|•|·|-|\*\s|▶|▸|\d+[.)]\s)/;
function isHeadingQuote(q) {
  const t = N.stripMarkup(q);
  if (t.length > 40) return false;
  return /^(\d+[.)]|Q\s*\d*[.)]|[A-Z][.)])\s*/.test(t) || /[?？]$/.test(t) || /^\p{Extended_Pictographic}/u.test(t) || t.length <= 24;
}
function manuscriptBlocks(S) {
  const out = [];
  for (const b of S.blocks) {
    if (b.text) {
      let para = [];
      const flush = () => {
        if (!para.length) return;
        const list = para.filter(l => LIST_RE.test(l)).length;
        out.push({ type: list >= 2 && list >= para.length / 2 ? 'L' : 'P', text: para.join('\n') });
        para = [];
      };
      for (const l of b.text) {
        if (!String(l).trim()) { flush(); continue; }
        if (/^\s*##\s/.test(l)) { flush(); out.push({ type: 'H', text: l.replace(/^\s*##\s*/, '') }); continue; }
        para.push(l);
      }
      flush();
    } else if (b.quote !== undefined) out.push({ type: isHeadingQuote(b.quote) ? 'H' : 'Q', text: b.quote });
    else if (b.table) out.push({ type: 'T' });
    else if (b.img !== undefined) out.push({ type: 'I' });
    else if (b.line) out.push({ type: 'D' });
    else if (b.hashtags) out.push({ type: 'X' });
  }
  return out;
}
function structure(S) { return structureFromBlocks(manuscriptBlocks(S)); }

// 제목 패턴: 유형명·숫자는 자리표, 구분자( | , ? ! · : )는 그대로, 나머지 낱말은 유지
// (두 제목을 비교할 때 서로 공유하지 않는 낱말만 {W} 로 접는다 → similarity.titleSim)
function titlePattern(title) {
  const s = N.stripMarkup(title).replace(N.NICK_RE, ' {T}').replace(/[EI][NS][TF][JP]/gi, '{T}');
  return s.split(/(\s+|[|,?!·:~…]|\.(?=\s|$))/).map(x => x && x.trim()).filter(Boolean)
    .map(t => t.replace(/\d+(\.\d+)?/g, '{N}').toLowerCase());
}

function char3(text) {
  const s = text.replace(/\s+/g, ' ');
  const tf = {};
  for (let i = 0; i + 3 <= s.length; i++) {
    const g = s.slice(i, i + 3);
    if (g.trim().length < 2) continue;
    const k = fnv(g).toString(36);
    tf[k] = (tf[k] || 0) + 1;
  }
  return tf;
}

function shingles(text, n = T.shingleSize) {
  const tk = N.tokens(text);
  const set = new Set();
  for (let i = 0; i + n <= tk.length; i++) set.add(fnv(tk.slice(i, i + n).join(' ')));
  return [...set];
}

// 고정 문구 창: 공백 뺀 본문(유형명 자리표)에서 15자 창 해시
function phraseWindows(text, n = T.phraseMinChars) {
  const s = N.slotTypes(text.replace(/\s+/g, ''));
  const set = new Set();
  for (let i = 0; i + n <= s.length; i++) set.add(fnv(s.slice(i, i + n)));
  return [...set];
}

function metaphorTerms(text, lexicon) {
  const out = {};
  for (const w of lexicon) { const c = text.split(w).length - 1; if (c) out[w] = c; }
  return out;
}

function build(S, opts = {}) {
  const lines = N.bodyLines(S);
  const text = lines.map(l => l.text).join('\n').toLowerCase();
  const struct = structure(S);
  const lexicon = [...new Set([...(T.metaphorSeed), ...(opts.metaphorLexicon || [])])];
  const sections = struct.split('').filter(c => c === 'H').length;
  return {
    fingerprintVersion: FINGERPRINT_VERSION,
    schemaVersion: T.schemaVersion,
    ruleVersion: T.ruleVersion,
    id: S.file ? require('path').resolve(S.file).toLowerCase() : null,
    title: S.title,
    titlePattern: titlePattern(S.title),
    bodySha256: sha256(text.replace(/\s+/g, ' ').trim()),
    manuscriptSha256: S.rawSha256 || null,
    chars: text.replace(/\s/g, '').length,
    tf3: char3(text),
    shingles: shingles(text),
    phrases: phraseWindows(text),
    structure: struct,
    counts: {
      tables: S.blocks.filter(b => b.table).length,
      images: S.blocks.filter(b => b.img !== undefined).length,
      sections,
      boldLines: S.blocks.reduce((a, b) => a + (b.text ? b.text.filter(l => /\*\*/.test(l)).length : 0), 0),
      emojiSectionEnds: opts.emojiSectionEnds || 0,
    },
    tags: [...(S.tags || [])],
    metaphors: metaphorTerms(text, lexicon),
    source: opts.source || 'local',
  };
}

module.exports = { FINGERPRINT_VERSION, structureFromBlocks, manuscriptBlocks, build, structure, titlePattern, char3, shingles, phraseWindows, fnv, sha256 };
