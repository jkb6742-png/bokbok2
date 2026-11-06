// 반복 문체 검사 (AI 판별이 아니라 같은 버릇이 되풀이되는지 보는 검사)
const N = require('./normalize');
const T = require('./thresholds');

const r2 = x => Math.round(x * 1000) / 1000;

// 소주제(H)·구분선(D) 기준으로 본문 줄을 묶는다
function sections(S) {
  const out = []; let cur = [];
  const close = () => { if (cur.length) out.push(cur); cur = []; };
  for (const b of S.blocks) {
    if (b.text) {
      for (const l of b.text) {
        if (/^\s*##\s/.test(l)) { close(); continue; }
        const t = N.stripMarkup(l);
        if (t && !N.isMandatory(t)) cur.push(t);
      }
    } else if (b.quote !== undefined || b.line) close();
  }
  close();
  return out;
}

const APHORISM_RE = /(아니라|결국|정답|출발선|본질|의지|가깝다|뿐이다|법이다|것이다|시작이다|과정이다|이유다|답이다|이다\.?$)/;
function isAphorism(sent) {
  const s = sent.replace(/[\s♡♥☆★\p{Extended_Pictographic}️]+$/u, '');
  return s.length <= 60 && /다[.!]?$/.test(s) && APHORISM_RE.test(s);
}
function isContrast(sent) {
  const s = sent.replace(/[\s♡♥☆★\p{Extended_Pictographic}️]+$/u, '').replace(/["”'’]/g, '');
  return (/아니라/.test(s) && /(다|거다|거니까)[.!]?$/.test(s)) || /에\s?가깝다[.!]?$/.test(s) || /에\s?가깝다는/.test(s);
}

function normTag(t) {
  return String(t).normalize('NFKC').replace(/^#/, '').replace(/\s+/g, '').replace(N.NICK_RE, m => N.NICK[m]).toUpperCase();
}

// 한 어간의 변형 태그 묶음 (INTP·인팁·INTP궁합·인팁엔프피 → 어간 INTP 4개)
function tagVariants(tags) {
  const norm = tags.map(normTag);
  const stems = new Set();
  for (const n of norm) {
    (n.match(N.MBTI_RE) || []).forEach(m => stems.add(m));
    if (n.length >= T.tagStemMinLen) stems.add(n);
  }
  const groups = [];
  for (const s of stems) {
    const v = tags.filter((t, i) => norm[i].includes(s));
    if (v.length > 1) groups.push({ stem: s, variants: v, count: v.length });
  }
  groups.sort((a, b) => b.count - a.count);
  // 다른 묶음에 완전히 포함되는 작은 묶음은 뺀다
  return groups.filter((g, i) => !groups.slice(0, i).some(h => h.count >= g.count && g.variants.every(v => h.variants.includes(v))));
}

function mainKeyword(S, opts) {
  if (opts.mainKeyword) return opts.mainKeyword;
  const head = N.stripMarkup(S.title).split('|')[0].trim();
  if (S.title.includes('|') && head.length <= 15) return head;
  return (S.tags && S.tags[0]) || head;
}

function check(S, fp, opts = {}) {
  const ST = T.style, findings = [];
  const add = (code, value, threshold, message, extra) => findings.push({ code, level: 'WARN', value, threshold, message, ...(extra || {}) });
  const secs = sections(S);
  const ends = secs.map(lines => lines[lines.length - 1]);
  const lastSent = ends.map(l => { const ss = N.splitSentences(l); return ss[ss.length - 1] || l; });

  // 1) 소주제 끝 격언형 문장
  const aph = lastSent.filter(isAphorism);
  if (aph.length >= ST.aphorismMinCount && aph.length / Math.max(1, secs.length) >= ST.aphorismSectionRatio)
    add('STYLE_APHORISM_END', `${aph.length}/${secs.length}`, `${ST.aphorismSectionRatio * 100}%`, `소주제 끝을 격언형 문장으로 맺는 버릇이 반복됨 (${aph.length}곳)`, { samples: aph.slice(0, 3) });

  // 2) 소주제 끝 이모지 규칙성
  const emo = ends.filter(l => N.EMOJI_RE.test(l)).length;
  fp.counts.emojiSectionEnds = emo;
  if (emo >= ST.emojiEndMinCount && emo / Math.max(1, secs.length) >= ST.emojiEndRatio)
    add('STYLE_EMOJI_END', `${emo}/${secs.length}`, `${ST.emojiEndRatio * 100}%`, `소주제 마지막 줄마다 이모지를 붙이는 패턴이 규칙적임 (${emo}곳)`);

  // 3) 비유 어휘 반복 (블로그별 누적 목록)
  const hits = Object.values(fp.metaphors).reduce((a, b) => a + b, 0);
  const recent = (opts.recent || []).slice(0, T.phraseRecent);
  const repeated = Object.keys(fp.metaphors).filter(w => recent.filter(e => e.metaphors && e.metaphors[w]).length >= ST.metaphorRepeatPosts);
  if (hits >= ST.metaphorMinHits || repeated.length)
    add('STYLE_METAPHOR_REPEAT', hits, ST.metaphorMinHits, `같은 비유 어휘 반복: ${Object.entries(fp.metaphors).map(([w, c]) => `${w}×${c}`).join(', ')}${repeated.length ? ` (최근 글에도 반복: ${repeated.join(', ')})` : ''}`);

  // 4) 대비 결론 "A가 아니라 B다 / ~에 가깝다"
  const allSent = secs.flat().flatMap(N.splitSentences);
  const con = allSent.filter(isContrast);
  if (con.length >= ST.contrastMax)
    add('STYLE_CONTRAST_CONCLUSION', con.length, ST.contrastMax, `"~가 아니라 ~다 / ~에 가깝다" 대비 결론이 ${con.length}번 나옴`, { samples: con.slice(0, 4) });

  // 5) 한 줄 한 문장 비율
  const lines = N.bodyLines(S).filter(l => l.kind === 'text');
  const one = lines.filter(l => N.splitSentences(l.text).length === 1).length;
  const ratio = lines.length ? one / lines.length : 0;
  if (lines.length >= ST.oneSentenceMinLines && ratio >= ST.oneSentenceLineRatio)
    add('STYLE_ONE_SENTENCE_LINE', r2(ratio), ST.oneSentenceLineRatio, `거의 모든 줄이 한 문장으로 끊김 (${Math.round(ratio * 100)}%)`);

  // 6) 주 키워드 밀도
  const kw = mainKeyword(S, opts);
  const body = N.bodyText(S).replace(/\s+/g, '');
  const k = String(kw).toLowerCase().replace(/\s+/g, '');
  const cnt = k ? body.split(k).length - 1 : 0;
  const dens = body.length ? (cnt * k.length) / body.length : 0;
  if (dens > ST.keywordDensityMax || cnt > ST.keywordCountMax)
    add('STYLE_KEYWORD_DENSITY', r2(dens), ST.keywordDensityMax, `주 키워드 "${kw}"가 ${cnt}번 반복됨 (본문 글자의 ${(dens * 100).toFixed(1)}%)`);

  return { findings, metrics: { sections: secs.length, aphorismEnds: aph.length, emojiEnds: emo, metaphorHits: hits, contrast: con.length, oneSentenceLineRatio: r2(ratio), mainKeyword: kw, keywordCount: cnt, keywordDensity: r2(dens) } };
}

module.exports = { check, tagVariants, sections, isAphorism, isContrast, mainKeyword };
