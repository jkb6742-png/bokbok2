// 블로그 링크 분석 — 아무 네이버 블로그나 링크(또는 아이디)만으로 공개 정보를 모아 지표를 만든다.
//   · 로그인·쿠키 없이 손님으로 공개 화면만 읽는다(내 네이버 계정과 엮이지 않음).
//   · 수집은 collectors/blog.js 그대로(호스트별 2초+ 간격, 재시도 2회). 결과는 <DATA>\insight\_analyze\<id>.json 에 보관.
//   parseBlogUrl(input) → blogId | null
//   analyze({ blogId, settings, pages, deps }) → report
//   buildReport(collected, now) → report (수집 없이 계산만, 시험용)
//   list() / get(blogId)
'use strict';
const fs = require('fs'), path = require('path');
const store = require('./lib/store');
const { createClient } = require('./lib/http');
const { collectBlog } = require('./collectors/blog');
const { InsightError, DAY, kstDate, kstParts, daysBetween, round, avg, median, checkBlogId } = require('./lib/util');

const ID_RE = /^[A-Za-z0-9_-]{3,40}$/;
const RESERVED = new Set(['PostView', 'PostList', 'PostView.naver', 'PostList.naver', 'prologue', 'api', 'BlogHome', 'SympathyHistoryList', 'section']);

