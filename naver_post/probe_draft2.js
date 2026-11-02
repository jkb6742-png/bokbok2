// 임시저장 불러오기 안내창 진단: 글쓰기 화면을 열고 보이는 팝업·단추를 덤프한다. 아무것도 누르지 않고 닫는다.
//   BLOG_ID=whitedream55 node probe_draft2.js
'use strict';
const { launch, WRITE_URL, sleep } = require('./common');
(async () => {
  const { browser, page } = await launch();
  await page.goto(WRITE_URL, { waitUntil: 'networkidle2' }); await sleep(4000);
  const f = page.frames().find(x => x.name() === 'mainFrame');
  if (!f) throw new Error('mainFrame 없음');
  const d = await f.evaluate(() => {
    const vis = el => !!el && el.getBoundingClientRect().width > 0;
    const txt = el => (el.innerText || '').replace(/\s+/g, ' ').trim();
    return {
      components: document.querySelectorAll('.se-content .se-component').length,
      popups: [...document.querySelectorAll('[class*="popup"]')].filter(vis).map(e => e.className.toString().slice(0, 80) + ' :: ' + txt(e).slice(0, 120)),
      buttons: [...document.querySelectorAll('button')].filter(vis).map(b => b.className.toString().slice(0, 70) + ' | ' + txt(b).slice(0, 30)).filter(s => /저장|불러오|임시|확인|취소|popup/.test(s)).slice(0, 20),
    };
  });
  console.log(JSON.stringify(d, null, 1));
  await page.close({ runBeforeUnload: false }).catch(() => { });
  if (browser.attached) browser.disconnect(); else await browser.close().catch(() => { });
  setTimeout(() => process.exit(0), 500).unref();
})().catch(e => { console.error('오류:', e.message); process.exitCode = 1; setTimeout(() => process.exit(1), 500).unref(); });
