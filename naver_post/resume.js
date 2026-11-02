// 입력 도중 멈춘 글 이어서 끝내기: 열려 있는 전용 크롬의 글쓰기 탭에 붙어 START번째 블록부터 입력 → 발행 설정 → 전수검사 → (PUBLISH=1이면) 발행 → 관련 글 읽기
//   BLOG_ID=<아이디> START=<0부터 세는 블록 번호> PUBLISH=1 node resume.js <원고>
//   먼저 probe_link.js 로 편집기에 들어간 컴포넌트 수를 확인하고 START를 정한다(제목은 컴포넌트가 아님).
'use strict';
const path = require('path');
const { launch, WRITE_URL, BLOG_ID, sleep } = require('./common');
const { Editor } = require('./editor');
const { finish } = require('./finish');
const { browse } = require('./browse');
const H = require('./humanize');

const S = require('./manuscript').load(process.argv[2]);
// START=auto : 편집기에 이미 들어간 컴포넌트를 세어 이어서 시작할 블록을 스스로 정한다 (제목 제외, 끝의 빈 본문 칸 제외)
const START_ENV = String(process.env.START || '0');
const MY_BLOG = `https://blog.naver.com/${BLOG_ID}`;
const linkUrl = l => (l === true || /^https:\/\/blog\.naver\.com\/[^/]+\/?$/.test(l)) ? MY_BLOG : l;
H.setBudget({ chars: [S.title, ...S.blocks.flatMap(b => b.text || (b.quote ? [b.quote] : []))].join('').length });

