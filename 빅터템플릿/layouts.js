// 빅터의 퍼니 이코노믹 — 글 레이아웃 5종(지금은 A·B, 11-05에 C·D·E 추가) + 순환 규칙
// 공통: 가운데 정렬 · 문장마다 한 줄(45자 안쪽) · 문단 사이 [빈줄] · 목차 없음 · 이모지·기호 적극 사용
//       ⚠ 이모지는 한 코드포인트짜리만(✅ ❗ ▶ 📌 🎬 📝 💬 🔹 📊 ①②③). 키캡(1️⃣)·변형선택자(⚠️ ➡️)·ZWJ 조합은 에디터가 글자를 두 번 넣어 전수검사 실패
//       글자 2,300~2,500자(공백 제외) · 이미지 6장 이상(단컷/2컷 만화 1장 필수) · 섹션 6~9개
//       시작은 "### 📌 미리보는 오늘의 핵심 요약", 끝은 "> 💬 빅터의 한줄평"(또는 빅터의 생각) → "#s 투자 판단은 본인 책임입니다."
//       강조: **굵게** __밑줄__ {{글자색|#ff0010 빨강 / #0078cb 파랑}} [[형광펜|#fff8b2]] · 줄 크기 ### 24 / ## 19 / 기본 16 / #s 15
//       출처: 수치마다 매체·발표일, 해외 자료는 capture 카드 + 본문 출처 줄. 전문 용어는 한 줄 풀이.
// 같은 레이아웃이 직전 2편에서 연속으로 쓰였으면 다른 레이아웃을 고른다(pick()).
const fs = require('fs'), path = require('path');

const LAYOUTS = {
  A: {
    name: 'A · 상황 해설형', since: '2026-11-03',
    sections: ['### 📌 미리보는 오늘의 핵심 요약 (✅ 3줄 + 한 줄 질문)', '[stats] 숫자 4개', '① 무슨 일이 있었나 [bars 또는 stats]', '② 한 컷으로 보는 상황 [comic]', '③ 어떻게 여기까지 왔나 [timeline]', '④ 핵심 쟁점 [versus] (❗ 단서 3개)', '⑤ 해외 보도는 어떻게 보나 [capture]', '⑥ 사례 비교 [compare]', '⑦ 앞으로 볼 일정 [checklist] (1. 2. 3. 번호 줄)', '📝 오늘의 포스팅을 정리하면? (▶ 3줄) + Q&A 3', '💬 빅터의 한줄평'],
    images: ['thumb', 'stats', 'bars|stats', 'comic', 'timeline', 'versus', 'capture', 'compare', 'checklist'],
    note: '쟁점이 뚜렷한 기업·정책 이슈. 섹션 7~9개',
  },
  B: {
    name: 'B · 숫자 브리핑형', since: '2026-11-03',
    sections: ['### 📌 미리보는 오늘의 핵심 요약 (✅ 3줄)', '[comic] 먼저 상황 한 컷', '① 숫자부터 [stats]', '② 흐름 [timeline 또는 bars]', '③ 왜 이런 일이 [본문 + 🔹 3줄]', '④ 나에게 오는 영향 [checklist]', '⑤ 전문가·해외 시각 [capture 또는 인용 블록]', '📝 정리 (▶ 3줄) + Q&A 2~3', '💬 빅터의 생각'],
    images: ['thumb', 'comic', 'stats', 'timeline|bars', 'checklist', 'capture|compare'],
    note: '시세·지표·사고처럼 숫자가 중심인 이슈. 섹션 6~7개',
  },
  // C·D·E: 2026-11-05 추가 예정 (비교 토론형 / 스토리형 / Q&A 중심형)
};

// 발행·초안 이력에서 최근 레이아웃 읽기: 원고함/victoreconomic/*/layout.txt (한 글자)
function history(root) {
  const dirs = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory() && /^\d{8}_\d{4}_/.test(e.name)).map(e => e.name).sort();
  return dirs.map(d => { try { return fs.readFileSync(path.join(root, d, 'layout.txt'), 'utf8').trim(); } catch { return null; } }).filter(Boolean);
}
// 직전 2편이 같은 레이아웃이면 그 레이아웃은 제외하고, 나머지 중 가장 오래전에 쓴 것
function pick(root, prefer) {
  const keys = Object.keys(LAYOUTS), h = history(root);
  const last2 = h.slice(-2);
  let pool = keys;
  if (last2.length === 2 && last2[0] === last2[1]) pool = keys.filter(k => k !== last2[0]);
  if (prefer && pool.includes(prefer)) return prefer;
  const lastUse = k => { const i = h.lastIndexOf(k); return i < 0 ? -1 : i; };
  return pool.sort((a, b) => lastUse(a) - lastUse(b))[0];
}
module.exports = { LAYOUTS, history, pick };
if (require.main === module) {
  const root = process.argv[2] || path.join(__dirname, '..', '..', '원고함', 'victoreconomic');
  console.log('history', history(root).join(' '), '→ next', pick(root, process.argv[3]));
}
