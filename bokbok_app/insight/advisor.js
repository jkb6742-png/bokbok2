// 주제 조회: 계정별 발행 데이터(글별 반응·노출 순위·키워드·추천)로 "이 주제를 지금 쓰면 좋은가"를 판정하고 대안을 낸다.
//   advise({ topic, posts, recs, today }) → { verdict, verdictLabel, score, conclusion, checks[], reasons[], tips[], related[], alternatives[] }
//   axes({ posts, today }) → [{ axis, label, posts, last, lastAgo, recent60, avgScore, status, hint, keywords[], top[], missingAngles[] }]
//   overview({ posts, recs, today }) → { good[], avoid[], boost[] }  한눈에 보기
//   posts = dashboard.tables.posts (logNo·title·date·category·sympathy·comments·keyword·rank·status·volume·score)
//   데이터만 본다. 외부 호출·AI 호출 없음. 점수는 50점에서 시작해 항목별로 더하고 뺀다.
'use strict';
const { primaryKeyword, norm, tokens: rawTokens } = require('./lib/keyword');
const { daysBetween } = require('./lib/util');

// 조사 떼기: "INTP가"·"INTP의"·"INTP에게"가 같은 축으로 묶이게 (남는 글자가 2자 이상일 때만)
const JOSA = /(에게서|에게|에서|으로|라는|이라는|한테|까지|부터|처럼|보다|이나|나|가|이|은|는|을|를|의|에|도|로|와|과|란)$/;
const stem = w => { const m = w.match(JOSA); return m && w.length - m[0].length >= 2 ? w.slice(0, w.length - m[0].length) : w; };
const tokens = s => rawTokens(s).map(stem);

const VERDICT = { avoid: '지금은 피하기', wait: '조금 미루기', ok: '써도 됨', good: '지금 쓰기 좋음' };
const CONCLUSION = {
  avoid: '지금 쓰면 내 기존 글과 부딪히거나 반응이 약했던 축입니다. 아래 대안 주제나, 각도를 바꾼 세부 키워드로 쓰는 편이 낫습니다.',
  wait: '못 쓸 주제는 아니지만 지금은 손해 보는 요인이 있습니다. 2~3주 뒤에 쓰거나, 아래 "이런 각도로" 중 하나로 바꿔 쓰세요.',
  ok: '막는 요인은 없습니다. 제목 앞에 키워드를 두고, 기존 글과 소주제가 겹치지 않게 쓰면 됩니다.',
  good: '데이터가 밀어주는 주제입니다. 지금 쓰면 검색 유입·반응을 기대할 수 있습니다.',
};
// 주제에 붙여 "아직 안 쓴 각도"를 찾는 데 쓰는 흔한 세부 각도
const ANGLES = ['특징', '장단점', '연애', '궁합', '직업', '공부', '인간관계', '스트레스', '뜻', '이유', '방법', '비용', '기간', '과정', '후기', '통증', '주의사항', '부작용', '비교', '추천', '관리'];

const kwOf = p => p.keyword || primaryKeyword(p.title || '');
const ago = (p, today) => p.date ? daysBetween(p.date, today) : null;
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const todayKst = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

// 주제와 글이 같은 축인가: 공백 없는 포함(0.9~1) 또는 낱말 겹침 비율(최대 0.8)
function relation(topic, p) {
  const T = norm(topic), tt = tokens(topic);
  const K = norm(kwOf(p)), TT = norm(p.title);
  if (!T) return 0;
  if (K === T) return 1;
  if (K.includes(T) || T.includes(K) || TT.includes(T)) return 0.9;
  if (!tt.length) return 0;
  const pt = new Set([...tokens(p.title), ...tokens(kwOf(p))]);
  const hit = tt.filter(w => [...pt].some(x => x.includes(w) || w.includes(x))).length;
  return Math.min(0.8, hit / tt.length);
}
// 관련 글로 칠 최소 겹침: 낱말이 2개 이하인 짧은 주제는 전부 겹쳐야 하고, 긴 주제는 6할
const minRel = topic => tokens(topic).length <= 2 ? 0.8 : 0.6;
const hasAngle = (texts, angle) => texts.some(t => norm(t).includes(norm(angle)));

