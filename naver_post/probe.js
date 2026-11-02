// 개발용: 열린 전용 창에 붙어 글쓰기 탭의 에디터에서 코드 실행. node probe.js "<frame에서 실행할 JS>"
const { puppeteer } = require('../chrome');
const fs = require('fs'), path = require('path');
const { PROFILE } = require('./common');
(async () => {
  const [port, ws] = fs.readFileSync(path.join(PROFILE, 'DevToolsActivePort'), 'utf8').trim().split('\n');
  const b = await puppeteer.connect({ browserWSEndpoint: `ws://127.0.0.1:${port}${ws}`, defaultViewport: null });
  const pages = await b.pages();
  const page = pages.filter(p => p.url().includes('Redirect=Write')).pop();
  const f = page.frames().find(x => x.name() === 'mainFrame');
  const r = await f.evaluate(process.argv[2]);
  console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 1));
  if (process.argv[3]) await page.screenshot({ path: process.argv[3] });
  b.disconnect();
})().catch(e => console.error(e.message));
