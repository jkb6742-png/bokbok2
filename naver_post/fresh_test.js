// 시크릿 창 흐름 시험: 임시 프로필 시크릿 창 → 네이버 로그인 화면 → (사람이 직접 로그인) → 블로그 글쓰기 화면 도달 확인 → 창 닫고 임시 프로필 삭제
//   LOGIN_MODE=fresh node fresh_test.js     (글은 쓰지 않는다)
'use strict';
process.env.LOGIN_MODE = 'fresh';
const { launch, waitLogin, WRITE_URL, BLOG_ID, sleep } = require('./common');
const ts = () => new Date().toTimeString().slice(0, 8);
(async () => {
  const t0 = Date.now();
  const { browser, page } = await launch();
  console.log(ts(), '시크릿 창 열림 · 임시 프로필', browser.freshDir);
  await page.goto('https://nid.naver.com/nidlogin.login?url=' + encodeURIComponent(WRITE_URL), { waitUntil: 'networkidle2' });
  console.log(ts(), '네이버 로그인 화면 표시 · 창에서 직접 로그인해 주세요 (최대 10분)');
  const f = await waitLogin(page, WRITE_URL, l => console.log(ts(), l));
  console.log(ts(), '로그인 확인 · 글쓰기 화면 도달:', page.url());
  const title = await f.$('.se-title-text') ? '제목 칸 있음' : '제목 칸 없음';
  const cookies = (await page.cookies('https://blog.naver.com')).map(c => c.name);
  console.log(ts(), `편집기 ${title} · 블로그 ${BLOG_ID} · 쿠키 ${cookies.length}개(${cookies.filter(n => /^NID_/.test(n)).join(',')})`);
  await sleep(5000);
  await browser.wipe();
  console.log(ts(), '창 닫고 임시 프로필 삭제 · 걸린 시간', Math.round((Date.now() - t0) / 1000) + '초');
})().catch(e => { console.error(ts(), '오류:', e.message); process.exitCode = 1; });
