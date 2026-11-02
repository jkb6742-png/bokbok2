// 이웃 후보 점수: 발행 뒤 읽은 다른 사람 블로그를 공개 정보(analyze 보고서)로 보고 "이웃 신청할 만한가"를 0~100으로 매긴다.
//   score(report, { keywords, readTitle }) → { score, good, reasons[], stats }
//   판정만 한다. 이웃 신청·댓글 같은 행동은 어디서도 하지 않는다(사람이 직접).
'use strict';

const AD_RE = /협찬|광고|체험단|원고료|제공받|대출|카지노|토토|바카라|수익률|리딩|코인\s*추천|분양|무료\s*상담|이벤트\s*참여/;
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, '');
const words = s => String(s || '').split(/[\s,·|\-_/()\[\]]+/).map(w => w.trim()).filter(w => w.length >= 2);

function score(report, { keywords = [], readTitle = '' } = {}) {
  const reasons = [];
  let s = 0;
  if (!report || !report.profile) return { score: 0, good: false, reasons: ['공개 정보를 가져오지 못함'], stats: {} };
  const p = report.profile, a = report.activity || {}, recent = report.recent || [], cats = report.categories || [];
  const posts = p.totalPosts ?? recent.length, subs = p.subscribers, last30 = a.last30 ?? 0, lastAgo = a.lastPostAgo;

  // 1) 살아 있는 블로그인가 (최대 30)
  if (last30 >= 8) { s += 30; reasons.push(`최근 30일 ${last30}편으로 활발`); }
  else if (last30 >= 3) { s += 22; reasons.push(`최근 30일 ${last30}편`); }
  else if (last30 >= 1) { s += 10; reasons.push(`최근 30일 ${last30}편으로 뜸함`); }
  else if (lastAgo != null) { reasons.push(`마지막 글이 ${lastAgo}일 전`); }

  // 2) 규모 (최대 15): 너무 작으면 이웃 효과가 없고, 너무 크면 서로이웃이 안 되는 경우가 많다
  if (posts >= 30 && posts <= 3000) { s += 15; reasons.push(`글 ${posts}편`); }
  else if (posts >= 10) { s += 8; reasons.push(`글 ${posts}편`); }
  else { s -= 10; reasons.push(`글 ${posts}편으로 아직 작음`); }
  if (subs != null) {
    if (subs >= 30 && subs <= 20000) { s += 10; reasons.push(`이웃 ${subs}`); }
    else if (subs > 20000) { s += 2; reasons.push(`이웃 ${subs} (대형 블로그, 서로이웃은 어려울 수 있음)`); }
    else reasons.push(`이웃 ${subs}`);
  }

  // 3) 같은 주제인가 (최대 30): 키워드 낱말이 최근 글 제목·카테고리·태그에 얼마나 나오나
  const kw = [...new Set(keywords.flatMap(words).map(norm))].filter(Boolean);
  const titles = recent.map(r => norm(r.title));
  const hit = kw.length ? titles.filter(t => kw.some(k => t.includes(k))).length : 0;
  const catHit = kw.length ? cats.filter(c => kw.some(k => norm(c.name).includes(k))).length : 0;
  const tagHit = kw.length ? ((report.content && report.content.tags) || []).filter(t => kw.some(k => norm(t.tag).includes(k))).length : 0;
  if (hit >= 5 || catHit) { s += 30; reasons.push(`같은 주제 글 ${hit}편${catHit ? ' · 카테고리 일치' : ''}`); }
  else if (hit >= 2 || tagHit) { s += 18; reasons.push(`같은 주제 글 ${hit}편`); }
  else if (hit === 1) { s += 8; reasons.push('같은 주제 글 1편'); }
  else if (kw.length) reasons.push('최근 글에 같은 주제가 거의 없음');

  // 4) 광고성 (감점)
  const adN = recent.filter(r => AD_RE.test(r.title || '')).length;
  if (adN >= 3 || (recent.length && adN / recent.length >= 0.3)) { s -= 30; reasons.push(`광고·협찬성 제목 ${adN}편`); }
  else if (adN) { s -= 8; reasons.push(`광고·협찬성 제목 ${adN}편`); }

  // 5) 반응 (최대 15)
  const e = report.engagement;
  if (e && e.avgSympathy30 != null) {
    const r = (e.avgSympathy30 || 0) + (e.avgComments30 || 0);
    if (r >= 10) { s += 15; reasons.push(`글당 반응 ${Math.round(r)}`); }
    else if (r >= 3) { s += 10; reasons.push(`글당 반응 ${Math.round(r)}`); }
    else if (r > 0) { s += 4; }
    if (e.avgComments30 >= 2) { s += 5; reasons.push('댓글이 오가는 블로그'); }
  }
  if (p.influencer || p.powerBlog) { s += 5; reasons.push(p.influencer ? '인플루언서' : '파워블로그'); }

  s = Math.max(0, Math.min(100, Math.round(s)));
  return {
    score: s, good: s >= 55,
    reasons: reasons.slice(0, 6),
    stats: { posts, subs: subs ?? null, last30, lastAgo: lastAgo ?? null, topicPosts: hit, adPosts: adN, blogName: p.blogName || '', nick: p.nickName || '' },
  };
}

module.exports = { score, AD_RE };
