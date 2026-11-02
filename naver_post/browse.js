// 발행 뒤 '관련 글 읽기': 글의 키워드로 네이버 블로그 검색 → 다른 사람 글 몇 편을 사람처럼 스크롤하며 읽는다.
//   읽기만 한다. 공감·댓글·이웃 신청·클릭 유도는 하지 않는다 (다른 사용자에게 어떤 행동도 남기지 않음).
//   browse(browser, { keywords, count, minSec, maxSec, myId, log }) → [{ blogId, url, title, keyword, sec }]
//   단독 시험: READ_N=2 node browse.js "INTP 연애" "INTP 특징"
'use strict';
const { sleep, pause, guard, BLOG_ID } = require('./common');

const rnd = (a, b) => a + Math.random() * (b - a);
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const POST_RE = /^https?:\/\/(?:m\.)?blog\.naver\.com\/([A-Za-z0-9_-]+)\/(\d{6,})/;
const SEARCH = q => `https://search.naver.com/search.naver?ssc=tab.blog.all&sm=tab_jum&query=${encodeURIComponent(q)}`;

// 사람처럼 읽기: 조금씩 내리고, 가끔 멈추고, 가끔 조금 되돌아간다
async function readLike(page, sec, log) {
  const until = Date.now() + sec * 1000;
  let n = 0;
  while (Date.now() < until) {
    const dy = Math.random() < 0.12 ? -rnd(80, 250) : rnd(120, 520);
    await page.mouse.wheel({ deltaY: Math.round(dy) }).catch(() => { });
    await sleep(rnd(900, 3200));
    if (++n % 6 === 0 && Math.random() < 0.5) await sleep(rnd(2000, 5000)); // 한 대목에서 머무름
    if (Math.random() < 0.08) await page.mouse.move(rnd(200, 900), rnd(200, 700)).catch(() => { });
  }
}

// 검색 결과에서 다른 사람 글 주소 모으기 (한 블로그당 1개, 내 블로그 제외)
async function collect(page, keyword, myId) {
  await page.goto(SEARCH(keyword), { waitUntil: 'networkidle2', timeout: 30000 });
  await pause(1500);
  for (let i = 0; i < 3; i++) { await page.mouse.wheel({ deltaY: Math.round(rnd(300, 700)) }).catch(() => { }); await sleep(rnd(700, 1600)); }
  const links = await page.$$eval('a[href*="blog.naver.com/"]', as => as.map(a => ({ href: a.href, text: (a.innerText || '').trim() })));
  const seen = new Set(), out = [];
  for (const l of links) {
    const m = l.href.match(POST_RE);
    if (!m || m[1] === myId || seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ blogId: m[1], url: `https://blog.naver.com/${m[1]}/${m[2]}`, text: l.text.slice(0, 80) });
  }
  return out.slice(0, 12);
}

async function browse(browser, { keywords = [], count = 2, minSec = 40, maxSec = 90, myId = BLOG_ID, log = console.log } = {}) {
  const kws = [...new Set(keywords.map(k => String(k || '').trim()).filter(Boolean))].slice(0, 3);
  count = Math.max(0, Math.min(5, count | 0));
  if (!kws.length || !count) return [];
  const page = await guard(await browser.newPage());
  const read = [];
  try {
    const pool = [];
    for (const k of kws) {
      try { for (const c of await collect(page, k, myId)) if (!pool.some(p => p.blogId === c.blogId)) pool.push({ ...c, keyword: k }); }
      catch (e) { log(`  검색 실패(${k}): ${e.message}`); }
      if (pool.length >= count * 3) break;
      await pause(1200);
    }
    const picks = shuffle(pool.slice(0, 10)).slice(0, count);
    for (const [i, p] of picks.entries()) {
      const sec = Math.round(rnd(minSec, maxSec));
      log(`  읽기 ${i + 1}/${picks.length} ${p.blogId} (${p.keyword}) ${sec}초`);
      console.log(`@@진행 읽기 ${i + 1}/${picks.length}`);
      try {
        await page.goto(p.url, { waitUntil: 'networkidle2', timeout: 30000 });
        await pause(2000);
        const title = (await page.title().catch(() => '')) || p.text;
        await readLike(page, sec, log);
        const item = { blogId: p.blogId, url: p.url, title: title.replace(/\s*:\s*네이버\s*블로그$/, '').slice(0, 80), keyword: p.keyword, sec };
        read.push(item);
        console.log('@@읽음 ' + JSON.stringify(item));
      } catch (e) { log(`  읽기 실패 ${p.blogId}: ${e.message}`); }
      if (i < picks.length - 1) await sleep(rnd(2500, 6000));
    }
  } finally {
    await page.close().catch(() => { });
  }
  return read;
}

module.exports = { browse, collect, readLike, POST_RE, SEARCH };

if (require.main === module) (async () => {
  const { launch } = require('./common');
  const { browser, page } = await launch();
  const r = await browse(browser, { keywords: process.argv.slice(2), count: Number(process.env.READ_N || 2), minSec: Number(process.env.READ_SEC || 60) * 0.7, maxSec: Number(process.env.READ_SEC || 60) * 1.3 });
  console.log(JSON.stringify(r, null, 1));
  await page.close().catch(() => { });
  browser.disconnect();
})().catch(e => { console.error('오류:', e.message); process.exitCode = 1; });
