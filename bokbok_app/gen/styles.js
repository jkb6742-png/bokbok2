// AI 이미지 스타일 프리셋 — writer/pipeline이 이미지 프롬프트에 붙인다
// 이미지 모델은 영어 지시를 더 정확히 따르므로 스타일·금지 규칙은 영어, 장면 묘사는 한국어여도 된다.

const STYLES = {
  photo: {
    id: 'photo', label: '실사 사진', desc: '자연광, 실제 장소·사물. 사람은 얼굴이 보이지 않게',
    prompt: 'Natural-light lifestyle photograph, realistic and candid, 35mm lens look, soft daylight, gentle shallow depth of field, real everyday places and objects. Any person appears only from behind, cropped at the shoulders, as hands, or softly out of focus, so that no face is identifiable.',
  },
  character: {
    id: 'character', label: '귀여운 캐릭터', desc: '둥근 2등신 캐릭터, 파스텔 톤 일러스트',
    prompt: 'Cute illustration of original round chibi characters (about two heads tall) with simple dot eyes, soft pastel palette, clean rounded outlines, gentle flat shading, uncluttered background. Characters are fully original designs, not resembling any existing cartoon, game or mascot.',
  },
  flat: {
    id: 'flat', label: '플랫 일러스트', desc: '단순한 도형과 면 색으로 만든 그림',
    prompt: 'Flat vector illustration made of simple geometric shapes and solid color fills, minimal or no gradients, limited harmonious palette of 4 to 5 colors, clean balanced composition, modern editorial look.',
  },
  watercolor: {
    id: 'watercolor', label: '수채화', desc: '종이 질감 위 번지는 수채 그림',
    prompt: 'Soft watercolor painting on textured cold-press paper, gentle color bleeds and blooms, loose expressive brush strokes, light airy palette with plenty of paper white, hand-painted warmth.',
  },
  '3d': {
    id: '3d', label: '3D 렌더', desc: '부드러운 클레이 질감의 미니어처 장면',
    prompt: 'Soft 3D render with a matte clay texture, rounded chunky forms, pastel colors, soft studio lighting with subtle ambient occlusion shadows, cozy toy-like miniature diorama.',
  },
  minimal: {
    id: 'minimal', label: '미니멀 정물', desc: '여백 많은 배경 위 사물 하나',
    prompt: 'Minimal still life: a single meaningful object on a plain seamless backdrop with generous negative space, soft even lighting, calm muted palette, centered composition, quiet and refined mood.',
  },
  editorial: {
    id: 'editorial', label: '신문 삽화(상황 연출)', desc: '경제면 삽화처럼 그날 이슈 장면을 연출. 인물은 뒷모습·실루엣·상징물로, 광택 3D·AI풍 금지',
    prompt: 'Newspaper business-section editorial illustration that stages the actual situation of the story as one readable scene (for example a podium at a government building, a signed tariff document, container ships at a port, a trading floor screen, a central bank facade). Hand-drawn feel with ink line work and flat muted color fills on a slightly textured paper background, restrained palette (navy, warm beige, one green accent), natural proportions, no glossy 3D rendering, no neon gradients, no generic stock-art look. Public figures are suggested only through context, back view, distant silhouette or symbolic props (a red tie, a podium, a flag), never a recognizable face or caricature.',
  },
};
const STYLE_IDS = Object.keys(STYLES);

// 모든 AI 이미지에 붙는 금지 규칙
const SAFETY = 'Strict rules: absolutely no text of any kind — no letters, words, numbers, captions, speech bubbles with writing, signs or labels; no logos, no watermarks, no signatures, no brand names, trademarks or recognizable products; no real or famous people, no celebrities, no recognizable faces; nothing medical-graphic, violent or sexual.';

// 최근 3개 글에 쓴 스타일을 뺀 후보(GPT가 주제에 맞게 고를 목록)
function styleCandidates(history = []) {
  const recent = history.slice(0, 3).map(h => h && h.imageStyle).filter(Boolean);
  const pool = STYLE_IDS.filter(s => !recent.includes(s));
  return pool.length ? pool : STYLE_IDS.slice();
}

// GPT 선택이 없거나 잘못됐을 때 무작위 고르기(최근 3개 피함)
function pickStyle(history = [], rand = Math.random) {
  const pool = styleCandidates(history);
  return pool[Math.floor(rand() * pool.length) % pool.length];
}

// 장면 묘사 + 스타일 + 금지 규칙 → 최종 이미지 프롬프트
function buildImagePrompt(scene, styleId, { color, role = 'header' } = {}) {
  const st = STYLES[styleId] || STYLES.photo;
  const clean = String(scene || '').replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('이미지 장면 묘사가 비어 있습니다');
  return [
    `Scene: ${clean}`,
    `Style: ${st.prompt}`,
    role === 'header'
      ? 'Composition: wide 3:2 landscape blog header image, one clear focal subject, calm background, no borders or frames.'
      : 'Composition: wide 3:2 landscape illustration for the middle of a blog post, one clear focal subject, no borders or frames.',
    color ? `Color mood: harmonize with an accent of ${color} (subtle, not overwhelming).` : '',
    SAFETY,
  ].filter(Boolean).join('\n');
}

module.exports = { STYLES, STYLE_IDS, SAFETY, styleCandidates, pickStyle, buildImagePrompt };
