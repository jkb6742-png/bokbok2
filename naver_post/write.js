// 직접 타이핑 발행: node write.js <원고 .js 또는 .txt>
//   기본: 사람 타자 속도로 전부 입력 → 발행 설정(카테고리·태그) → 전수검사 → 멈춤
//   PUBLISH=1 : 전수검사가 전부 통과했을 때만 최종 [발행] 클릭
//   FAST=1    : 구조 시험용 빠른 입력
//   BLOG_ID   : 어느 계정 블로그에 쓸지 (없으면 jsrjkb6742)
//   TAG_PAUSE : 태그 하나 친 뒤 Enter까지 기다리는 ms (기본 900)
//   TYPO_N / THINK_N : 원고 1편당 오타 내고 고치기 · 문장 끝 생각 멈춤 횟수 (humanize.js, 기본 0)
//   READ_N / READ_SEC : 발행 뒤 관련 키워드로 다른 사람 글 N편을 각 약 READ_SEC초 읽기 (browse.js, 읽기만)
//   CLEAR_CACHE=1 : 끝난 뒤 이 계정 크롬의 캐시만 비움(쿠키·로그인 유지)
//   REPORT_DIR: 전수검사 HTML 저장 폴더
// 화면(bokbok 앱)용으로 '@@진행 i/n', '@@결과 {json}' 줄을 함께 출력한다
const path = require('path'), fs = require('fs');
const { launch, waitLogin, WRITE_URL, BLOG_ID, sleep, pause } = require('./common');
const { Editor } = require('./editor');
const { finish } = require('./finish');
const { browse } = require('./browse');
const H = require('./humanize');

