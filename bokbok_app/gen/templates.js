// 계정별 "기본 글 형태 템플릿 3개" 자동 구성 — 블로그 데이터(제목·노출·반응·사진 수·지난 초안)를 읽어
// 돌아가며 쓸 템플릿 조합(preset) 3개를 고른다. 순수 함수: 네트워크·파일 접근 없음(서버가 재료를 모아 넘긴다).
//
//   suggest({ profile, titles, winners, avgImages, history, photosAvailable }) → { kind, presets:[3], reasons:[3] }
//     kind 'clinical' : 치과 블로그 → 임상 사진 글 형태 3종(증례 순서형·질문 답변형·판단 기준형)
//     kind 'general'  : 그 밖의 블로그 → 레이아웃 6종 중 제목 패턴 점수 상위 3개
//   titles  : 이 블로그 글 제목 전부(최근순)        winners : 노출 상위(10위 안)·반응 상위 글 제목
//   history : 지난 초안 [{imageMode, layout}]        avgImages : 글당 평균 사진 수(블로그 분석)
'use strict';
const layouts = require('./layouts');
const clinical = require('./clinical');

const DENTAL_RE = /치과|임플란트|교정|보철|치주|신경\s*치료|충치|사랑니|라미네이트|틀니|스케일링|크라운|잇몸|치아/g;

// 레이아웃별 제목 패턴(제목에 이런 말이 자주 보이면 그 형태의 글이 이 블로그에 맞는다)
const PATTERNS = {
  compare: { re: /vs|VS|차이|비교|다른\s*점|다른점/, why: '"vs·차이·비교"' },
  howto: { re: /방법|하는\s*법|순서|단계|노하우|팁|가이드/, why: '"방법·순서·단계"' },
  qa: { re: /\?|이유|왜\s|궁금|뜻|의미|일까/, why: '질문·"이유·뜻"' },
  list: { re: /\d+\s*가지|총\s*정리|모음|리스트|특징|종류|추천/, why: '"N가지·특징·종류"' },
  story: { re: /후기|경험|해\s*봤|일기|썰|달라진|직접/, why: '"후기·경험·직접"' },
};
const DEFAULT_ORDER = ['classic', 'qa', 'list', 'compare', 'howto', 'story'];
const CARDS_FOR = { compare: ['compare', 'points'], howto: ['steps', 'checklist'], list: ['points', 'checklist'], qa: ['points', 'checklist'], story: ['checklist', 'points'], classic: ['points', 'compare', 'checklist', 'steps'] };
const TITLE_FOR = { compare: 'keyword', howto: 'number', list: 'number', qa: 'question', story: 'story', classic: 'keyword' };
const CHARS_FOR = { story: 1800, howto: 1500, compare: 1500, list: 1500, qa: 1500, classic: 1500 };

const uniq = a => [...new Set(a)];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// 치과(임상) 블로그인지: 프로필 글귀 + 제목에 치과 용어가 얼마나 나오는지
function isDental({ profile = {}, titles = [], history = [] } = {}) {
  const text = [profile.persona, profile.prompt, profile.rules, profile.blogName, ...(Array.isArray(profile.categories) ? profile.categories : [])].filter(Boolean).join(' ');
  if (DENTAL_RE.test(text)) { DENTAL_RE.lastIndex = 0; return true; }
  DENTAL_RE.lastIndex = 0;
  const clin = history.filter(h => h && h.imageMode === 'clinical').length;
  if (clin && clin >= history.length / 2) return true;
  const hit = titles.filter(t => { const m = DENTAL_RE.test(String(t || '')); DENTAL_RE.lastIndex = 0; return m; }).length;
  return titles.length >= 3 && hit / titles.length >= 0.5;
}

// 제목 패턴 점수: 전체 제목 1점, 잘 된 글(노출 상위·반응 상위) 3점
function scoreLayouts(titles, winners) {
  const score = {}, hits = {};
  for (const id of layouts.LAYOUT_IDS) { score[id] = 0; hits[id] = { all: 0, win: 0 }; }
  const tally = (list, w, key) => {
    for (const t of list) for (const [id, p] of Object.entries(PATTERNS)) if (p.re.test(String(t || ''))) { score[id] += w; hits[id][key]++; }
  };
  tally(titles, 1, 'all'); tally(winners, 3, 'win');
  return { score, hits };
}

