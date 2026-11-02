// 임상 증례 글 (치과 블로그): 임상 사진을 올린 순서대로 글 흐름을 잡고, 의료광고 규칙을 지키게 하는 규칙·검사
//   FIELDS  진료 분야 목록 · STAGES 사진 단계 목록
//   prompt(P) → 글쓰기 프롬프트에 끼울 규칙+뼈대 (layoutPrompt 대신)
//   validate(d) → 문제 목록 (효과 보장·과장 표현, 환자 식별, 주의사항 누락)
'use strict';

const FIELDS = ['임플란트', '치아교정', '투명교정', '크라운·보철', '신경치료', '잇몸치료', '충치치료', '사랑니 발치', '소아치과', '치아미백', '라미네이트', '틀니', '턱관절', '스케일링', '기타'];
const STAGES = [
  { key: 'first', label: '초진' }, { key: 'xray', label: '엑스레이·CT' }, { key: 'during', label: '치료 중' },
  { key: 'after', label: '치료 직후' }, { key: 'followup', label: '경과·완료' }, { key: 'etc', label: '기타' },
];
const stageLabel = k => (STAGES.find(s => s.key === k) || STAGES[5]).label;
// 임상 글 형태 3종 — 사진 순서·의료광고 규칙은 같고, 소주제가 이어지는 방식만 다르다(계정별 기본 템플릿 3개로 돌려 쓴다)
const FORMS = {
  stage: { key: 'stage', label: '증례 순서형', desc: '사진 단계마다 "## 1. 단계" 소주제 → 설명 → 사진. 치료 과정을 처음부터 끝까지 보여 주는 글' },
  qa: { key: 'qa', label: '질문 답변형', desc: '사진마다 환자가 실제로 묻는 "## Q. 질문?"으로 소주제를 잡고 답하며 사진을 보여 주는 글' },
  guide: { key: 'guide', label: '판단 기준형', desc: '"이런 경우 이 치료를 생각한다" 기준 3~5가지를 앞에 두고, 사진은 그 기준을 보여 주는 예로 쓰는 정보형 글' },
};
const FORM_IDS = Object.keys(FORMS);
const formOf = k => (FORMS[k] ? k : 'stage');

// 의료광고에서 문제 되는 표현 (검사에서 막음)
const BANNED_RE = [
  [/완벽(하|한|히)/, '완벽'], [/최고(의|급)?/, '최고'], [/무통/, '무통'], [/통증\s*(이|은)?\s*(없|전혀|제로)/, '통증 없음'],
  [/영구(적|히)/, '영구'], [/100\s*%/, '100%'], [/보장/, '보장'], [/단\s*한\s*번(에|으로)/, '단 한 번에'], [/유일(한|하게)/, '유일'],
  [/1\s*위/, '1위'], [/부작용(이|은)?\s*(없|전혀)/, '부작용 없음'], [/후회\s*없/, '후회 없음'], [/최신\s*(장비|기술)/, '최신 장비'],
  [/할인|이벤트|특가|무료\s*(상담|검진)/, '가격·이벤트'], [/다른\s*(치과|병원)(보다|와\s*달리)/, '타 의료기관 비교'],
  [/(환자|고객)\s*(님|분)?\s*(이|께서)?\s*(말씀|후기|말하길)/, '환자 말 인용'], [/\d{2}세\b/, '정확한 나이'],
];
const DISCLAIMER_RE = /개인(에\s*따라|마다|차)/;
const CAUTION_RE = /부작용|주의/;

function photoLines(P) {
  const notes = Array.isArray(P.clinical && P.clinical.photoNotes) ? P.clinical.photoNotes : [];
  return Array.from({ length: P.imageCount }, (_, i) => {
    const n = notes[i] || {};
    return `  ${i}번: [${stageLabel(n.stage)}] ${String(n.note || '').trim() || '(설명 없음 — 단계에 맞게 자연스럽게)'}`;
  });
}

