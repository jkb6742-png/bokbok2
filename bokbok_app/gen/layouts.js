// 원고 레이아웃 6종 — 블록 순서 규칙 + 프롬프트 지시문 + 검사 규칙
// 같은 계정에서 같은 모양 글이 반복되지 않게 pickLayout / pickVariant 로 돌려 쓴다.
//
// 블록 이어붙이기 안전 규칙(naver_post 입력 엔진에서 검증된 순서만):
//   구분선 다음엔 반드시 인용구 · 사진은 인용구나 본문 다음, 사진 다음엔 본문
//   본문 다음 본문 금지(하나로 합침) · 끝은 [링크] → [해시태그]

const CARD_TEMPLATES = ['points', 'compare', 'checklist', 'steps'];

// 공통 도입 패턴(첫 문장 모양). 레이아웃별 후보와 합쳐 무작위로 하나
const COMMON_INTROS = [
  '일상 속 짧은 장면 하나(대사 한 줄 포함)를 보여 주며 시작',
  '독자가 실제로 검색창에 칠 법한 질문 하나를 그대로 꺼내며 시작',
  '흔히 퍼져 있는 오해 하나를 짚으며 시작',
  '화자 자신의 솔직한 고백 한 줄로 시작',
  '지난 글이나 화자의 최근 일과 자연스럽게 이어 붙이며 시작',
];
// 공통 정리 섹션 제목 후보
const COMMON_CLOSINGS = [
  '오늘의 포스팅을 정리하면?',
  '오늘 글, 짧게 정리하면',
  '한 번에 정리해 보면',
  '마지막으로 정리',
  '읽고 나서 남는 질문들',
  '바쁜 사람을 위한 요약',
];

