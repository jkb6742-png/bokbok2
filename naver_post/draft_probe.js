// 임시저장 글 목록 진단: 전용 크롬(BLOG_ID 프로필)에서 글쓰기 화면을 열고, 임시저장 안내창·저장 목록 단추·목록 항목의 DOM을 본다. 입력·발행 없음.
//   BLOG_ID=whitedream55 node draft_probe.js            → 화면 상태 덤프 + draft_probe.png
//   BLOG_ID=whitedream55 OPEN_LIST=1 node draft_probe.js → 저장 목록 열어서 항목 덤프
'use strict';
const { launch, WRITE_URL, sleep } = require('./common');
(async () => {
  const { browser, page: blank } = await launch();
  let page = (await browser.pages()).filter(p => p.url().includes('Write')).pop();
  if (!page) { page = blank; await page.goto(WRITE_URL, { waitUntil: 'networkidle2' }); await sleep(4000); }
  else if (blank !== page) await blank.close().catch(() => { });
  await page.bringToFront();
  const f = page.frames().find(x => x.name() === 'mainFrame') || page.mainFrame();
  const dump = () => f.evaluate(() => {
    const vis = el => !!el && el.offsetParent !== null;
    const txt = el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    return {
      url: location.href,
      components: document.querySelectorAll('.se-content .se-component').length,
      title: txt(document.querySelector('.se-title-text') || {}),
      layers: [...document.querySelectorAll('[class*="popup"],[class*="layer"],[role="dialog"]')].filter(vis).map(e => e.className.toString().slice(0, 70) + ' :: ' + txt(e).slice(0, 80)).slice(0, 12),
      buttons: [...document.querySelectorAll('button, a')].filter(vis).map(b => (b.className.toString().slice(0, 50)) + ' | ' + txt(b)).filter(s => /저장|불러오|임시|확인|취소|삭제/.test(s)).slice(0, 30),
      listItems: [...document.querySelectorAll('li')].filter(vis).map(li => li.className.toString().slice(0, 40) + ' | ' + txt(li)).filter(s => /임플란트|세종|\d{4}\.\d{2}|\d{2}:\d{2}/.test(s)).slice(0, 20),
    };
  });
  console.log('[처음]', JSON.stringify(await dump(), null, 1));
  await page.screenshot({ path: 'draft_probe.png' });
  if (process.env.OPEN_LIST === '1') {
    // 상단 '저장 N' 단추 옆의 목록 단추(▾) 또는 '저장 N' 자체를 눌러 목록 열기
    const clicked = await f.evaluate(() => {
      const vis = el => !!el && el.offsetParent !== null;
      const cands = [...document.querySelectorAll('button')].filter(vis).filter(b => /저장/.test(b.innerText || '') && /\d/.test(b.innerText || ''));
      const arrow = [...document.querySelectorAll('button')].filter(vis).filter(b => /temp_save|draft|save_list|_list|arrow|more/i.test(b.className) && !/publish/i.test(b.className));
      const target = cands[0] || arrow[0];
      if (!target) return null;
      target.click(); return target.className + ' | ' + (target.innerText || '').trim();
    });
    console.log('목록 단추 클릭:', clicked);
    await sleep(2500);
    console.log('[목록]', JSON.stringify(await dump(), null, 1));
    await page.screenshot({ path: 'draft_probe_list.png' });
  }
  browser.disconnect();
})().catch(e => { console.error('오류:', e.message); process.exitCode = 1; });
