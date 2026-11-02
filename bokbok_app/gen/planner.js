// 자동 기획: 블로그의 기존 글·반응·검색 데이터를 읽고, 다음에 쓸 주제(키워드·보조 키워드·제목·방향)를 GPT가 고른다.
//   buildBrief({ profile, posts, recs, report, existingTitles, draftTitles }) → 브리핑 문자열
//   plan({ apiKey, model, brief, n, avoidTitles, log }) → { candidates: [{ keyword, subKeywords, title, topic, category, titleMode, layout, reason }] }
//   GEO_RULES: 글쓰기 프롬프트에 항상 붙는 검색·AI 검색·애드포스트 최적화 규칙
'use strict';
const openai = require('./openai');

const GEO_RULES = `# 검색·AI 검색·애드포스트 최적화 (항상 지킨다)
- 도입 첫 3줄 안에 이 글의 핵심 답을 한 문장으로 먼저 준다(검색 요약·AI 답변에 그대로 인용돼도 뜻이 통하게).
- 본문 어딘가에 "키워드는 ~이다/~를 말한다" 꼴의 정의 문장을 1개 넣는다.
- 소주제 중 1개 이상은 독자가 검색창에 그대로 칠 법한 질문형으로 쓴다.
- 숫자·단계·비교처럼 구조가 보이는 대목을 본문에 1곳 이상 둔다(카드와 겹쳐도 되지만 문장은 다르게).
- 문단은 2~4줄, 빈 줄로 자주 끊는다(모바일 가독·본문 광고 자리).
- 끝의 Q&A는 각 답이 그 자체로 완결된 문장(발췌돼도 뜻이 통하게). 답에 키워드나 그 변형을 자연스럽게 한 번.
- 글 바깥 사이트·상품 홍보, 외부 링크 유도, 댓글 구걸 문구를 넣지 않는다. 광고성 표현은 애드포스트 승인에 불리하다.
- 같은 블로그의 기존 글과 제목·소주제가 겹치지 않게 한다(아래 기존 글 제목 참고).`;

const LAYOUT_IDS = ['classic', 'qa', 'list', 'story', 'compare', 'howto'];
const TITLE_MODES = ['auto', 'keyword', 'question', 'number', 'story'];
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

function buildBrief({ profile = {}, posts = [], recs = [], report = null, existingTitles = [], draftTitles = [] } = {}) {
  const L = [];
  L.push(`# 블로그: ${profile.blogName || profile.blogId || ''} (${profile.blogId || ''})`);
  if (profile.persona) L.push(`- 화자·말투: ${clip(profile.persona, 200)}`);
  if (profile.audience) L.push(`- 독자: ${clip(profile.audience, 150)}`);
  if (Array.isArray(profile.categories) && profile.categories.length) L.push(`- 카테고리: ${profile.categories.join(', ')}`);
  if (profile.rules) L.push(`- 블로그 규칙: ${clip(profile.rules, 300)}`);
  if (report && report.profile) {
    const p = report.profile, a = report.activity || {};
    L.push(`- 전체 글 ${p.totalPosts ?? '?'}편 · 이웃 ${p.subscribers ?? '?'} · 최근 30일 ${a.last30 ?? '?'}편 · 주당 ${a.perWeek90 ?? '?'}편`);
    if (report.content && report.content.titleWords && report.content.titleWords.length) L.push(`- 제목에 자주 쓴 말: ${report.content.titleWords.slice(0, 15).map(w => `${w.word}(${w.count})`).join(', ')}`);
    if (report.categories && report.categories.length) L.push(`- 카테고리별 글 수: ${report.categories.slice(0, 8).map(c => `${c.name} ${c.posts}편${c.avgEngagement != null ? '·반응 ' + c.avgEngagement : ''}`).join(' / ')}`);
  }
  const top = [...posts].filter(p => p && p.title).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 12);
  if (top.length) {
    L.push('# 반응·성과가 좋았던 글 (점수 순)');
    for (const p of top) L.push(`- ${clip(p.title, 60)} | ${p.date || ''} | 공감 ${p.sympathy ?? '-'} 댓글 ${p.comments ?? '-'}${p.keyword ? ' | 키워드 ' + p.keyword : ''}${p.rank ? ' | 순위 ' + p.rank + '위' : ''}`);
  }
  const weak = [...posts].filter(p => p && p.title && (p.score || 0) <= 20).slice(0, 6);
  if (weak.length) L.push('# 반응이 약했던 글: ' + weak.map(p => clip(p.title, 40)).join(' / '));
  const useful = (recs || []).filter(r => ['NEW_KEYWORD', 'OPPORTUNITY', 'PUSH_TOP10', 'CANNIBAL', 'GAP'].includes(r.type));
  if (useful.length) {
    L.push('# 데이터가 알려 주는 기회');
    for (const r of useful) {
      const items = (r.items || []).slice(0, 8).map(it => typeof it === 'string' ? it : [it.keyword || it.title, it.volume != null ? '월 ' + it.volume : '', it.rank != null ? it.rank + '위' : '', it.comp || it.competition || ''].filter(Boolean).join(' ')).filter(Boolean);
      L.push(`- ${r.title}: ${r.reason}${items.length ? ' → ' + items.join(', ') : ''}`);
    }
  }
  const all = [...new Set([...existingTitles, ...draftTitles].filter(Boolean))].slice(0, 80);
  if (all.length) L.push('# 이미 있는 글·초안 제목 (겹치지 않게)\n' + all.map(t => '- ' + clip(t, 60)).join('\n'));
  return L.join('\n');
}