const LAYOUTS = {
  classic: {
    id: 'classic', label: '기본형',
    desc: '인용구 소제목마다 사진 한 장, 가장 익숙한 정보형 구성',
    requiredCard: null,
    intros: ['이번 글에서 다룰 내용을 화자의 관심사와 엮어 한두 줄로 예고하며 시작'],
    closings: [],
    instructions: [
      '[레이아웃: 기본형]',
      '순서: 인용구(키워드 제목) → 도입 본문 → [구분선 → 인용구 소제목 → 사진 → 본문] × 사진 수 → 구분선 → 인용구(정리 제목) → 정리 본문 → 링크 → 해시태그',
      '- 섹션 수는 사진 수와 정확히 같다. 섹션마다 사진은 인용구 소제목 바로 다음에 한 장.',
      '- 섹션 본문 안에서는 "## " 소주제를 0~5개 자유롭게 쓴다(번호를 붙일 땐 "## 1. …").',
      '- 섹션마다 성격을 다르게: 장면/공통점/차이/관계·팁 처럼 한 섹션이 한 가지 질문에 답하게.',
    ],
    skeleton: (n) => [
      '{"quote":"키워드 제목"}', '{"text":[도입…]}',
      ...Array.from({ length: n }, (_, i) => `{"line":true}, {"quote":"소제목 ${i + 1}"}, {"img":${i}}, {"text":[…]}`),
      '{"line":true}', '{"quote":"정리 제목"}', '{"text":["## Q. …", …]}', '{"link":true}', '{"hashtags":true}',
    ],
    validate(d, ctx) {
      const p = [];
      const B = d.blocks;
      const body = bodyQuotes(d);
      if (body.length !== d.images.length) p.push(`기본형: 인용구 소제목 수(${body.length})가 사진 수(${d.images.length})와 같아야 함`);
      B.forEach((b, i) => {
        if (b.img === undefined) return;
        if (!(B[i - 1] && B[i - 1].quote !== undefined && B[i - 2] && B[i - 2].line))
          p.push(`기본형: 사진 ${b.img + 1}은 [구분선 → 인용구 소제목] 바로 다음에 와야 함`);
      });
      return p;
    },
  },

  qa: {
    id: 'qa', label: '질문형',
    desc: '소제목이 전부 질문(## Q.)으로 이어지는 검색 답변형',
    requiredCard: null,
    intros: ['이 주제로 사람들이 가장 많이 묻는 질문 서너 개를 한 줄씩 나열하며 시작', '화자가 친구에게 실제로 받았던 질문 하나로 시작'],
    closings: ['질문만 다시 모아 보면', '한 줄 답으로 정리하면'],
    instructions: [
      '[레이아웃: 질문형]',
      '순서: 인용구(키워드 제목) → 도입 본문 → 사진(대표) → 본문(## Q. 질문 + 답) → 사진 → 본문(## Q. …) … → 구분선 → 인용구(정리 제목) → 정리 본문 → 링크 → 해시태그',
      '- 인용구는 맨 앞 제목과 정리 제목 딱 2개만. 본문 중간에 인용구·구분선을 쓰지 않는다.',
      '- 본문의 "## " 소제목은 전부 "## Q. 질문?" 형태. 질문은 독자가 실제로 검색할 말투로, 최소 4개.',
      '- 각 질문 바로 아래 첫 줄에서 결론부터 답하고, 이어서 2~6줄로 이유·예시를 단다.',
      '- 사진은 질문과 질문 사이(앞 질문의 답 끝난 뒤)에 둔다. 사진 바로 다음 본문은 새 질문으로 시작.',
      '- 정리 섹션의 Q&A는 본문 질문을 더 짧게 압축한 한 줄 답으로.',
    ],
    skeleton: (n) => [
      '{"quote":"키워드 제목"}', '{"text":[도입…]}', '{"img":0}', '{"text":["## Q. …", 답…]}',
      ...Array.from({ length: n - 1 }, (_, i) => `{"img":${i + 1}}, {"text":["## Q. …", …]}`),
      '{"line":true}', '{"quote":"정리 제목"}', '{"text":["## Q. …", …]}', '{"link":true}', '{"hashtags":true}',
    ],
    validate(d) {
      const p = [];
      const quotes = d.blocks.filter(b => b.quote !== undefined).length;
      if (quotes !== 2) p.push(`질문형: 인용구는 제목·정리 2개만 써야 함(지금 ${quotes}개)`);
      const subs = bodySubs(d);
      const notQ = subs.filter(s => !/^Q\.\s/.test(s));
      if (notQ.length) p.push(`질문형: 본문 소제목은 전부 "## Q. "로 시작해야 함 → ${notQ.slice(0, 3).join(' / ')}`);
      const q = subs.length - notQ.length;
      if (q < Math.max(4, d.images.length)) p.push(`질문형: 본문 질문(## Q.)이 ${Math.max(4, d.images.length)}개 이상이어야 함(지금 ${q}개)`);
      return p;
    },
  },

  list: {
    id: 'list', label: '리스트형',
    desc: '## 1. ## 2. 번호 소주제가 쭉 이어지는 정리형',
    requiredCard: null,
    intros: ['몇 가지를 정리할지 숫자로 먼저 밝히고, 고른 기준을 한 줄로 말하며 시작'],
    closings: ['번호만 다시 보면'],
    instructions: [
      '[레이아웃: 리스트형]',
      '순서: 인용구(키워드 제목) → 도입 본문 → 사진(대표) → 본문(## 1. … ## 2. …) → 사진 → 본문(## 3. …) … → 구분선 → 인용구(정리 제목) → 정리 본문 → 링크 → 해시태그',
      '- 본문은 "## 1. 소주제", "## 2. 소주제" … 처럼 1부터 빠짐없이 이어지는 번호 소주제 5~7개.',
      '- 번호 없는 "## " 소제목은 쓰지 않는다(정리 섹션의 ## Q. 는 예외).',
      '- 구분선은 정리 섹션 앞 1개만. 본문 중간에 인용구도 쓰지 않는다.',
      '- 사진은 소주제와 소주제 사이에 고르게 흩어 놓는다(사진 바로 다음 본문은 다음 번호로 시작).',
      '- 소주제마다 2~5줄: 핵심 한 줄 + 구체적인 예 또는 장면.',
    ],
    skeleton: (n) => [
      '{"quote":"키워드 제목"}', '{"text":[도입…]}', '{"img":0}', '{"text":["## 1. …", …, "## 2. …", …]}',
      ...Array.from({ length: n - 1 }, (_, i) => `{"img":${i + 1}}, {"text":["## ${i + 3}. …", …]}`),
      '{"line":true}', '{"quote":"정리 제목"}', '{"text":["## Q. …", …]}', '{"link":true}', '{"hashtags":true}',
    ],
    validate(d) {
      const p = [];
      const subs = bodySubs(d);
      const nums = subs.map(s => (s.match(/^(\d+)\.\s/) || [])[1]).filter(Boolean).map(Number);
      if (nums.length < 5) p.push(`리스트형: "## 1." 같은 번호 소주제가 5개 이상이어야 함(지금 ${nums.length}개)`);
      if (nums.some((n, i) => n !== i + 1)) p.push(`리스트형: 번호가 1부터 차례로 이어져야 함(${nums.join(',')})`);
      if (subs.length !== nums.length) p.push('리스트형: 본문 소제목은 전부 번호 소주제여야 함');
      const lines = d.blocks.filter(b => b.line).length;
      if (lines > 1) p.push(`리스트형: 구분선은 정리 앞 1개만(지금 ${lines}개)`);
      if (nums.length && nums.length < d.images.length) p.push('리스트형: 사진 수보다 번호 소주제가 적음');
      return p;
    },
  },

  story: {
    id: 'story', label: '경험담형',
    desc: '화자 경험 흐름(처음→과정→깨달음)으로 읽히는 에세이형',
    requiredCard: null,
    intros: ['그 일이 처음 시작된 순간의 장면으로 바로 들어가며 시작', '그때의 나를 지금 돌아보는 한 줄로 시작'],
    closings: ['그래서 남은 것', '이 경험을 정리하면'],
    instructions: [
      '[레이아웃: 경험담형]',
      '순서: 인용구(키워드 제목) → 도입 본문(장면) → 사진(대표) → 본문(처음) → [구분선 → 인용구(전환점 한 줄) → 본문(과정)] 1~2회 → 사진들은 본문 문단 사이 → 구분선 → 인용구(정리 제목) → 정리 본문 → 링크 → 해시태그',
      '- 화자 1인칭 이야기로 쓴다. 흐름은 처음(무슨 일이 있었나) → 과정(어떻게 느끼고 무엇을 바꿨나) → 깨달음(그래서 지금은).',
      '- 본문 중간 인용구는 1~2개만, 소주제("## ")는 본문 전체에서 3개 이하.',
      '- 정보는 이야기 속에 녹인다. 설명 나열 대신 장면·대사·속마음.',
      '- 경험은 페르소나 범위 안에서 그럴듯한 일상으로. 특정 실명·날짜·수치를 지어내 사실처럼 쓰지 않는다.',
      '- 카드 이미지는 이야기에서 얻은 정리(체크할 점·순서 등)를 담는다.',
    ],
    skeleton: (n) => [
      '{"quote":"키워드 제목"}', '{"text":[장면…]}', '{"img":0}', '{"text":[처음…]}',
      '{"line":true}', '{"quote":"전환점 한 줄"}', '{"text":[과정…]}',
      ...Array.from({ length: n - 1 }, (_, i) => `{"img":${i + 1}}, {"text":[…]}`),
      '{"line":true}', '{"quote":"정리 제목"}', '{"text":["## Q. …", …]}', '{"link":true}', '{"hashtags":true}',
    ],
    validate(d) {
      const p = [];
      const mid = bodyQuotes(d).length;
      if (mid < 1 || mid > 2) p.push(`경험담형: 본문 중간 인용구는 1~2개(지금 ${mid}개)`);
      const subs = bodySubs(d).length;
      if (subs > 3) p.push(`경험담형: 본문 "## " 소주제는 3개 이하(지금 ${subs}개)`);
      const first = (allText(d).match(/(^|[\s"'(])(나는|내가|나도|나한테|내\s|저는|제가|저도|제\s)/g) || []).length;
      if (first < 3) p.push('경험담형: 화자 1인칭 서술이 거의 없음(나는/내가/저는 …)');
      return p;
    },
  },

  compare: {
    id: 'compare', label: '비교형',
    desc: 'A vs B 두 축으로 나란히 비교, 비교 카드 필수',
    requiredCard: 'compare',
    intros: ['둘을 헷갈리게 만드는 대표적인 상황 하나로 시작', '"둘이 뭐가 달라?"라는 질문을 화자가 받은 장면으로 시작'],
    closings: ['둘의 차이만 다시 보면', '한 줄로 갈라 보면'],
    instructions: [
      '[레이아웃: 비교형]',
      '순서: 인용구(키워드 제목) → 도입 본문 → [구분선 → 인용구 소제목 → 사진 → 본문] × 사진 수 → 구분선 → 인용구(정리 제목) → 정리 본문 → 링크 → 해시태그',
      '- 글 전체가 A와 B 두 대상을 비교하는 축으로 전개된다. 제목 또는 첫 인용구에 "vs" / "차이" / "비교" 중 하나를 넣는다.',
      '- 섹션은 비교 기준(예: 말투, 갈등 대처, 연애, 일하는 방식) 하나씩. 섹션 안에서 "## A는 …" / "## B는 …" 처럼 나란히 쓴다.',
      '- 카드 중 최소 1장은 compare 템플릿(왼쪽 A, 오른쪽 B).',
      '- 어느 한쪽을 깎아내리지 않는다. 차이는 상황에 따른 경향으로 쓴다.',
    ],
    skeleton: (n) => LAYOUTS.classic.skeleton(n),
    validate(d) {
      const p = [];
      if (!d.images.some(im => im.kind === 'card' && im.template === 'compare')) p.push('비교형: compare 카드가 최소 1장 있어야 함');
      const head = d.title + ' ' + (d.blocks[0] && d.blocks[0].quote || '');
      if (!/vs|VS|차이|비교|다른 점|다른점/.test(head)) p.push('비교형: 제목이나 첫 인용구에 "vs/차이/비교"가 들어가야 함');
      if (bodyQuotes(d).length !== d.images.length) p.push(`비교형: 인용구 소제목 수가 사진 수(${d.images.length})와 같아야 함`);
      return p;
    },
  },

  howto: {
    id: 'howto', label: '방법형',
    desc: '## STEP 1. 단계별로 따라 하는 방법 글, 순서 카드 필수',
    requiredCard: 'steps',
    intros: ['이 방법이 필요해지는 순간을 짧게 보여 주며 시작', '화자가 처음에 잘못했던 방식 하나를 털어놓으며 시작'],
    closings: ['단계만 다시 보면', '따라 하기 전에 다시 보기'],
    instructions: [
      '[레이아웃: 방법형]',
      '순서: 인용구(키워드 제목) → 도입 본문 → 사진(대표) → 본문(준비/전제) → 구분선 → 인용구("단계별로 해 보기" 같은 소제목) → 본문(## STEP 1. … ## STEP 2. …), 단계 사이사이에 사진 → 구분선 → 인용구(정리 제목) → 정리 본문 → 링크 → 해시태그',
      '- 단계 소제목은 "## STEP 1. 동사로 끝나는 행동" 형태로 1부터 빠짐없이 3~6단계.',
      '- 각 단계: 무엇을 하는지 한 줄 → 어떻게/왜 2~4줄 → 흔한 실수 한 줄(선택).',
      '- 카드 중 최소 1장은 steps 템플릿(단계 요약). 본문 단계와 내용이 맞아야 한다.',
      '- 결과를 보장하지 않는다("이렇게 하면 반드시 ~된다" 금지).',
    ],
    skeleton: (n) => [
      '{"quote":"키워드 제목"}', '{"text":[도입…]}', '{"img":0}', '{"text":[준비…]}',
      '{"line":true}', '{"quote":"단계별로 해 보기"}', '{"text":["## STEP 1. …", …]}',
      ...Array.from({ length: n - 1 }, (_, i) => `{"img":${i + 1}}, {"text":["## STEP ${i + 2}. …", …]}`),
      '{"line":true}', '{"quote":"정리 제목"}', '{"text":["## Q. …", …]}', '{"link":true}', '{"hashtags":true}',
    ],
    validate(d) {
      const p = [];
      if (!d.images.some(im => im.kind === 'card' && im.template === 'steps')) p.push('방법형: steps 카드가 최소 1장 있어야 함');
      const nums = bodySubs(d).map(s => (s.match(/^STEP\s?(\d+)\.\s/i) || [])[1]).filter(Boolean).map(Number);
      if (nums.length < 3) p.push(`방법형: "## STEP 1." 형태 단계가 3개 이상이어야 함(지금 ${nums.length}개)`);
      if (nums.some((n, i) => n !== i + 1)) p.push(`방법형: STEP 번호가 1부터 차례로 이어져야 함(${nums.join(',')})`);
      return p;
    },
  },
};
const LAYOUT_IDS = Object.keys(LAYOUTS);

// ── 블록 도우미 ──────────────────────────────
// 정리 섹션 = 마지막 인용구. 그 앞까지가 본문
function closingIndex(d) {
  for (let i = d.blocks.length - 1; i >= 0; i--) if (d.blocks[i].quote !== undefined) return i;
  return -1;
}
// 본문 중간 인용구(첫 인용구·정리 인용구 제외)
function bodyQuotes(d) {
  const ci = closingIndex(d);
  return d.blocks.filter((b, i) => b.quote !== undefined && i > 0 && i < ci).map(b => b.quote);
}
// 본문 "## " 소제목(정리 섹션 제외), "## " 뗀 글자
function bodySubs(d) {
  const ci = closingIndex(d);
  const out = [];
  d.blocks.forEach((b, i) => { if (b.text && i < ci) for (const l of b.text) if (l.startsWith('## ')) out.push(l.slice(3).trim()); });
  return out;
}
const allText = d => d.blocks.filter(b => b.text).map(b => b.text.join('\n')).join('\n');

// ── 반복 방지 선택 ────────────────────────────
// history: 최근 draft.json 기록(최신이 앞). 최근 3개에 쓴 것은 피한다.
function pickFrom(ids, recent, rand = Math.random) {
  const pool = ids.filter(x => !recent.includes(x));
  const use = pool.length ? pool : ids;
  return use[Math.floor(rand() * use.length) % use.length];
}

// opts.cardTemplates: 쓸 수 있는 카드 템플릿 묶음이 정해져 있으면 필수 카드가 그 안에 있는 레이아웃을 우선
function pickLayout(history = [], { rand = Math.random, cardTemplates } = {}) {
  const recent = history.slice(0, 3).map(h => h && h.layout).filter(Boolean);
  let ids = LAYOUT_IDS;
  if (Array.isArray(cardTemplates) && cardTemplates.length) {
    const ok = ids.filter(id => !LAYOUTS[id].requiredCard || cardTemplates.includes(LAYOUTS[id].requiredCard));
    if (ok.length) ids = ok;
  }
  return pickFrom(ids, recent, rand);
}

// 레이아웃 고정 시 카드 묶음 정리: 필수 카드는 자동으로 넣는다
function allowedCards(layoutId, cardTemplates) {
  const L = LAYOUTS[layoutId];
  if (!L) throw new Error(`알 수 없는 레이아웃: ${layoutId}`);
  let set = Array.isArray(cardTemplates) && cardTemplates.length ? cardTemplates.filter(t => CARD_TEMPLATES.includes(t)) : CARD_TEMPLATES.slice();
  if (Array.isArray(cardTemplates) && cardTemplates.length && !set.length)
    throw new Error(`카드 템플릿 묶음이 올바르지 않습니다: ${cardTemplates.join(', ')} (가능: ${CARD_TEMPLATES.join(', ')})`);
  if (L.requiredCard && !set.includes(L.requiredCard)) set = [...set, L.requiredCard];
  return set;
}

// 도입 패턴·정리 제목 무작위(직전 글과 같은 것은 피함)
function pickVariant(layoutId, history = [], rand = Math.random) {
  const L = LAYOUTS[layoutId];
  const last = history.slice(0, 3).map(h => h && h.variant || {});
  const intro = pickFrom([...COMMON_INTROS, ...L.intros], last.map(v => v.intro), rand);
  const closingHeading = pickFrom([...COMMON_CLOSINGS, ...L.closings], last.map(v => v.closingHeading), rand);
  return { intro, closingHeading };
}

// 프롬프트용 레이아웃 지시문
function layoutPrompt(layoutId, imageCount) {
  const L = LAYOUTS[layoutId];
  return [...L.instructions, '블록 뼈대(예시, … 부분을 채움):', ...L.skeleton(imageCount).map(s => '  ' + s)].join('\n');
}

function validateLayout(layoutId, draft) {
  const L = LAYOUTS[layoutId];
  if (!L) return [`알 수 없는 레이아웃: ${layoutId}`];
  return L.validate(draft);
}

module.exports = {
  LAYOUTS, LAYOUT_IDS, CARD_TEMPLATES, COMMON_INTROS, COMMON_CLOSINGS,
  pickLayout, pickVariant, allowedCards, layoutPrompt, validateLayout,
  closingIndex, bodyQuotes, bodySubs,
};
