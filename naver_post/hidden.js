// 히든 이미지 가져오기: 내 블로그의 (비공개) 글에 넣어 둔 이미지와 그 아래 적힌 규칙 문구를 내려받는다
//   BLOG_ID  계정(전용 크롬 프로필)        URL  글 주소(blog.naver.com/<id>/<logNo> 또는 PostView.naver?blogId=&logNo=)
//   OUT      저장 폴더                       LOGIN_MODE keep(기본) — 로그인은 사람이 전용 창에서 미리 해 둔다
// 출력: '@@이미지 {"file","url","w","h","rule"}' 줄들, 끝에 '@@결과 {"ok","count"}'. 로그인이 안 돼 있으면 '@@오류 로그인 필요' + 종료 코드 2
// 비밀번호는 어디에도 넣지 않는다. 글 주소는 이 계정 블로그만 허용한다.
const fs = require('fs'), path = require('path');
const { launch, BLOG_ID, sleep } = require('./common');

const URL = String(process.env.URL || '');
const OUT = process.env.OUT || path.join(process.cwd(), 'hidden_out');
const m = URL.match(/^https?:\/\/(?:m\.)?blog\.naver\.com\/(?:([a-zA-Z0-9_-]+)\/(\d{6,})|PostView\.n(?:aver|hn)\?(?:[^#]*&)?blogId=([a-zA-Z0-9_-]+)&(?:[^#]*&)?logNo=(\d{6,}))/);
const blogId = m && (m[1] || m[3]), logNo = m && (m[2] || m[4]);
if (!m || blogId.toLowerCase() !== BLOG_ID.toLowerCase()) { console.log('@@오류 이 계정 블로그의 글 주소가 아닙니다'); process.exit(3); }

const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };

let browserRef = null;
(async () => {
  const { browser, page } = await launch();
  browserRef = browser;
  const view = `https://blog.naver.com/PostView.naver?blogId=${blogId}&logNo=${logNo}`;
  await page.goto(view, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1500);
  if (/nid\.naver\.com/.test(page.url())) { console.log('@@오류 로그인 필요'); finish(browser); process.exit(2); }
  const box = await page.waitForSelector('.se-main-container', { timeout: 20000 }).catch(() => null);
  if (!box) {
    const txt = await page.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => '');
    console.log(/로그인|비공개|권한/.test(txt) ? '@@오류 로그인 필요' : '@@오류 글 본문을 찾지 못했습니다');
    finish(browser); process.exit(2);
  }
  // 이미지마다 원본 주소와, 문서 순서상 바로 뒤에 오는 첫 글(캡션 또는 다음 문단)
  const items = await page.evaluate(() => {
    const root = document.querySelector('.se-main-container');
    const comps = [...root.querySelectorAll('.se-component')];
    const textOf = el => (el.innerText || '').replace(/[​‌‍﻿]/g, '').split('\n').map(s => s.trim()).filter(Boolean)[0] || '';
    const out = [];
    for (const img of root.querySelectorAll('img.se-image-resource')) {
      let url = img.getAttribute('data-lazy-src') || img.getAttribute('src') || '';
      url = url.replace(/\?.*$/, '');
      if (!url) continue;
      if (/pstatic\.net\//.test(url)) url += '?type=w3840';   // 원본 크기(파라미터 없으면 100px 썸네일이 온다)
      const comp = img.closest('.se-component');
      let rule = '';
      const cap = comp && comp.querySelector('.se-caption');
      if (cap && textOf(cap)) rule = textOf(cap);
      if (!rule && comp) {
        for (let i = comps.indexOf(comp) + 1; i < comps.length && i <= comps.indexOf(comp) + 3; i++) {
          const c = comps[i];
          if (c.classList.contains('se-image')) break;
          if (c.classList.contains('se-text') || c.classList.contains('se-quotation') || c.classList.contains('se-sectionTitle')) { const t = textOf(c); if (t) { rule = t; break; } }
        }
      }
      out.push({ url, w: img.naturalWidth || 0, h: img.naturalHeight || 0, rule: rule.slice(0, 60) });
    }
    return out;
  });
  fs.mkdirSync(OUT, { recursive: true });
  const stamp = Date.now().toString(36);
  const dl = await browser.newPage();
  let n = 0;
  for (const it of items) {
    try {
      const res = await dl.goto(it.url, { waitUntil: 'load', timeout: 30000 });
      if (!res || !res.ok()) { console.log(`받기 실패(${res ? res.status() : '응답 없음'}): ${it.url}`); continue; }
      const type = String(res.headers()['content-type'] || '').split(';')[0].trim().toLowerCase();
      const ext = EXT[type] || path.extname(it.url).toLowerCase() || '.jpg';
      const buf = await res.buffer();
      if (buf.length < 100) continue;
      const file = `hidden_${stamp}_${String(++n).padStart(2, '0')}${ext}`;
      fs.writeFileSync(path.join(OUT, file), buf);
      const size = await dl.evaluate(() => { const i = document.querySelector('img'); return i ? [i.naturalWidth, i.naturalHeight] : [0, 0]; }).catch(() => [0, 0]);
      console.log('@@이미지 ' + JSON.stringify({ file, url: it.url, w: size[0] || it.w, h: size[1] || it.h, rule: it.rule }));
    } catch (e) { console.log(`받기 실패: ${e.message}`); }
  }
  await dl.close().catch(() => { });
  console.log('@@결과 ' + JSON.stringify({ ok: true, count: n, found: items.length }));
  finish(browser);
  setTimeout(() => process.exit(0), 1500).unref();
})().catch(e => {
  console.log('@@오류 ' + e.message);
  try { if (browserRef) finish(browserRef); } catch { }
  setTimeout(() => process.exit(1), 1000).unref();
});

// 붙은 창은 그대로, 우리가 띄운 창은 닫는다(로그인 세션은 프로필에 남음)
function finish(browser) {
  if (!browser) return;
  if (browser.fresh) browser.wipe().catch(() => { });
  else if (browser.attached) { try { browser.disconnect(); } catch { } }
  else browser.close().catch(() => { });
}
