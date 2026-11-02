// 이웃 추가 창 열어 두기: node neighbor.js <상대 블로그 아이디>
//   전용 크롬(BLOG_ID 계정 프로필)에서 상대 블로그 첫 화면을 열고 [이웃추가] 단추가 보이게 스크롤해 둔다.
//   신청 단추는 사람이 직접 누른다. 이 스크립트는 어떤 단추도 누르지 않고 글자도 입력하지 않는다.
//   PROBE=1 : 열리는지만 확인하고 탭을 닫는다
'use strict';
const { launch, sleep } = require('./common');

const target = String(process.argv[2] || '').trim();
if (!/^[A-Za-z0-9_-]{3,40}$/.test(target)) { console.error('블로그 아이디가 올바르지 않음'); process.exit(2); }
const HOME = id => `https://blog.naver.com/${encodeURIComponent(id)}`;

// 모든 프레임에서 [이웃추가] 단추(openAddBuddy)를 찾아 보이게 스크롤하고 테두리만 표시
async function reveal(page) {
  for (const f of page.frames()) {
    const ok = await f.evaluate(() => {
      const el = [...document.querySelectorAll('a,button')].find(e => /openAddBuddy/.test(e.getAttribute('onclick') || '') || /^이웃\s*추가$/.test((e.innerText || '').trim()));
      if (!el) return false;
      el.scrollIntoView({ block: 'center' });
      el.style.outline = '3px dashed #ff6b00'; el.style.outlineOffset = '4px';
      return true;
    }).catch(() => false);
    if (ok) return true;
  }
  return false;
}

(async () => {
  const { browser, page } = await launch();
  await page.goto(HOME(target), { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1500);
  const login = await page.evaluate(() => /nid\.naver\.com/.test(location.href));
  let where = 'home';
  if (login) { where = 'login'; console.log('로그인이 풀려 있음 → 전용 크롬에서 먼저 로그인'); }
  else if (await reveal(page)) { where = 'button'; console.log(`${target} 블로그를 열고 [이웃추가] 단추를 표시했음 → 창에서 직접 누르기`); }
  else console.log(`${target} 블로그를 열었음 (단추를 못 찾음) → 화면의 [이웃추가]를 직접`);
  await page.bringToFront().catch(() => { });
  console.log('@@결과 ' + JSON.stringify({ target, where, url: page.url() }));
  if (process.env.PROBE) await page.close().catch(() => { });
  browser.disconnect();
})().catch(e => { console.error('오류:', e.message); console.log('@@결과 ' + JSON.stringify({ target, where: 'error', error: e.message })); process.exitCode = 1; });
