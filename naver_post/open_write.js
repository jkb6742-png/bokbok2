// 고정 IP가 할당된 계정의 글쓰기 화면 열기 (앱의 [임시저장 글 열기]가 부른다).
//   common.launch()로 그 계정 전용 크롬을 할당된 프록시로 띄우고 출구 IP를 확인한 뒤에만 글쓰기 화면을 연다.
//   IP가 다르거나 프록시가 끊기면 창을 닫고 실패로 끝난다(기본 브라우저로 대신 열지 않음). 창은 열어 둔 채 끝난다.
'use strict';
const { launch, WRITE_URL } = require('./common');
(async () => {
  const { browser, page } = await launch();
  await page.goto(WRITE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
  await page.bringToFront().catch(() => { });
  browser.disconnect();
  console.log('@@결과 ' + JSON.stringify({ ok: true }));
})().catch(e => { console.log('@@결과 ' + JSON.stringify({ ok: false, error: e.message })); process.exit(1); });