// "https://blog.naver.com/abc/2234", "m.blog.naver.com/abc", "blog.naver.com/PostView.naver?blogId=abc&logNo=1", "abc.blog.me", "abc" → "abc"
function parseBlogUrl(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  if (ID_RE.test(s)) return s;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u; try { u = new URL(s); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const q = u.searchParams.get('blogId');
  if (q && ID_RE.test(q)) return q;
  const bm = host.match(/^([a-z0-9_-]{3,40})\.blog\.me$/i);
  if (bm) return bm[1];
  if (/(^|\.)blog\.naver\.com$/.test(host) || host === 'rss.blog.naver.com') {
    const seg = u.pathname.split('/').filter(Boolean)[0] || '';
    const id = seg.replace(/\.xml$/, '');
    if (ID_RE.test(id) && !RESERVED.has(id)) return id;
  }
  return null;
}

const STOP = new Set(['그리고', '하는', '있는', '없는', '대한', '위한', '이유', '방법', '정리', '후기', '추천', '총정리', '이야기', '진짜', '정말', '오늘', '우리', '이번', '그냥', '어떻게', '무엇', '뭐가', '하기', '되는', '같은', '하면', '해서', '에서', '으로', '까지', '부터', '보다', '모든', '가지']);
function titleWords(titles) {
  const cnt = new Map();
  for (const t of titles) {
    const seen = new Set();
    for (let w of String(t || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)) {
      w = w.replace(/(은|는|이|가|을|를|의|에|와|과|도|로|으로|에서|까지|부터|이랑|랑|하고|처럼|보다)$/u, '');
      if ([...w].length < 2 || STOP.has(w) || /^\d+$/.test(w)) continue;
      const k = w.toUpperCase() === w ? w : w.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k); cnt.set(k, (cnt.get(k) || 0) + 1);
    }
  }
  return [...cnt.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([word, count]) => ({ word, count }));
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

function buildReport(c, now = Date.now()) {
  const today = kstDate(now);
  const posts = (c.posts || []).filter(p => p.date);
  const pf = c.profile || {};
  const ago = p => daysBetween(p.date, today);
  const inDays = n => posts.filter(p => ago(p) < n);
  const hasMetrics = !!pf.metricsAvailable;
  const eng = p => (p.sympathy || 0) + (p.comments || 0);

  // 활동
  const dates = [...new Set(posts.map(p => p.date))].sort();
  const last90 = inDays(90), last30 = inDays(30);
  const gaps = [];
  for (let i = 1; i < dates.length; i++) gaps.push(daysBetween(dates[i - 1], dates[i]));
  const recentDates = dates.filter(d => daysBetween(d, today) < 90);
  const recentGaps = []; for (let i = 1; i < recentDates.length; i++) recentGaps.push(daysBetween(recentDates[i - 1], recentDates[i]));
  const perDay = new Map(); for (const p of last90) perDay.set(p.date, (perDay.get(p.date) || 0) + 1);
  const covered = posts.length >= (pf.totalPosts || 0);
  const weekday = Array(7).fill(0), hour = Array(24).fill(0);
  let timed = 0;
  for (const p of last90.length >= 10 ? last90 : posts.slice(0, 60)) {
    if (p.addedAt) { const k = kstParts(p.addedAt); weekday[k.weekday]++; hour[k.hour]++; timed++; }
    else weekday[new Date(p.date + 'T12:00:00+09:00').getUTCDay()]++;
  }
  const monthly = new Map();
  for (const p of posts) { const m = p.date.slice(0, 7); monthly.set(m, (monthly.get(m) || 0) + 1); }
  const months = []; { const d = new Date(today + 'T00:00:00+09:00'); for (let i = 11; i >= 0; i--) { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)); const k = x.toISOString().slice(0, 7); months.push({ month: k, posts: monthly.get(k) || 0 }); } }

  // 반응
  const sample = posts.slice(0, 30);
  const byEng = hasMetrics ? [...posts].sort((a, b) => eng(b) - eng(a)).slice(0, 10) : [];

  // 카테고리
  const cats = new Map();
  for (const p of posts) {
    const k = p.categoryName || (p.categoryNo != null ? '카테고리 ' + p.categoryNo : '미분류');
    const o = cats.get(k) || { name: k, posts: 0, recent90: 0, eng: [] };
    o.posts++; if (ago(p) < 90) o.recent90++; o.eng.push(eng(p)); cats.set(k, o);
  }
  const categories = [...cats.values()].sort((a, b) => b.posts - a.posts).map(o => ({ name: o.name, posts: o.posts, recent90: o.recent90, share: round(o.posts / posts.length * 100, 0), avgEngagement: hasMetrics ? round(avg(o.eng), 1) : null }));

  // 태그(RSS 최근 글)
  const tagCnt = new Map(); for (const p of posts) for (const t of p.tags || []) tagCnt.set(t, (tagCnt.get(t) || 0) + 1);

  const titles = posts.map(p => p.title || '');
  const tl = titles.map(t => [...t].length).filter(Boolean);
  const imgs = posts.filter(p => p.images != null).map(p => p.images);

  // 신호(사실만, 판정 아님)
  const signals = [];
  const busyDays = [...perDay.values()].filter(n => n >= 3).length;
  if (busyDays) signals.push({ level: 'info', text: `최근 90일에 하루 3편 이상 올린 날이 ${busyDays}일` });
  const lastAgo = posts[0] ? ago(posts[0]) : null;
  if (lastAgo != null && lastAgo >= 14) signals.push({ level: 'warn', text: `마지막 글이 ${lastAgo}일 전` });
  const hidden = posts.filter(p => p.searchYn === false).length;
  if (hidden) signals.push({ level: 'info', text: `검색 비허용으로 설정된 글 ${hidden}편` });
  if (!hasMetrics) signals.push({ level: 'info', text: '공감·댓글·이웃 수는 데이터 설정의 "robots.txt 비허용 주소 쓰지 않기"가 켜져 있어 모으지 않았습니다' });
  if (!covered) signals.push({ level: 'info', text: `전체 ${pf.totalPosts}편 중 최근 ${posts.length}편만 분석했습니다` });

  return {
    blogId: pf.blogId, fetchedAt: c.fetchedAt || now, today, sources: c.source || [], errors: c.errors || [],
    profile: {
      blogName: pf.blogName, nickName: pf.nickName, directory: pf.directory, powerBlog: pf.powerBlog, influencer: pf.influencer,
      totalPosts: pf.totalPosts ?? null, subscribers: pf.subscriberCount ?? null, totalVisitors: pf.totalVisitorCount ?? null, todayVisitorsPartial: pf.dayVisitorCountPartial ?? null,
      visitorsPerPost: pf.totalVisitorCount && pf.totalPosts ? round(pf.totalVisitorCount / pf.totalPosts, 0) : null,
      firstPostDate: covered && dates.length ? dates[0] : null, lastPostDate: dates.length ? dates[dates.length - 1] : null,
      ageDays: covered && dates.length ? daysBetween(dates[0], today) : null,
    },
    analyzed: { posts: posts.length, covered, metrics: hasMetrics },
    activity: {
      last7: inDays(7).length, last30: last30.length, last90: last90.length,
      perWeek90: round(last90.length / (90 / 7), 1),
      activeDays90: recentDates.length,
      avgGapDays: round(avg(recentGaps), 1), medianGapDays: median(recentGaps), maxGapDays90: recentGaps.length ? Math.max(...recentGaps) : null,
      maxGapDaysAll: gaps.length ? Math.max(...gaps) : null,
      lastPostAgo: lastAgo,
      weekday: weekday.map((n, i) => ({ label: WEEK[i], n })), hour: hour.map((n, i) => ({ label: String(i), n })), timedPosts: timed,
      months,
    },
    engagement: hasMetrics ? {
      avgSympathy30: round(avg(sample.map(p => p.sympathy || 0)), 1), avgComments30: round(avg(sample.map(p => p.comments || 0)), 1),
      medianSympathy30: median(sample.map(p => p.sympathy || 0)), medianComments30: median(sample.map(p => p.comments || 0)),
      noReaction30: sample.filter(p => !eng(p)).length,
      top: byEng.map(p => ({ logNo: p.logNo, title: p.title, date: p.date, sympathy: p.sympathy || 0, comments: p.comments || 0, images: p.images ?? null, category: p.categoryName || null })),
    } : null,
    content: {
      avgTitleLen: round(avg(tl), 0), avgImages: imgs.length ? round(avg(imgs), 1) : null, videoPosts: posts.filter(p => p.hasVideo).length,
      titleWords: titleWords(titles.slice(0, 150)),
      tags: [...tagCnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([tag, count]) => ({ tag, count })),
    },
    categories,
    recent: posts.slice(0, 50).map(p => ({ logNo: p.logNo, title: p.title, date: p.date, at: p.addedAt || null, category: p.categoryName || null, sympathy: p.sympathy ?? null, comments: p.comments ?? null, images: p.images ?? null, searchYn: p.searchYn !== false })),
    signals,
  };
}