function advise({ topic, posts = [], recs = [], today } = {}) {
  topic = String(topic || '').replace(/\s+/g, ' ').trim();
  if (!topic) throw new Error('주제나 키워드를 넣어 주세요');
  today = today || todayKst();
  const checks = [];
  let s = 50;
  const add = (key, label, state, text, delta) => { s += delta; checks.push({ key, label, state, text, delta }); };   // state: good|bad|warn|none
  const rel = posts.map(p => ({ p, r: relation(topic, p) })).filter(x => x.r >= minRel(topic)).sort((a, b) => (b.p.date || '').localeCompare(a.p.date || ''));
  const related = rel.map(({ p, r }) => ({ logNo: p.logNo, title: p.title, date: p.date, ago: ago(p, today), score: p.score, rank: p.rank, sympathy: p.sympathy, comments: p.comments, keyword: kwOf(p), same: r >= 0.9 }));
  const exact = rel.filter(x => x.r >= 0.9);
  const tt = tokens(topic);
  const relKw = k => { const K = norm(k), T = norm(topic); if (!K) return false; if (K === T || K.includes(T) || T.includes(K)) return true; const kt = tokens(k); return tt.length && tt.filter(w => kt.some(x => x.includes(w) || w.includes(x))).length / tt.length >= minRel(topic); };
  const inRec = type => (recs || []).filter(r => r.type === type).flatMap(r => r.items || []).filter(it => relKw(typeof it === 'string' ? it : it.keyword || it.title || ''));

  // 1) 같은 키워드 글이 이미 노출 중인가
  const ranked = exact.map(x => x.p).filter(p => p.rank != null && p.rank <= 10);
  if (ranked.length) add('ranked', '같은 키워드 노출', 'bad', `같은 키워드 글이 이미 ${ranked[0].rank}위로 노출 중입니다. 새 글을 또 쓰면 내 글 둘이 한 자리를 두고 경쟁해 둘 다 밀립니다.`, -30);
  else if (exact.length) add('ranked', '같은 키워드 노출', 'none', '같은 키워드 글은 있지만 10위 안에 노출돼 있지는 않습니다.', 0);
  else add('ranked', '같은 키워드 노출', 'good', '같은 키워드로 쓴 글이 없습니다.', 0);
  // 2) 최근 같은 축 글과의 간격
  const last = rel[0] ? ago(rel[0].p, today) : null;
  if (last == null) add('gap', '같은 축 최근 글', 'none', '이 축으로 쓴 글이 아직 없습니다.', 0);
  else if (last <= 14) add('gap', '같은 축 최근 글', 'bad', `${last}일 전에 같은 축의 글을 올렸습니다. 같은 축은 3~4주 간격이 안전합니다.`, -25);
  else if (last <= 30) add('gap', '같은 축 최근 글', 'warn', `${last}일 전에 같은 축의 글이 있습니다. 조금 더 간격을 두면 좋습니다.`, -10);
  else add('gap', '같은 축 최근 글', 'good', `마지막 같은 축 글이 ${last}일 전이라 간격은 충분합니다.`, 0);
  // 3) 60일 포화
  const recent60 = rel.filter(x => { const a = ago(x.p, today); return a != null && a <= 60; }).length;
  if (recent60 >= 4) add('sat', '최근 60일 편수', 'bad', `최근 60일에 같은 축 글이 ${recent60}편입니다. 한 축에 몰리면 블로그가 좁아 보이고 글끼리 검색 자리를 나눠 갖습니다.`, -15);
  else add('sat', '최근 60일 편수', recent60 ? 'none' : 'good', recent60 ? `최근 60일 같은 축 글 ${recent60}편(4편부터 포화로 봅니다).` : '최근 60일에 같은 축 글이 없습니다.', 0);
  // 4) 과거 성과
  const sc = rel.map(x => x.p.score).filter(v => typeof v === 'number');
  const a = avg(sc);
  if (a != null && sc.length >= 2 && a >= 60) add('perf', '이 축의 과거 성과', 'good', `이 축 글 ${sc.length}편의 반응·노출 점수 평균이 ${Math.round(a)}점으로 블로그 안에서 높은 편입니다.`, 20);
  else if (a != null && sc.length >= 2 && a < 30) add('perf', '이 축의 과거 성과', 'bad', `이 축 글 ${sc.length}편의 점수 평균이 ${Math.round(a)}점으로 낮습니다. 같은 식으로 또 쓰면 비슷하게 묻힐 가능성이 큽니다.`, -15);
  else if (a != null) add('perf', '이 축의 과거 성과', 'none', `비슷한 글 ${sc.length}편, 점수 평균 ${Math.round(a)}점(보통).`, 0);
  else add('perf', '이 축의 과거 성과', 'none', '비교할 과거 글이 없습니다.', 0);
  // 5) 오래 쉰 좋은 축
  if (last != null && last >= 120 && a != null && a >= 40) add('stale', '갱신 기회', 'good', `마지막 글이 ${last}일 전인데 반응은 있었던 축입니다. 최신 내용으로 다시 쓰면 검색에서 새 글로 잡힙니다.`, 15);
  // 6) 데이터 추천과의 겹침
  const can = inRec('CANNIBAL'), nk = inRec('NEW_KEYWORD'), op = inRec('OPPORTUNITY');
  if (can.length) add('cannibal', '내 글끼리 경쟁', 'bad', '대시보드가 이미 "내 글끼리 같은 키워드 경쟁"으로 잡은 축입니다. 글을 하나로 합치거나 세부 키워드로 나눠야 합니다.', -15);
  if (nk.length) add('newkw', '빈 키워드 추천', 'good', `검색량은 있는데 내 글이 없는 키워드와 겹칩니다: ${nk.slice(0, 3).map(i => i.keyword || i).join(', ')}`, 20);
  if (op.length) add('opp', '손해 보는 키워드', 'good', `검색량에 비해 순위가 낮은 키워드와 겹칩니다: ${op.slice(0, 3).map(i => i.keyword || i).join(', ')}. 3위 안을 노리는 보강 글이 효과적입니다.`, 10);
  if (!nk.length && !op.length && !can.length) add('recs', '데이터 추천', 'none', recs && recs.length ? '대시보드 추천 키워드와 겹치는 것은 없습니다.' : '검색 API·검색광고 키가 없어 추천 키워드 데이터가 없습니다.', 0);
  s = Math.max(0, Math.min(100, Math.round(s)));
  const verdict = s <= 25 ? 'avoid' : s <= 45 ? 'wait' : s <= 65 ? 'ok' : 'good';
  const reasons = checks.filter(c => c.state !== 'none').map(c => c.text);

  // 이런 각도로: 관련 글 제목에 아직 없는 세부 각도
  const relTexts = rel.map(x => x.p.title || '');
  const tips = ANGLES.filter(an => !norm(topic).includes(norm(an)) && !hasAngle(relTexts, an)).slice(0, 5).map(an => `${topic} ${an}`);

  // 대안: 추천 키워드 + 오래됐지만 반응 좋았던 축 + 잘 되는 축의 빈 각도
  const alts = [];
  const seen = new Set([norm(topic)]);
  const push = (keyword, why) => { if (!keyword || seen.has(norm(keyword))) return; seen.add(norm(keyword)); alts.push({ keyword, why }); };
  for (const type of ['NEW_KEYWORD', 'OPPORTUNITY', 'PUSH_TOP10']) for (const r of (recs || []).filter(r => r.type === type)) for (const it of (r.items || [])) {
    const k = typeof it === 'string' ? it : it.keyword || it.title;
    push(k, type === 'NEW_KEYWORD' ? `검색량 있는데 내 글이 없는 키워드${it.volume ? ' · 월 ' + it.volume : ''}` : type === 'OPPORTUNITY' ? `검색량 대비 순위가 낮음${it.rank != null ? ' · 지금 ' + it.rank + '위' : ''}` : `${it.rank != null ? it.rank + '위' : '11~30위'} 글 — 보강하면 10위 안`);
  }
  const ax = axes({ posts, today });
  for (const x of ax.filter(x => x.status === 'stale' && x.avgScore != null && x.avgScore >= 40).slice(0, 3)) push(x.label, `${x.lastAgo}일 쉬었고 평균 ${x.avgScore}점이던 축 — 갱신 글`);
  for (const x of ax.filter(x => x.status === 'strong' || (x.status === 'ok' && x.avgScore != null && x.avgScore >= 50)).slice(0, 3)) for (const an of x.missingAngles.slice(0, 2)) push(`${x.label} ${an}`, `잘 되는 축 "${x.label}"에서 아직 안 쓴 각도`);
  return { topic, verdict, verdictLabel: VERDICT[verdict], score: s, conclusion: CONCLUSION[verdict], checks, reasons, tips, related: related.slice(0, 8), alternatives: alts.slice(0, 8), today };
}