// 형태별: 사진 앞 소주제를 어떻게 쓰는지 + 도입 + 뼈대의 소주제 예시
const FORM_RULES = {
  stage: {
    sub: '- 사진마다: "## N. 소주제"(단계 이름이 드러나게, 1부터 차례로) → 그 단계에서 무엇을 왜 했는지 4~10줄 → {"img":i} → 사진에서 보이는 것을 짚는 2~4줄("위 사진은 ~"처럼 사진을 가리켜도 된다). 다음 단계 소주제는 그 뒤에 빈 줄을 두고 이어 쓴다.',
    intro: '도입: 어떤 상황으로 내원했는지, 이 글에서 무엇을 보여 줄지 6~12줄',
    head: i => `## ${i + 1}. ${i === 0 ? '첫 단계 소주제' : '다음 단계 소주제'}`,
  },
  qa: {
    sub: '- 사진마다 소주제는 환자가 실제로 묻는 말 그대로 "## Q. 질문?" 형태다(예: "## Q. 뼈가 부족하면 임플란트를 못 하나요?"). 질문 바로 아래 첫 줄에서 결론부터 답하고, 그 단계에서 실제로 한 일을 3~8줄 → {"img":i} → 사진에서 보이는 것 2~4줄. 질문은 사진 순서(치료 순서)를 따라 자연스럽게 이어진다. 번호 소주제("## 1.")는 쓰지 않는다.',
    intro: '도입: 이 치료를 앞둔 사람이 가장 많이 묻는 질문 두세 개를 한 줄씩 꺼내고, 실제 증례로 답하겠다고 6~10줄',
    head: () => '## Q. 환자가 묻는 질문?',
  },
  guide: {
    sub: '- 도입 바로 다음에 "## 이런 경우 이 치료를 생각합니다" 소주제를 두고 판단 기준 3~5가지를 한 줄씩 쓴다(보장·단정 없이 "검토한다/권한다" 수준). 그다음 사진마다 "## N. 기준 이름" 소주제(1부터 차례로)로 그 기준을 실제 증례에서 어떻게 확인·처리했는지 4~8줄 → {"img":i} → 사진에서 보이는 것 2~4줄. 사진은 설명의 예시로 쓰고 순서는 그대로 지킨다.',
    intro: '도입: 이 치료가 필요한지 고민하는 사람에게 무엇을 기준으로 판단하는지 알려 주겠다고 6~10줄',
    head: i => `## ${i + 1}. ${i === 0 ? '첫 번째 기준 이름' : '다음 기준 이름'}`,
  },
};

function prompt(P) {
  const C = P.clinical || {};
  const n = P.imageCount;
  const F = FORM_RULES[formOf(C.form)];
  const L = [
    `# 임상 증례 글 (치과 블로그 · ${FORMS[formOf(C.form)].label}) — 반드시 지킨다`,
    `- 진료 분야: ${C.field || '치과 일반'}. 화자는 이 치과에서 치료 과정을 설명하는 사람(원장·치과 스태프 시점)이다. 환자 후기 형식이 아니다.`,
    C.caseNote ? `- 증례 메모(블로그 주인이 적음, 사실만 쓰고 꾸미지 않는다): ${C.caseNote.replace(/"/g, "'")}` : '- 증례 메모가 없으니 사진 설명과 분야에서 벗어나는 상황을 지어내지 않는다.',
    `- 임상 사진 ${n}장은 아래 순서·단계 그대로이고, 글의 흐름도 이 순서를 그대로 따른다. 사진을 건너뛰거나 순서를 바꾸지 않는다.`,
    ...photoLines(P),
    F.sub,
    '- 환자 식별 금지: 이름·정확한 나이·직업·거주지·내원 날짜를 쓰지 않는다. "40대 남성 환자분" 정도까지만. 환자가 한 말을 따옴표로 인용하지 않는다.',
    '- 치료 효과를 보장하거나 과장하지 않는다. "완벽", "최고", "무통", "통증 없는", "영구", "100%", "보장", "단 한 번에", "유일", "1위", "최신 장비", "부작용 없음"을 쓰지 않는다.',
    '- 치료 결과(치료 직후·경과 사진) 설명 뒤에 "치료 결과는 개인에 따라 다를 수 있습니다"라는 뜻의 문장을 꼭 한 줄 넣는다.',
    `- 마지막 사진 다음, 정리 섹션 앞에 {"line":true} → {"quote":"치료 후 주의할 점"} → 본문을 둔다. 본문은 "## 부작용과 주의사항" 소주제로 시작하고, ${C.field || '이 시술'}의 일반적인 부작용·불편감·관리법을 4~8줄 쓴다. 두루뭉술하게 넘기지 않는다.`,
    '- 다른 치과·병원과 비교하거나 깎아내리지 않는다. 가격·할인·이벤트·예약 유도·전화 안내 문구를 쓰지 않는다.',
    '- 전문의·학회·수상·장비 자랑은 블로그 고유 규칙에 적힌 것만 쓴다. 적혀 있지 않으면 쓰지 않는다.',
    '- 진단명·시술명은 정확한 용어로 쓰고, 처음 나올 때 쉬운 말로 한 줄 풀어 준다. 지어낸 수치·기간 단정("3일이면 낫는다")은 쓰지 않는다.',
    '- 이 글에는 글자 카드가 없다. images는 전부 ai(사진 자리)이고, prompt에는 그 사진 자리에 어울리는 한 줄 설명만 적는다.',
    '블록 뼈대(예시, … 부분을 채움):',
    '  {"quote":"키워드가 든 제목형 한 줄"}',
    formOf(C.form) === 'guide'
      ? `  {"text":["${F.intro}", "", "## 이런 경우 이 치료를 생각합니다", "기준 1 …", "기준 2 …", "기준 3 …", "", "${F.head(0)}", "그 기준을 증례에서 어떻게 봤는지 4~8줄 …"]}`
      : `  {"text":["${F.intro}", "", "${F.head(0)}", "설명 4~10줄 …"]}`,
    ...Array.from({ length: n }, (_, i) => i === 0 ? '  {"img":0}' : `  {"text":["사진 설명 2~4줄", "", "${F.head(i)}", "설명 …"]}\n  {"img":${i}}`),
    '  {"text":["마지막 사진 설명 2~4줄 (결과 사진이면 개인차 문장 포함)"]}',
    '  {"line":true}',
    '  {"quote":"치료 후 주의할 점"}',
    '  {"text":["## 부작용과 주의사항", "4~8줄 …"]}',
    '  {"line":true}',
    `  {"quote":"${P.variant && P.variant.closingHeading ? P.variant.closingHeading : '정리'}"}`,
    '  {"text":["## Q. 질문?", "답 …", "", "마무리 1~3줄"]}',
    '  {"link":true}',
    '  {"hashtags":true}',
  ];
  return L.join('\n');
}