function generalPresets({ titles, winners, avgImages, history, photosAvailable }) {
  const { score, hits } = scoreLayouts(titles, winners);
  const ranked = layouts.LAYOUT_IDS.filter(id => score[id] > 0).sort((a, b) => score[b] - score[a] || DEFAULT_ORDER.indexOf(a) - DEFAULT_ORDER.indexOf(b));
  const picked = uniq([...ranked, ...DEFAULT_ORDER]).slice(0, 3);
  // 이미지 방식: 지난 초안에서 가장 많이 쓴 방식을 기본으로, 하나는 글자 카드만(비용·속도)
  const used = {}; for (const h of history) if (h && h.imageMode && h.imageMode !== 'clinical') used[h.imageMode] = (used[h.imageMode] || 0) + 1;
  let base = Object.entries(used).sort((a, b) => b[1] - a[1]).map(x => x[0])[0] || 'ai';
  if (base === 'photos' && !photosAvailable) base = 'ai';
  const modes = [base, base === 'cards' ? 'ai' : 'cards', base];
  const imageCount = Number.isFinite(avgImages) && avgImages > 0 ? clamp(Math.round(avgImages), 2, 6) : 4;
  const presets = [], reasons = [];
  picked.forEach((id, i) => {
    const L = layouts.LAYOUTS[id], h = hits[id];
    presets.push({
      name: `기본 ${i + 1} · ${L.label}`, layout: id, imageMode: modes[i], imageStyle: 'auto', imageCount, aiCount: 1, deco: 'auto',
      cardTemplates: CARDS_FOR[id], charTarget: CHARS_FOR[id], charBasis: 'nospace', tone: 'profile', kwRepeat: 'mid', emphasis: 'mid',
      titleMode: TITLE_FOR[id], qaCount: id === 'qa' ? '3' : 'auto', imageNotes: '',
    });
    let why;
    if (h.win) why = `잘 된 글 ${winners.length}편 중 ${h.win}편 제목에 ${PATTERNS[id].why}`;
    else if (h.all) why = `글 ${titles.length}편 중 ${h.all}편 제목에 ${PATTERNS[id].why}`;
    else why = id === 'classic' ? '어떤 주제에도 맞는 기본 구성' : '글 모양이 겹치지 않게 기본 순서에서 채움';
    reasons.push(`${L.label} — ${why} · 사진 ${imageCount}장(${modes[i] === 'cards' ? '글자 카드만' : modes[i] === 'photos' ? '내 사진' : 'AI 1장+카드'}) · ${CHARS_FOR[id].toLocaleString()}자`);
  });
  return { kind: 'general', presets, reasons, score };
}

function clinicalPresets({ titles, winners }) {
  const q = [...titles, ...winners].filter(t => /\?|궁금|이유|왜\s|일까/.test(String(t || ''))).length;
  const g = [...titles, ...winners].filter(t => /기준|경우|언제|해야|판단|체크|확인/.test(String(t || ''))).length;
  // 질문 제목이 많으면 질문 답변형을 앞에, 기준·판단 제목이 많으면 판단 기준형을 앞에
  const order = q > g && q >= 2 ? ['qa', 'stage', 'guide'] : g >= 2 ? ['guide', 'stage', 'qa'] : ['stage', 'qa', 'guide'];
  const TITLE = { stage: 'keyword', qa: 'question', guide: 'keyword' };
  const WHY = {
    stage: '치료 과정을 사진 순서대로 보여 주는 가장 기본 증례 글',
    qa: q >= 2 ? `제목에 질문형이 ${q}편 — 환자가 묻는 말로 소주제를 잡는 글` : '환자가 실제로 묻는 질문으로 소주제를 잡는 검색 답변형',
    guide: g >= 2 ? `제목에 "기준·경우·언제"가 ${g}편 — 판단 기준 먼저, 사진은 예시` : '"이런 경우 이 치료를 생각한다" 기준을 앞에 두는 정보형',
  };
  const presets = order.map((f, i) => ({
    name: `기본 ${i + 1} · ${clinical.FORMS[f].label}`, layout: 'classic', imageMode: 'clinical', clinicalForm: f, imageStyle: 'auto', imageCount: 4, aiCount: 1, deco: 'off',
    cardTemplates: ['points'], charTarget: 2000, charBasis: 'nospace', tone: 'profile', kwRepeat: 'mid', emphasis: 'low', titleMode: TITLE[f], qaCount: '3', imageNotes: '',
  }));
  const reasons = order.map(f => `${clinical.FORMS[f].label} — ${WHY[f]} · 임상 사진 순서대로 · 2,000자(공백 제외) · 부작용·주의사항 문단`);
  return { kind: 'clinical', presets, reasons };
}

function suggest(data = {}) {
  const titles = (Array.isArray(data.titles) ? data.titles : []).map(t => String(t || '')).filter(Boolean).slice(0, 300);
  const winners = (Array.isArray(data.winners) ? data.winners : []).map(t => String(t || '')).filter(Boolean).slice(0, 50);
  const history = Array.isArray(data.history) ? data.history : [];
  const d = { profile: data.profile || {}, titles, winners, avgImages: data.avgImages, history, photosAvailable: !!data.photosAvailable };
  const r = isDental(d) ? clinicalPresets(d) : generalPresets(d);
  r.presets.forEach((p, i) => { p.note = r.reasons[i]; });
  return r;
}

module.exports = { suggest, isDental, scoreLayouts, PATTERNS, DEFAULT_ORDER };
