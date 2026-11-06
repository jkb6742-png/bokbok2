// 최근 글 형태 분석 → "다음 글은 이렇게" 설계안 (2026-11-05)
// 이유: 블로그 글이 제목 틀·도입·소제목·강조·이미지·끝맺음까지 매번 같은 형태로 나와 검색 누락이 반복됐다.
//       G2(gate.js)는 다 쓴 원고를 사후에 거르고, formplan은 쓰기 전에 "최근 N편과 다른 형태"를 정해 준다.
// 사용: node quality/formplan.js <원고 파일 또는 폴더…> [--n 5] [--json]
//       require('./formplan').plan(files, { n }) → { recent:[특징], avoid:{}, next:{}, brief:'…' }
'use strict';
const fs = require('fs'), path = require('path');
const manuscript = require(path.join(__dirname, '..', '..', 'naver_post', 'manuscript.js'));

const strip = s => String(s || '').replace(/\*\*|__|\{\{|\}\}|\[\[|\]\]|\|#[0-9a-fA-F]{6}/g, '');
const EMOJI = /\p{Extended_Pictographic}/u;
const EMOJI_G = /\p{Extended_Pictographic}/gu;
const SENT_END = /(다|요|죠|까|음|함|네|지)[.?!]?\s*$/;

// ── 한 편의 형태 특징 ──
function features(file) {
  const s = manuscript.load(file);
  const blocks = s.blocks;
  const kind = b => b.img != null ? 'img' : b.quote != null ? 'quote' : b.line ? 'line' : b.table ? 'table' : b.text ? 'text' : b.link != null ? 'link' : b.tags ? 'tags' : 'etc';
  const textLines = blocks.filter(b => b.text).flatMap(b => b.text).filter(l => l.trim());
  const plain = textLines.map(strip);
  const raw = textLines.join('\n');
  const quotes = blocks.filter(b => b.quote != null).map(b => strip(b.quote));
  const h2 = plain.filter(l => /^##\s/.test(l)), h3 = plain.filter(l => /^###\s/.test(l));
  const firstReal = blocks.find(b => kind(b) !== 'img');
  const title = s.title || '';

  // 제목 틀
  const titleForm = /\|/.test(title) ? 'bar' : /\?$/.test(title.trim()) ? 'question' : /,/.test(title) ? 'comma' : /정리$/.test(title.trim()) ? 'summary' : 'sentence';
  // 도입 형태
  const opener = !firstReal ? 'none' : firstReal.quote != null ? 'quote' : (firstReal.text && /^#{2,3}\s/.test(strip(firstReal.text[0]))) ? 'heading' : firstReal.table ? 'table' : 'text';
  const openerEmoji = !!(firstReal && EMOJI.test(firstReal.quote != null ? firstReal.quote : (firstReal.text || [''])[0]));
  // 소제목 방식
  const headings = [...quotes, ...h2.map(l => l.replace(/^##\s*/, ''))].filter(h => !/^Q[.\s]/.test(h));
  const numbering = headings.some(h => /^[①-⑳]/.test(h)) ? 'circled' : headings.some(h => /^\d+[.)]/.test(h)) ? 'number' : headings.some(h => /^Q\d*[.\s]/i.test(h)) ? 'q' : headings.some(h => /^(버그|숫자)\s?#?\d/.test(h)) ? 'label' : headings.filter(h => EMOJI.test(h.slice(0, 3))).length >= 2 ? 'emoji' : 'plain';
  const headingCarrier = quotes.length >= h2.length ? 'quote' : 'h2';
  // 이미지 위치: 소제목 바로 다음에 사진이 오는 비율
  let afterHead = 0, imgs = 0;
  blocks.forEach((b, i) => { if (b.img == null) return; imgs++; const p = blocks[i - 1]; if (p && (p.quote != null || p.line)) afterHead++; });
  // 강조·장식
  const count = re => (raw.match(re) || []).length;
  const bold = count(/\*\*[^*]+\*\*/g), under = count(/__[^_]+__/g), color = count(/\{\{[^}]+\}\}/g), hl = count(/\[\[[^\]]+\]\]/g);
  const emojis = (raw.match(EMOJI_G) || []).length + quotes.join('').replace(/[^\p{Extended_Pictographic}]/gu, '').length;
  const lineStartEmoji = plain.filter(l => EMOJI.test(l.slice(0, 2))).length;
  const bullets = plain.filter(l => /^[✅✔☑▶🔹❗✕•\-·]\s?/.test(l)).length;
  // 문장 리듬
  const body = plain.filter(l => !/^#{2,3}\s/.test(l) && !/^#s\s/.test(l));
  const oneSent = body.length ? body.filter(l => (l.match(/[.?!](\s|$)/g) || []).length <= 1).length / body.length : 0;
  const avgLine = body.length ? body.reduce((a, l) => a + l.length, 0) / body.length : 0;
  const paras = blocks.filter(b => b.text).flatMap(b => b.text.join('\n').split(/\n\s*\n|\n?\[빈줄\]\n?/)).filter(p => p.trim());
  const avgPara = paras.length ? body.length / paras.length : 0;
  // 끝맺음
  const tail = blocks.filter(b => kind(b) !== 'tags' && kind(b) !== 'link').slice(-3);
  const lastQuote = [...blocks].reverse().find(b => b.quote != null);
  const lastText = strip(([...blocks].reverse().find(b => b.text) || { text: [''] }).text.slice(-1)[0]);
  const hasQA = plain.some(l => /^##\s*Q[.\s]/.test(l));
  const ending = /한줄평|한 줄 결론|생각$|결론/.test(lastQuote ? strip(lastQuote.quote) : '') && tail.some(b => b.quote != null) ? 'verdict-quote'
    : hasQA && tail.some(b => b.text && b.text.some(l => /^##\s*Q/.test(strip(l)))) ? 'qa' : /^\*\*["“]/.test(([...blocks].reverse().find(b => b.text) || { text: [''] }).text.find(l => /^\*\*/.test(l)) || '') ? 'aphorism' : 'monologue';
  const chars = plain.join('').replace(/^#+\s|#s\s/g, '').replace(/\s/g, '').length;

  return {
    file, title, titleForm, titleLen: title.length, opener, openerEmoji, quoteStyle: s.quoteStyle, lineStyle: s.lineStyle,
    sections: headings.length, numbering, headingCarrier, dividers: blocks.filter(b => b.line).length,
    images: imgs, imgAfterHeading: imgs ? +(afterHead / imgs).toFixed(2) : 0, tables: blocks.filter(b => b.table).length,
    bold, underline: under, color, highlight: hl, sizeLines: h3.length + plain.filter(l => /^#s\s/.test(l)).length,
    emojis, lineStartEmoji, bullets, oneSentenceRatio: +oneSent.toFixed(2), avgLine: Math.round(avgLine), avgParaLines: +avgPara.toFixed(1),
    hasQA, ending, chars, tags: s.tags.length,
  };
}

// 고를 수 있는 형태 (블로그 공통). 최근 글에 많이 쓴 값은 피한다
const OPTIONS = {
  titleForm: { sentence: '평서문 한 줄(쉼표·| 없이)', question: '물음표로 끝나는 질문', comma: '키워드, 부제', bar: '키워드 | 부제', summary: '~정리' },
  opener: { text: '본문 문단으로 바로 시작(장면·질문 서술)', quote: '인용구 한 블록으로 시작', heading: '큰 글씨 소제목으로 시작', table: '짧은 문단 뒤 표로 시작' },
  numbering: { plain: '번호·이모지 없는 평서 소제목', number: '1. 2. 숫자 소제목', circled: '①② 원문자 소제목', q: 'Q. 질문형 소제목', emoji: '이모지로 시작하는 소제목', label: '라벨형(버그 #1 등)' },
  headingCarrier: { quote: '소제목을 인용구로', h2: '소제목을 굵은 19 글씨 줄로' },
  ending: { monologue: '독백·다음 행동으로 끝(명언·한줄평 블록 없음)', qa: 'Q&A로 끝', 'verdict-quote': '인용구 결론 블록(한줄평 등)으로 끝', open: '독자에게 묻는 질문 한 줄로 끝' },
  quoteStyle: null, lineStyle: null,
};
const QUOTE_STYLES = ['default', 'quotation_line', 'quotation_bubble', 'quotation_underline', 'quotation_postit', 'quotation_corner'];
const LINE_STYLES = ['default', 'line1', 'line2', 'line3', 'line4', 'line5', 'line6', 'line7'];

function tally(arr) { const m = {}; for (const v of arr) m[v] = (m[v] || 0) + 1; return m; }
function leastUsed(keys, used, recent1) {
  // 최근 N편에서 덜 쓴 순, 직전 글 값은 제외
  return keys.filter(k => k !== recent1).sort((a, b) => (used[a] || 0) - (used[b] || 0))[0] || keys[0];
}
const mean = (arr, k) => arr.length ? arr.reduce((a, f) => a + (+f[k] || 0), 0) / arr.length : 0;

function plan(files, { n = 5 } = {}) {
  const feats = files.map(f => { try { return features(f); } catch (e) { return { file: f, error: e.message }; } }).filter(f => !f.error).slice(-n);
  const last = feats[feats.length - 1] || {};
  const next = {}, avoid = {};
  for (const key of ['titleForm', 'opener', 'numbering', 'headingCarrier', 'ending']) {
    const used = tally(feats.map(f => f[key]));
    avoid[key] = Object.entries(used).filter(([, c]) => c >= 2).map(([k]) => k);
    next[key] = leastUsed(Object.keys(OPTIONS[key]), used, last[key]);
  }
  next.quoteStyle = leastUsed(QUOTE_STYLES, tally(feats.map(f => f.quoteStyle)), last.quoteStyle);
  next.lineStyle = leastUsed(LINE_STYLES, tally(feats.map(f => f.lineStyle)), last.lineStyle);

  // 수치: 최근 평균에서 벗어난 쪽으로, 그리고 AI 티 기준(한 줄 한 문장·장식 과다)을 낮추는 쪽으로
  const m = k => +mean(feats, k).toFixed(1);
  const R = {
    sections: m('sections'), images: m('images'), tables: m('tables'), bold: m('bold'), emojis: m('emojis'), lineStartEmoji: m('lineStartEmoji'),
    oneSentenceRatio: m('oneSentenceRatio'), avgParaLines: m('avgParaLines'), dividers: m('dividers'), imgAfterHeading: m('imgAfterHeading'), chars: Math.round(mean(feats, 'chars')),
  };
  next.sections = R.sections >= 6 ? [3, 4] : R.sections <= 3 ? [5, 6] : [R.sections - 2, R.sections - 1].map(x => Math.max(3, Math.round(x)));
  next.images = R.images >= 5 ? [2, 3] : [3, 4];
  next.tables = R.tables >= 2 ? [0, 1] : [1, 1];
  next.bold = [4, Math.max(6, Math.min(9, Math.round(R.bold / 2) || 6))];
  next.emojis = [0, Math.min(4, Math.max(1, Math.round(R.emojis / 4)))];
  next.lineStartEmoji = 0;
  next.oneSentenceRatio = '0.6 이하(한 줄에 두세 문장 이어 쓴 문단을 섞기)';
  next.dividers = R.dividers >= 3 ? [0, 1] : [1, 2];
  next.imgAfterHeading = R.imgAfterHeading >= 0.5 ? '소제목 바로 뒤가 아니라 본문 중간·끝에 사진' : '사진 위치 자유';
  next.chars = R.chars >= 2300 ? [1500, 2000] : [1800, 2400];
  next.colorAndSize = '글자색·글자 크기 변경은 0~1곳';

  const lines = [];
  lines.push(`최근 ${feats.length}편 형태 분석 → 다음 글 설계`);
  lines.push(`· 제목: ${OPTIONS.titleForm[next.titleForm]} (최근: ${feats.map(f => f.titleForm).join('·')})`);
  lines.push(`· 도입: ${OPTIONS.opener[next.opener]} (최근: ${feats.map(f => f.opener).join('·')})${feats.filter(f => f.openerEmoji).length >= 2 ? ' · 첫 줄 이모지 금지' : ''}`);
  lines.push(`· 소제목: ${OPTIONS.numbering[next.numbering]}, ${OPTIONS.headingCarrier[next.headingCarrier]} · ${next.sections.join('~')}개 (최근 평균 ${R.sections}개)`);
  lines.push(`· 끝맺음: ${OPTIONS.ending[next.ending]} (최근: ${feats.map(f => f.ending).join('·')})`);
  lines.push(`· 인용구 스타일 ${next.quoteStyle} · 구분선 ${next.lineStyle} · 구분선 ${next.dividers.join('~')}개 (최근 평균 ${R.dividers})`);
  lines.push(`· 사진 ${next.images.join('~')}장(최근 평균 ${R.images}) · ${next.imgAfterHeading} · 표 ${next.tables[0] === next.tables[1] ? next.tables[0] : next.tables.join('~')}개`);
  lines.push(`· 문장: 한 줄 한 문장 비율 ${next.oneSentenceRatio} (최근 평균 ${R.oneSentenceRatio})`);
  lines.push(`· 장식: 굵게 ${next.bold.join('~')}곳(최근 평균 ${R.bold}) · 이모지 ${next.emojis.join('~')}개(최근 평균 ${R.emojis}) · 줄 맨 앞 이모지·불릿 기호 줄 금지 · ${next.colorAndSize}`);
  lines.push(`· 분량: 공백 제외 ${next.chars.join('~')}자 (최근 평균 ${R.chars}자) · 채우기용 문단 금지`);
  if (avoid.titleForm.length || avoid.opener.length || avoid.ending.length) lines.push(`· 피할 것(최근 2편 이상 반복): ${[...avoid.titleForm.map(k => '제목 ' + OPTIONS.titleForm[k]), ...avoid.opener.map(k => '도입 ' + OPTIONS.opener[k]), ...avoid.numbering.map(k => '소제목 ' + OPTIONS.numbering[k]), ...avoid.ending.map(k => '끝 ' + OPTIONS.ending[k])].join(' / ')}`);
  lines.push('· 공통: 지어낸 일화 금지(날짜·인물 특정 장면), "A가 아니라 B" 대비 결론·명언형 마무리·기계 비유 반복 금지');
  return { recent: feats, avg: R, avoid, next, brief: lines.join('\n') };
}

// 폴더 → 원고 파일 목록(이름순 = 시간순)
function collect(args) {
  const out = [];
  for (const a of args) {
    if (!fs.existsSync(a)) continue;
    const st = fs.statSync(a);
    if (st.isFile()) { out.push(a); continue; }
    for (const d of fs.readdirSync(a, { withFileTypes: true }).filter(e => e.isDirectory() && /^\d{8}_\d{4}_/.test(e.name)).map(e => e.name).sort()) {
      const f = path.join(a, d, '원고.txt'); if (fs.existsSync(f)) out.push(f);
    }
  }
  return out;
}

module.exports = { features, plan, collect, OPTIONS };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const ni = argv.indexOf('--n'); const n = ni >= 0 ? +argv[ni + 1] : 5;
  const files = collect(argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--n'));
  const r = plan(files, { n });
  if (argv.includes('--json')) console.log(JSON.stringify(r, null, 1)); else { console.log(r.brief); }
}
