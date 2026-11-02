// 링크 카드 진단 2: 링크 단추가 '글감' 통합 패널(se-flayer-unified)을 여는지, 그 패널의 검색칸에 주소를 넣으면 링크 카드가 들어가는지 본다
//   BLOG_ID=whitedream55 node probe_link3.js
'use strict';
const { launch, WRITE_URL, sleep, pause } = require('./common');
const { Editor } = require('./editor');
(async () => {
  const { browser, page: blank } = await launch();
  let page = (await browser.pages()).filter(p => p.url().includes('Write')).pop();
  if (!page) { page = blank; await page.goto(WRITE_URL, { waitUntil: 'networkidle2' }); await sleep(3500); }
  else if (blank !== page) await blank.close().catch(() => { });
  await page.bringToFront();
  const f = page.frames().find(x => x.name() === 'mainFrame');
  if (!f) throw new Error('mainFrame 없음');
  const e = new Editor(page, f); await e.tidy();
  const panel = () => f.evaluate(() => {
    const vis = el => !!el && el.getBoundingClientRect().width > 0;
    const w = document.querySelector('.se-flayer-unified-toolbar-wrapper');
    if (!w) return null;
    const tb = w.querySelector('.se-flayer-unified-toolbar');
    return {
      state: tb ? [...tb.classList].filter(c => c.indexOf('--') >= 0).join(',') : '',
      cat: (w.querySelector('.se-flayer-unified-category-dropdown-trigger') || {}).innerText,
      ph: (w.querySelector('.se-flayer-unified-search-input') || {}).placeholder,
      val: (w.querySelector('.se-flayer-unified-search-input') || {}).value,
      buttons: [...w.querySelectorAll('button')].filter(vis).map(b => b.className.toString().replace(/se-flayer-unified-/g, '').slice(0, 50) + '|' + (b.innerText || b.getAttribute('aria-label') || '').trim().slice(0, 20)).slice(0, 25),
      items: [...w.querySelectorAll('li, [class*="item"]')].filter(vis).map(x => x.className.toString().replace(/se-flayer-unified-/g, '').slice(0, 50) + '|' + (x.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60)).slice(0, 12),
    };
  });
  const comps = () => f.$$eval('.se-content .se-component', a => a.map(c => [...c.classList].filter(x => x !== 'se-component').join('.')));
  const topPop = () => page.evaluate(() => [...document.querySelectorAll('[class*="popup"],[class*="oglink"],dialog')].map(x => x.className.toString().slice(0, 60) + (x.getBoundingClientRect().width ? '' : ' (hidden)')).slice(0, 8));
  const p = (await f.$$('.se-content .se-component:last-child .se-text-paragraph')).pop(); await p.click(); await pause(300);
  console.log('[panel before]', JSON.stringify(await panel()));
  await (await f.$('.se-oglink-toolbar-button')).click(); await sleep(1500);
  console.log('[panel after oglink click]', JSON.stringify(await panel()));
  console.log('[top doc popups]', JSON.stringify(await topPop()));
  console.log('[frames]', page.frames().map(x => x.name() + ':' + x.url().slice(0, 60)).join(' | '));
  // 검색칸에 주소 넣고 Enter
  const inp = await f.$('.se-flayer-unified-search-input');
  if (inp) {
    await inp.click(); await pause(300);
    for (const ch of 'https://blog.naver.com/whitedream55') { await page.keyboard.sendCharacter(ch); await sleep(10); }
    await pause(500); await page.keyboard.press('Enter'); await sleep(3500);
    console.log('[panel after url enter]', JSON.stringify(await panel()));
    console.log('[comps after enter]', JSON.stringify(await comps()));
    // 결과 항목·추가 단추 클릭 시도
    const clicked = await f.evaluate(() => {
      const w = document.querySelector('.se-flayer-unified-toolbar-wrapper');
      const vis = el => !!el && el.getBoundingClientRect().width > 0;
      const b = [...w.querySelectorAll('button, li, a')].filter(vis).find(x => /추가|삽입|넣기|insert|add|result|item/i.test(x.className + ' ' + (x.innerText || '')) && !/search|검색|category|카테고리|fold|닫기/i.test(x.className + ' ' + (x.innerText || '')));
      if (!b) return null; b.click(); return b.className.toString().slice(0, 60) + '|' + (b.innerText || '').trim().slice(0, 30);
    });
    console.log('[clicked result]', clicked);
    await sleep(3000);
    console.log('[comps after result click]', JSON.stringify(await comps()));
    console.log('[panel end]', JSON.stringify(await panel()));
  }
  if (browser.attached) browser.disconnect(); else { await page.close({ runBeforeUnload: false }).catch(() => { }); await browser.close().catch(() => { }); }
  setTimeout(() => process.exit(0), 500).unref();
})().catch(e => { console.error('오류:', e.message); process.exitCode = 1; setTimeout(() => process.exit(1), 500).unref(); });