// 축 이름: 두 번 이상 쓴 짧은 키워드가 있으면 그것, 없으면 축 낱말 자체(영문은 대문자) — 제목 조각이 이름이 되지 않게
function labelOf(o) {
  const cands = [...o.kws.entries()].filter(([k, n]) => k && k.length <= 14 && n >= 2).sort((a, b) => b[1] - a[1] || a[0].length - b[0].length);
  if (cands.length) return cands[0][0];
  const raw = o.items.map(p => rawTokens(kwOf(p))[0]).find(Boolean) || o.axis;   // 원래 표기(조사 떼기 전)에서 대소문자 복원
  const base = raw.toLowerCase().startsWith(o.axis) ? raw.slice(0, o.axis.length) : o.axis;
  return /^[a-z0-9]+$/i.test(base) ? base.toUpperCase() : base;
}

// 내 글을 주제 축(키워드 첫 낱말, 조사 제거)으로 묶어 상태를 본다
function axes({ posts = [], today } = {}) {
  today = today || todayKst();
  const g = new Map();
  for (const p of posts) {
    const kw = kwOf(p); const t = tokens(kw); const axis = t[0] || norm(kw) || '(없음)';
    const o = g.get(axis) || { axis, items: [], kws: new Map() };
    o.items.push(p); o.kws.set(kw, (o.kws.get(kw) || 0) + 1); g.set(axis, o);
  }
  const out = [];
  for (const o of g.values()) {
    const dated = o.items.filter(p => p.date).sort((a, b) => b.date.localeCompare(a.date));
    const last = dated[0] ? dated[0].date : null, lastAgo = dated[0] ? daysBetween(last, today) : null;
    const recent60 = dated.filter(p => daysBetween(p.date, today) <= 60).length;
    const sc = o.items.map(p => p.score).filter(v => typeof v === 'number');
    const avgScore = avg(sc);
    const n = o.items.length;
    let status = 'ok', hint = '지금 써도 되는 축';
    if (recent60 >= 4) { status = 'saturated'; hint = `최근 60일에 ${recent60}편 — 잠시 다른 축으로`; }
    else if (lastAgo != null && lastAgo <= 14 && n >= 2) { status = 'hot'; hint = `${lastAgo}일 전 글 — 3~4주 뒤 다른 각도로`; }
    else if (lastAgo != null && lastAgo <= 14) { status = 'hot'; hint = `${lastAgo}일 전 첫 글 — 반응을 보고 이어 가기`; }
    else if (avgScore != null && sc.length >= 2 && avgScore < 30) { status = 'weak'; hint = `평균 ${Math.round(avgScore)}점 — 같은 식은 피하고 각도 바꾸기`; }
    else if (lastAgo != null && lastAgo >= 120) { status = 'stale'; hint = `${lastAgo}일 쉼 — 최신 내용으로 갱신 글`; }
    else if (avgScore != null && avgScore >= 60) { status = 'strong'; hint = `평균 ${Math.round(avgScore)}점 — 이어 가기 좋음`; }
    const texts = o.items.map(p => p.title || '');
    const top = [...o.items].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 3).map(p => ({ logNo: p.logNo, title: p.title, date: p.date, score: p.score, rank: p.rank }));
    const label = labelOf(o);
    out.push({
      axis: o.axis, label, posts: n, last, lastAgo, recent60, avgScore: avgScore != null ? Math.round(avgScore) : null, status, hint,
      keywords: [...o.kws.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 6), top,
      missingAngles: ANGLES.filter(an => !norm(label).includes(norm(an)) && !hasAngle(texts, an)).slice(0, 4),
    });
  }
  return out.sort((a, b) => b.posts - a.posts || (b.avgScore || 0) - (a.avgScore || 0));
}

