// 블로그 한 곳의 "다음 글 설계" (2026-11-05)
// 이유: formplan.plan()은 파일 목록만 받는다. 앱(server.js)과 자동 원고(gen)가 같은 기준으로
//       "그 블로그의 최근 글"을 고르고, 최근 많이 다룬 소재까지 붙인 결과를 쓰도록 한 곳에 모았다.
// 사용: forBlog({ blogId, files:[{path, draft}], history:[], published:['제목'…], n:5 })
'use strict';
const fs = require('fs'), path = require('path');
const formplan = require('./formplan.js');
const manuscript = require(path.join(__dirname, '..', '..', 'naver_post', 'manuscript.js'));

const squash = s => String(s || '').replace(/\s+/g, '').toLowerCase();
const KO = {
  titleForm: { sentence: '평서문', question: '질문형', comma: '쉼표형', bar: '| 구분형', summary: '~정리형' },
  opener: { text: '문단 시작', quote: '인용구 시작', heading: '소제목 시작', table: '표 시작', none: '없음' },
  ending: { monologue: '독백', qa: 'Q&A', 'verdict-quote': '결론 인용구', aphorism: '명언형', open: '질문' },
  numbering: { plain: '평서 소제목', number: '숫자 소제목', circled: '원문자 소제목', q: 'Q. 소제목', emoji: '이모지 소제목', label: '라벨형 소제목' },
  headingCarrier: { quote: '인용구 소제목', h2: '굵은 글씨 소제목' },
};

