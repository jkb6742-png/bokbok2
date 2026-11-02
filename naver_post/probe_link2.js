// 링크 카드 단추 진단: 열려 있는 글쓰기 탭에 붙어 링크 단추를 누르고 무엇이 생기는지 덤프 (입력·발행 없음)
//   BLOG_ID=whitedream55 node probe_link2.js
'use strict';
const { launch, sleep, pause } = require('./common');
(async () => {
  const { WRITE_URL } = require('./common');
  const { Editor } = require('./editor');
  const { browser, page: blank } = await launch();
  let page = (await browser.pages()).filter(p => p.url().includes('Write')).pop();
  if (!page) { page = blank; await page.goto(WRITE_URL, { waitUntil: 'networkidle2' }); await sleep(3500); }
  else if (blank !== page) await blank.close().catch(() => { });
  await page.bringToFront();
  const f = page.frames().find(x => x.name() === 'mainFrame');
  if (!f) throw new Error('mainFrame 없음');
  await new Editor(page, f).tidy();
  const snap = () => f.evaluate(() => {
    const vis = el => el.offsetParent !== null;
    const og = [...document.querySelectorAll('[class*="oglink"]')].map(x => ({ tag: x.tagName, cls: x.className.toString().slice(0, 120), vis: vis(x), html: x.outerHTML.slice(0, 300) }));
    const inputs = [...document.querySelectorAll('input, textarea')].filter(vis).map(x => ({ cls: x.className.toString().slice(0, 80), ph: x.placeholder, type: x.type }));
    const btn = document.querySelector('.se-oglink-toolbar-button');
    const b = btn ? { cls: btn.className, disabled: btn.disabled, aria: btn.getAttribute('aria-expanded'), rect: JSON.stringify(btn.getBoundingClientRect()), parent: btn.parentElement.className.toString().slice(0, 120) } : null;
    const popups = [...document.querySelectorAll('[class*="popup"]')].filter(vis).map(x => x.className.toString().slice(0, 100));
    return { og, inputs, btn: b, popups, comps: document.querySelectorAll('.se-content .se-component').length, focused: document.activeElement && document.activeElement.className.toString().slice(0, 80) };
  });
  console.log('[before]', JSON.stringify(await snap(), null, 1));
  const popupNow = () => f.evaluate(() => { const vis = el => el && el.offsetParent !== null; return { oglinkPopup: !!document.querySelector('.se-popup-oglink-input'), visPopup: [...document.querySelectorAll('[class*="popup"],[class*="layer"]:not([class*="flayer"])')].filter(vis).map(x => x.className.toString().slice(0, 70)).slice(0, 5), focused: document.activeElement && document.activeElement.className.toString().slice(0, 60), sel: String(window.getSelection && window.getSelection().anchorNode && window.getSelection().anchorNode.parentElement && window.getSelection().anchorNode.parentElement.className).slice(0, 60) }; });
  const lastP = async () => { const p = await f.$$('.se-content .se-component:last-child .se-text-paragraph'); return p[p.length - 1]; };
  // 1) 본문 줄 클릭 → 마우스 클릭
  let p = await lastP(); await p.click(); await pause(400);
  console.log('[1 caret]', JSON.stringify(await popupNow()));
  let btn = await f.$('.se-oglink-toolbar-button'); await btn.click(); await sleep(1500);
  console.log('[1 after mouse click]', JSON.stringify(await popupNow()));
  await page.keyboard.press('Escape').catch(() => { }); await pause(400);
  // 2) 글자 하나 치고(에디터 포커스 확실) → 마우스 클릭
  p = await lastP(); await p.click(); await pause(300); await page.keyboard.sendCharacter('ㅁ'); await pause(400);
  console.log('[2 typed]', JSON.stringify(await popupNow()));
  btn = await f.$('.se-oglink-toolbar-button'); await btn.click(); await sleep(1500);
  console.log('[2 after mouse click]', JSON.stringify(await popupNow()));
  await page.keyboard.press('Escape').catch(() => { }); await pause(400);
  // 3) mousedown/mouseup/click 순서로 DOM 이벤트
  p = await lastP(); await p.click(); await pause(300);
  await btn.evaluate(b => { for (const t of ['mousedown', 'mouseup', 'click']) b.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); }); await sleep(1500);
  console.log('[3 after dom events]', JSON.stringify(await popupNow()));
  await page.keyboard.press('Escape').catch(() => { }); await pause(400);
  // 4) 왼쪽 삽입 메뉴(+)에서 링크
  const ins = await f.evaluate(() => { const b = document.querySelector('.se-insert-menu-button-oglink, [class*="insert-menu"][class*="oglink"]'); return b ? b.className : null; });
  console.log('[4 insert-menu oglink button]', ins);
  if (ins) { await f.evaluate(() => document.querySelector('.se-insert-menu-button-oglink').click()); await sleep(1500); console.log('[4 after insert-menu click]', JSON.stringify(await popupNow())); }
  // 5) 전체 문서에서 'popup' 요소(보이지 않는 것 포함)
  const hiddenPop = await f.evaluate(() => [...document.querySelectorAll('[class*="popup"]')].map(x => x.className.toString().slice(0, 70) + (x.offsetParent === null ? ' (hidden)' : '')).slice(0, 12));
  console.log('[5 all popup-ish]', JSON.stringify(hiddenPop));
  console.log('[after]', JSON.stringify(await snap(), null, 1));
  // 문서 전체에서 새로 보이는 요소 중 input 이 있는 레이어
  const layers = await f.evaluate(() => [...document.querySelectorAll('div')].filter(d => d.offsetParent !== null && d.querySelector('input') && d.getBoundingClientRect().width < 900 && d.getBoundingClientRect().height < 500 && /link|url|oglink|popup|layer/i.test(d.className)).map(d => d.className.toString().slice(0, 100) + ' :: ' + d.outerHTML.slice(0, 400)).slice(0, 5));
  console.log('[layers with input]', JSON.stringify(layers, null, 1));
  await page.keyboard.press('Escape').catch(() => { });
  if (browser.attached) browser.disconnect(); else { await page.close({ runBeforeUnload: false }).catch(() => { }); await browser.close().catch(() => { }); }
  setTimeout(() => process.exit(0), 500).unref();
})().catch(e => { console.error('오류:', e.message); process.exitCode = 1; setTimeout(() => process.exit(1), 500).unref(); });
