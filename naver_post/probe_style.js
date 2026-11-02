// 인용구·구분선 스타일 선택 UI 진단: 전용 크롬에서 글쓰기 화면을 열고 툴바의 스타일 선택 레이어 DOM을 덤프하고,
// 세로선 인용구·구분선2를 실제로 넣어 컴포넌트 클래스를 확인한다. 발행 없음. 끝나면 탭을 닫는다(임시저장은 남을 수 있음).
//   BLOG_ID=whitedream55 node probe_style.js
'use strict';
const { launch, WRITE_URL, sleep, pause } = require('./common');
const { Editor } = require('./editor');
(async () => {
  const { browser, page } = await launch();
  await page.goto(WRITE_URL, { waitUntil: 'networkidle2' }); await sleep(3500);
  const f = page.frames().find(x => x.name() === 'mainFrame');
  if (!f) throw new Error('mainFrame 없음 (로그인 안 됨?)');
  const e = new Editor(page, f); await e.tidy();
  const visBtns = re => f.evaluate(re => {
    const vis = el => el.offsetParent !== null;
    return [...document.querySelectorAll('button')].filter(vis).filter(b => new RegExp(re).test(b.className)).map(b => ({ cls: b.className, txt: (b.innerText || '').trim().slice(0, 20), dv: b.getAttribute('data-value'), aria: b.getAttribute('aria-label'), sel: b.classList.contains('se-is-selected') }));
  }, re);
  const item = await f.evaluate(() => (document.querySelector('.se-toolbar-item-insert-quotation') || {}).outerHTML || '').then(s => s.slice(0, 1500));
  console.log('[toolbar item]', item);
  console.log('[before] quotation buttons:', JSON.stringify(await visBtns('quotation')));
  // 옵션 레이어 열기
  const opt = await f.$('.se-toolbar-item-insert-quotation .se-document-toolbar-select-option-button');
  console.log('option button exists:', !!opt);
  if (opt) { await opt.click(); await pause(800); }
  console.log('[layer open] quotation buttons:', JSON.stringify(await visBtns('quotation')));
  const layerHtml = await f.evaluate(() => { const l = [...document.querySelectorAll('[class*="layer"],[class*="option-list"],[class*="popup"]')].filter(x => x.offsetParent !== null && /quotation/.test(x.innerHTML)); return l.map(x => x.className + ' :: ' + x.outerHTML.slice(0, 1200)).slice(0, 2); });
  console.log('[layer html]', JSON.stringify(layerHtml, null, 1));
  // 세로선 옵션 클릭 시도
  const clicked = await f.evaluate(() => {
    const vis = el => el.offsetParent !== null;
    const b = [...document.querySelectorAll('button')].filter(vis).find(x => /quotation_line/.test(x.className) || /quotation_line/.test(x.getAttribute('data-value') || ''));
    if (!b) return null; b.click(); return b.className + ' | dv=' + b.getAttribute('data-value');
  });
  console.log('clicked line option:', clicked);
  await pause(900);
  const comps = () => f.$$eval('.se-content .se-component', a => a.map(c => c.className));
  console.log('[after line option] comps:', JSON.stringify(await comps()));
  console.log('[after] main button:', JSON.stringify(await visBtns('insert-quotation')));
  // 기본 단추 한 번 더 → 마지막 스타일이 유지되는지
  await e.key('End');
  await f.click('.se-insert-quotation-default-toolbar-button').catch(err => console.log('main click fail', err.message)); await pause(900);
  console.log('[after main again] comps:', JSON.stringify(await comps()));
  // 구분선 옵션
  const lopt = await f.$('.se-toolbar-item-insert-horizontal-line .se-document-toolbar-select-option-button');
  console.log('line option button exists:', !!lopt);
  if (lopt) { await lopt.click(); await pause(800); }
  console.log('[layer open] line buttons:', JSON.stringify(await visBtns('horizontal|line')));
  const lclicked = await f.evaluate(() => {
    const vis = el => el.offsetParent !== null;
    const b = [...document.querySelectorAll('button')].filter(vis).find(x => /line1/.test(x.className) || /line1/.test(x.getAttribute('data-value') || ''));
    if (!b) return null; b.click(); return b.className + ' | dv=' + b.getAttribute('data-value');
  });
  console.log('clicked line1 option:', lclicked);
  await pause(900);
  console.log('[after line1] comps:', JSON.stringify(await comps()));
  await page.close({ runBeforeUnload: false }).catch(() => { });
  if (browser.attached) browser.disconnect(); else await browser.close().catch(() => { });
  setTimeout(() => process.exit(0), 1000).unref();
})().catch(e => { console.error('오류:', e.message); process.exitCode = 1; setTimeout(() => process.exit(1), 1000).unref(); });
