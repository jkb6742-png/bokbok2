// G2 품질 기준값 — 조정은 이 파일에서만 한다 (v1.1/v1.2 결정값)
module.exports = {
  ruleVersion: '1.2.0-p1',
  schemaVersion: '1.2',

  // 비교 범위
  compareRecentMax: 50,       // 유사도(코사인·shingle·해시)는 같은 블로그 최근 50편까지
  structureRecent: 3,         // 구조 묶음: 최근 3편
  structureClusterMin: 2,     // 그중 2편 이상이
  structureLcs: 0.80,         //   LCS 0.80 이상이면 REWRITE
  titleRecent: 5,             // 제목 패턴: 최근 5편
  titleRepeatMin: 2,          // 그중 2편 이상이
  titlePatternSim: 0.85,      //   패턴 유사도 0.85 이상이면 REWRITE
  phraseRecent: 5,            // 고정 문구: 최근 5편
  phraseMinChars: 15,         // 공백 제외 15자 이상 같은 문구가
  phraseRepeatMin: 2,         //   2편 이상과 겹치면 REWRITE

  // 본문 유사도
  char3Cosine: { rewrite: 0.25, hold: 0.45 },
  shingleJaccard: { rewrite: 0.30, hold: 0.50 },
  shingleSize: 5,

  // 태그
  tagVariantMax: 3,           // 한 어간의 변형 태그가 3개 초과면 REWRITE
  tagCountWarn: 15,           // 태그 15개 초과면 경고
  tagStemMinLen: 2,

  // 반복 문체 (경고 — 3개 이상 동시에 걸리면 REWRITE)
  styleStackRewrite: 3,
  style: {
    aphorismSectionRatio: 0.5,  // 소주제 끝 문장 중 격언형 비율
    aphorismMinCount: 2,
    emojiEndRatio: 0.6,         // 소주제 끝 줄 이모지 비율
    emojiEndMinCount: 3,
    metaphorMinHits: 3,         // 비유 어휘 등장 횟수
    metaphorRepeatPosts: 2,     // 같은 비유어가 최근 5편 중 2편 이상에 있었으면
    contrastMax: 3,             // "A가 아니라 B" 대비 결론 3회 이상
    oneSentenceLineRatio: 0.9,  // 한 줄 한 문장 비율
    oneSentenceMinLines: 20,
    keywordDensityMax: 0.03,    // 주 키워드가 본문 글자의 3% 초과
    keywordCountMax: 15,
  },
  metaphorSeed: ['렌더링', '배터리', '버그', '번역', '로딩'],

  // 비교 전에 빼는 필수 반복부(법적 고지·안내 문구) — 정규식 문자열
  mandatoryPatterns: [
    '^※.*',
    '(쿠팡\\s*파트너스|파트너스\\s*활동).*',
    '(소정의|일정액의)\\s*수수료.*',
    '(원고료|제품|서비스).{0,10}(제공|지원)받아.*',
    '^(본|이)\\s*(포스팅|글|게시물)은.*(광고|협찬|제공|수수료|의료법|참고용).*',
    '개인에\\s*따라\\s*(차이|부작용).*',
  ],

  // 판정 점수(앱 내부 정렬용, 네이버 점수 아님)
  penalty: { REJECT: 100, HOLD: 30, REWRITE: 15, WARN: 4, INFO: 0 },
};
