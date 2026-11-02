// 최초 1회: node login.js → 열린 창에서 직접 네이버 로그인(로그인 상태 유지 체크) → 창 닫기
const { launch, PROFILE } = require('./common');
const { fillLogin } = require('./login-fill');
(async () => {
  // IPC transfers the one-time password without command-line arguments or files.
  let credentials = process.argv.includes('--fill-once') ? await new Promise(resolve => process.once('message', resolve)) : null;
  const { browser, page } = await launch();
  await page.goto('https://nid.naver.com/nidlogin.login?url=https%3A%2F%2Fblog.naver.com%2F', { waitUntil: 'domcontentloaded' });
  if (credentials) {
    try { await fillLogin(page, credentials); }
    finally { credentials.password = ''; credentials = null; }
    if (process.send) process.send({ ok: true });
    if (process.connected) process.disconnect();
  }
  console.log('창에서 직접 로그인하세요. 끝나면 창을 닫으면 됩니다.');
  console.log('세션 저장 위치:', PROFILE);
  await new Promise(r => browser.on('disconnected', r));
  if (browser.fresh) await browser.wipe();
})().catch(() => {
  if (process.send) process.send({ ok: false });
  if (process.connected) process.disconnect();
  console.error('로그인 창 준비 실패. 크롬 설치와 네이버 연결을 확인하세요.');
  process.exitCode = 1;
});