const adir = () => path.join(store.root(), '_analyze');
const afile = id => path.join(adir(), checkBlogId(id) + '.json');
function get(blogId) { return store.readJson(afile(blogId), null); }
function list() {
  let fs_ = []; try { fs_ = fs.readdirSync(adir()).filter(f => f.endsWith('.json')); } catch { }
  return fs_.map(f => { const r = store.readJson(path.join(adir(), f), null); return r && { blogId: r.blogId, blogName: r.profile.blogName, fetchedAt: r.fetchedAt, totalPosts: r.profile.totalPosts, subscribers: r.profile.subscribers, last30: r.activity.last30 }; })
    .filter(Boolean).sort((a, b) => b.fetchedAt - a.fetchedAt);
}
function remove(blogId) { try { fs.unlinkSync(afile(blogId)); } catch { } }

const running = new Set();
async function analyze({ blogId, settings = {}, pages = 1, log = () => { }, deps = {} } = {}) {
  checkBlogId(blogId);
  if (running.has(blogId)) throw new InsightError('이 블로그를 이미 분석하는 중입니다', { code: 'BUSY' });
  running.add(blogId);
  try {
    const now = deps.now || Date.now;
    const client = deps.client || createClient({ fetch: deps.fetch, sleep: deps.sleep, now, log });
    log(`공개 정보 수집 시작 (최근 글 최대 ${pages * 30}편)`);
    const c = await collectBlog({ client, blogId, settings: { strictRobots: !!settings.strictRobots, maxPostPages: pages }, log, now });
    const r = buildReport(c, now());
    r.pages = pages;
    if (!r.analyzed.posts) throw new InsightError('공개된 글이 없거나 없는 블로그입니다', { code: 'PARSE' });
    store.writeJson(afile(blogId), r);
    log(`분석 완료: 글 ${r.analyzed.posts}편`);
    return r;
  } finally { running.delete(blogId); }
}

module.exports = { parseBlogUrl, buildReport, analyze, get, list, remove, titleWords, _running: running };
