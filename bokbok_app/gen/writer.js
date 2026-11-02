// GPT 원고 작성: 프롬프트 만들기 → JSON 받기 → 다듬기 → 검사(문제 있으면 1회 수정 요청) → draft
// draft.blocks 는 naver_post\manuscript.js 블록과 같은 모양, toTxt()는 그 엔진이 읽는 .txt 형식
const openai = require('./openai');
const layouts = require('./layouts');
const styles = require('./styles');
const { GEO_RULES } = require('./planner');
const clinical = require('./clinical');
const hidden = require('./hidden');

const PALETTE = ['#bdfbfa', '#fff8b2', '#ffa94f', '#ffc1c8', '#d4d4ff', '#c8f5c8'];
const PALETTE_NAMES = { '#bdfbfa': '민트', '#fff8b2': '노랑', '#ffa94f': '주황', '#ffc1c8': '분홍', '#d4d4ff': '보라', '#c8f5c8': '연두' };
const DECO_MODES = ['off', 'auto', 'rich'];
const DECO_SYMBOLS = ['✔', '▶', '·', '✓', '※'];
const LENGTHS = { 짧게: [40, 60], 보통: [60, 90], 길게: [90, 130] };
// 세부 옵션 (2026-11-01 추가)
const LENGTH_CHARS = { 짧게: 700, 보통: 1000, 길게: 1500 };           // 예전 length 값(줄 수 기준)에 해당하는 글자 수(공백 제외)
const CHAR_MIN = 500, CHAR_MAX = 5000, CHAR_TOL = 0.15;             // 목표 ±15% 밖이면 수정 요청
const CHAR_BASES = ['nospace', 'space'];
const TONES = {
  profile: { label: '블로그 성격대로', desc: '블로그 계정의 화자·말투 그대로' },
  yo: { label: '친근한 존댓말', desc: '~해요, ~더라고요' },
  hapnida: { label: '정중한 존댓말', desc: '~합니다, ~입니다' },
  banmal: { label: '반말 평서체', desc: '~다, ~더라' },
};
const TONE_RULE = {
  yo: '어미는 처음부터 끝까지 친근한 존댓말 "~해요/~더라고요/~거든요"체로 통일한다. "~습니다"체와 반말을 섞지 않는다.',
  hapnida: '어미는 처음부터 끝까지 정중한 "~합니다/~입니다"체로 통일한다. 딱딱한 공문 투는 피하고 "~요"체·반말을 섞지 않는다.',
  banmal: '어미는 처음부터 끝까지 반말 평서체 "~다/~더라/~했다"로 통일한다. 존댓말을 섞지 않는다.',
};
const KW_REPEATS = {
  low: { label: '적게', desc: '본문 2~3번', range: [2, 3], hard: [1, 6] },
  mid: { label: '보통', desc: '본문 3~5번', range: [3, 5], hard: [2, 9] },
  high: { label: '많이', desc: '본문 5~7번', range: [5, 7], hard: [3, 11] },
};
const EMPHASES = {
  low: { label: '적게', desc: '굵게 2~4 · 형광펜 0~2', bold: [2, 4], hl: [0, 2] },
  mid: { label: '보통', desc: '굵게 4~8 · 형광펜 0~6', bold: [4, 8], hl: [0, 6] },
  high: { label: '많이', desc: '굵게 7~30 · 형광펜 3~8', bold: [7, 30], hl: [3, 8] },   // 치과 블로그처럼 굵게를 많이 쓰는 글(기준 글 69곳) 수용
};
const TITLE_MODES = {
  auto: { label: '자동', desc: '글에 맞게', rule: '"키워드 | 부제" 또는 키워드로 시작하는 자연스러운 문장.' },
  keyword: { label: '키워드 | 부제', desc: '키워드 뒤에 부제', rule: '반드시 "키워드 | 부제" 모양. 부제는 글의 핵심을 한 구절로.' },
  question: { label: '질문형', desc: '독자가 묻는 말로', rule: '키워드로 시작해 독자가 실제로 검색할 법한 질문 한 문장으로. 물음표는 끝에 하나만.' },
  number: { label: '숫자형', desc: '"~ 3가지"처럼', rule: '키워드로 시작하고 본문 소주제 개수와 같은 숫자를 넣는다(예: "~ 4가지", "~ 3단계"). 지어낸 통계 숫자는 금지.' },
  story: { label: '경험형', desc: '화자가 겪은 이야기로', rule: '키워드로 시작하고 화자가 직접 겪거나 해 본 느낌이 나는 문장(예: "~ 해 보고 달라진 점").' },
  fixed: { label: '직접 입력', desc: '내가 정한 제목 그대로', rule: '' },
};
const QA_COUNTS = [0, 1, 2, 3, 4, 5];
const MAX_LINE = 30;        // 이보다 길면 자동 줄나눔
const HARD_LINE = 32;       // 줄나눔 뒤에도 넘으면 문제
const CARD_FILE = { points: '핵심정리', compare: '비교', checklist: '체크리스트', steps: '순서' };

