// 원고 자동 입력: node post.js ../원고데이터/04_NT.js
// 제목·본문·이미지 4장·해시태그·카테고리·태그까지 채우고 멈춘다. 마지막 '발행' 클릭은 사람이 한다.
const path = require('path');
const { launch, WRITE_URL, sleep, pause } = require('./common');

const P = require(path.resolve(process.argv[2]));
const ROOT = path.resolve(__dirname, '..', '..');
const imgPath = i => path.join(ROOT, '04_이미지', P.folder, P.imgs[i][0]);

// 본문을 {{imgN}} 기준으로 [글, 이미지, 글, ...] 조각으로 나눈다
function segments() {
  const parts = P.body.split(/\{\{img(\d)\}\}/);
  const seg = [];
  parts.forEach((s, i) => {
    if (i % 2) seg.push({ img: Number(s) - 1 });
    else if (s.trim()) seg.push({ html: s.trim() });
  });
  seg.push({ html: `<p>${P.tags.map(t => '#' + t).join(' ')}</p>` });
  return seg;
}

async function editorFrame(page) {
  for (let t = 0; t < 40; t++) {
    for (const f of page.frames()) {
      if (await f.$('.se-documentTitle, .se-title-text').catch(() => null)) return f;
    }
    await sleep(500);
  }
  throw new Error('에디터를 찾지 못함. 로그인(node login.js)부터 확인');
}

// 텍스트로 버튼 찾아 클릭 (해시 클래스명이 자주 바뀌어서 글자로 찾는다)
async function clickText(frame, text, scope = 'button') {
  const h = await frame.evaluateHandle((text, scope) =>
    [...document.querySelectorAll(scope)].find(b => b.offsetParent && b.innerText.trim() === text), text, scope);
  const el = h.asElement();
  if (!el) return false;
  await el.click(); return true;
}

async function closePopups(f) {
  // '작성 중인 글이 있습니다' → 취소(새로 작성), 도움말 패널 닫기
  for (const sel of ['.se-popup-button-cancel', '.se-help-panel-close-button']) {
    const b = await f.$(sel); if (b) { await b.click().catch(() => {}); await pause(); }
  }
}

// 에디터는 키 입력을 숨은 iframe(input_buffer…)으로 받는다. 클립보드 쓰기·붙여넣기는 그 프레임에서.
const bufferFrame = page => page.frames().find(fr => fr.name().startsWith('input_buffer'));

async function paste(page, ef, html) {
  const f = bufferFrame(page) || ef;
  const plain = html.replace(/<br\s*\/?>/g, '\n').replace(/<\/(p|h2)>/g, '\n').replace(/<[^>]+>/g, '');
  const ok = await f.evaluate(async (html, plain) => {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      })]);
      return true;
    } catch (e) { return e.message; }
  }, html, plain);
  if (ok !== true) console.log('  클립보드 대신 붙여넣기 이벤트 사용:', ok);
  if (ok === true) { await page.keyboard.down('Control'); await page.keyboard.press('v'); await page.keyboard.up('Control'); }
  else {
    // 클립보드 권한이 없으면 붙여넣기 이벤트를 직접 보낸다
    await f.evaluate((html, plain) => {
      const dt = new DataTransfer(); dt.setData('text/html', html); dt.setData('text/plain', plain);
      (document.activeElement || document.body).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, html, plain);
  }
  await pause(1200);
}

// 문서 맨 끝 빈 줄에 커서를 둔다 (이미지 다음 글을 이어 쓰기 위해)
async function caretToEnd(page, f) {
  const box = await f.evaluate(() => {
    const comps = document.querySelectorAll('.se-content .se-component');
    const last = comps[comps.length - 1];
    if (last && last.classList.contains('se-text')) {
      const p = last.querySelectorAll('.se-text-paragraph'); const r = p[p.length - 1].getBoundingClientRect();
      return { x: r.right - 4, y: r.top + r.height / 2, text: true };
    }
    const r = last.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.bottom + 24, text: false };
  });
  const off = f === page.mainFrame() ? { x: 0, y: 0 } : await (await f.frameElement()).boundingBox();
  await page.mouse.click(off.x + box.x, off.y + box.y);
  await pause(400);
  await page.keyboard.down('Control'); await page.keyboard.press('End'); await page.keyboard.up('Control');
}

async function uploadImage(page, f, i) {
  const before = await f.$$eval('.se-component.se-image', a => a.length);
  const btn = await f.$('button[data-name="image"], .se-image-toolbar-button');
  if (!btn) throw new Error('사진 버튼을 찾지 못함');
  const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 10000 }), btn.click()]);
  await chooser.accept([imgPath(i)]);
  for (let t = 0; t < 60; t++) {
    if (await f.$$eval('.se-component.se-image', a => a.length) > before) break;
    await sleep(500);
  }
  console.log('  사진', i + 1, P.imgs[i][0]);
  await pause(1500);
}

(async () => {
  const { browser, page } = await launch();
  await page.goto(WRITE_URL, { waitUntil: 'networkidle2' });
  const f = await editorFrame(page);
  await pause(2000);
  await closePopups(f);

  // 제목
  await (await f.$('.se-documentTitle .se-text-paragraph, .se-title-text')).click();
  await page.keyboard.type(P.title, { delay: 40 + Math.random() * 40 });
  console.log('제목 입력');
  await pause();

  // 본문
  await (await f.$('.se-component.se-text .se-text-paragraph')).click();
  for (const s of segments()) {
    if (s.img !== undefined) await uploadImage(page, f, s.img);
    else { await caretToEnd(page, f); await paste(page, f, s.html); }
  }
  console.log('본문 입력');

  // 발행 설정 창: 카테고리·태그 (최종 발행 버튼은 누르지 않음)
  await clickText(f, '발행') || await clickText(page.mainFrame(), '발행');
  await pause(1500);
  const lf = (await f.$('input[placeholder*="태그"]')) ? f : page.mainFrame();
  const catBtn = await lf.evaluateHandle(() => {
    const lab = [...document.querySelectorAll('*')].find(e => e.childElementCount === 0 && e.innerText?.trim() === '카테고리');
    return lab?.closest('div')?.parentElement?.querySelector('button');
  });
  if (catBtn.asElement()) {
    await catBtn.asElement().click(); await pause();
    const ok = await clickText(lf, P.category, 'label, li, span, button');
    console.log(ok ? `카테고리: ${P.category}` : `카테고리 '${P.category}' 못 찾음 → 직접 선택`);
  }
  const tagInput = await lf.$('input[placeholder*="태그"]');
  if (tagInput) {
    await tagInput.click();
    for (const t of P.tags.slice(0, 30)) { await page.keyboard.type(t, { delay: 30 }); await page.keyboard.press('Enter'); await pause(250); }
    console.log('태그', Math.min(P.tags.length, 30), '개');
  } else console.log('태그 입력칸 못 찾음 → 직접 입력');

  console.log('\n입력 끝. 창에서 내용 확인 후 대표사진(1번 4컷) 지정하고 [발행]을 직접 누르세요.');
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: false });
  // 열려 있던 창에 붙은 경우: 탭은 그대로 두고 스크립트만 끝낸다
  if (browser.attached) return browser.disconnect();
  await new Promise(r => browser.on('disconnected', r));
})().catch(e => { console.error('오류:', e.message); });
