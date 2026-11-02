// 원고 읽기: Claude가 만든 *_layout.js 와 직접 쓰는 .txt 둘 다 같은 구조로 바꾼다
// 결과: { title, category, tags[], images[절대경로], blocks[] }
const fs = require('fs'), path = require('path');
const ST = require('./styles');

// ── 직접 쓰는 .txt 형식 ──────────────────────────────
// 제목: …              (맨 위 머리말, 빈 줄로 끝)
// 카테고리: …
// 태그: 가, 나, 다
// 사진폴더: C:\…        (없으면 txt가 있는 폴더)
// 인용구스타일: 따옴표|세로선|말풍선|밑줄|포스트잇|프레임   (없으면 따옴표 · 글 전체 기본)
// 구분선스타일: 구분선1|구분선2|…|구분선8               (없으면 구분선1)
//
// > 인용구               '---' 구분선     [사진] 파일명.png
// >[세로선] 인용구        ---[구분선1]      ← 한 칸만 다른 스타일로
// ## 소주제(19 굵게)      일반 줄(16 보통)  **강조**  [[INFJ|#bdfbfa]] 형광펜
// [링크]  또는 [링크] 주소                 [해시태그]
function parseTxt(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r/g, '');
  const [head, ...rest] = raw.split(/\n\s*\n/);
  const meta = {};
  for (const l of head.split('\n')) { const m = l.match(/^\s*([^:：]+)[:：]\s*(.*)$/); if (m) meta[m[1].trim()] = m[2].trim(); }
  if (!meta['제목']) throw new Error('머리말에 "제목:" 이 없음');
  const dir = meta['사진폴더'] || path.dirname(file);
  const S = {
    title: meta['제목'], category: meta['카테고리'] || '',
    tags: (meta['태그'] || '').split(/[,，\s]+/).map(t => t.replace(/^#/, '')).filter(Boolean),
    quoteStyle: ST.quoteKey(meta['인용구스타일'] || meta['인용구 스타일'] || ''),
    lineStyle: ST.lineKey(meta['구분선스타일'] || meta['구분선 스타일'] || ''),
    images: [], blocks: [],
  };
  let buf = null;
  const flush = () => {
    if (!buf) return;
    while (buf.length && !buf[0].trim()) buf.shift();
    while (buf.length && !buf[buf.length - 1].trim()) buf.pop();
    if (buf.length) S.blocks.push({ text: buf.map(l => l.trimEnd()) });
    buf = null;
  };
  for (const l of rest.join('\n\n').split('\n')) {
    const t = l.trim();
    const qo = t.match(/^>\[([^\]]+)\]\s*(.*)$/);   // >[세로선] 한 칸만 다른 스타일
    const lo = t.match(/^---\[([^\]]+)\]$/);        // ---[구분선1]
    if (qo) { flush(); S.blocks.push({ quote: qo[2].trim(), style: ST.quoteKey(qo[1]) }); }
    else if (t.startsWith('> ')) { flush(); S.blocks.push({ quote: t.slice(2).trim() }); }
    else if (lo) { flush(); S.blocks.push({ line: true, style: ST.lineKey(lo[1]) }); }
    else if (t === '---') { flush(); S.blocks.push({ line: true }); }
    else if (/^\[사진\]/.test(t)) {
      flush();
      const f = t.replace(/^\[사진\]\s*/, '');
      S.images.push(path.isAbsolute(f) ? f : path.join(dir, f));
      S.blocks.push({ img: S.images.length - 1 });
    }
    else if (/^\[링크\]/.test(t)) { flush(); S.blocks.push({ link: t.replace(/^\[링크\]\s*/, '') || true }); }
    else if (t === '[해시태그]') { flush(); S.blocks.push({ hashtags: true }); }
    else (buf = buf || []).push(t);
  }
  flush();
  return S;
}

// ── Claude가 만든 *_layout.js ─────────────────────────
function parseJs(file) {
  delete require.cache[require.resolve(file)];
  const S = { ...require(file) };
  // 선택 항목: quoteStyle / lineStyle (이름 또는 키). 없으면 기본
  S.quoteStyle = ST.quoteKey(S.quoteStyle || ''); S.lineStyle = ST.lineKey(S.lineStyle || '');
  S.blocks = (S.blocks || []).map(b => (b.quote !== undefined && b.style) ? { ...b, style: ST.quoteKey(b.style) } : (b.line && b.style) ? { ...b, style: ST.lineKey(b.style) } : b);
  if (!S.images) {
    // 사진 파일명은 같은 이름의 원고데이터(05_NF.js)에서, 폴더는 04_이미지/<folder>
    const base = require(file.replace(/_layout\.js$/, '.js'));
    const root = path.resolve(path.dirname(file), '..', '..');
    S.images = base.imgs.map(([f]) => path.join(root, '04_이미지', S.folder, f));
  }
  return S;
}

function load(file) {
  file = path.resolve(file);
  const S = file.endsWith('.txt') ? parseTxt(file) : parseJs(file);
  S.file = file;
  const miss = S.images.filter(f => !fs.existsSync(f));
  if (miss.length) throw new Error('사진 파일 없음: ' + miss.join(', '));
  return S;
}

// 목록 화면용 요약
function summary(file) {
  try {
    const S = load(file);
    const chars = S.blocks.filter(b => b.text).reduce((a, b) => a + b.text.join('').replace(/\s|\*|##|\[\[|\|#[0-9a-f]{6}\]\]/gi, '').length, 0);
    return { file, ok: true, title: S.title, category: S.category, tags: S.tags.length, images: S.images.length, blocks: S.blocks.length, chars };
  } catch (e) { return { file, ok: false, error: e.message }; }
}

module.exports = { load, summary, parseTxt };