function system(n) {
  return `너는 네이버 블로그 운영 전략가다. 아래 브리핑을 읽고, 이 블로그가 다음에 올리면 검색 유입·AI 검색 인용·애드포스트 수익에 가장 도움이 될 글 주제 ${n}개를 고른다.
원칙:
- 블로그의 기존 주제 축·말투·독자와 이어지되, 이미 있는 글과 겹치지 않는다(세부 각도를 바꾸거나 빈 주제를 찾는다).
- 키워드는 사람이 실제로 검색창에 치는 말(2~4어절, 15자 이내). 너무 넓은 단어(예: "연애")보다 구체적인 조합을 고른다. 지어낸 검색량·순위 숫자를 쓰지 않는다.
- 보조 키워드 2~4개는 주 키워드의 변형·연관 검색어.
- 반응이 좋았던 글의 각도는 이어 가고, 약했던 글의 각도는 피한다. "데이터가 알려 주는 기회"가 있으면 우선 반영한다.
- 건강·의료·금융처럼 단정이 위험한 주제는 경향·안내 수준에서 다룰 수 있는 각도로만.
출력은 설명 없이 JSON 객체 하나:
{"candidates":[{"keyword":"주 키워드","subKeywords":["보조1","보조2"],"title":"제목안(25~45자, 키워드 앞쪽)","topic":"무엇을 어떤 흐름으로 쓸지 2~3문장","category":"브리핑의 카테고리 중 하나 또는 빈 문자열","titleMode":"${TITLE_MODES.join('|')}","layout":"${LAYOUT_IDS.join('|')}","reason":"왜 지금 이 글인지 한 문장(검색·AI 검색·애드포스트 관점)"}]}`;
}

function clean(c, profile) {
  if (!c || typeof c !== 'object') return null;
  const keyword = clip(c.keyword, 30);
  if (!keyword) return null;
  const cats = Array.isArray(profile && profile.categories) ? profile.categories : [];
  const subs = [...new Set((Array.isArray(c.subKeywords) ? c.subKeywords : String(c.subKeywords || '').split(/[,，]/)).map(x => clip(x, 30)).filter(x => x && x !== keyword))].slice(0, 4);
  return {
    keyword, subKeywords: subs, title: clip(c.title, 60), topic: clip(c.topic, 400),
    category: cats.includes(c.category) ? c.category : '',
    titleMode: TITLE_MODES.includes(c.titleMode) ? c.titleMode : 'auto',
    layout: LAYOUT_IDS.includes(c.layout) ? c.layout : 'auto',
    reason: clip(c.reason, 200),
  };
}
const norm = s => String(s || '').replace(/\s+/g, '').toLowerCase();

async function plan({ apiKey, model = 'gpt-5', brief, profile = {}, n = 3, avoidTitles = [], log = () => { }, reasoningEffort = 'low' } = {}) {
  n = Math.max(1, Math.min(5, parseInt(n, 10) || 3));
  const raw = await openai.chatJSON({ apiKey, model, system: system(n), user: brief + `\n\n위 브리핑으로 주제 ${n}개를 JSON으로.`, maxTokens: 6000, reasoningEffort, log });
  const avoid = new Set(avoidTitles.map(norm));
  const seen = new Set(), out = [];
  for (const c of Array.isArray(raw && raw.candidates) ? raw.candidates : []) {
    const k = clean(c, profile);
    if (!k || seen.has(norm(k.keyword))) continue;
    if (avoid.has(norm(k.title))) continue;
    seen.add(norm(k.keyword)); out.push(k);
  }
  if (!out.length) throw new Error('자동 기획 결과가 비어 있습니다. 블로그 성격(화자·카테고리)을 채우고 다시 시도해 주세요');
  log(`자동 기획 후보 ${out.length}개: ${out.map(c => c.keyword).join(' / ')}`);
  return { candidates: out.slice(0, n) };
}

module.exports = { GEO_RULES, buildBrief, plan, clean, LAYOUT_IDS, TITLE_MODES };
