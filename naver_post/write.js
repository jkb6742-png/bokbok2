// 직접 타이핑 입력: node write.js <원고 .js 또는 .txt>
//   실행 방식(MODE)
//   SAVE=1    : [권장 기본] 사람 타자 속도로 전부 입력 → 발행 설정(카테고리·태그) → 전수검사 →
//               전 항목 통과일 때만 편집기 상단 [저장](임시저장) 클릭 → 저장 목록에서 같은 제목·방금 시각 확인 → 멈춤.
//               최종 [발행]은 절대 누르지 않는다. 사람이 임시저장 글을 열어 직접 [발행]한다.
//               결과는 원고 옆 save_result.json (saved && draftVerified 일 때만 종료 코드 0)
//               검사 실패면 저장하지 않고 편집기를 그대로 둔다(종료 코드 1).
//   (없음)    : 입력 → 발행 설정 → 전수검사 → 멈춤 (저장·발행 안 함)
//   PUBLISH=1 : 자동 발행은 운영 결정(2026-11-05)으로 꺼져 있다. ALLOW_AUTO_PUBLISH=1을 함께 줘야만
//               예전처럼 '전수검사 전부 통과 시 발행'이 동작하고, 아니면 입력 전에 거부하고 끝낸다(종료 코드 2).
//   FAST=1    : 구조 시험용 빠른 입력
//   INPUT_MODE=MANUAL_EDITOR : 자동 입력을 전혀 하지 않고 원고 옆 manual_package.txt(제목·블록 표시 본문·사진 목록·태그)만 만들고 끝낸다
//               (정책상 자동 입력을 멈춰야 할 때의 사람 손 입력 대안). 크롬을 띄우지 않는다.
//   G2 승인   : 입력 전에 원고 옆 quality.json 의 verdict(PASS)와 approvedHash(원고 파일 바이트 SHA-256)를 확인한다.
//               불일치·PASS 아님이면 거부(G2_NOT_APPROVED). quality.json 이 없으면 SKIP_G2=1 일 때만 경고 후 진행.
//   SAVE 성공 판정(SAVE_CONFIRMED) = 전수검사 통과 + 저장 목록에 같은 제목·방금 시각 1건 + 그 저장본을 다시 불러와 제목·첫 문단 일치.
//               하나라도 불확실하면 자동 재시도·발행 없이 saved / draftVerified 를 false 로 두고 이유를 남긴다.
//   임시저장 보호
//   DRAFT_POLICY : 글쓰기 화면에 "작성 중인 글이 있습니다 … 이어서 작성하시겠습니까?" 안내창이 뜨거나
//                  (SAVE) 임시저장 목록에 같은 제목 글이 이미 있으면 기본은 중단(결과 코드 EXISTING_DRAFT).
//                  DRAFT_POLICY=replace 이면 안내창에서 [취소](이어쓰기 안 함)를 눌러 버리고 새로 쓴다(로그에 남김).
//   BLOG_ID   : 어느 계정 블로그에 쓸지 (없으면 jsrjkb6742) · BLOG_PROFILE : 전용 크롬 프로필 폴더(앱이 넘김)
//   TAG_PAUSE : 태그 하나 친 뒤 Enter까지 기다리는 ms (기본 900)
//   TYPO_N / THINK_N : 원고 1편당 오타 내고 고치기 · 문장 끝 생각 멈춤 횟수 (humanize.js, 기본 0)
//   READ_N / READ_SEC : 발행 뒤 관련 키워드로 다른 사람 글 N편을 각 약 READ_SEC초 읽기 (browse.js, 읽기만)
//   CLEAR_CACHE=1 : 끝난 뒤 이 계정 크롬의 캐시만 비움(쿠키·로그인 유지)
//   REPORT_DIR: 전수검사 HTML 저장 폴더
// 화면(bokbok 앱)용으로 '@@진행 i/n', '@@결과 {json}' 줄을 함께 출력한다
const path = require('path'), fs = require('fs');
const { launch, waitLogin, WRITE_URL, BLOG_ID, sleep, pause, verifyIp } = require('./common');
const { Editor } = require('./editor');
const { finish, PUBLISH_REFUSED_MSG } = require('./finish');
const SV = require('./save');
const { browse } = require('./browse');
const H = require('./humanize');

