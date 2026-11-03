// 발행 설정(카테고리·태그) → 전수검사 → (통과 + PUBLISH=1이면) 발행
// write.js 마지막 단계. 단독 실행: 이미 입력된 글쓰기 탭에서 태그만 다시 넣고 검사·발행
//   PUBLISH=1 node finish.js ../원고데이터/05_NF_layout.js
const path = require('path'), fs = require('fs');
const { sleep, pause, BLOG_ID } = require('./common');
const { releaseMods } = require('./editor');
const { inspect } = require('./inspect');

// 태그 칸에 들어간 태그 목록 (입력 중인 글자·안내 문구 제외)
const tagList = f => f.evaluate(() => {
  const i = document.querySelector('#tag-input');
  const box = i.closest('div').parentElement;
  return box.innerText.split('#').map(x => x.trim()).filter(x => x && !x.startsWith('태그 입력') && !x.includes('최대 30개'));
});

async function setTags(page, f, tags) {
  const input = await f.$('#tag-input');
  await input.click(); await pause(300);
  // 기존 태그 전부 지우기 (빈 칸에서 Backspace = 마지막 태그 삭제)
  for (let k = 0; k < 40 && (await tagList(f)).length; k++) { await page.keyboard.press('Backspace'); await sleep(120); }
  // 태그 칸은 실제 키 입력이어야 Enter가 매번 먹는다. Ctrl·Shift를 먼저 떼서 단축키 위험 없음.
  for (const t of tags.slice(0, 30)) {
    for (let tries = 0; tries < 3; tries++) {
      await releaseMods(page);
      for (const ch of t) { await page.keyboard.type(ch); await sleep(110 + Math.random() * 90); }
      await sleep(Number(process.env.TAG_PAUSE || 900));
      await page.keyboard.press('Enter'); await sleep(800);
      const now = await tagList(f);
      if (now[now.length - 1] === t) break;
      // 붙어버렸거나 안 들어갔으면 마지막 것 지우고 다시
      if (now.length && now[now.length - 1].endsWith(t)) { await page.keyboard.press('Backspace'); await sleep(300); }
      else { await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace'); await sleep(300); }
    }
  }
}

async function finish(page, f, S, reportName) {
  // 발행 설정 창 열기 (이미 열려 있으면 그대로)
  if (!await f.$('#tag-input')) { await (await f.$('button[class^="publish_btn"]')).click(); await pause(1500); }
  // 카테고리 선택 상자: 이미 펼쳐져 있으면(이어서 하기) 다시 누르면 닫히므로, 옵션이 안 보일 때만 누른다
  const normCat = s => String(s || '').replace(/[ \s]+/g, ' ').trim();   // 네이버가 넣는 특수 공백(NBSP)·연속 공백 무시
  const visibleOptions = async () => (await f.$$('span[class^="option"]')).filter(Boolean);
  let opts = await visibleOptions();
  for (let t = 0; t < 2 && !opts.length; t++) { await (await f.$('button[class^="selectbox_button"]')).click(); await pause(900); opts = await visibleOptions(); }
  let catOk = false;
  const seen = [];
  for (const o of opts) {
    const name = normCat(await o.evaluate(x => x.innerText.trim().split('\n').pop()));
    seen.push(name);
    if (name === normCat(S.category)) { await o.click(); catOk = true; break; }
  }
  if (!catOk) { console.log(`카테고리 '${S.category}'가 이 블로그에 없음 (보이는 목록: ${seen.join(' / ') || '없음'})`); await page.keyboard.press('Escape'); }
  await pause(800);
  await setTags(page, f, S.tags);

  console.log('@@진행 전수검사 중');
  const r = await inspect(f, S);
  const dir = process.env.REPORT_DIR || path.resolve(__dirname, '..', '..', '03_원고');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `검수_${reportName}.html`);
  fs.writeFileSync(out, r.html);
  console.log(`\n전수검사: ${r.pass ? '통과' : '실패 ' + r.fails.length + '건'} → ${out}`);
  r.fails.forEach(x => console.log('  ✗', x));

  // 해시태그 줄에서만 실패한 경우는 발행을 막지 않는다 (사용자 지시: 해시태그 상관없이 발행)
  const hardFails = r.fails.filter(x => !/해시태그|#[^ ]+ #/.test(x));
  const okToPublish = r.pass || (hardFails.length === 0 && r.fails.length > 0);
  if (!r.pass && okToPublish) console.log('  (해시태그 항목만 실패 → 발행 진행)');
  let published = null;
  if (okToPublish && process.env.PUBLISH) {
    const btn = await f.evaluateHandle(() => [...document.querySelectorAll('button')].find(b => /confirm_btn/.test(b.className) && b.innerText.includes('발행')));
    if (btn.asElement()) {
      await btn.asElement().click();
      // 발행 뒤 글 주소(logNo)로 넘어갈 때까지 최대 20초 기다린다 (5초 뒤 바로 읽으면 글쓰기 주소가 찍히는 경우가 있음)
      for (let t = 0; t < 20 && !/\/\d{9,}(\?|$)|logNo=\d+/.test(page.url()); t++) await sleep(1000);
      published = page.url();
      if (!/\/\d{9,}(\?|$)|logNo=\d+/.test(published)) {
        try { const r = await page.evaluate(async id => (await fetch(`https://blog.naver.com/PostTitleListAsync.naver?blogId=${id}&currentPage=1&countPerPage=1`)).json(), BLOG_ID); const ln = r && r.postList && r.postList[0] && r.postList[0].logNo; if (ln) published = `https://blog.naver.com/${BLOG_ID}/${ln}`; } catch { }
      }
      console.log('발행 완료:', published);
    }
    else console.log('최종 발행 버튼을 못 찾음 → 직접 클릭');
  } else console.log('발행 전 멈춤. 창에서 확인 후 직접 [발행]');
  console.log('@@결과 ' + JSON.stringify({ pass: r.pass, fails: r.fails, report: out, published }));
  return { ...r, published };
}

module.exports = { finish, setTags, tagList };

if (require.main === module) (async () => {
  const S = require('./manuscript').load(process.argv[2]);
  const { launch } = require('./common');
  const { browser, page: blank } = await launch();
  const page = (await browser.pages()).filter(p => p.url().includes('Write')).pop();
  if (blank !== page) await blank.close();
  if (!page) throw new Error('입력된 글쓰기 탭이 없음');
  const f = page.frames().find(x => x.name() === 'mainFrame');
  await finish(page, f, S, path.basename(S.file).replace(/\.(js|txt)$/, ''));
  browser.disconnect();
})().catch(e => { console.error('오류:', e.message); process.exitCode = 1; });