(async () => {
  const { browser, page: blank } = await launch();
  let page = (await browser.pages()).filter(p => p.url().includes('Write')).pop();
  let f;
  if (!page) {
    // 글쓰기 탭이 없으면(창이 닫힘) 새로 열고, "작성 중인 글이 있습니다 … 이어서 작성하시겠습니까?" 안내창에서 [확인]으로 임시저장 글을 불러온다
    page = blank;
    await page.goto(WRITE_URL, { waitUntil: 'networkidle2' }); await sleep(4000);
    f = page.frames().find(x => x.name() === 'mainFrame');
    if (!f) throw new Error('글쓰기 프레임 없음(로그인이 풀렸으면 창에서 먼저 로그인)');
    const alert = await f.$('.se-popup-alert-confirm');
    const msg = alert ? await alert.evaluate(x => (x.innerText || '').replace(/\s+/g, ' ').trim()) : '';
    if (!/작성\s*중인\s*글/.test(msg)) throw new Error('임시저장 불러오기 안내창이 없음 — 이어서 쓸 글이 없거나 이미 다른 창에 열려 있음' + (msg ? ` (안내: ${msg.slice(0, 60)})` : ''));
    console.log(`임시저장 불러오기: ${msg.slice(0, 70)}`);
    await (await f.$('.se-popup-alert-confirm .se-popup-button-confirm')).click();
    for (let t = 0; t < 40; t++) { await sleep(500); if (await f.$$eval('.se-content .se-component', a => a.length) > 1) break; }
    await sleep(2000);
  } else {
    if (blank !== page) await blank.close().catch(() => { });
    f = page.frames().find(x => x.name() === 'mainFrame');
    if (!f) throw new Error('글쓰기 프레임 없음');
  }
  await page.bringToFront();
  const e = new Editor(page, f);
  await e.tidy();
  const kindOf = b => b.quote ? 'quote' : b.line ? 'line' : b.img !== undefined ? 'img' : b.link ? 'link' : b.hashtags ? 'hashtags' : 'text';
  const comps = await f.$$eval('.se-content .se-component', a => a.map(c => ({ type: ([...c.classList].find(x => x.startsWith('se-') && x !== 'se-component' && !x.startsWith('se-l-')) || '').slice(3), text: (c.innerText || '').replace(/​/g, '').trim() })));
  const n = comps.length;
  // 제목 다음부터, 끝에 남은 빈 본문 칸은 뺀다 → 이미 들어간 블록 수
  const body = comps.slice(1);
  while (body.length && body[body.length - 1].type === 'text' && !body[body.length - 1].text) body.pop();
  const typeOf = k => ({ quote: 'quotation', line: 'horizontalLine', img: 'image', link: 'oglink', hashtags: 'text', text: 'text' })[k];
  let START = START_ENV === 'auto' ? body.length : Math.max(0, parseInt(START_ENV, 10) || 0);
  const mism = body.slice(0, START).findIndex((c, i) => !S.blocks[i] || c.type !== typeOf(kindOf(S.blocks[i])));
  if (mism >= 0) throw new Error(`편집기 ${mism + 1}번째 칸(${body[mism].type})이 원고 블록(${S.blocks[mism] ? kindOf(S.blocks[mism]) : '없음'})과 다름 — 이어쓰기 중단`);
  if (START > S.blocks.length) throw new Error(`편집기 블록(${START})이 원고 블록(${S.blocks.length})보다 많음`);
  const ST = require('./styles');
  console.log(`편집기 컴포넌트 ${n}개(본문 ${body.length}칸 일치) · ${START + 1}/${S.blocks.length}번째 블록부터 이어서 입력 · 인용구 스타일: ${ST.quoteLabel(S.quoteStyle)} · 구분선 스타일: ${ST.lineLabel(S.lineStyle)}`);
  if (START >= S.blocks.length) console.log('남은 블록 없음 → 발행 설정·전수검사로');
  let prev = START > 0 ? kindOf(S.blocks[START - 1]) : 'title';
  if (prev === 'text' || prev === 'img' || prev === 'link') await e.lastLine();
  for (let i = START; i < S.blocks.length; i++) {
    const b = S.blocks[i], t0 = Date.now();
    if (b.quote) await e.quote(b.quote, b.style || S.quoteStyle);
    else if (b.line) await e.line(b.style || S.lineStyle);
    else if (b.img !== undefined) await e.image(S.images[b.img]);
    else if (b.link) { await e.link(linkUrl(b.link)); await e.lastLine(); }
    else if (b.text || b.hashtags) {
      if (prev === 'quote') await e.afterQuote();
      else if (prev === 'img' || prev === 'title') await e.lastLine();
      if (b.hashtags) await e.text([S.tags.map(t => '#' + t).join(' ')], { size: 'fs15' });
      else await e.text(b.text);
    }
    prev = kindOf(b);
    console.log(`  ${i + 1}/${S.blocks.length} ${prev} ${((Date.now() - t0) / 1000).toFixed(0)}초`);
    console.log(`@@진행 ${i + 1}/${S.blocks.length} · ${({ quote: '인용구', line: '구분선', img: '사진', link: '링크', text: '본문', hashtags: '해시태그' })[prev]} 입력`);
  }
  console.log('@@진행 발행 설정 · 카테고리·태그');
  const r = await finish(page, f, S, path.basename(S.file).replace(/\.(js|txt)$/, ''));
  const READ_N = Number(process.env.READ_N || 0), READ_SEC = Number(process.env.READ_SEC || 60);
  if (r.published && READ_N > 0) {
    const keywords = [S.keyword, ...(S.tags || [])].filter(Boolean);
    console.log(`관련 글 읽기: ${READ_N}편 · 키워드 ${keywords.slice(0, 3).join(', ')}`);
    await sleep(4000 + Math.random() * 6000);
    const read = await browse(browser, { keywords, count: READ_N, minSec: READ_SEC * 0.7, maxSec: READ_SEC * 1.3, myId: BLOG_ID }).catch(e => { console.log('읽기 중 오류:', e.message); return []; });
    console.log(`관련 글 읽기 끝: ${read.length}편`);
  }
  if (process.env.CLEAR_CACHE === '1') { try { const cdp = await page.target().createCDPSession(); await cdp.send('Network.clearBrowserCache'); await cdp.detach(); console.log('캐시 비움'); } catch { } }
  if (browser.attached) browser.disconnect(); else await browser.close().catch(() => { });
  setTimeout(() => process.exit(0), 2000).unref();
})().catch(e => { console.error('오류:', e.message); console.log('@@결과 ' + JSON.stringify({ pass: false, fails: [e.message] })); process.exitCode = 1; setTimeout(() => process.exit(1), 1500).unref(); });