const S = require('./manuscript').load(process.argv[2]);
// 사람 습관(오타·멈춤) 횟수를 글 전체에 고르게 흩기 위해 전체 글자 수를 알려 준다
H.setBudget({ chars: [S.title, ...S.blocks.flatMap(b => b.text || (b.quote ? [b.quote] : []))].join('').replace(/\[\[|\]\]|\*\*|\|#[0-9a-f]{6}/gi, '').length });
const ROOT = path.resolve(__dirname, '..', '..');
const MY_BLOG = `https://blog.naver.com/${BLOG_ID}`;
// 링크 블록이 true이거나 다른 계정 블로그 주소면 지금 계정 블로그로
const linkUrl = l => (l === true || /^https:\/\/blog\.naver\.com\/[^/]+\/?$/.test(l)) ? MY_BLOG : l;

let browserRef = null;   // 오류로 멈출 때 창은 남기되 프로세스는 끝내기 위해
(async () => {
  const { browser, page } = await launch();
  browserRef = browser;
  for (const p of await browser.pages()) if (p !== page && p.url().includes('Write')) await p.close({ runBeforeUnload: false });
  await page.goto(WRITE_URL, { waitUntil: 'networkidle2' });
  await sleep(3000);
  let f = page.frames().find(x => x.name() === 'mainFrame');
  if (!f) {
    // 로그인이 안 돼 있으면(새 시크릿 창이거나 세션이 풀림) 사람이 창에서 로그인할 때까지 기다린다
    if (!/nid\.naver\.com/.test(page.url())) await page.goto('https://nid.naver.com/nidlogin.login?url=' + encodeURIComponent(WRITE_URL), { waitUntil: 'networkidle2' }).catch(() => { });
    f = await waitLogin(page, WRITE_URL);
    console.log('로그인 확인 · 글쓰기 시작');
    await sleep(1500);
  }
  const e = new Editor(page, f);
  await e.tidy();

  const ST = require('./styles');
  console.log(`인용구 스타일: ${ST.quoteLabel(S.quoteStyle)} · 구분선 스타일: ${ST.lineLabel(S.lineStyle)}`);
  console.log('제목'); await e.title(S.title);
  let prev = 'title';
  for (const [i, b] of S.blocks.entries()) {
    const t0 = Date.now();
    if (b.quote) await e.quote(b.quote, b.style || S.quoteStyle);
    else if (b.line) await e.line(b.style || S.lineStyle);
    else if (b.img !== undefined) await e.image(S.images[b.img]);
    else if (b.link) { await e.link(linkUrl(b.link)); await e.lastLine(); }
    else if (b.text || b.hashtags) {
      if (prev === 'quote') await e.afterQuote();
      else if (prev === 'img' || prev === 'title') await e.lastLine();
      else if (b.hashtags && prev === 'text') await e.newLine();   // 본문 바로 뒤 해시태그는 새 본문 칸에 (앞 줄에 붙지 않게)
      if (b.hashtags) await e.text([S.tags.map(t => '#' + t).join(' ')], { size: 'fs15' });
      else await e.text(b.text);
    }
    prev = b.quote ? 'quote' : b.line ? 'line' : b.img !== undefined ? 'img' : b.link ? 'link' : 'text';
    console.log(`  ${i + 1}/${S.blocks.length} ${prev} ${((Date.now() - t0) / 1000).toFixed(0)}초`);
    console.log(`@@진행 ${i + 1}/${S.blocks.length} · ${({ quote: '인용구', line: '구분선', img: '사진', link: '링크', text: '본문', hashtags: '해시태그' })[prev] || prev} 입력`);
  }

  const hs = H.stats();
  if (hs.typo || hs.think) console.log(`사람 습관: 오타 고침 ${hs.typo}회 · 생각 멈춤 ${hs.think}회`);

  // 발행 설정(카테고리·태그) → 전수검사 → 통과 시 발행
  console.log('@@진행 발행 설정 · 카테고리·태그');
  const r = await finish(page, f, S, path.basename(S.file).replace(/\.(js|txt)$/, ''));

  // 발행이 됐으면 글의 키워드로 다른 사람 글을 몇 편 읽는다 (읽기만, 공감·댓글·이웃 없음)
  const READ_N = Number(process.env.READ_N || 0), READ_SEC = Number(process.env.READ_SEC || 60);
  if (r.published && READ_N > 0 && !process.env.FAST) {
    const keywords = [S.keyword, ...(S.tags || [])].filter(Boolean);
    console.log(`관련 글 읽기: ${READ_N}편 · 키워드 ${keywords.slice(0, 3).join(', ')}`);
    await sleep(Math.round(4000 + Math.random() * 6000));
    const read = await browse(browser, { keywords, count: READ_N, minSec: READ_SEC * 0.7, maxSec: READ_SEC * 1.3, myId: BLOG_ID }).catch(e => { console.log('읽기 중 오류:', e.message); return []; });
    console.log(`관련 글 읽기 끝: ${read.length}편`);
  }
  // 발행 뒤 캐시 비우기(쿠키·로그인은 그대로): CLEAR_CACHE=1 이면 이 계정 크롬 프로필의 캐시만 지운다
  if (process.env.CLEAR_CACHE === '1' && !process.env.FAST) {
    try { const cdp = await page.target().createCDPSession(); await cdp.send('Network.clearBrowserCache'); await cdp.detach(); console.log('캐시 비움 (로그인 유지)'); }
    catch (e) { console.log('캐시 비우기 실패:', e.message); }
  }
  // 새 시크릿 창 방식이면 창을 닫고 임시 프로필을 통째로 지운다(쿠키·캐시·기록 모두 사라짐)
  if (browser.fresh) { await browser.wipe(); console.log('시크릿 창 닫고 임시 프로필 삭제'); }
  else if (browser.attached) browser.disconnect();   // 이미 열려 있던 전용 창은 그대로 둔다
  else { await browser.close().catch(() => { }); console.log('전용 크롬 닫음 (로그인 세션은 프로필에 남음)'); }   // 우리가 띄운 창은 닫아야 이 프로세스가 끝난다
  setTimeout(() => process.exit(0), 3000).unref();
})().catch(e => {
  console.error('오류:', e.message); console.log('@@결과 ' + JSON.stringify({ pass: false, fails: [e.message] }));
  // 창은 그대로 둬서 사람이 확인·이어서 할 수 있게 하고(disconnect만), 프로세스는 끝낸다
  try { if (browserRef && !browserRef.fresh) browserRef.disconnect(); } catch { }
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 1500).unref();
});