// 검사에서 막는 표현(상투어·지어낸 근거·보장 표현)
const BANNED = [
  '결론적으로', '요약하자면', '알아보겠습니다', '알아볼까요', '살펴보겠습니다', '살펴볼까요', '여러분',
  '도움이 되셨길', '도움이 되셨으면', '마무리하며',
  '연구에 따르면', '연구 결과', '통계에 따르면', '통계적으로', '논문에', '설문 결과', '전문가들은', '전문가에 따르면',
  '완치', '무조건', '100%', '효과 보장', '보장합니다', '수익 보장', '원금 보장', '부작용 없', '반드시 효과',
  '충격', '모르면 손해',
];
const PERCENT = /\d+(\.\d+)?\s*(%|퍼센트|프로\b)/;
// 본문에 써도 되는 글자: 문자·숫자·공백·일반 문장부호 + 허용 기호
const OK_CHAR = /[\p{L}\p{N}\s.,!?'"()\[\]{}:;/~%&+\-=_<>@|#*^…·“”‘’「」『』—–→]/u;   // → 는 흐름 요약(진단 → 식립 → …)용

const TOKEN = /(\*\*[^*]+\*\*|\[\[[^\]|]+\|#[0-9a-fA-F]{6}\]\])/;
const plainOf = l => l.replace(/^## /, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[\[([^\]|]+)\|#[0-9a-fA-F]{6}\]\]/g, '$1');
const len = s => [...s].length;
const squash = s => String(s || '').replace(/\s+/g, '').toLowerCase();

let _cardValidator; // undefined = 처음 쓸 때 cards/render.js 에서 찾음, null = 내장 검사만
function _setCardValidator(fn) { _cardValidator = fn; }
function cardValidator() {
  if (_cardValidator === undefined) {
    try { _cardValidator = require('./cards/render').validateCard || null; } catch { _cardValidator = null; }
  }
  return _cardValidator;
}

// 실측: 이 형식의 본문 한 줄은 공백 제외 약 12~13자, 공백 포함 약 15~16자
const targetLines = P => Math.round(P.charTarget / (P.charBasis === 'space' ? 15.5 : 12.5));

// ── 분량·키워드 측정 (화면 표시·검사 공용) ─────────────────
function countKw(str, kw) {
  if (!kw) return 0;
  const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*'), 'gi');
  return (String(str).match(re) || []).length;
}
function measureDraft(d) {
  const B = (d && d.blocks) || [], lines = [];
  let subtitles = 0, bolds = 0, highlights = 0;
  for (const b of B) {
    if (b.quote !== undefined) lines.push(String(b.quote));
    else if (Array.isArray(b.text)) for (const l of b.text) {
      if (l === '') continue;
      if (l.startsWith('## ')) subtitles++;
      bolds += (l.match(/\*\*[^*]+\*\*/g) || []).length;
      highlights += (l.match(/\[\[[^\]|]+\|#[0-9a-fA-F]{6}\]\]/g) || []).length;
      lines.push(plainOf(l));
    }
  }
  const all = lines.join('\n'), body = lines.slice(1).join('\n');
  const kw = (d && (d.keyword || (d.input && d.input.keyword))) || '';
  const subs = (d && d.subKeywords) || [];
  return {
    chars: [...all.replace(/\s+/g, '')].length,
    charsWithSpace: [...all.replace(/\n/g, '')].length,
    lines: lines.length, subtitles, bolds, highlights,
    keywordCount: countKw(body, kw),
    subKeywordCounts: Object.fromEntries(subs.map(k => [k, countKw(body, k)])),
  };
}
// 목표치에서 벗어난 것: 수정 요청은 하되, 고쳐지지 않아도 원고는 살린다("(참고)"는 요청도 안 함)
function softProblems(d) {
  const p = [], m = measureDraft(d);
  const t = d.charTarget;
  if (t) {
    const v = d.charBasis === 'space' ? m.charsWithSpace : m.chars, lo = Math.round(t * (1 - CHAR_TOL)), hi = Math.round(t * (1 + CHAR_TOL));
    if (v < lo) p.push(`본문 글자 수가 ${v}자로 목표 ${t}자보다 적음(${lo}~${hi}자로 늘릴 것, 소주제 본문을 장면·예시로 보강)`);
    else if (v > hi) p.push(`본문 글자 수가 ${v}자로 목표 ${t}자보다 많음(${lo}~${hi}자로 줄일 것)`);
  }
  const kr = KW_REPEATS[d.kwRepeat] || KW_REPEATS.mid;
  if (d.keyword && (m.keywordCount < kr.range[0] || m.keywordCount > kr.range[1])) p.push(`본문 키워드 "${d.keyword}" ${m.keywordCount}번(목표 ${kr.range.join('~')}번)`);
  for (const [k, n] of Object.entries(m.subKeywordCounts)) if (n < 1) p.push(`보조 키워드 "${k}"가 본문에 없음(1~2번 넣을 것)`);
  const em = EMPHASES[d.emphasis] || EMPHASES.mid;
  if (m.bolds < em.bold[0]) p.push(`(참고) 굵게가 ${m.bolds}번(목표 ${em.bold.join('~')}번)`);
  if (m.highlights < em.hl[0]) p.push(`(참고) 형광펜이 ${m.highlights}번(목표 ${em.hl.join('~')}번)`);
  if (d.titleMode === 'fixed' && d.keyword && squash(d.title).indexOf(squash(d.keyword)) < 0) p.push(`(참고) 직접 입력한 제목에 키워드 "${d.keyword}"가 없음`);
  return p;
}

// k개 자리를 n장 가운데 고르게 배치 (0번은 항상 포함)
function spreadSlots(k, n) {
  if (k <= 0) return [];
  if (k >= n) return Array.from({ length: n }, (_, i) => i);
  if (k === 2) return [0, Math.floor(n / 2)];
  return [...new Set(Array.from({ length: k }, (_, i) => Math.floor(i * n / k)))];
}

// ── 계획: 레이아웃·스타일·장식·사진 구성 정하기 ─────────────────
function planDraft(input = {}, profile = {}, { history = [], rand = Math.random } = {}) {
  const keyword = String(input.keyword || '').trim();
  if (!keyword) throw new Error('키워드를 넣어 주세요');
  // 이미지 방식: ai(AI 그림 1~2장 + 카드) · photos(내 사진 k장 + 카드) · cards(전부 글자 카드) · clinical(임상 사진만, 순서대로, 카드 없음)
  const imageMode = ['ai', 'photos', 'cards', 'clinical'].includes(input.imageMode) ? input.imageMode : 'ai';
  const isClinical = imageMode === 'clinical';
  const rawPhotos = Array.isArray(input.photos) ? input.photos.filter(Boolean) : [];
  if ((imageMode === 'photos' || isClinical) && !rawPhotos.length) throw new Error(isClinical ? '임상 사진 방식은 사진을 1장 이상 골라야 합니다' : '내 사진 방식은 사진을 1장 이상 골라야 합니다');
  const imageCount = isClinical ? Math.min(8, rawPhotos.length) : Math.min(6, Math.max(2, parseInt(input.imageCount, 10) || 4));
  const photos = imageMode === 'photos' || isClinical ? rawPhotos.slice(0, imageCount) : [];
  const aiCount = imageMode === 'cards' ? 0 : (imageMode === 'photos' || isClinical) ? photos.length : Math.min(2, Math.max(1, parseInt(input.aiCount, 10) || 1));
  const aiIndexes = spreadSlots(aiCount, imageCount);
  // 임상 증례: 레이아웃은 기본형 고정(카드 없음), 사진 단계 메모·분야·증례 메모를 함께 둔다
  if (isClinical) {
    const C = input.clinical && typeof input.clinical === 'object' ? input.clinical : {};
    const notes = (Array.isArray(C.photoNotes) ? C.photoNotes : []).slice(0, imageCount).map(x => ({ stage: clinical.STAGES.some(s => s.key === (x && x.stage)) ? x.stage : 'etc', note: String((x && x.note) || '').replace(/\s+/g, ' ').trim().slice(0, 200) }));
    const form = clinical.formOf(C.form || input.clinicalForm);   // 글 형태(증례 순서형·질문 답변형·판단 기준형) — 조합(preset)에서 오거나 직접 고름
    input = { ...input, layout: 'classic', cardTemplates: ['points'], clinical: { field: String(C.field || '').trim().slice(0, 40), caseNote: String(C.caseNote || '').replace(/\s+/g, ' ').trim().slice(0, 1000), photoNotes: notes, form } };
  }

  const want = Array.isArray(input.cardTemplates) && input.cardTemplates.length ? input.cardTemplates : null;
  if (want) {
    const bad = want.filter(t => !layouts.CARD_TEMPLATES.includes(t));
    if (bad.length) throw new Error(`알 수 없는 카드 템플릿: ${bad.join(', ')} (가능: ${layouts.CARD_TEMPLATES.join(', ')})`);
  }
  let layout = input.layout && input.layout !== 'auto' ? input.layout : null;
  if (layout && !layouts.LAYOUTS[layout]) throw new Error(`알 수 없는 레이아웃: ${layout} (가능: auto, ${layouts.LAYOUT_IDS.join(', ')})`);
  const layoutMode = layout ? 'fixed' : 'auto';
  if (!layout) layout = layouts.pickLayout(history, { rand, cardTemplates: want });
  const cardTemplates = layouts.allowedCards(layout, want);   // 필수 카드는 자동 추가
  const cardCount = imageCount - new Set(aiIndexes).size;
  const L = layouts.LAYOUTS[layout];
  if (L.requiredCard && cardCount < 1)
    throw new Error(`${L.label}은 ${L.requiredCard} 카드가 1장 이상 필요합니다. 사진 수를 늘리거나 AI 이미지 수를 줄여 주세요.`);

  let imageStyle = input.imageStyle && input.imageStyle !== 'auto' ? input.imageStyle : null;
  if (imageStyle && !styles.STYLES[imageStyle]) throw new Error(`알 수 없는 이미지 스타일: ${imageStyle} (가능: auto, ${styles.STYLE_IDS.join(', ')})`);
  const styleMode = imageStyle ? 'fixed' : 'auto';
  const styleCandidates = imageStyle ? [imageStyle] : styles.styleCandidates(history);

  const deco = DECO_MODES.includes(input.deco) ? input.deco : 'auto';
  const length = LENGTHS[input.length] ? input.length : '보통';
  const ct = parseInt(input.charTarget, 10);
  const charTarget = Number.isFinite(ct) ? Math.min(CHAR_MAX, Math.max(CHAR_MIN, ct)) : null;   // null = 예전 방식(줄 수)
  const charBasis = CHAR_BASES.includes(input.charBasis) ? input.charBasis : 'nospace';
  const tone = TONES[input.tone] ? input.tone : 'profile';
  const kwRepeat = KW_REPEATS[input.kwRepeat] ? input.kwRepeat : 'mid';
  const emphasis = EMPHASES[input.emphasis] ? input.emphasis : 'mid';
  let titleMode = TITLE_MODES[input.titleMode] ? input.titleMode : 'auto';
  const fixedTitle = String(input.fixedTitle || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (titleMode === 'fixed' && !fixedTitle) titleMode = 'auto';
  const qn = input.qaCount === 'auto' || input.qaCount == null || input.qaCount === '' ? null : parseInt(input.qaCount, 10);
  const qaCount = QA_COUNTS.includes(qn) ? qn : null;            // null = 2~3개
  const imageNotes = String(input.imageNotes || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  const subKeywords = [...new Set((Array.isArray(input.subKeywords) ? input.subKeywords : String(input.subKeywords || '').split(/[,，\n]/))
    .map(x => String(x || '').replace(/\s+/g, ' ').trim()).filter(x => x && x.length <= 30 && squash(x) !== squash(keyword)))].slice(0, 5);
  const variant = layouts.pickVariant(layout, history, rand);
  const recentTitles = history.slice(0, 5).map(h => h && h.title).filter(Boolean);
  // 고정 이미지(히든): 계정에 저장된 것을 서버가 절대 경로(path)와 함께 넘긴다. 본문 사진 번호 뒤에 번호가 붙는다
  const hiddenItems = hidden.normalize(input.hidden).map((h, i) => ({ ...h, path: String((Array.isArray(input.hidden) ? input.hidden[i] : {}).path || ''), index: imageCount + i }));
  return {
    hidden: hiddenItems,
    keyword, topic: String(input.topic || '').trim(), notes: String(input.notes || '').trim(),
    category: String(input.category || '').trim(),
    imageCount, aiCount, aiIndexes, cardTemplates, layout, layoutMode, imageMode, photos,
    clinical: isClinical ? input.clinical : null,
    imageStyle, styleMode, styleCandidates, deco, length, variant, recentTitles,
    charTarget, charBasis, tone, kwRepeat, emphasis, titleMode, fixedTitle, qaCount, subKeywords, imageNotes,
    preset: input.preset ? String(input.preset) : null,
  };
}

// ── 프롬프트 ─────────────────────────────────────────
const CARD_SHAPES = {
  points: '{"title":"카드 제목","items":[{"head":"핵심 한마디","body":"짧은 설명"}, … 3~5개]}  — 번호 붙은 핵심 정리',
  compare: '{"title":"카드 제목","left":{"label":"A","items":["…", … 2~5개]},"right":{"label":"B","items":["…", … 2~5개]}}  — 둘 비교(왼쪽·오른쪽 줄 수를 맞춘다)',
  checklist: '{"title":"카드 제목","items":["체크할 문장", … 3~6개]}  — 체크 항목',
  steps: '{"title":"카드 제목","steps":[{"head":"단계 이름","body":"짧은 설명"}, … 3~5개]}  — 순서/방법',
};

function decoRule(deco) {
  if (deco === 'off') return '본문에 장식 기호를 쓰지 않는다(✔ ▶ ✓ ※ 금지). 가운뎃점(·)은 "INFJ·INFP"처럼 단어를 잇는 데만 쓴다.';
  if (deco === 'rich') return '목록처럼 이어지는 줄의 맨 앞에 "✔ "를 적극 붙인다(글 전체 4~12줄). "▶ ", "✓ ", "※ "(주의 한 줄)도 줄 맨 앞에만 쓸 수 있다. 가운뎃점(·)은 단어 잇기에. 그 밖의 기호는 쓰지 않는다.';
  return '목록처럼 이어지는 줄의 맨 앞에만 가끔(글 전체 0~6줄) "✔ " 또는 "▶ "를 붙일 수 있다. "※ "는 주의 한 줄 맨 앞에만. 가운뎃점(·)은 단어 잇기에. 그 밖의 기호는 쓰지 않는다.';
}

function listText(v) {
  const arr = Array.isArray(v) ? v : String(v || '').split(/\r?\n/);
  return arr.map(x => String(x || '').replace(/^\s*[-·*•]\s*/, '').trim()).filter(Boolean).map(x => `  · ${x}`).join('\n');
}

function buildMessages(input, profile = {}, plan) {
  const P = plan || planDraft(input, profile);
  const L = layouts.LAYOUTS[P.layout];
  const persona = String(profile.persona || '').trim() || '30대 블로거. 친구에게 말하듯 담백한 반말 평서체(~다, ~더라).';
  const audience = String(profile.audience || '').trim() || '이 주제를 검색해서 들어온 20~30대';
  const rules = listText(profile.rules);
  const aiWord = P.imageMode === 'photos' ? 'ai (블로그 주인이 올린 사진 자리)' : P.imageMode === 'clinical' ? 'ai (임상 사진 자리)' : 'ai';
  const H = Array.isArray(P.hidden) ? P.hidden : [];
  const kinds = [...Array.from({ length: P.imageCount }, (_, i) => `  ${i}번: ${P.aiIndexes.includes(i) ? (i === 0 && P.imageMode === 'ai' ? 'ai (대표 이미지)' : aiWord) : 'card'}`),
    ...H.map((h, i) => `  ${P.imageCount + i}번: hidden (고정 이미지 · ${hidden.describe(h)})`)].join('\n');
  const cardCount = P.imageCount - new Set(P.aiIndexes).size;
  const totalImages = P.imageCount + H.length;
  const cats = Array.isArray(profile.categories) ? profile.categories.filter(Boolean) : [];

  const styleBlock = P.styleMode === 'auto'
    ? [
      '# 이미지 스타일 (imageStyle)',
      '- AI 이미지 화풍을 아래 후보 중 글 주제·분위기에 가장 맞는 하나로 골라 "imageStyle"에 id를 적는다.',
      ...P.styleCandidates.map(id => `  ${id}: ${styles.STYLES[id].label} — ${styles.STYLES[id].desc}`),
    ].join('\n')
    : `# 이미지 스타일\n- 화풍은 "${P.imageStyle}"(${styles.STYLES[P.imageStyle].label})로 정해져 있다. "imageStyle"에 "${P.imageStyle}"를 적는다.`;

  const categoryBlock = P.category
    ? `# 카테고리\n- "category"는 "${P.category}" 그대로.`
    : cats.length
      ? `# 카테고리\n- "category"는 다음 중 글에 가장 맞는 하나를 글자 그대로: ${cats.map(c => `"${c}"`).join(', ')}`
      : '# 카테고리\n- "category"는 빈 문자열 "".';

  const system = `너는 네이버 블로그 「${profile.blogName || profile.blogId || '블로그'}」의 글을 직접 쓰는 사람이다.
사람이 쓴 것처럼 자연스러운 블로그 글 한 편을 JSON 객체 하나로 돌려준다.

# 화자와 독자
- 화자·말투: ${persona}
- 독자: ${audience}
- 처음부터 끝까지 같은 화자, 같은 어미를 유지한다. 존댓말과 반말을 섞지 않는다.${TONE_RULE[P.tone] ? `\n- 말투 지정(화자 설명보다 우선): ${TONE_RULE[P.tone]}` : ''}
- 정보를 나열하지 말고 화자의 시선으로 쓴다. 화자가 겪었을 법한 장면, 짧은 대사, 속마음을 섞는다.
- 독자에게 말을 걸 때도 화자의 말투 그대로. 가르치려 들지 않는다.${rules ? `\n- 블로그 고유 규칙(반드시 지킴):\n${rules}` : ''}

${String(profile.prompt || '').trim() ? `# 블로그 주인이 적은 원고 프롬프트 — 아래 지시를 그대로 반영한다. 단, 이 문서의 "내용 원칙"·의료광고 규칙·출력 형식과 어긋나는 부분은 그쪽이 우선한다.
${String(profile.prompt).trim().slice(0, 4000)}

` : ''}# 출력 형식 — 설명·코드블록 없이 JSON 객체 하나만
{
  "title": "글 제목",
  "category": "카테고리",
  "imageStyle": "스타일 id",
  "tags": ["태그", …],
  "blocks": [ …블록… ],
  "images": [ …이미지… ]
}
블록은 아래 6가지 모양만 쓴다.
  {"quote":"인용구 한 줄"}  {"text":["줄","","줄"]}  {"img":0}  {"line":true}  {"link":true}  {"hashtags":true}

# 본문 줄 규칙 — 이 원고는 입력 프로그램이 네이버 에디터에 한 줄씩 그대로 타이핑한다
- 본문은 가운데 정렬로 올라간다. text 배열의 원소 하나가 화면의 한 줄이다.
- 한 줄은 15~28자(공백 포함). 30자를 넘기지 않는다. 긴 문장은 의미가 끊기는 자리에서 다음 원소로 넘긴다.
- 2~4줄마다 빈 줄("")을 넣어 문단을 나눈다. 빈 줄을 연달아 두 번 쓰지 않는다. text 배열은 빈 줄로 시작하거나 끝나지 않는다.
- "## "로 시작하는 줄은 소주제(크고 굵게 보임). 소주제 줄은 25자 이내이고 그 안에 ** 를 쓰지 않는다.
- **굵게**: 꼭 기억할 한 구절에만. 한 문단에 많아야 1번, 글 전체 ${EMPHASES[P.emphasis].bold.join('~')}번. ** 안에 * 를 넣지 않는다.
- 형광펜 [[글자|#색]]: 1~10자 짧은 단어에만, 글 전체 ${EMPHASES[P.emphasis].hl.join('~')}번. 색은 ${PALETTE.map(c => `${c}(${PALETTE_NAMES[c]})`).join(' ')} 여섯 가지만 쓴다. 같은 대상에는 늘 같은 색. 굵게와 형광펜을 겹치지 않는다.
- 줄을 "- ", "* ", "> ", "#"(소주제의 "## " 제외), "[", "---", "1) " 로 시작하지 않는다. 번호가 필요하면 "## 1. 소주제" 모양으로만.
- 인용구(quote)는 10~30자 한 줄. 인용구 안에는 **, [[ ]], 기호를 쓰지 않는다.
- 기호: ${decoRule(P.deco)}
- 이모지, ★ ♥ ♡ → ■ ● ◆ 같은 특수기호, 마크다운 표·링크·URL은 쓰지 않는다.

# 블록 이어붙이기 규칙(입력 프로그램이 이 순서만 안정적으로 친다)
- 맨 앞은 인용구(키워드가 든 제목형 문구), 그다음은 도입 본문.
- 구분선(line) 바로 다음은 반드시 인용구.
- 사진(img)은 인용구나 본문 바로 다음에 오고, 사진 바로 다음은 반드시 본문.
- 본문(text) 블록 둘을 연달아 두지 않는다(하나로 합친다).
- img 블록은 {"img":0}부터 {"img":${P.imageCount - 1}}까지 순서대로 한 번씩만.${H.length ? ` 고정 이미지 ${P.imageCount}~${totalImages - 1}번은 아래 "고정 이미지" 자리에 한 번씩.` : ''}
- 맨 끝은 정확히 {"link":true}, {"hashtags":true} 순서.

${P.imageMode === 'clinical' ? clinical.prompt(P) : layouts.layoutPrompt(P.layout, P.imageCount)}${H.length ? `

${hidden.promptBlock(P)}` : ''}

# 도입
- 도입 첫 문장은 이렇게 연다: ${P.variant.intro}.
- 도입 6~12줄 안에서 이 글을 읽으면 무엇이 정리되는지 분명히 한다.
- "오늘은 ~에 대해 알아보겠습니다" 같은 예고문으로 시작하지 않는다.

# 정리 섹션
- 마지막 구분선 다음 인용구 글자는 정확히 "${P.variant.closingHeading}".
${P.qaCount === 0
    ? '- 이 글은 정리 섹션에 Q&A를 쓰지 않는다(위 순서 예시의 "## Q." 줄은 무시). 대신 본문 핵심을 3~6줄로 짧게 다시 정리한다. "## " 소제목도 쓰지 않는다.'
    : `- 이어지는 본문은 Q&A ${P.qaCount ? '정확히 ' + P.qaCount : '2~3'}개: "## Q. 질문?" 줄 다음에 1~3줄 답. 질문은 독자가 검색할 법한 말, 답은 본문과 어긋나지 않게 결론부터.`}
- ${P.qaCount === 0 ? '정리' : 'Q&A'} 뒤에 화자다운 마무리 1~3줄. 댓글을 가볍게 권해도 된다. 다음 글 내용을 약속하지 않는다.

# 키워드
- 키워드: "${P.keyword}"
- 제목 앞쪽 15자 안에 키워드를 띄어쓰기까지 그대로 넣는다. 첫 인용구에도 넣는다.
- 본문(소주제·Q&A 포함)에 키워드를 그대로 ${KW_REPEATS[P.kwRepeat].range.join('~')}번 자연스럽게 넣는다. 한 문단에 몰거나 억지로 반복하지 않는다.
- 연관 표현(세부 유형, 자주 묻는 말, 비슷한 말)을 소주제와 Q&A에 섞는다.${P.subKeywords.length ? `\n- 보조 키워드: ${P.subKeywords.map(k => `"${k}"`).join(', ')} — 각각 본문에 그대로 1~2번씩 넣고, 태그에도 붙여 쓴 형태로 넣는다.` : ''}

# 제목
${P.titleMode === 'fixed' ? `- 제목은 정해져 있다. "title"에 "${P.fixedTitle.replace(/"/g, "'")}"를 글자 그대로 적고, 본문은 이 제목에 맞춰 쓴다.` : `- 25~45자. ${TITLE_MODES[P.titleMode].rule}`}
- "충격", "모르면 손해", "꼭 보세요", 물음표·느낌표 남발 같은 낚시·과장 표현 금지.

# 내용 원칙 — 반드시 지킨다
- 지어낸 통계·퍼센트·순위·연구·논문·설문·전문가 발언·유명인 인용·독자 후기를 쓰지 않는다. "연구에 따르면", "통계적으로", "~%의 사람" 금지.
- 확인되지 않은 사실을 단정하지 않는다. 성격·심리 이야기는 경향("~한 편이다", "~할 때가 많다")으로 쓰고 사람을 낙인찍지 않는다.
- 건강·의료·약·다이어트·돈·투자·수익 효과를 단정하거나 보장하지 않는다("완치", "무조건", "100%", "반드시 효과", "수익 보장" 금지). 필요하면 "개인차가 있으니 전문가와 상의"를 한 줄로만.
- 과장 광고 문구, 특정 업체·제품·브랜드 홍보를 하지 않는다.
- 다른 블로그·기사 문장을 옮기지 않는다. 전부 화자의 말로 새로 쓴다.
- AI 티 나는 말 금지: "결론적으로", "요약하자면", "~에 대해 알아보겠습니다", "살펴보겠습니다", "여러분", "~하는 것이 중요합니다", "다양한", "도움이 되셨길 바랍니다", "마무리하며", "이처럼", "뿐만 아니라", "~라고 할 수 있습니다".
- 같은 어미를 세 줄 연속 반복하지 않는다. 추상어 나열 대신 장면·예시·대사 하나로 보여 준다.

${styleBlock}

# 이미지 (images 배열, 정확히 ${totalImages}장${H.length ? ` = 본문 사진 ${P.imageCount} + 고정 이미지 ${H.length}` : ''})
- 종류는 아래 순서 그대로:
${kinds}${H.length ? '\n- hidden: {"kind":"hidden"} 만 적는다(파일은 프로그램이 넣는다).' : ''}
- ai: {"kind":"ai","prompt":"장면 묘사","alt":"사진 설명(한국어 30자 이내)"}
  · prompt는 이미지 모델에 줄 장면 묘사 1~3문장(한국어 가능). 무엇이 어디에 어떤 분위기로 있는지 구체적으로. 한국의 일상 공간이어도 좋다.
  · 그림 속 글자·간판·말풍선 글씨·숫자·로고·워터마크·브랜드·실존 인물·유명인을 넣지 않는다. 사람은 뒷모습·손·실루엣 정도로만.
  · 화풍(사진/일러스트 등)은 적지 않는다. 화풍은 프로그램이 imageStyle로 붙인다.
  · ${P.imageMode === 'photos' ? '이 글의 ai 자리에는 블로그 주인이 직접 찍은 사진이 들어간다. prompt에는 그 자리에 어울릴 사진 설명을 한 줄로 적기만 하면 된다(그림을 그리지 않음). 본문에서 "아래 사진처럼"같이 사진을 가리키는 말은 쓰지 않는다.' : P.imageMode === 'clinical' ? '이 글의 ai 자리에는 치과에서 찍은 임상 사진이 순서대로 들어간다. prompt에는 그 사진의 단계·내용을 한 줄로 적기만 하면 된다(그림을 그리지 않음). 본문에서 "위 사진은 ~"처럼 사진을 가리켜도 된다.' : '0번 대표 이미지는 글 주제를 한눈에 보여 주는 장면.'}${P.imageNotes ? `
  · 그림 참고(블로그 주인이 적음, 장면 묘사에 반드시 반영): ${P.imageNotes.replace(/"/g, "'")}` : ''}
${cardCount ? `- card(${cardCount}장): 글자가 정확히 들어가는 정리 카드. {"kind":"card","template":"…","alt":"카드 설명","data":{…}}
  · 쓸 수 있는 template은 이것뿐: ${P.cardTemplates.join(', ')}
${P.cardTemplates.map(t => `    ${t}: ${CARD_SHAPES[t]}`).join('\n')}
  · 글자 수: title 20자 이내, head 14자 이내, body 40자 이내, checklist 문장 30자 이내, compare label 10자 이내·items 20자 이내.
  · 카드 내용은 그 카드가 놓인 섹션 본문과 맞아야 한다. 본문 문장을 통째로 복사하지 말고 짧게 압축한다.
  · 카드끼리는 되도록 다른 template을 쓴다.${L.requiredCard ? ` 이 레이아웃은 ${L.requiredCard} 카드가 최소 1장 꼭 있어야 한다.` : ''}
  · 카드 글자에는 기호·이모지·번호 원문자를 넣지 않는다(장식은 카드 템플릿이 그린다). 지어낸 수치도 금지.` : '- 이 글에는 card가 없다. images는 전부 ai.'}

${GEO_RULES}

# 태그
- 5~10개. 띄어쓰기 없이, # 없이. 키워드를 붙여 쓴 형태 1개 + 세부 키워드·연관어. 중복 금지.

${categoryBlock}`;

  const user = [
    '아래 조건으로 글 한 편을 써서 JSON으로만 답해 줘.',
    `- 키워드: ${P.keyword}`,
    `- 주제: ${P.topic || P.keyword}`,
    P.notes ? `- 메모(꼭 반영): ${P.notes}` : '',
    !P.charTarget ? `- 분량: ${P.length} (본문 글줄 합계 ${LENGTHS[P.length].join('~')}줄, 빈 줄 제외)` : `- 분량: 본문 글자 수 약 ${P.charTarget}자(${P.charBasis === 'space' ? '공백 포함' : '공백 제외'}, 제목·태그 제외, 인용구·소주제·본문 모두 포함). 허용 범위 ${Math.round(P.charTarget * (1 - CHAR_TOL))}~${Math.round(P.charTarget * (1 + CHAR_TOL))}자. 한 줄 평균 ${P.charBasis === 'space' ? '약 15자' : '약 12자'}이므로 빈 줄 뺀 본문 줄 수는 대략 ${targetLines(P)}줄.`,
    P.subKeywords.length ? `- 보조 키워드: ${P.subKeywords.join(', ')}` : '',
    `- 레이아웃: ${L.label} (${L.desc})`,
    `- 사진: ${P.imageCount}장 (${P.imageMode === 'cards' ? '전부 글자 카드' : P.imageMode === 'clinical' ? `임상 사진 ${P.imageCount}장, 카드 없음` : `${P.imageMode === 'photos' ? '내 사진' : 'AI'} ${new Set(P.aiIndexes).size}장 + 카드 ${cardCount}장`})${H.length ? ` + 고정 이미지 ${H.length}장(${H.map(hidden.describe).join(', ')})` : ''}`,
    P.imageMode === 'clinical' && P.clinical && P.clinical.field ? `- 진료 분야: ${P.clinical.field}` : '',
    P.recentTitles.length ? `- 이 블로그 최근 글 제목(제목·도입 문장이 비슷해지지 않게):\n${P.recentTitles.map(t => `  · ${t}`).join('\n')}` : '',
  ].filter(Boolean).join('\n');
  return { system, user };
}

// ── 다듬기: 모델 응답 → draft ─────────────────────────────
// 줄을 단어 단위(굵게 표시 유지)로 쪼개 MAX_LINE 안으로 다시 묶는다
function wrapLine(line) {
  if (line.startsWith('## ') || len(plainOf(line)) <= MAX_LINE) return [line];
  const segs = [];
  for (const part of line.split(TOKEN).filter(Boolean)) {
    const hl = part.match(/^\[\[([^\]|]+)\|(#[0-9a-fA-F]{6})\]\]$/);
    const bo = part.match(/^\*\*([^*]+)\*\*$/);
    if (hl) segs.push({ t: hl[1], hl: hl[2] });
    else for (const w of (bo ? bo[1] : part).split(/( +)/)) if (w) segs.push(/^ +$/.test(w) ? { sp: true } : { t: w, b: !!bo });
  }
  // 단어(공백 사이 묶음)
  const units = [[]];
  for (const s of segs) { if (s.sp) { if (units[units.length - 1].length) units.push([]); } else units[units.length - 1].push(s); }
  if (!units[units.length - 1].length) units.pop();
  const ulen = u => u.reduce((a, s) => a + len(s.t), 0);
  const total = units.reduce((a, u) => a + ulen(u), 0) + units.length - 1;
  const parts = Math.ceil(total / 26), target = total / parts;
  const lines = [[]]; let cur = 0;
  for (const u of units) {
    const L = ulen(u);
    if (lines[lines.length - 1].length && (cur + 1 + L > target + 3 || cur + 1 + L > MAX_LINE)) { lines.push([]); cur = 0; }
    cur += (lines[lines.length - 1].length ? 1 : 0) + L;
    lines[lines.length - 1].push(u);
  }
  const render = us => {
    const flat = [];
    us.forEach((u, i) => { if (i) flat.push({ t: ' ', space: true }); flat.push(...u); });
    flat.forEach((s, i) => { if (s.space) s.b = !!(flat[i - 1] && flat[i - 1].b && flat[i + 1] && flat[i + 1].b); });
    let out = '', run = '', bold = false;
    const end = () => { if (run) out += bold ? `**${run}**` : run; run = ''; };
    for (const s of flat) {
      if (s.hl) { end(); out += `[[${s.t}|${s.hl.toLowerCase()}]]`; continue; }
      if (!!s.b !== bold) { end(); bold = !!s.b; }
      run += s.t;
    }
    end();
    return out;
  };
  return lines.map(render);
}

function cleanLine(raw, deco) {
  let l = String(raw ?? '').replace(/[\t ​]/g, ' ').replace(/\s+/g, ' ').trim();
  l = l.replace(/^#{1,6}\s*(?=\S)/, m => '## ');
  l = l.replace(/^(?:[-*•]|\d+\))\s+/, deco === 'off' ? '' : (deco === 'rich' ? '✔ ' : ''));
  l = l.replace(/\[\[([^\]|]+)\|(#[0-9a-fA-F]{6})\]\]/g, (_, w, c) => `[[${w.trim()}|${c.toLowerCase()}]]`);
  return l;
}

function cleanText(lines, deco) {
  const out = [];
  for (const raw of Array.isArray(lines) ? lines : String(lines || '').split('\n')) {
    const l = cleanLine(raw, deco);
    if (!l) { if (out.length && out[out.length - 1] !== '') out.push(''); continue; }
    out.push(...wrapLine(l));
  }
  while (out.length && out[0] === '') out.shift();
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

function cleanBlock(b, deco) {
  if (!b || typeof b !== 'object') return null;
  const type = b.type;
  // style: 인용구·구분선 한 칸만 다른 편집기 스타일(naver_post\styles.js 키·이름). 없으면 글 전체 기본
  const st = typeof b.style === 'string' && b.style.trim() ? { style: b.style.trim() } : {};
  if (b.quote !== undefined || type === 'quote') return { quote: String(b.quote ?? b.text ?? '').replace(/\s+/g, ' ').trim(), ...st };
  if (b.img !== undefined || type === 'img' || type === 'image') return { img: Number(b.img ?? b.index) };
  if (b.line || type === 'line') return { line: true, ...st };
  if (b.link || type === 'link') return { link: true };
  if (b.hashtags || type === 'hashtags') return { hashtags: true };
  if (b.text !== undefined || type === 'text') return { text: cleanText(b.text ?? b.lines, deco) };
  return { unknown: JSON.stringify(b).slice(0, 60) };
}

function cleanTags(tags) {
  const seen = new Set(), out = [];
  for (const t of Array.isArray(tags) ? tags : String(tags || '').split(/[,，]/)) {
    const v = String(t || '').replace(/^#+/, '').replace(/[\s,，#]+/g, '').trim();
    if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); out.push(v); }
  }
  return out;
}

function imageFile(i, im) {
  const n = String(i + 1).padStart(2, '0');
  if (im.kind === 'ai') return `${n}_${i === 0 ? '대표' : '그림'}.png`;
  return `${n}_${CARD_FILE[im.template] || '카드'}.png`;
}

// 글 끝 링크 구성: … 마무리 본문 → [## 함께 보면 좋은 글 / 제목1] → 링크1 → [제목2] → 링크2 → [안내 한 줄] → 홈페이지 링크(또는 블로그 홈) → 해시태그
//   links = { related: [{ title, url }], homepage: 'https://…', label: '치과 홈페이지' }
const URL_RE = /^https?:\/\/[^\s"'<>]+$/;
function appendLinks(blocks, links) {
  if (!links || typeof links !== 'object') return blocks;
  const related = (Array.isArray(links.related) ? links.related : []).filter(x => x && URL_RE.test(String(x.url || '')) && String(x.title || '').trim()).slice(0, 2);
  const homepage = URL_RE.test(String(links.homepage || '')) ? String(links.homepage) : null;
  if (!related.length && !homepage) return blocks;
  const body = blocks.filter(b => !b.link && !b.hashtags);
  const tail = [];
  related.forEach((r, i) => {
    tail.push({ text: i === 0 ? ['## 함께 보면 좋은 글', String(r.title).replace(/\s+/g, ' ').trim().slice(0, 60)] : [String(r.title).replace(/\s+/g, ' ').trim().slice(0, 60)] });
    tail.push({ link: r.url });
  });
  if (homepage) { tail.push({ text: [String(links.label || '홈페이지').replace(/\s+/g, ' ').trim().slice(0, 30)] }); tail.push({ link: homepage }); }
  else { tail.push({ text: ['더 많은 글은 블로그 홈에서'] }); tail.push({ link: true }); }
  tail.push({ hashtags: true });
  // 마지막 본문과 꼬리 첫 본문이 붙지 않게: 꼬리 첫 블록이 text면 바로 앞 본문에 빈 줄로 이어 붙인다
  const last = body[body.length - 1];
  if (last && last.text && tail[0].text) { last.text.push('', ...tail[0].text); tail.shift(); }
  return [...body, ...tail];
}

function normalizeDraft(raw, P, { input = {}, profile = {}, model, rand = Math.random } = {}) {
  raw = raw && typeof raw === 'object' ? raw : {};
  let blocks = (Array.isArray(raw.blocks) ? raw.blocks : []).map(b => cleanBlock(b, P.deco)).filter(Boolean);
  // 빈 본문 빼고, 이어진 본문은 하나로
  const merged = [];
  for (const b of blocks) {
    if (b.text && !b.text.length) continue;
    const prev = merged[merged.length - 1];
    if (b.text && prev && prev.text) prev.text.push('', ...b.text);
    else merged.push(b);
  }
  blocks = merged;
  // 끝 [링크] → [해시태그] 맞추기
  blocks = blocks.filter((b, i) => !((b.link || b.hashtags) && i < blocks.length - 2));
  if (!blocks.some(b => b.link)) blocks.splice(blocks.findIndex(b => b.hashtags) >= 0 ? blocks.findIndex(b => b.hashtags) : blocks.length, 0, { link: true });
  if (!blocks.some(b => b.hashtags)) blocks.push({ hashtags: true });
  const li = blocks.findIndex(b => b.link), hi = blocks.findIndex(b => b.hashtags);
  if (hi < li) { const [h] = blocks.splice(hi, 1); blocks.push(h); }
  // 링크 꼬리(input.links): 관련 글 내부 링크 + 홈페이지(없으면 블로그 홈). 주소는 서버가 실제 글 목록에서 고른 것만 쓴다(모델이 지어낸 주소 금지).
  blocks = appendLinks(blocks, input.links);

  let imageStyle = P.styleMode === 'fixed' ? P.imageStyle : raw.imageStyle;
  if (!P.styleCandidates.includes(imageStyle)) imageStyle = P.styleCandidates[Math.floor(rand() * P.styleCandidates.length) % P.styleCandidates.length];

  const H = Array.isArray(P.hidden) ? P.hidden : [];
  const images = (Array.isArray(raw.images) ? raw.images : []).slice(0, P.imageCount).map((im, i) => {
    im = im && typeof im === 'object' ? im : {};
    const kind = im.kind === 'ai' || (!im.template && (im.prompt || im.scene)) ? 'ai' : 'card';
    const out = { kind, alt: String(im.alt || '').trim() };
    if (kind === 'ai') {
      out.scene = String(im.scene || im.prompt || '').trim();
      try { out.prompt = styles.buildImagePrompt(out.scene, imageStyle, { color: profile.color, role: i === 0 ? 'header' : 'body' }); } catch { out.prompt = ''; }
    } else {
      out.template = String(im.template || '').trim();
      out.data = im.data && typeof im.data === 'object' ? im.data : {};
    }
    out.file = imageFile(i, out);
    return out;
  });
  // 고정 이미지(히든)는 모델 출력과 상관없이 계획대로 붙인다(파일·자리는 프로그램이 정한다)
  H.forEach((h, k) => {
    const i = P.imageCount + k, ext = (require('path').extname(h.file || '').toLowerCase() || '.png').replace('.jpeg', '.jpg');
    images[i] = { kind: 'hidden', slot: h.slot, label: h.label || '', alt: h.caption || hidden.describe(h), caption: h.caption || '', file: `${String(i + 1).padStart(2, '0')}_히든${ext}`, source: h.file, src: h.path || '' };
  });

  const category = P.category || String(raw.category || '').trim();
  return {
    title: P.titleMode === 'fixed' ? P.fixedTitle : String(raw.title || '').replace(/\s+/g, ' ').trim(),
    category,
    tags: cleanTags(raw.tags),
    blocks,
    images,
    keyword: P.keyword,
    layout: P.layout, layoutMode: P.layoutMode,
    imageStyle, styleMode: P.styleMode,
    deco: P.deco, length: P.length, variant: P.variant,
    charTarget: P.charTarget, charBasis: P.charBasis, tone: P.tone, kwRepeat: P.kwRepeat, emphasis: P.emphasis,
    titleMode: P.titleMode, qaCount: P.qaCount, subKeywords: P.subKeywords, imageNotes: P.imageNotes,
    cardTemplates: P.cardTemplates, aiCount: P.aiCount, aiIndexes: P.aiIndexes, imageMode: P.imageMode,
    clinical: P.clinical || null,
    hidden: H.map(h => ({ slot: h.slot, file: h.file, caption: h.caption, label: h.label || '' })),
    preset: P.preset,
    input: { ...input },
    model: model || null,
    createdAt: new Date().toISOString(),
  };
}

// 수정 요청 때 모델에게 다시 보여 줄 모양(요청 스키마 그대로)
function toModelJSON(d) {
  return {
    title: d.title, category: d.category, imageStyle: d.imageStyle, tags: d.tags, blocks: d.blocks,
    images: d.images.map(im => im.kind === 'ai' ? { kind: 'ai', prompt: im.scene, alt: im.alt } : im.kind === 'hidden' ? { kind: 'hidden' } : { kind: 'card', template: im.template, alt: im.alt, data: im.data }),
  };
}

// ── 검사 ───────────────────────────────────────────
function checkCard(template, data) {
  const p = [];
  const s = (v, max, name) => {
    if (typeof v !== 'string' || !v.trim()) p.push(`${name} 비어 있음`);
    else if (len(v) > max) p.push(`${name} ${len(v)}자(최대 ${max}자)`);
    else if (badChars(v).length) p.push(`${name}에 쓰면 안 되는 기호: ${badChars(v).join(' ')}`);
  };
  const arr = (v, lo, hi, name) => { if (!Array.isArray(v) || v.length < lo || v.length > hi) { p.push(`${name}는 ${lo}~${hi}개여야 함(지금 ${Array.isArray(v) ? v.length : 0}개)`); return false; } return true; };
  if (!data || typeof data !== 'object') return ['data 없음'];
  s(data.title, 24, 'title');
  if (template === 'points' || template === 'steps') {
    const key = template === 'points' ? 'items' : 'steps';
    if (arr(data[key], 3, 5, key)) data[key].forEach((it, i) => { s(it && it.head, 18, `${key}[${i}].head`); s(it && it.body, 60, `${key}[${i}].body`); });
  } else if (template === 'checklist') {
    if (arr(data.items, 3, 6, 'items')) data.items.forEach((it, i) => s(it, 40, `items[${i}]`));
  } else if (template === 'compare') {
    for (const side of ['left', 'right']) {
      const v = data[side];
      if (!v || typeof v !== 'object') { p.push(`${side} 없음`); continue; }
      s(v.label, 14, `${side}.label`);
      if (arr(v.items, 2, 5, `${side}.items`)) v.items.forEach((it, i) => s(it, 30, `${side}.items[${i}]`));
    }
  } else p.push(`알 수 없는 템플릿 ${template}`);
  return p;
}

// 허용 안 되는 글자(이모지·특수기호)
function badChars(s) {
  const bad = new Set();
  for (const ch of String(s)) if (!OK_CHAR.test(ch) && !DECO_SYMBOLS.includes(ch)) bad.add(ch);
  return [...bad];
}

function validateDraft(d, { profile } = {}) {
  const p = [];
  if (!d || typeof d !== 'object') return ['원고가 비어 있음'];
  const B = Array.isArray(d.blocks) ? d.blocks : [];
  const I = Array.isArray(d.images) ? d.images : [];
  const kw = d.keyword || (d.input && d.input.keyword) || '';
  const deco = DECO_MODES.includes(d.deco) ? d.deco : 'auto';

  // 제목·카테고리·태그
  if (!d.title) p.push('제목이 비어 있음');
  else {
    if (/[\n\r]/.test(d.title)) p.push('제목에 줄바꿈이 있음');
    if (len(d.title) > 60) p.push(`제목이 너무 김(${len(d.title)}자, 60자 이내)`);
    const at = squash(d.title).indexOf(squash(kw));
    if (d.titleMode !== 'fixed') {
      if (kw && at < 0) p.push(`제목에 키워드 "${kw}"가 없음`);
      else if (kw && at > 15) p.push(`키워드 "${kw}"를 제목 앞쪽(15자 안)으로`);
      if (d.titleMode === 'keyword' && !/\|/.test(d.title)) p.push('제목이 "키워드 | 부제" 모양이 아님');
      if (d.titleMode === 'question' && !/\?$/.test(d.title.trim())) p.push('질문형 제목은 물음표로 끝나야 함');
    }
  }
  const cats = profile && Array.isArray(profile.categories) ? profile.categories.filter(Boolean) : [];
  if (!(d.input && d.input.category) && cats.length && !cats.includes(d.category)) p.push(`카테고리 "${d.category}"는 목록에 없음(${cats.join(', ')} 중 하나)`);
  const tags = Array.isArray(d.tags) ? d.tags : [];
  if (tags.length < 5 || tags.length > 10) p.push(`태그는 5~10개(지금 ${tags.length}개)`);
  for (const t of tags) {
    if (/[\s,#]/.test(t)) p.push(`태그 "${t}"에 공백·쉼표·#이 있음`);
    if (len(t) > 25) p.push(`태그 "${t}"가 너무 김`);
  }

  // 블록 순서
  if (!B.length) p.push('본문 블록이 없음');
  if (B[0] && B[0].quote === undefined) p.push('첫 블록은 인용구(키워드 제목)여야 함');
  else if (B[0] && kw && !squash(B[0].quote).includes(squash(kw))) p.push(`첫 인용구에 키워드 "${kw}"가 없음`);
  // 인용구 제목 바로 뒤에 요약 인용구가 오는 구성(치과 기준 글)도 허용 — 두 번째 인용구 뒤에는 본문이 와야 한다
  if (B[1] && !B[1].text && B[1].quote === undefined) p.push('첫 인용구 다음은 도입 본문이나 요약 인용구여야 함');
  const n = B.length;
  if (n < 2 || !B[n - 2].link || !B[n - 1].hashtags) p.push('끝은 [링크] → [해시태그] 순서여야 함');
  const isHiddenImg = b => b && b.img !== undefined && I[b.img] && I[b.img].kind === 'hidden';
  B.forEach((b, i) => {
    const prev = B[i - 1], next = B[i + 1];
    if (b.unknown) p.push(`알 수 없는 블록: ${b.unknown}`);
    // 구분선 다음은 인용구. 고정(히든) 이미지가 바로 오는 것도 허용(원장 소개 사진 자리)
    if (b.line && !(next && (next.quote !== undefined || isHiddenImg(next)))) p.push(`${i + 1}번째 블록: 구분선 다음은 인용구여야 함`);
    if (b.img !== undefined) {
      if (!(prev && (prev.quote !== undefined || prev.text || (prev.line && isHiddenImg(b))))) p.push(`사진 ${b.img + 1}: 인용구나 본문 다음에 와야 함`);
      if (!(next && next.text)) p.push(`사진 ${b.img + 1}: 바로 다음에 본문이 와야 함`);
    }
    // 인용구 다음은 본문·사진. 첫 인용구(제목) 바로 뒤의 인용구(요약)만 예외
    if (b.quote !== undefined && !(next && (next.text || next.img !== undefined || (i === 0 && next.quote !== undefined)))) p.push(`인용구 "${b.quote}" 다음엔 본문이나 사진이 와야 함`);
    if (b.text && prev && prev.text) p.push(`${i + 1}번째 블록: 본문 두 개가 연달아 있음`);
    if (b.link && !(prev && prev.text)) p.push('[링크] 앞에는 본문이 있어야 함');
  });

  // 사진 블록 ↔ images  (고정 이미지(히든)는 본문 사진 번호 뒤에 붙고, 자리 규칙은 따로 본다)
  const hiddenIdx = new Set(I.map((im, i) => im.kind === 'hidden' ? i : -1).filter(i => i >= 0));
  const Im = I.filter((im, i) => !hiddenIdx.has(i));
  const Bm = B.filter(b => !(b.img !== undefined && hiddenIdx.has(b.img)));
  const imgSeq = Bm.filter(b => b.img !== undefined).map(b => b.img);
  if (imgSeq.length !== Im.length || imgSeq.some((v, i) => v !== i)) p.push(`사진 블록은 0~${Im.length - 1}번을 순서대로 한 번씩(지금 ${imgSeq.join(',') || '없음'})`);
  for (const k of hiddenIdx) {
    const c = B.filter(b => b.img === k).length;
    if (c !== 1) p.push(`고정 이미지 ${k}번({"img":${k}})은 정해진 자리에 정확히 한 번 있어야 함(지금 ${c}번)`);
  }
  if (hiddenIdx.size && [...hiddenIdx].some(k => k < Im.length)) p.push('고정 이미지 번호는 본문 사진 번호 뒤여야 함');
  const aiIdx = Array.isArray(d.aiIndexes) ? d.aiIndexes : [0];
  const isClinical = d.imageMode === 'clinical';
  const wantN = isClinical ? (Array.isArray(d.input && d.input.photos) ? Math.min(8, d.input.photos.length) : null) : d.input && d.input.imageCount ? Math.min(6, Math.max(2, parseInt(d.input.imageCount, 10) || 4)) : null;
  if (wantN && Im.length !== wantN) p.push(`images는 ${wantN}장이어야 함(지금 ${Im.length}장)`);
  if (isClinical ? (Im.length < 1 || Im.length > 8) : (Im.length < 2 || Im.length > 6)) p.push(isClinical ? '임상 사진은 1~8장' : '사진은 2~6장');
  if (isClinical) p.push(...clinical.validate({ ...d, blocks: Bm, images: Im }));
  const allowed = Array.isArray(d.cardTemplates) && d.cardTemplates.length ? d.cardTemplates : layouts.CARD_TEMPLATES;
  const extV = cardValidator();
  I.forEach((im, i) => {
    if (hiddenIdx.has(i)) { if (!im.file) p.push(`images[${i}] 고정 이미지 파일이 없음`); return; }
    const wantAi = aiIdx.includes(i);
    if (wantAi && im.kind !== 'ai') p.push(`images[${i}]는 ai 이미지여야 함`);
    if (!wantAi && im.kind !== 'card') p.push(`images[${i}]는 card여야 함`);
    if (im.kind === 'ai') {
      if (!im.scene) p.push(`images[${i}] ai 장면 묘사(prompt)가 비어 있음`);
    } else if (im.kind === 'card') {
      if (!allowed.includes(im.template)) p.push(`images[${i}] 카드 템플릿 "${im.template}"은 쓸 수 없음(${allowed.join(', ')} 중)`);
      else {
        const cp = checkCard(im.template, im.data);
        if (extV) try { for (const x of extV(im.template, im.data) || []) if (!cp.includes(x)) cp.push(x); } catch { }
        cp.forEach(x => p.push(`images[${i}] ${im.template} 카드: ${x}`));
      }
    }
  });

  // 줄 검사
  let bolds = 0, hls = 0, decoLines = 0, bodyLines = 0;
  const textAll = [];
  for (const b of B) {
    if (b.quote !== undefined) {
      if (!b.quote) p.push('빈 인용구');
      else {
        if (len(b.quote) > 40) p.push(`인용구가 너무 김(${len(b.quote)}자): ${b.quote}`);
        if (/\*\*|\[\[|\]\]/.test(b.quote)) p.push(`인용구에 꾸밈 표시가 있음: ${b.quote}`);
        textAll.push(b.quote);
      }
    }
    if (!b.text) continue;
    b.text.forEach((l, k) => {
      if (l === '') { if (b.text[k - 1] === '') p.push('빈 줄이 연달아 있음'); return; }
      bodyLines++;
      const short = l.slice(0, 20);
      if (/^(> |---|\[사진\]|\[링크\]|\[해시태그\])/.test(l)) p.push(`줄이 원고 명령어로 시작함: ${short}`);
      if (/^([-*•] |\d+\) |#(?!# )|###)/.test(l)) p.push(`줄 머리 형식 금지(목록 기호·# 등): ${short}`);
      const sub = l.startsWith('## ');
      if (sub && /\*\*/.test(l)) p.push(`소주제 줄에는 ** 금지: ${short}`);
      const rest = l.replace(/\*\*[^*]+\*\*/g, m => { bolds++; return m.slice(2, -2); })
        .replace(/\[\[([^\]|]+)\|(#[0-9a-fA-F]{6})\]\]/g, (m, w, c) => { hls++; if (!PALETTE.includes(c.toLowerCase())) p.push(`형광펜 색 ${c}는 팔레트에 없음`); if (len(w) > 12) p.push(`형광펜 글자가 너무 김: ${w}`); return w; });
      if (/\*\*|\[\[|\]\]/.test(rest) || /(^|[^*])\*([^*]|$)/.test(rest.replace(/^## /, ''))) p.push(`꾸밈 표시가 깨짐(** 또는 [[ ]] 짝이 안 맞음): ${short}`);
      const L = len(plainOf(l));
      if (L > HARD_LINE) p.push(`한 줄이 너무 김(${L}자, 28자 안팎으로 나눌 것): ${short}…`);
      const bad = badChars(plainOf(l));
      if (bad.length) p.push(`쓰면 안 되는 기호·이모지: ${bad.join(' ')} (${short})`);
      const syms = [...plainOf(l)].filter(ch => ['✔', '▶', '✓', '※'].includes(ch));
      if (syms.length) {
        if (deco === 'off') p.push(`장식 안 씀 설정인데 기호 사용: ${syms.join('')} (${short})`);
        else {
          decoLines++;
          const body = plainOf(l).replace(/^## /, '');
          if (!['✔', '▶', '✓', '※'].includes([...body][0]) || syms.length > 1) p.push(`기호는 줄 맨 앞에 하나만: ${short}`);
        }
      }
      textAll.push(plainOf(l));
    });
  }
  if (deco === 'auto' && decoLines > 8) p.push(`장식 기호 줄이 너무 많음(${decoLines}줄, 적당히 = 6줄 이내)`);
  const em = EMPHASES[d.emphasis] || EMPHASES.mid;
  if (bolds > em.bold[1] + 4) p.push(`굵게가 너무 많음(${bolds}번, ${em.bold.join('~')}번)`);
  if (hls > em.hl[1] + 2) p.push(`형광펜이 너무 많음(${hls}번, ${em.hl.join('~')}번)`);

  // 금지 표현
  const joined = [d.title, ...textAll].join('\n');
  for (const w of BANNED) if (joined.includes(w)) p.push(`금지 표현 "${w}"`);
  const pm = joined.match(PERCENT);
  if (pm) p.push(`수치(%) 표현 금지(지어낸 통계 우려): "${pm[0]}"`);
  const titleBad = badChars(d.title || '');
  if (titleBad.length) p.push(`제목에 쓰면 안 되는 기호: ${titleBad.join(' ')}`);

  // 키워드 횟수(첫 인용구·제목 제외 본문)
  if (kw) {
    const bodyStr = textAll.slice(1).join('\n');
    const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*'), 'gi');
    const cnt = (bodyStr.match(re) || []).length;
    const kr = KW_REPEATS[d.kwRepeat] || KW_REPEATS.mid;
    if (cnt < kr.hard[0]) p.push(`본문에 키워드 "${kw}"가 ${cnt}번뿐(${kr.range.join('~')}번)`);
    if (cnt > kr.hard[1]) p.push(`본문에 키워드 "${kw}"가 ${cnt}번(${kr.range.join('~')}번으로 줄일 것)`);
  }

  // 분량
  if (d.charTarget) {
    const m = measureDraft(d), v = d.charBasis === 'space' ? m.charsWithSpace : m.chars;
    if (v < d.charTarget * 0.5) p.push(`본문이 너무 짧음(${v}자, 목표 ${d.charTarget}자)`);
  } else {
    const [lmin] = LENGTHS[d.length] || LENGTHS['보통'];
    if (bodyLines < Math.floor(lmin * 0.7)) p.push(`본문이 너무 짧음(${bodyLines}줄, ${lmin}줄 이상)`);
  }

  // 정리 섹션
  const ci = layouts.closingIndex(d);
  if (ci < 1) p.push('정리 인용구가 없음');
  else {
    // 정리 인용구 앞은 구분선. 고정(히든) 안내 이미지 + 한두 줄 설명 뒤에 바로 오는 것도 허용(치과 기준 글)
    const beforeClose = B[ci - 1], beforeThat = B[ci - 2];
    const hiddenLead = beforeClose && beforeClose.text && beforeThat && beforeThat.img !== undefined && I[beforeThat.img] && I[beforeThat.img].kind === 'hidden';
    if (!(beforeClose && (beforeClose.line || hiddenLead))) p.push('정리 인용구 앞에 구분선이 있어야 함');
    const after = B.slice(ci + 1).filter(b => b.text).flatMap(b => b.text);
    const q = after.filter(l => /^## Q\.\s/.test(l)).length;
    if (d.qaCount === 0) { if (q) p.push(`정리 섹션 Q&A 안 씀 설정인데 ${q}개 있음`); }
    else if (d.qaCount) { if (q !== d.qaCount) p.push(`정리 섹션 Q&A는 ${d.qaCount}개(지금 ${q}개, "## Q. …" 형태)`); }
    else if (q < 2 || q > 3) p.push(`정리 섹션 Q&A는 2~3개(지금 ${q}개, "## Q. …" 형태)`);
    if (B.slice(ci + 1).some(b => b.img !== undefined)) p.push('정리 섹션에는 사진을 넣지 않음');
  }

  // 레이아웃 규칙
  if (d.layout && d.imageMode !== 'clinical') for (const x of layouts.validateLayout(d.layout, { ...d, blocks: Bm, images: Im })) p.push(x);   // 임상 증례는 clinical.validate 가 구조를 본다 · 고정 이미지는 레이아웃 규칙에서 뺀다
  return [...new Set(p)];
}

// ── 쓰기 ───────────────────────────────────────────
function repairMessage(problems) {
  return [
    '방금 원고를 검사했더니 아래 문제가 있다. 문제만 고치고 나머지 좋은 부분은 그대로 살려서,',
    '같은 스키마의 JSON 전체(title, category, imageStyle, tags, blocks, images)를 다시 출력해 줘.',
    ...problems.slice(0, 40).map(x => `- ${x}`),
  ].join('\n');
}

async function write({ apiKey, model = 'gpt-5', input, profile = {}, log = () => {}, history = [], rand = Math.random, reasoningEffort = 'low', maxTokens, plan } = {}) {
  const P = plan || planDraft(input, profile, { history, rand });
  maxTokens = maxTokens || Math.max(16000, Math.round((P.charTarget || 0) * 7));
  log(`레이아웃 ${layouts.LAYOUTS[P.layout].label}(${P.layoutMode === 'auto' ? '자동' : '지정'}) · 이미지 스타일 ${P.styleMode === 'auto' ? '자동(' + P.styleCandidates.join('/') + ')' : P.imageStyle} · 장식 ${P.deco} · 카드 ${P.cardTemplates.join('/')}`);
  const { system, user } = buildMessages(input, profile, P);
  const opts = { apiKey, model, system, user, maxTokens, reasoningEffort, log };
  const raw = await openai.chatJSON(opts);
  let draft = normalizeDraft(raw, P, { input, profile, model, rand });
  const finish = dd => {
    dd.stats = measureDraft(dd); dd.warnings = softProblems(dd);
    log(`분량 ${dd.stats.chars}자(공백 제외) · ${dd.stats.charsWithSpace}자(공백 포함) · 키워드 ${dd.stats.keywordCount}번${dd.warnings.length ? ' · 참고 ' + dd.warnings.length + '건' : ''}`);
    return dd;
  };
  let problems = validateDraft(draft, { profile });
  const soft = softProblems(draft).filter(x => !x.startsWith('(참고)'));
  if (!problems.length && !soft.length) return finish(draft);

  const ask = [...problems, ...soft];
  log(`검사 문제 ${ask.length}건 → 수정 요청 1회: ${ask.slice(0, 5).join(' / ')}`);
  const first = draft;
  const raw2 = await openai.chatJSON({ ...opts, messages: [{ role: 'assistant', content: JSON.stringify(toModelJSON(draft)) }, { role: 'user', content: repairMessage(ask) }] });
  draft = normalizeDraft(raw2, P, { input, profile, model, rand });
  const problems2 = validateDraft(draft, { profile });
  if (!problems2.length) return finish(draft);
  // 수정본이 구조상 깨졌는데 첫 원고는 멀쩡했으면(목표치만 빗나감) 첫 원고를 쓴다
  if (!problems.length) { log('수정본에 문제가 있어 첫 원고를 씁니다'); return finish(first); }
  problems = problems2;
  const e = new Error(`원고 검사를 통과하지 못했습니다(수정 1회 후 ${problems.length}건): ${problems.slice(0, 6).join(' / ')}`);
  e.problems = problems; e.draft = draft;
  throw e;
}

// ── .txt 만들기(naver_post manuscript.js parseTxt 형식) ─────────────
function toTxt(d, dir, profile = {}) {
  const head = [`제목: ${String(d.title || '').replace(/[\r\n]+/g, ' ')}`, `카테고리: ${d.category || ''}`, `태그: ${(d.tags || []).join(', ')}`];
  if (dir) head.push(`사진폴더: ${dir}`);
  // 편집기 인용구·구분선 스타일(블로그 성격 설정). 기본(따옴표·구분선1)이면 머리말에 적지 않는다
  // 블록에 style 이 있으면 그 칸만 ">[따옴표] …" / "---[구분선1]" 로 적는다(manuscript.js 형식)
  let ST = null, q = 'default', l = 'default';
  try {
    ST = require('../../naver_post/styles');
    q = ST.quoteKey(profile.quoteStyle || ''); l = ST.lineKey(profile.lineStyle || '');
    if (q !== 'default') head.push(`인용구스타일: ${ST.quoteLabel(q)}`);
    if (l !== 'default') head.push(`구분선스타일: ${ST.lineLabel(l)}`);
  } catch { }
  const qMark = b => { if (!ST || !b.style) return '> '; const k = ST.quoteKey(b.style); return k === q ? '> ' : `>[${ST.quoteLabel(k)}] `; };
  const lMark = b => { if (!ST || !b.style) return '---'; const k = ST.lineKey(b.style); return k === l ? '---' : `---[${ST.lineLabel(k)}]`; };
  const out = [...head, ''];
  for (const b of d.blocks || []) {
    if (b.quote !== undefined) out.push(`${qMark(b)}${b.quote}`);
    else if (b.line) out.push(lMark(b));
    else if (b.img !== undefined) out.push(`[사진] ${d.images[b.img] ? d.images[b.img].file : ''}`);
    else if (b.link) out.push(b.link === true ? '[링크]' : `[링크] ${b.link}`);
    else if (b.hashtags) out.push('[해시태그]');
    else if (b.text) out.push(...b.text);
  }
  return out.join('\n') + '\n';
}

module.exports = {
  planDraft, buildMessages, write, normalizeDraft, validateDraft, toTxt, measureDraft, softProblems, spreadSlots,
  TONES, KW_REPEATS, EMPHASES, TITLE_MODES, QA_COUNTS, CHAR_MIN, CHAR_MAX, LENGTH_CHARS, toModelJSON, wrapLine, checkCard, badChars,
  PALETTE, DECO_MODES, DECO_SYMBOLS, LENGTHS, BANNED, _setCardValidator, appendLinks,
};
