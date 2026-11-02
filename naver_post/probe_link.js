// 링크 카드 단추 진단: 열려 있는 전용 크롬(BLOG_ID 프로필)의 글쓰기 탭에서 oglink 단추·팝업 상태만 본다. 아무것도 입력·발행하지 않는다.
//   BLOG_ID=dongyangsongtan node probe_link.js
'use strict';
const { launch, WRITE_URL, sleep } = require('./common');
(async () => {
  const { browser, page: blank } = await launch();
  let page = (await browser.pages()).filter(p => p.url().includes('Write')).pop();
  const opened = !page;
  if (!page) { page = blank; await page.goto(WRITE_URL, { waitUntil: 'networkidle2' }); await sleep(3000); }
  else if (blank !== page) await blank.close().catch(() => { });
  const f = page.frames().find(x => x.name() === 'mainFrame');
  if (!f) { console.log('글쓰기 프레임 없음', page.url()); browser.disconnect(); return; }
  const info = await f.evaluate(() => {
    const q = s => document.querySelector(s);
    const vis = el => !!el && el.offsetParent !== null;
    const btn = q('.se-oglink-toolbar-button');
    const r = btn ? btn.getBoundingClientRect() : null;
    return {
      hasBtn: !!btn, btnVisible: vis(btn), btnRect: r && { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      toolbarButtons: [...document.querySelectorAll('.se-toolbar button')].filter(vis).map(b => b.className.split(' ').find(c => /toolbar-button$/.test(c)) || b.className.slice(0, 40)).slice(0, 40),
      popups: [...document.querySelectorAll('[class*="se-popup"]')].filter(vis).map(e => e.className.slice(0, 80)),
      panels: [...document.querySelectorAll('.se-side-panel, .se-help-panel, .se-flayer, .se-sidebar')].filter(vis).map(e => e.className.slice(0, 60)),
      components: document.querySelectorAll('.se-content .se-component').length,
      oglinks: document.querySelectorAll('.se-component.se-oglink').length,
      title: (q('.se-title-text') || {}).innerText,
    };
  });
  console.log(JSON.stringify(info, null, 1));
  await page.screenshot({ path: process.env.SHOT || 'probe_link.png' });
  if (process.env.TRY_CLICK === '1') {
    const btn = await f.$('.se-oglink-toolbar-button');
    if (btn) { await btn.click(); await sleep(1500); }
    const after = await f.evaluate(() => ({ popups: [...document.querySelectorAll('[class*="se-popup"]')].filter(e => e.offsetParent !== null).map(e => e.className.slice(0, 80)), inputs: [...document.querySelectorAll('input')].filter(e => e.offsetParent !== null).map(e => (e.className || '') + '|' + (e.placeholder || '')).slice(0, 10) }));
    console.log('클릭 후', JSON.stringify(after, null, 1));
    await page.screenshot({ path: (process.env.SHOT || 'probe_link.png').replace('.png', '_after.png') });
    const cancel = await f.$('.se-popup-button-cancel'); if (cancel) await cancel.click().catch(() => { });
  }
  if (opened) console.log('(새로 연 글쓰기 탭은 그대로 둠)');
  browser.disconnect();
})().catch(e => { console.error('오류:', e.message); process.exitCode = 1; });
