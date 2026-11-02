// 링크 카드 진단 3: 빈 줄에 주소를 치고 Enter → 편집기가 링크 카드로 바꾸는지, 주소 글자가 남는지
//   BLOG_ID=whitedream55 node probe_link4.js
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
  const comps = () => f.$$eval('.se-content .se-component', a => a.map(c => [...c.classList].filter(x => x !== 'se-component').join('.') + ' :: ' + (c.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 50)));
  await e.title('링크 자동 카드 시험 (삭제용)');
  await e.lastLine();
  await e.text(['본문 한 줄입니다.']);
  await e.newLine();
  console.log('[before url]', JSON.stringify(await comps()));
  for (const ch of 'https://blog.naver.com/whitedream55') { await page.keyboard.sendCharacter(ch); await sleep(8); }
  await pause(400);
  console.log('[typed url]', JSON.stringify(await comps()));
  await page.keyboard.press('Enter');
  for (let t = 0; t < 20; t++) { await sleep(500); if (await f.$('.se-content .se-component.se-oglink')) break; }
  await sleep(1500);
  console.log('[after enter]', JSON.stringify(await comps()));
  const popups = await f.evaluate(() => [...document.querySelectorAll('[class*="popup"]')].filter(x => x.getBoundingClientRect().width > 0).map(x => x.className.toString().slice(0, 70) + ' :: ' + (x.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60)));
  console.log('[popups]', JSON.stringify(popups));
  // 뒤에 본문 이어 쓰기
  await e.lastLine(); await e.text(['카드 뒤 본문입니다.']);
  console.log('[after text]', JSON.stringify(await comps()));
  if (browser.attached) browser.disconnect(); else { await page.close({ runBeforeUnload: false }).catch(() => { }); await browser.close().catch(() => { }); }
  setTimeout(() => process.exit(0), 500).unref();
})().catch(e => { console.error('오류:', e.message); process.exitCode = 1; setTimeout(() => process.exit(1), 500).unref(); });
