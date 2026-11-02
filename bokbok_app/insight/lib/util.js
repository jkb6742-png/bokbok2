// 공통 도구: 한국시간 날짜, 오류 형식, 문자열 정리
'use strict';

class InsightError extends Error {
  // code: NETWORK | TIMEOUT | HTTP | PARSE | CONFIG | LOCKED | LOGIN | BLOCKED
  constructor(msg, { code = 'ERROR', status, source } = {}) { super(msg); this.code = code; this.status = status; this.source = source; }
}

const DAY = 86400000;
const KST = 9 * 3600000;

// 한국시간 기준 YYYY-MM-DD
function kstDate(t = Date.now()) {
  const d = new Date((t instanceof Date ? t.getTime() : t) + KST);
  return d.toISOString().slice(0, 10);
}
// 한국시간 요일(0=일)·시(0~23)
function kstParts(t) {
  const d = new Date((t instanceof Date ? t.getTime() : t) + KST);
  return { weekday: d.getUTCDay(), hour: d.getUTCHours(), date: d.toISOString().slice(0, 10) };
}
// YYYY-MM-DD(한국시간 자정) → epoch ms
const kstMidnight = ymd => Date.parse(ymd + 'T00:00:00+09:00');
const addDays = (ymd, n) => kstDate(kstMidnight(ymd) + n * DAY + 3600000);
const daysBetween = (a, b) => Math.round((kstMidnight(b) - kstMidnight(a)) / DAY);

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·' };
function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, k) => ENT[k.toLowerCase()] ?? m);
}
const stripTags = s => decodeEntities(String(s ?? '').replace(/<[^>]*>/g, '')).trim();

const ID_RE = /^[A-Za-z0-9_-]{3,40}$/;
function checkBlogId(id) {
  if (!ID_RE.test(String(id || ''))) throw new InsightError('블로그 아이디 형식이 아닙니다', { code: 'CONFIG' });
  return id;
}

const round = (n, d = 1) => (n == null || !Number.isFinite(n)) ? null : Math.round(n * 10 ** d) / 10 ** d;
const sum = a => a.reduce((x, y) => x + (Number(y) || 0), 0);
const avg = a => a.length ? sum(a) / a.length : null;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
// 백분위(0~1): 값 v가 배열 a에서 차지하는 순위
function pctRank(a, v) {
  if (!a.length) return null;
  const below = a.filter(x => x < v).length, eq = a.filter(x => x === v).length;
  return (below + eq / 2) / a.length;
}

module.exports = { InsightError, DAY, kstDate, kstParts, kstMidnight, addDays, daysBetween, decodeEntities, stripTags, checkBlogId, round, sum, avg, clamp, median, pctRank };