function validate(d) {
  const p = [];
  const B = Array.isArray(d.blocks) ? d.blocks : [];
  const texts = [];
  for (const b of B) { if (b.text) texts.push(...b.text); if (b.quote !== undefined) texts.push(b.quote); }
  const joined = [d.title || '', ...texts].join('\n');
  for (const [re, label] of BANNED_RE) if (re.test(joined)) p.push(`의료광고 금지 표현(${label}): "${(joined.match(re) || [''])[0]}"`);
  if (!texts.some(l => l.startsWith('## ') && CAUTION_RE.test(l))) p.push('"## 부작용과 주의사항" 소주제가 없음(마지막 사진 뒤, 정리 섹션 앞에 4~8줄)');
  if (!DISCLAIMER_RE.test(joined)) p.push('"치료 결과는 개인에 따라 다를 수 있습니다" 문장이 없음');
  const imgs = B.filter(b => b.img !== undefined).length;
  const form = formOf(d.clinical && d.clinical.form);
  if (form === 'qa') {
    // 질문 답변형: 정리 섹션(마지막 인용구 뒤) 앞의 "## Q." 가 사진 수 이상
    let ci = -1; for (let i = B.length - 1; i >= 0; i--) if (B[i].quote !== undefined) { ci = i; break; }
    const body = []; B.forEach((b, i) => { if (b.text && i < ci) body.push(...b.text); });
    const qs = body.filter(l => /^## Q\.\s/.test(l)).length;
    if (imgs && qs < imgs) p.push(`질문 답변형: 사진 ${imgs}장인데 본문 "## Q. 질문?" 소주제가 ${qs}개 — 사진마다 질문 소주제를 둘 것`);
  } else {
    const subs = texts.filter(l => l.startsWith('## ') && !/^## Q\./.test(l) && !CAUTION_RE.test(l) && !/^## 이런 경우/.test(l)).length;
    if (imgs && subs < imgs) p.push(`사진 ${imgs}장인데 단계 소주제가 ${subs}개 — 사진마다 "## 소주제"를 둘 것`);
    if (form === 'guide' && !texts.some(l => /^## 이런 경우/.test(l))) p.push('판단 기준형: "## 이런 경우 이 치료를 생각합니다" 소주제가 없음(도입 바로 다음)');
  }
  return p;
}

module.exports = { FIELDS, STAGES, FORMS, FORM_IDS, formOf, stageLabel, prompt, validate, BANNED_RE };