// 원고 시각: 원고함 폴더 이름(YYYYMMDD_HHMM_) → 이 블로그 발행 기록 → 파일 수정 시각
function whenOf(file, history, blogId) {
  const m = path.basename(path.dirname(file)).match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})_/);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00`).getTime();
  const h = history.find(x => x.blogId === blogId && x.file === file && x.at);
  if (h) return new Date(h.at).getTime();
  try { return fs.statSync(file).mtimeMs; } catch { return 0; }
}

// 이 블로그 원고 고르기: 그 계정 원고함 초안 + (공용 폴더 원고 중) 이 블로그에 올라간 것
function pickFiles({ blogId, files = [], history = [], published = [] }) {
  const pub = new Set(published.map(squash));
  const okFor = (f, id) => history.some(h => h.file === f && h.blogId === id && h.mode === 'publish' && h.code === 0);
  const out = [];
  for (const m of files) {
    const f = m.path; let title = '';
    try { title = manuscript.summary(f).title || ''; } catch { continue; }
    const posted = !!title && pub.has(squash(title));
    let mine = !!m.draft && String(m.draft).split('/')[0] === blogId;
    if (!mine && !m.draft) {
      const other = history.some(h => h.file === f && h.blogId !== blogId && h.mode === 'publish' && h.code === 0);
      mine = posted || (okFor(f, blogId) && !other);
    }
    if (mine) out.push({ path: f, title, posted, at: whenOf(f, history, blogId) });
  }
  return out.sort((a, b) => a.at - b.at);
}

// 최근 많이 다룬 소재: 제목·태그에서 2자 이상 낱말, 글 한 편에 한 번만 센다
const STOP = new Set(['정리', '방법', '이유', '특징', '모습', '가지', '이야기', '총정리', '뜻', '차이', '비교', '최근', '오늘', '이번', '그리고', '하지만', '때문', '경우',
  '얼마', '어떻게', '무엇', '진짜', '정말', '추천', '후기', '부터', '까지', '대한', '관련', '위한', '있는', '없는', '하는', '되는', '했다', '한다', '이다', '같은', '다른', '옆에서', '본', '영향', '결과', '나한테', '직접', '물어봤다', '달라질까', '무슨', '생각', '사람']);
const JOSA = /(으로|에서|에게|까지|부터|보다|처럼|이란|라는|이라|은|는|이|가|을|를|의|에|와|과|도|로|만)$/;
function tokens(s) {
  const out = new Set();
  for (let w of String(s || '').split(/[^0-9A-Za-z가-힣]+/)) {
    if (!w) continue;
    if (/[가-힣]$/.test(w) && w.length > 2) w = w.replace(JOSA, '');
    if (w.length < 2 || /^\d+$/.test(w) || STOP.has(w)) continue;
    out.add(/^[A-Za-z]+$/.test(w) ? w.toUpperCase() : w);
  }
  return out;
}
function topics(docs, top = 8) {
  const c = {};
  for (const d of docs) for (const w of tokens(d)) c[w] = (c[w] || 0) + 1;
  return Object.entries(c).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, top).map(([word, count]) => ({ word, count }));
}

const localDate = t => { const d = new Date(t), z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };

function forBlog({ blogId, files = [], history = [], published = [], n = 5 } = {}) {
  const picked = pickFiles({ blogId, files, history, published });
  const recentFiles = picked.slice(-n);
  const r = formplan.plan(recentFiles.map(x => x.path), { n });
  const meta = new Map(recentFiles.map(x => [x.path, x]));
  const recent = r.recent.map(f => {
    const m = meta.get(f.file) || {};
    return {
      title: f.title, date: m.at ? localDate(m.at) : null, posted: !!m.posted,
      titleForm: f.titleForm, opener: f.opener, ending: f.ending, numbering: f.numbering,
      titleFormKo: KO.titleForm[f.titleForm] || f.titleForm, openerKo: KO.opener[f.opener] || f.opener, endingKo: KO.ending[f.ending] || f.ending,
      sections: f.sections, images: f.images, tables: f.tables, chars: f.chars, oneSentenceRatio: f.oneSentenceRatio, emojis: f.emojis,
    };
  });
  // 소재: 최근 원고 제목·태그 + 블로그에 올라간 최근 제목 20개
  //   매 글에 붙는 고정 태그(경제뉴스·오늘의이슈 등: 제목엔 없고 최근 원고 75% 이상에 붙은 태그)는 소재가 아니라서 뺀다
  const docs = [], tagSets = [];
  for (const x of recentFiles) { let tags = []; try { tags = manuscript.load(x.path).tags || []; } catch { } tagSets.push(tokens(tags.join(' '))); docs.push(`${x.title} ${tags.join(' ')}`); }
  const seen = new Set(recentFiles.map(x => squash(x.title)));
  const titles = [...recentFiles.map(x => x.title), ...published.slice(0, 20).filter(t => !seen.has(squash(t)))];
  for (const t of titles.slice(recentFiles.length)) docs.push(t);
  const inTitle = new Set(titles.flatMap(t => [...tokens(t)]));
  const fixedTag = w => !inTitle.has(w) && tagSets.length >= 3 && tagSets.filter(s => s.has(w)).length >= tagSets.length * 0.75;
  const tp = topics(docs, 20).filter(t => !fixedTag(t.word)).slice(0, 8);

  const avoidText = [];
  const OPT = formplan.OPTIONS;
  for (const k of r.avoid.titleForm || []) avoidText.push(`제목: ${OPT.titleForm[k] || k}`);
  for (const k of r.avoid.opener || []) avoidText.push(`도입: ${OPT.opener[k] || k}`);
  for (const k of r.avoid.numbering || []) avoidText.push(`소제목: ${OPT.numbering[k] || k}`);
  for (const k of r.avoid.headingCarrier || []) avoidText.push(`소제목: ${OPT.headingCarrier[k] || k}`);
  for (const k of r.avoid.ending || []) avoidText.push(`끝맺음: ${OPT.ending[k] || k}`);
  const A = r.avg || {};
  if (A.oneSentenceRatio >= 0.8) avoidText.push(`한 줄에 한 문장만 쓰기 (최근 ${Math.round(A.oneSentenceRatio * 100)}%)`);
  if (A.lineStartEmoji >= 3) avoidText.push(`줄 맨 앞 이모지 (최근 평균 ${A.lineStartEmoji}줄)`);
  if (A.bold >= 10) avoidText.push(`굵게 남발 (최근 평균 ${A.bold}곳)`);
  if (A.imgAfterHeading >= 0.5) avoidText.push('소제목 바로 뒤에 사진 넣기');

  const nextText = r.brief.split('\n').slice(1).filter(l => !/^· 피할 것/.test(l)).map(l => l.replace(/^·\s*/, ''));
  let brief = r.brief;
  if (tp.length) brief += `\n· 최근 많이 다룬 소재: ${tp.map(t => `${t.word}(${t.count})`).join(', ')} — 같은 소재면 다른 각도·다른 낱말로`;
  return { blogId, count: recent.length, recent, avg: r.avg, avoid: r.avoid, avoidText, next: r.next, nextText, topics: tp, brief };
}

module.exports = { forBlog, pickFiles, topics, tokens };