const S = require('./manuscript').load(process.argv[2]);
// 사람 습관(오타·멈춤) 횟수를 글 전체에 고르게 흩기 위해 전체 글자 수를 알려 준다
H.setBudget({ chars: [S.title, ...S.blocks.flatMap(b => b.text || (b.quote ? [b.quote] : []))].join('').replace(/\[\[|\]\]|\*\*|\|#[0-9a-f]{6}/gi, '').length });
const ROOT = path.resolve(__dirname, '..', '..');
const MY_BLOG = `https://blog.naver.com/${BLOG_ID}`;
// 링크 블록이 true이거나 다른 계정 블로그 주소면 지금 계정 블로그로
const linkUrl = l => (l === true || /^https:\/\/blog\.naver\.com\/[^/]+\/?$/.test(l)) ? MY_BLOG : l;

let browserRef = null;   // 오류로 멈출 때 창은 남기되 프로세스는 끝내기 위해
// 실행 방식: SAVE / PUBLISH(ALLOW_AUTO_PUBLISH=1 필요) / STOP
const MODE = process.env.SAVE ? 'SAVE' : process.env.PUBLISH ? 'PUBLISH' : 'STOP';
const DRAFT_POLICY = process.env.DRAFT_POLICY === 'replace' ? 'replace' : 'stop';
const RESULT_FILE = path.join(path.dirname(S.file), 'save_result.json');
const INPUT_MODE = process.env.INPUT_MODE === 'MANUAL_EDITOR' ? 'MANUAL_EDITOR' : 'ENGINE_SAVE';
const result = { schemaVersion: '1.3.1', mode: 'SAVE', inputMode: INPUT_MODE, manuscriptSha256: null, g2: null, listVerified: false, status: 'RUNNING', blogId: BLOG_ID, title: S.title, manuscript: S.file, inspection: { passed: false, failed: [] }, saved: false, draftVerified: false, draftTitle: null, savedAt: null, editorUrl: null, publishClicked: false, contentVerified: 'UNKNOWN', errors: [] };
class Stop extends Error { constructor(code, msg) { super(msg); this.code = code; } }

if (MODE === 'PUBLISH' && process.env.ALLOW_AUTO_PUBLISH !== '1') {
  console.error('거부: ' + PUBLISH_REFUSED_MSG);
  console.log('@@결과 ' + JSON.stringify({ pass: false, fails: ['PUBLISH_REFUSED: ' + PUBLISH_REFUSED_MSG] }));
  process.exit(2);
}
if (MODE === 'PUBLISH') console.log('경고: ALLOW_AUTO_PUBLISH=1 로 자동 발행이 켜졌습니다 (운영 정책상 기본은 SAVE).');
// G2 품질 승인 확인 (입력 전)
{
  const g = SV.g2Gate(S.file);
  result.manuscriptSha256 = g.sha; result.g2 = { ok: g.ok, skipped: !!g.skipped, file: g.file, verdict: g.verdict || null };
  console.log(g.ok ? g.message : '거부(G2_NOT_APPROVED): ' + g.message);
  if (!g.ok) {
    result.status = 'G2_NOT_APPROVED'; result.errors.push({ step: 'preflight', code: 'G2_NOT_APPROVED', message: g.message, retryable: false });
    if (MODE === 'SAVE' || INPUT_MODE === 'MANUAL_EDITOR') SV.writeResult(RESULT_FILE, result);
    console.log('@@결과 ' + JSON.stringify({ pass: false, fails: ['G2_NOT_APPROVED: ' + g.message], code: 'G2_NOT_APPROVED' }));
    process.exit(3);
  }
}
// 수동 입력 꾸러미만 만들고 끝
if (INPUT_MODE === 'MANUAL_EDITOR') {
  const out = path.join(path.dirname(S.file), 'manual_package.txt');
  fs.writeFileSync(out, '﻿' + SV.manualPackage(S, linkUrl), 'utf8');
  result.status = 'MANUAL_PACKAGE_WRITTEN'; result.manualPackage = out;
  SV.writeResult(RESULT_FILE, result);
  console.log('수동 입력 꾸러미 작성(자동 입력 안 함):', out);
  console.log('@@결과 ' + JSON.stringify({ pass: true, fails: [], manualPackage: out, code: 'MANUAL_PACKAGE_WRITTEN' }));
  process.exit(0);
}
console.log(`실행 방식: ${MODE}${MODE === 'SAVE' ? ' (입력·전수검사·임시저장, 발행 안 함)' : ''} · 임시저장 보호: ${DRAFT_POLICY}`);

(async () => {
  const { browser, page } = await launch();
  browserRef = browser;
  for (const p of await browser.pages()) if (p !== page && p.url().includes('Write')) await p.close({ runBeforeUnload: false });
  // 로그인 안 된 프로필이면 글쓰기 주소 대신 네이버 첫 화면부터 연다(사용자 지시 2026-11-05)
  const loggedIn = (await page.cookies('https://www.naver.com').catch(() => [])).some(c => c.name === 'NID_AUT');
  await page.goto(loggedIn ? WRITE_URL : 'https://www.naver.com/', { waitUntil: 'networkidle2' }).catch(() => { });
  await sleep(3000);
  let f = page.frames().find(x => x.name() === 'mainFrame');
  if (!f) {
    // 로그인이 안 돼 있으면(새 시크릿 창이거나 세션이 풀림) 사람이 창에서 로그인할 때까지 기다린다
    // 사용자 지시(2026-11-05): 로그인 주소로 바로 보내지 않고 네이버 첫 화면을 띄운다. 사람이 거기서 로그인하면 waitLogin이 블로그로 옮긴다.
    if (!/nid\.naver\.com|www\.naver\.com/.test(page.url())) await page.goto('https://www.naver.com/', { waitUntil: 'networkidle2' }).catch(() => { });
    f = await waitLogin(page, WRITE_URL);
    console.log('로그인 확인 · 글쓰기 시작');
    await sleep(1500);
  }
  result.editorUrl = page.url();

  // 3. 임시저장 확인 (tidy()가 안내창의 [취소]를 누르기 전에 먼저 본다)
  const restoreMsg = await SV.restoreDialog(f);
  if (restoreMsg) {
    if (DRAFT_POLICY !== 'replace') throw new Stop('EXISTING_DRAFT', `작성 중인 글(임시저장)이 남아 있어 중단합니다. 안내: "${restoreMsg.slice(0, 80)}" — 창에서 그 글을 확인·정리한 뒤 다시 실행하거나, 버려도 되면 DRAFT_POLICY=replace 로 실행하세요.`);
    console.log(`[DRAFT_POLICY=replace] 작성 중인 글 안내창에서 [취소] → 기존 작성 중 글을 이어쓰지 않고 새로 씀 (안내: ${restoreMsg.slice(0, 80)})`);
    result.errors.push({ step: 'draft_precheck', code: 'EXISTING_DRAFT_REPLACED', message: restoreMsg.slice(0, 120) });
    await SV.dismissRestore(f);
  }
  if (await f.$$eval('.se-content .se-component', a => a.length).catch(() => 0) > 2 && DRAFT_POLICY !== 'replace') throw new Stop('EXISTING_DRAFT', '편집기에 이미 작성된 내용이 있어 중단합니다 (새 글쓰기 화면이 아님).');
  if (MODE === 'SAVE') {
    const n0 = await SV.draftCount(f);
    console.log(`임시저장 글: ${n0 ?? '?'}개`);
    if (n0) {
      const L = await SV.readList(page, f);
      const same = L.items.filter(it => SV.titleMatch(it, S.title));
      console.log(`  목록 ${L.items.length}건 · 같은 제목 ${same.length}건`);
      if (same.length && DRAFT_POLICY !== 'replace') throw new Stop('EXISTING_DRAFT', `임시저장 목록에 같은 제목 글이 이미 ${same.length}건 있어 중단합니다 ("${same[0].text.slice(0, 60)}"). 확인 뒤 정리하거나 DRAFT_POLICY=replace 로 실행하세요.`);
      if (same.length) { console.log('[DRAFT_POLICY=replace] 같은 제목 임시저장이 있지만 새로 저장 (기존 저장본은 지우지 않음)'); result.errors.push({ step: 'draft_precheck', code: 'SAME_TITLE_DRAFT_EXISTS', message: same.map(x => x.text.slice(0, 60)).join(' / ') }); }
    }
  }

  const e = new Editor(page, f);
  await e.tidy();

  const ST = require('./styles');
  console.log(`인용구 스타일: ${ST.quoteLabel(S.quoteStyle)} · 구분선 스타일: ${ST.lineLabel(S.lineStyle)}`);
  console.log('제목'); await e.title(S.title);
  let prev = 'title';
  for (const [i, b] of S.blocks.entries()) {
    const t0 = Date.now();
    if (b.quote) await e.quote(b.quote, b.style || S.quoteStyle);
    else if (b.line) await e.line(b.style || S.lineStyle);
    else if (b.img !== undefined) await e.image(S.images[b.img]);
    else if (b.link) { await e.link(linkUrl(b.link)); await e.lastLine(); }
    else if (b.table) await e.table(b.table);   // 끝나면 새 본문 칸에 커서가 있다
    else if (b.text || b.hashtags) {
      if (prev === 'table') { /* table()이 만든 새 본문 칸에 이미 커서 */ }
      else if (prev === 'quote') await e.afterQuote();
      else if (prev === 'img' || prev === 'title') await e.lastLine();
      else if (b.hashtags && prev === 'text') { await e.key('End'); await e.key('Enter'); }   // 본문 바로 뒤 해시태그는 같은 칸의 새 줄에 (줄 중간에 끼지 않게)
      if (b.hashtags) await e.text([S.tags.map(t => '#' + t).join(' ')], { size: 'fs15' });
      else await e.text(b.text);
    }
    prev = b.quote ? 'quote' : b.line ? 'line' : b.img !== undefined ? 'img' : b.link ? 'link' : b.table ? 'table' : 'text';
    console.log(`  ${i + 1}/${S.blocks.length} ${prev} ${((Date.now() - t0) / 1000).toFixed(0)}초`);
    console.log(`@@진행 ${i + 1}/${S.blocks.length} · ${({ quote: '인용구', line: '구분선', img: '사진', link: '링크', text: '본문', hashtags: '해시태그', table: '표' })[prev] || prev} 입력`);
  }

  const hs = H.stats();
  if (hs.typo || hs.think) console.log(`사람 습관: 오타 고침 ${hs.typo}회 · 생각 멈춤 ${hs.think}회`);

  // 발행 설정(카테고리·태그) → 전수검사 → 통과 시 발행
  // 고정 IP가 할당된 계정: 발행 설정 직전에 출구 IP를 한 번 더 확인 (입력 중 프록시가 끊기거나 바뀌었으면 중단)
  await verifyIp(browser).catch(e => { throw new Stop('FIXED_IP_MISMATCH', e.message); });
  console.log('@@진행 발행 설정 · 카테고리·태그');
  const r = await finish(page, f, S, path.basename(S.file).replace(/\.(js|txt)$/, ''), { mode: MODE === 'SAVE' ? 'SAVE' : undefined });

  if (MODE === 'SAVE') {
    result.inspection = { passed: !!r.pass, failed: r.fails, report: r.report };
    if (!r.pass) throw new Stop('INSPECTION_FAILED', `전수검사 실패 ${r.fails.length}건 → 저장하지 않음`);
    // 6. 저장
    console.log('@@진행 임시저장');
    await page.bringToFront().catch(() => { });
    const before = await SV.draftCount(f);
    const sv = await SV.clickSave(page, f);
    result.savedAt = sv.requestedAt.toISOString();
    result.saveSignal = { toast: sv.toast || null, autosaveBefore: sv.autosaveBefore, autosaveAfter: sv.autosaveAfter, countBefore: before };
    console.log(`  저장 신호: 안내 "${sv.toast || '없음'}" · 상단 표시 "${sv.autosaveBefore}" → "${sv.autosaveAfter}"`);
    // 7. 목록 확인 (최대 3번, 사이 2초)
    let L = null, hit = [];
    for (let t = 0; t < 3; t++) {
      if (t) await sleep(2000);
      L = await SV.readList(page, f);
      hit = L.items.filter(it => SV.titleMatch(it, S.title));
      const countUp = before != null && L.count != null && L.count === before + 1;
      const times = hit.map(it => SV.parseItemTime(it.text)).filter(Boolean);
      const reqMin = new Date(sv.requestedAt); reqMin.setSeconds(0, 0);
      const fresh = times.some(d => d >= new Date(reqMin - 60000) && d <= new Date(Date.now() + 60000));
      result.draftList = { countBefore: before, countAfter: L.count, matches: hit.map(x => x.text.slice(0, 120)), countIncreased: countUp, freshTimestamp: fresh, timeParsed: times.map(d => d.toISOString()) };
      result.saved = !!sv.toast || countUp || hit.length > 0;
      if (hit.length === 1 && (fresh || (countUp && !times.length))) { result.listVerified = true; break; }
    }
    if (!result.listVerified && L) result.draftList.rawHtml = L.html.slice(0, 1500);
    result.draftTitle = hit.length ? (hit[0].lines.find(l => SV.titleMatch({ text: l, lines: [l] }, S.title)) || hit[0].lines[0]) : null;
    if (!result.saved) throw new Stop('SAVE_FAILED', '[저장]을 눌렀지만 저장 신호(안내·개수 변화·목록 항목)가 없음');
    if (!result.listVerified) throw new Stop('SAVE_UNVERIFIED', hit.length > 1 ? `같은 제목 임시저장이 ${hit.length}건이라 어느 글인지 확정할 수 없음` : `임시저장 목록에서 같은 제목·방금 시각 항목을 확인하지 못함 (목록 ${L ? L.items.length : '?'}건)`);
    // 8. 내용 확인: 저장본을 다시 불러와 제목·첫 문단 대조
    const firstBlock = S.blocks.find(b => b.text);
    const wantFirst = firstBlock ? SV.plainLine(firstBlock.text.find(l => SV.plainLine(l).trim()) || '').trim() : '';
    const cv = await SV.loadDraftFromList(page, f, S.title);
    const norm = x => String(x || '').replace(/\s+/g, ' ').trim();
    result.contentCheck = cv.ok ? { title: norm(cv.title) === norm(S.title), firstParagraph: norm(cv.firstText) === norm(wantFirst), gotTitle: cv.title, gotFirst: cv.firstText.slice(0, 120), wantFirst: wantFirst.slice(0, 120), components: cv.components, popup: cv.popupText || null } : { error: cv.reason };
    result.contentVerified = cv.ok && result.contentCheck.title && result.contentCheck.firstParagraph;
    result.editorUrl = page.url();
    if (!result.contentVerified) throw new Stop('SAVE_UNVERIFIED', cv.ok ? `다시 불러온 저장본이 원고와 다름 (제목 ${result.contentCheck.title ? '일치' : '불일치'} · 첫 문단 ${result.contentCheck.firstParagraph ? '일치' : '불일치'})` : `저장본 다시 열기 실패: ${cv.reason}`);
    result.draftVerified = true;
    result.status = 'SAVE_CONFIRMED';
    console.log(`임시저장 확인(SAVE_CONFIRMED): "${result.draftTitle}" · 목록 ${result.draftList.countBefore} → ${result.draftList.countAfter}개 · 다시 불러온 제목·첫 문단 일치`);
    console.log('발행은 하지 않음. 사람이 임시저장 글을 열어 직접 [발행]하세요.');
    SV.writeResult(RESULT_FILE, result);
    console.log('@@결과 ' + JSON.stringify({ pass: true, fails: [], report: r.report, published: null, saved: true, draftVerified: true, result: RESULT_FILE }));
  }

  // 발행이 됐으면 글의 키워드로 다른 사람 글을 몇 편 읽는다 (읽기만, 공감·댓글·이웃 없음)
  const READ_N = Number(process.env.READ_N || 0), READ_SEC = Number(process.env.READ_SEC || 60);
  if (r.published && READ_N > 0 && !process.env.FAST) {
    const keywords = [S.keyword, ...(S.tags || [])].filter(Boolean);
    console.log(`관련 글 읽기: ${READ_N}편 · 키워드 ${keywords.slice(0, 3).join(', ')}`);
    await sleep(Math.round(4000 + Math.random() * 6000));
    const read = await browse(browser, { keywords, count: READ_N, minSec: READ_SEC * 0.7, maxSec: READ_SEC * 1.3, myId: BLOG_ID }).catch(e => { console.log('읽기 중 오류:', e.message); return []; });
    console.log(`관련 글 읽기 끝: ${read.length}편`);
  }
  // 발행 뒤 캐시 비우기(쿠키·로그인은 그대로): CLEAR_CACHE=1 이면 이 계정 크롬 프로필의 캐시만 지운다
  if (process.env.CLEAR_CACHE === '1' && !process.env.FAST) {
    try { const cdp = await page.target().createCDPSession(); await cdp.send('Network.clearBrowserCache'); await cdp.detach(); console.log('캐시 비움 (로그인 유지)'); }
    catch (e) { console.log('캐시 비우기 실패:', e.message); }
  }
  // 새 시크릿 창 방식이면 창을 닫고 임시 프로필을 통째로 지운다(쿠키·캐시·기록 모두 사라짐)
  if (browser.fresh) { await browser.wipe(); console.log('시크릿 창 닫고 임시 프로필 삭제'); }
  else if (browser.attached) browser.disconnect();   // 이미 열려 있던 전용 창은 그대로 둔다
  else if (!r.published) { browser.disconnect(); console.log(MODE === 'SAVE' ? '임시저장 뒤 멈춤 · 전용 크롬 창은 그대로 둠 (사람이 임시저장 글을 열어 직접 발행)' : '발행 전 멈춤 상태라 전용 크롬 창은 그대로 둠 (사람이 이어서 확인·발행)'); }
  else { await browser.close().catch(() => { }); console.log('전용 크롬 닫음 (로그인 세션은 프로필에 남음)'); }   // 우리가 띄운 창은 닫아야 이 프로세스가 끝난다
  setTimeout(() => process.exit(0), 3000).unref();
})().catch(e => {
  console.error('오류:', e.message);
  if (MODE === 'SAVE') {
    result.status = e.code || (result.inspection.passed ? 'SAVE_FAILED' : 'INPUT_FAILED');
    result.errors.push({ code: result.status, message: e.message });
    SV.writeResult(RESULT_FILE, result);
    console.log('@@결과 ' + JSON.stringify({ pass: result.inspection.passed, fails: result.inspection.failed.length ? result.inspection.failed : [e.message], code: result.status, saved: result.saved, draftVerified: result.draftVerified, result: RESULT_FILE }));
  } else console.log('@@결과 ' + JSON.stringify({ pass: false, fails: [e.message] }));
  // 창은 그대로 둬서 사람이 확인·이어서 할 수 있게 하고(disconnect만), 프로세스는 끝낸다
  try { if (browserRef && !browserRef.fresh) browserRef.disconnect(); } catch { }
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 1500).unref();
});
