// 수집기 1·2: 공개 블로그 정보·글 목록·글별 공개 지표 (등록된 내 블로그만)
//
// 확인한 주소 (2026-11-01 jsrjkb6742로 실측):
//  A. https://blog.naver.com/PostTitleListAsync.naver?blogId=&currentPage=&countPerPage=30
//     → 전체 글 목록(logNo·제목(URL인코딩)·categoryNo·addDate("2026. 10. 27." 또는 "13시간 전")·totalCount).
//       robots.txt 비차단. 응답 JSON 안에 \' 가 섞여 있어 치환 후 파싱.
//  B. https://m.blog.naver.com/api/blogs/<id>/post-list?categoryNo=0&itemCount=30&page=N  (Referer 필수, 없으면 403)
//     → 글별 sympathyCnt·commentCnt·shareCnt·thumbnailCount(사진 수)·addDate(ms)·categoryName·searchYn·allOpenPost.
//       itemCount 50은 400, 30까지 됨. 빈 items 가 오면 끝. robots.txt 의 m.blog.naver.com /api/ 는 Disallow.
//  C. https://m.blog.naver.com/api/blogs/<id>  (Referer 필수)
//     → blogName·subscriberCount(이웃 수)·totalVisitorCount·dayVisitorCount(오늘 지금까지)·blogDirectoryName. 같은 robots 주의.
//  D. https://rss.blog.naver.com/<id>.xml → 최근 글(약 50건)의 정확한 발행 시각·태그. (robots.txt 전체 Disallow 이지만 RSS 는 구독용 공개 피드)
//  확인했지만 쓰지 않음: NVisitorgp4Ajax.naver (204 빈 응답 + robots Disallow), BlogTagListInfo.naver (robots Disallow, 태그는 RSS로 대체)
//
// B·C 는 robots.txt 상 크롤러 비허용 경로라 settings.strictRobots=true 면 건너뛴다(공감·댓글·이웃 수가 비게 됨).
'use strict';
const { InsightError, kstDate, decodeEntities } = require('../lib/util');

const SOURCE = {
  titleList: 'blog.naver.com/PostTitleListAsync.naver',
  mobileList: 'm.blog.naver.com/api/blogs/{id}/post-list',
  blogInfo: 'm.blog.naver.com/api/blogs/{id}',
  rss: 'rss.blog.naver.com/{id}.xml',
};

// "2026. 10. 27." / "13시간 전" / "5분 전" / "방금 전" / "어제" → YYYY-MM-DD (한국시간)
function parseListDate(s, fetchedAt) {
  const t = String(s || '').trim();
  let m = t.match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  if ((m = t.match(/(\d+)\s*시간\s*전/))) return kstDate(fetchedAt - m[1] * 3600000);
  if ((m = t.match(/(\d+)\s*분\s*전/))) return kstDate(fetchedAt - m[1] * 60000);
  if (/방금/.test(t)) return kstDate(fetchedAt);
  if (/어제/.test(t)) return kstDate(fetchedAt - 86400000);
  return null;
}

const decodeTitle = s => { try { return decodeEntities(decodeURIComponent(String(s || '').replace(/\+/g, ' '))); } catch { return decodeEntities(s); } };