// 한눈에: 지금 쓰기 좋은 주제 · 잠시 피할 축 · 보강할 글
function overview({ posts = [], recs = [], today } = {}) {
  today = today || todayKst();
  const ax = axes({ posts, today });
  const good = [], avoid = [], boost = [];
  const seen = new Set();
  const pushGood = (keyword, why, kind) => { if (!keyword || seen.has(norm(keyword))) return; seen.add(norm(keyword)); good.push({ keyword, why, kind }); };
  for (const r of (recs || []).filter(r => r.type === 'NEW_KEYWORD')) for (const it of (r.items || []).slice(0, 5)) pushGood(it.keyword || it, `검색량${it.volume ? ' 월 ' + it.volume : ' 있음'} · 내 글 없음`, 'newkw');
  for (const r of (recs || []).filter(r => r.type === 'OPPORTUNITY')) for (const it of (r.items || []).slice(0, 3)) pushGood(it.keyword || it, `검색량 대비 순위 낮음${it.rank != null ? ' · ' + it.rank + '위' : ''} — 3위 안 노리기`, 'opp');
  for (const x of ax.filter(x => x.status === 'stale' && x.avgScore != null && x.avgScore >= 40).slice(0, 3)) pushGood(x.label, `${x.lastAgo}일 쉼 · 평균 ${x.avgScore}점 — 갱신 글`, 'stale');
  for (const x of ax.filter(x => x.status === 'strong' || (x.status === 'ok' && x.posts >= 2)).slice(0, 4)) for (const an of x.missingAngles.slice(0, 1)) pushGood(`${x.label} ${an}`, `"${x.label}" 축(평균 ${x.avgScore ?? '-'}점)에서 아직 안 쓴 각도`, 'angle');
  for (const x of ax.filter(x => x.status === 'hot' || x.status === 'saturated' || x.status === 'weak').slice(0, 6)) avoid.push({ keyword: x.label, why: x.hint, status: x.status });
  for (const r of (recs || []).filter(r => r.type === 'CANNIBAL')) for (const it of (r.items || []).slice(0, 3)) avoid.push({ keyword: it.keyword || it, why: '내 글끼리 같은 키워드 경쟁 — 하나로 합치거나 세부 키워드로', status: 'cannibal' });
  for (const r of (recs || []).filter(r => r.type === 'PUSH_TOP10')) for (const it of (r.items || []).slice(0, 5)) boost.push({ title: it.title || it.keyword || '', keyword: it.keyword || '', rank: it.rank ?? null, why: '제목 앞 키워드·본문 보강·같은 주제 후속 글로 10위 안' });
  return { good: good.slice(0, 8), avoid: avoid.slice(0, 8), boost: boost.slice(0, 6) };
}

module.exports = { advise, axes, overview, relation, VERDICT, ANGLES };
