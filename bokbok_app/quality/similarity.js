// 지문끼리 비교: 3-gram TF-IDF 코사인 · shingle Jaccard · 구조 LCS · 제목 패턴 · 고정 문구

// 3-gram TF-IDF 코사인 (idf 는 idf.js 의 idfFor 로 계산)
const tfw = t => t;   // 원시 tf (로그 tf는 재작성 원고 쌍의 차이를 지워서 쓰지 않음)
function cosine(a, b, idf) {
  let dot = 0, na = 0, nb = 0;
  for (const k in a) { const w = tfw(a[k]) * (idf[k] ?? 0); na += w * w; if (b[k]) dot += w * tfw(b[k]) * (idf[k] ?? 0); }
  for (const k in b) { const w = tfw(b[k]) * (idf[k] ?? 0); nb += w * w; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function jaccard(a, b) {
  if (!a || !b || !a.length || !b.length) return 0;
  const A = new Set(a); let inter = 0;
  for (const x of new Set(b)) if (A.has(x)) inter++;
  return inter / (A.size + new Set(b).size - inter);
}

// 일반 LCS 길이(가중치 함수 선택)
function lcs(a, b, w = (x, y) => (x === y ? 1 : 0)) {
  const m = a.length, n = b.length;
  let prev = new Float64Array(n + 1), cur = new Float64Array(n + 1);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const s = w(a[i - 1], b[j - 1]);
      cur[j] = Math.max(prev[j], cur[j - 1], s > 0 ? prev[j - 1] + s : 0);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}
function structureLcs(a, b) {
  if (!a || !b) return 0;
  return lcs([...a], [...b]) / Math.max(a.length, b.length);
}

// 제목 패턴 유사도: 서로 공유하지 않는 낱말은 {W} 로 접고 LCS / 최대 길이
// {W}끼리 맞으면 0.5 만 인정(낱말이 전부 다르면 패턴이 같다고 보지 않기 위해)
const SEP = new Set(['|', ',', '?', '!', '·', ':', '~', '…', '.']);
function collapse(tokens, shared) {
  const out = [];
  for (const t of tokens) {
    const keep = SEP.has(t) || t.includes('{') || shared.has(t);
    const x = keep ? t : '{W}';
    if (x === '{W}' && out[out.length - 1] === '{W}') continue;
    out.push(x);
  }
  return out;
}
function titleSim(pa, pb) {
  if (!pa || !pb || !pa.length || !pb.length) return 0;
  const sb = new Set(pb), shared = new Set(pa.filter(t => sb.has(t)));
  const a = collapse(pa, shared), b = collapse(pb, shared);
  const v = lcs(a, b, (x, y) => (x !== y ? 0 : x === '{W}' ? 0.5 : 1));
  return v / Math.max(a.length, b.length);
}

// 고정 문구: 현재 원고의 15자 창 해시가 몇 편과 겹치는지
// phrasesText: 현재 원고 공백 뺀 문자열(창 위치 → 문구 복원용, 현재 원고만 사용)
function sharedPhrases(curWindows, curText, others, n) {
  const sets = others.map(o => new Set(o.phrases || []));
  const fnv = require('./fingerprint').fnv;
  const runs = [];      // {text, docs:Set}
  let run = null;
  for (let i = 0; i + n <= curText.length; i++) {
    const h = fnv(curText.slice(i, i + n));
    const docs = new Set();
    sets.forEach((s, k) => { if (s.has(h)) docs.add(k); });
    if (docs.size) {
      if (run && run.end === i - 1 + n) {   // 바로 이어지는 창
        run.end = i + n; for (const d of docs) run.docs.add(d); run.max = Math.max(run.max, docs.size);
      } else { run = { start: i, end: i + n, docs, max: docs.size }; runs.push(run); }
    } else run = null;
  }
  return runs.map(r => ({ text: curText.slice(r.start, r.end), docs: [...r.docs].map(k => others[k].id || others[k].title), count: r.max, union: r.docs.size }));
}

module.exports = { cosine, jaccard, lcs, structureLcs, titleSim, sharedPhrases };