function parseTitleList(text, fetchedAt = Date.now()) {
  let j;
  try { j = JSON.parse(String(text).replace(/\\'/g, "'")); } catch { throw new InsightError('글 목록 응답을 읽을 수 없습니다(형식 바뀜)', { code: 'PARSE', source: SOURCE.titleList }); }
  if (j.resultCode && j.resultCode !== 'S') throw new InsightError('글 목록을 받지 못했습니다: ' + (j.resultMessage || j.resultCode), { code: 'HTTP', source: SOURCE.titleList });
  const posts = (j.postList || []).map(p => ({
    logNo: String(p.logNo),
    title: decodeTitle(p.title),
    categoryNo: p.categoryNo != null ? String(p.categoryNo) : null,
    date: parseListDate(p.addDate, fetchedAt),
    commentCount: p.commentCount === '' || p.commentCount == null ? null : Number(p.commentCount),
    searchYn: p.searchYn !== 'false',
    open: p.isPostNotOpen !== '1' && String(p.openType || '2') === '2',
  }));
  return { totalCount: Number(j.totalCount) || 0, countPerPage: Number(j.countPerPage) || 30, posts };
}

function parseMobilePostList(json) {
  if (!json || json.isSuccess === false || !json.result) throw new InsightError('모바일 글 목록 응답 형식이 다릅니다', { code: 'PARSE', source: SOURCE.mobileList });
  return (json.result.items || []).map(it => ({
    logNo: String(it.logNoObject ?? it.logNo),
    title: decodeEntities(it.titleWithInspectMessage || ''),
    categoryNo: it.categoryNo != null ? String(it.categoryNo) : null,
    categoryName: it.categoryName || null,
    addedAt: typeof it.addDate === 'number' ? it.addDate : null,
    sympathy: Number(it.sympathyCnt) || 0,
    comments: Number(it.commentCnt) || 0,
    shares: Number(it.shareCnt) || 0,
    images: Number(it.thumbnailCount) || 0,
    hasVideo: !!it.isVideoThumbnail,
    searchYn: it.searchYn !== false,
    open: it.allOpenPost !== false && !it.notOpen,
    readCount: typeof it.readCount === 'number' ? it.readCount : null,   // 손님에게는 null
  }));
}

function parseBlogInfo(json) {
  const r = json && json.result;
  if (!r || json.isSuccess === false) throw new InsightError('블로그 정보 응답 형식이 다릅니다', { code: 'PARSE', source: SOURCE.blogInfo });
  const n = v => (typeof v === 'number' ? v : null);
  return {
    blogName: r.blogName ?? null, nickName: r.nickName ?? null, blogNo: r.blogNo ?? null,
    subscriberCount: n(r.subscriberCount), totalVisitorCount: n(r.totalVisitorCount), dayVisitorCount: n(r.dayVisitorCount),
    directory: r.blogDirectoryName || null, powerBlog: !!r.powerBlog, officialBlog: !!r.officialBlog,
    influencer: !!(r.isNaverMateBlog || r.mateInfo), blocked: !!r.block,
  };
}

const cdata = s => String(s ?? '').replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim();
const tag = (b, n) => { const m = b.match(new RegExp(`<${n}>([\\s\\S]*?)</${n}>`, 'i')); return m ? cdata(m[1]) : undefined; };
function parseRss(xml) {
  const s = String(xml || '');
  const blocks = s.match(/<item>[\s\S]*?<\/item>/g) || [];
  const headEnd = blocks.length ? s.indexOf(blocks[0]) : s.length;
  const head = s.slice(0, headEnd);
  const items = [];
  for (const b of blocks) {
    const guid = tag(b, 'guid') || tag(b, 'link') || '';
    const logNo = (guid.match(/\/(\d{6,})(?:[?#]|$)/) || [])[1];
    const pub = Date.parse(tag(b, 'pubDate') || '');
    if (!logNo) continue;
    const tg = tag(b, 'tag');
    items.push({ logNo, title: decodeEntities(tag(b, 'title') || ''), category: tag(b, 'category') || null, publishedAt: Number.isFinite(pub) ? pub : null, tags: tg ? tg.split(',').map(x => x.trim()).filter(Boolean) : [] });
  }
  return { title: tag(head, 'title') || null, description: tag(head, 'description') || null, items };
}

// 블로그 1개 공개 데이터 수집. 실패한 부분은 errors 에 남기고 나머지는 계속.
async function collectBlog({ client, blogId, settings = {}, log = () => { }, now = Date.now }) {
  const errors = [], sources = [];
  const fetchedAt = now();
  const ref = { Referer: `https://m.blog.naver.com/${blogId}` };
  const strict = !!settings.strictRobots;
  const maxPages = Math.max(1, Math.min(Number(settings.maxPostPages) || 20, 100));

  // A. 전체 글 목록
  let titleList = null;
  try {
    const all = [];
    let total = 0;
    for (let p = 1; p <= maxPages; p++) {
      const r = await client.request(`https://blog.naver.com/PostTitleListAsync.naver?blogId=${encodeURIComponent(blogId)}&currentPage=${p}&countPerPage=30`, { headers: { Referer: `https://blog.naver.com/${blogId}` }, step: `글 목록 ${p}쪽`, source: SOURCE.titleList });
      const t = parseTitleList(r.text, fetchedAt);
      total = t.totalCount; all.push(...t.posts);
      if (t.posts.length < 30 || all.length >= total) break;
    }
    titleList = { totalCount: total, posts: all };
    sources.push(SOURCE.titleList);
  } catch (e) { errors.push({ source: SOURCE.titleList, message: e.message }); }

  // B. 글별 공감·댓글·사진 수
  let mobile = null;
  if (!strict) {
    try {
      const all = [];
      for (let p = 1; p <= maxPages; p++) {
        const r = await client.request(`https://m.blog.naver.com/api/blogs/${encodeURIComponent(blogId)}/post-list?categoryNo=0&itemCount=30&page=${p}`, { headers: ref, step: `글별 반응 ${p}쪽`, source: SOURCE.mobileList });
        const items = parseMobilePostList(r.json);
        all.push(...items);
        if (items.length < 30) break;
      }
      mobile = all; sources.push(SOURCE.mobileList);
    } catch (e) { errors.push({ source: SOURCE.mobileList, message: e.message }); }
  }

  // C. 블로그 정보(이웃 수·누적 방문자)
  let info = null;
  if (!strict) {
    try {
      const r = await client.request(`https://m.blog.naver.com/api/blogs/${encodeURIComponent(blogId)}`, { headers: ref, step: '블로그 정보', source: SOURCE.blogInfo });
      info = parseBlogInfo(r.json); sources.push(SOURCE.blogInfo);
    } catch (e) { errors.push({ source: SOURCE.blogInfo, message: e.message }); }
  }

  // D. RSS(발행 시각·태그)
  let rss = null;
  try {
    const r = await client.request(`https://rss.blog.naver.com/${encodeURIComponent(blogId)}.xml`, { step: 'RSS', source: SOURCE.rss });
    rss = parseRss(r.text); sources.push(SOURCE.rss);
  } catch (e) { errors.push({ source: SOURCE.rss, message: e.message.includes('404') ? 'RSS가 꺼져 있습니다(발행 시각·태그 없음)' : e.message }); }

  if (!titleList && !mobile) throw new InsightError('글 목록을 하나도 받지 못했습니다: ' + errors.map(e => e.message).join(' / '), { code: 'NETWORK', source: SOURCE.titleList });

  // 합치기: 전체 목록이 기준, 모바일 목록·RSS로 보강
  const byNo = new Map();
  const put = (logNo, patch) => byNo.set(logNo, { ...(byNo.get(logNo) || { logNo }), ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined && v !== null)) });
  for (const p of titleList ? titleList.posts : []) put(p.logNo, { title: p.title, categoryNo: p.categoryNo, date: p.date, comments: p.commentCount, searchYn: p.searchYn, open: p.open });
  for (const m of mobile || []) put(m.logNo, { title: m.title, categoryNo: m.categoryNo, categoryName: m.categoryName, addedAt: m.addedAt, date: m.addedAt ? kstDate(m.addedAt) : undefined, sympathy: m.sympathy, comments: m.comments, shares: m.shares, images: m.images, hasVideo: m.hasVideo, searchYn: m.searchYn, open: m.open });
  for (const it of rss ? rss.items : []) {
    if (!byNo.has(it.logNo)) continue;
    const cur = byNo.get(it.logNo);
    put(it.logNo, { addedAt: cur.addedAt || it.publishedAt, date: cur.date || (it.publishedAt ? kstDate(it.publishedAt) : undefined), categoryName: cur.categoryName || it.category, tags: it.tags });
  }
  const posts = [...byNo.values()].sort((a, b) => (b.addedAt || Date.parse(b.date || 0) || 0) - (a.addedAt || Date.parse(a.date || 0) || 0) || (b.logNo > a.logNo ? 1 : -1));

  return {
    source: sources, fetchedAt, errors,
    profile: {
      blogId,
      blogName: (info && info.blogName) || (rss && rss.title) || null,
      nickName: info ? info.nickName : null,
      totalPosts: titleList ? titleList.totalCount : posts.length,
      subscriberCount: info ? info.subscriberCount : null,
      totalVisitorCount: info ? info.totalVisitorCount : null,
      dayVisitorCountPartial: info ? info.dayVisitorCount : null,   // 수집 시점까지의 오늘 방문자(하루 전체 아님)
      directory: info ? info.directory : null,
      powerBlog: info ? info.powerBlog : null,
      influencer: info ? info.influencer : null,
      metricsAvailable: !!mobile,
    },
    posts,
  };
}

module.exports = { collectBlog, parseTitleList, parseMobilePostList, parseBlogInfo, parseRss, parseListDate, SOURCE };
