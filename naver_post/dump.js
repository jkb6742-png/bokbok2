// 에디터 구조 확인용: node dump.js → editor_dump.json (클래스·버튼·입력칸 목록, 글 내용 없음)
const fs = require('fs'), path = require('path');
const { launch, WRITE_URL, sleep } = require('./common');
(async () => {
  const { browser, page } = await launch();
  await page.goto(WRITE_URL, { waitUntil: 'networkidle2' });
  await sleep(5000);
  const out = { url: page.url(), frames: [] };
  for (const f of page.frames()) {
    const info = await f.evaluate(() => {
      const pick = el => ({ tag: el.tagName, cls: String(el.className).slice(0, 160), id: el.id, name: el.getAttribute('data-name'), ph: el.getAttribute('placeholder'), txt: (el.innerText || el.value || '').trim().slice(0, 40) });
      return {
        buttons: [...document.querySelectorAll('button, [role=button]')].map(pick).slice(0, 250),
        inputs: [...document.querySelectorAll('input, textarea, [contenteditable=true]')].map(pick),
        se: [...new Set([...document.querySelectorAll('[class*="se-"]')].flatMap(e => [...e.classList].filter(c => c.startsWith('se-'))))].slice(0, 400),
      };
    }).catch(e => ({ err: e.message }));
    out.frames.push({ name: f.name(), url: f.url(), ...info });
  }
  fs.writeFileSync(path.join(__dirname, 'editor_dump.json'), JSON.stringify(out, null, 1));
  console.log('저장: editor_dump.json, 프레임', out.frames.length);
  if (browser.attached) { await page.close(); browser.disconnect(); } else await browser.close();
})();
