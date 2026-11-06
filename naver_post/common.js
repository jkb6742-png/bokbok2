// 네이버 블로그 자동 입력 공통 설정
// 보안 원칙
//  - 아이디·비밀번호는 코드·파일 어디에도 저장하지 않는다. 로그인은 사람이 창에서 직접 한다.
//  - 로그인 세션(쿠키)은 바탕화면(NAS 공유)이 아닌 %LOCALAPPDATA% 아래 계정별 크롬 폴더에만 남는다.
//    (복복이 jsrjkb6742 = naver-blog-profile, 그 외 계정 = bokbok\profiles\<블로그아이디>)
//  - 외부 패키지 추가 없음. 이미 설치된 puppeteer-core + 로컬 Chrome만 쓴다.
//  - naver.com 외 주소로는 이동하지 않는다.
//  - 기본 운영은 SAVE=1(임시저장까지, 발행 안 함). 최종 '발행'은 전수검사 전 항목 통과 + PUBLISH=1 + ALLOW_AUTO_PUBLISH=1 일 때만 누른다.
//  - 계정 선택: 환경변수 BLOG_ID (없으면 jsrjkb6742)
const fs = require('fs'), path = require('path'), os = require('os');
const chromeEnv = require('../chrome');   // puppeteer-core 모듈·크롬 경로 (PC마다 달라도 됨)
const puppeteer = chromeEnv.puppeteer;

const BLOG_ID = process.env.BLOG_ID || 'jsrjkb6742';
const CHROME = chromeEnv.CHROME;
const LOCAL = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
// 전용 크롬 프로필: 기본은 블로그 아이디 이름. 네이버 로그인 아이디와 블로그 아이디가 다르면(예: 로그인 jkb2907, 블로그 victoreconomic)
// 앱이 BLOG_PROFILE(계정의 loginId 프로필 경로)을 넘겨 그 폴더를 쓴다.
const PROFILE = process.env.BLOG_PROFILE || (BLOG_ID === 'jsrjkb6742' ? path.join(LOCAL, 'naver-blog-profile') : path.join(LOCAL, 'bokbok', 'profiles', BLOG_ID));
const WRITE_URL = `https://blog.naver.com/${BLOG_ID}?Redirect=Write&`;
const ALLOWED = /^https?:\/\/([a-z0-9-]+\.)*(naver\.com|naver\.net|pstatic\.net|navercorp\.com)(\/|$)/;

// 고정 IP(프록시): 앱에서 계정에 할당한 값이 BLOG_PROXY(http://host:port 등)·BLOG_FIXED_IP(출구 IPv4)로 온다.
//   - 크롬을 그 프록시로 띄우고(WebRTC도 프록시 밖으로 못 나가게), 네이버를 열기 전에 출구 IP가 BLOG_FIXED_IP와 같은지 확인한다.
//   - 다르거나 확인이 안 되면 창을 닫고 중단한다. 이 PC 인터넷으로 대신 나가지 않는다.
//   - 이미 열린 전용 창이 다른 프록시로 떠 있으면 재사용하지 않고 닫은 뒤 새로 띄운다(프록시는 크롬을 띄울 때만 정해진다).
const PROXY = process.env.BLOG_PROXY || '';
const FIXED_IP = process.env.BLOG_FIXED_IP || '';
const NET_MARK = path.join(PROFILE, 'bokbok_net.json');
const netArgs = () => PROXY ? [`--proxy-server=${PROXY}`,'--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] : [];
const IP_CHECK = ['https://api.ipify.org/', 'https://ipv4.icanhazip.com/'];
// 크롬 안에서(그 창의 실제 경로로) 출구 IP를 두 곳에서 확인한다. 고정 IP가 할당되지 않은 계정은 그냥 통과.
async function verifyIp(browser, log = console.log) {
  if (!FIXED_IP) return null;
  if (FIXED_IP === 'MISSING') throw new Error('이 계정에 할당한 고정 IP가 목록에서 지워졌습니다. 앱에서 고정 IP를 다시 할당하세요');
  const p = await browser.newPage();
  try {
    const seen = [];
    for (const u of IP_CHECK) {
      const r = await p.goto(u, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(e => { throw new Error(`출구 IP 확인 실패(${u}): ${e.message.slice(0, 80)} — 프록시가 연결되지 않았을 수 있습니다`); });
      if (!r || !r.ok()) throw new Error(`출구 IP 확인 실패(${u}): 응답 ${r ? r.status() : "없음"}`);
      seen.push((await r.text()).trim());
    }
    if (seen.some(x => x !== FIXED_IP)) throw new Error(`출구 IP 불일치: 할당 ${FIXED_IP} · 실제 ${seen.join(" / ")} — 네이버를 열지 않고 중단합니다`);
    log(`고정 IP 확인 ${FIXED_IP}${PROXY ? " (프록시 " + PROXY.replace(/^\w+:\/\//, "") + ")" : ""}`);
    return FIXED_IP;
  } finally { await p.close().catch(() => { }); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 사람 손 속도처럼 0.6~1.4배로 흔들어 기다림
const pause = (ms = 700) => sleep(Math.round(ms * (0.6 + Math.random() * 0.8)));

// 로그인 방식 (LOGIN_MODE)
//   keep  : 계정별 전용 프로필에 로그인을 유지. 이미 열린 전용 창이 있으면 붙는다.
//   fresh : 매번 새 시크릿 창(임시 프로필). 로그인은 사람이 그 창에서 직접 한다(아이디·비밀번호·IP보안 해제 모두 사람 손).
//           작업이 끝나면 창을 닫고 임시 프로필 폴더를 통째로 지운다 → 쿠키·캐시·기록이 남지 않는다.
const LOGIN_MODE = process.env.LOGIN_MODE === 'fresh' ? 'fresh' : 'keep';
const FRESH_PREFIX = 'bokbok-fresh-';
function cleanupOldFresh() {
  try {
    for (const n of fs.readdirSync(os.tmpdir())) {
      if (!n.startsWith(FRESH_PREFIX)) continue;
      const p = path.join(os.tmpdir(), n);
      try { if (Date.now() - fs.statSync(p).mtimeMs > 6 * 3600000) fs.rmSync(p, { recursive: true, force: true }); } catch { }
    }
  } catch { }
}

// 이미 열린 전용 창이 있으면 그 창에 붙고, 없으면 새로 띄운다
async function open() {
  if (LOGIN_MODE === 'fresh') {
    cleanupOldFresh();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), FRESH_PREFIX));
    const browser = await puppeteer.launch({
      executablePath: CHROME, headless: false, userDataDir: dir,
      defaultViewport: null, args: ['--window-size=1280,960', '--lang=ko-KR', '--incognito', '--no-first-run', '--no-default-browser-check', ...netArgs()],
    });
    browser.fresh = true;
    browser.freshDir = dir;
    // 창을 닫고 임시 프로필을 지운다 (오류로 멈췄을 땐 호출하지 않아 창이 남는다 → 사람이 확인)
    browser.wipe = async () => { try { await browser.close(); } catch { } try { fs.rmSync(dir, { recursive: true, force: true }); } catch { } };
    return browser;
  }
  try {
    const [port, wsPath] = fs.readFileSync(path.join(PROFILE, 'DevToolsActivePort'), 'utf8').trim().split('\n');
    const browser = await puppeteer.connect({ browserWSEndpoint: `ws://127.0.0.1:${port}${wsPath}`, defaultViewport: null });
    let mark = ''; try { mark = JSON.parse(fs.readFileSync(NET_MARK, 'utf8')).proxy || ''; } catch { }
    if (mark !== PROXY) {
      console.log(`열린 전용 창의 연결(${mark || '이 PC 인터넷'})이 할당된 연결(${PROXY || '이 PC 인터넷'})과 달라 창을 닫고 새로 띄웁니다`);
      await browser.close().catch(() => { });
      for (let t = 0; t < 20 && fs.existsSync(path.join(PROFILE, 'lockfile')); t++) await sleep(500);
      await sleep(1500);
      throw new Error('relaunch');
    }
    browser.attached = true;
    return browser;
  } catch (e) {
    // 크롬을 이 프로세스와 분리해서 띄운다(detached). puppeteer.launch로 띄우면 node가 끝날 때 창도 같이 꺼져서,
    // '해시태그까지 넣고 멈춤' 뒤 사람이 [발행]을 누를 창이 사라졌다(2026-11-05 whitedream56). 이제 멈춘 뒤에도 창이 남는다.
    const portFile = path.join(PROFILE, 'DevToolsActivePort');
    try { fs.unlinkSync(portFile); } catch { }
    require('child_process').spawn(CHROME, [`--user-data-dir=${PROFILE}`, '--remote-debugging-port=0', '--window-size=1280,960', '--lang=ko-KR', '--no-first-run', '--no-default-browser-check', ...netArgs(), 'about:blank'], { detached: true, stdio: 'ignore' }).unref();
    try { fs.writeFileSync(NET_MARK, JSON.stringify({ proxy: PROXY, at: new Date().toISOString() })); } catch { }
    for (let t = 0; t < 60 && !fs.existsSync(portFile); t++) await sleep(500);
    const [port, wsPath] = fs.readFileSync(portFile, 'utf8').trim().split('\n');
    const browser = await puppeteer.connect({ browserWSEndpoint: `ws://127.0.0.1:${port}${wsPath.trim()}`, defaultViewport: null });
    browser.spawned = true;
    return browser;
  }
}

// 글쓰기 화면이 뜰 때까지(=로그인될 때까지) 기다린다. 로그인은 사람이 창에서 직접 한다.
//   돌려주는 값: mainFrame 프레임. LOGIN_WAIT_MIN(기본 10분) 안에 안 되면 오류.
async function waitLogin(page, writeUrl, log = console.log) {
  const limit = Number(process.env.LOGIN_WAIT_MIN || 10) * 60000, t0 = Date.now();
  let told = false, lastNudge = 0;
  while (Date.now() - t0 < limit) {
    const f = page.frames().find(x => x.name() === 'mainFrame');
    const url = page.url();
    if (f && /blog\.naver\.com/.test(url) && !/nid\.naver\.com/.test(url)) {
      const ok = await f.$('.se-content, .se-title-text').catch(() => null);
      if (ok) return f;
    }
    if (!told) { told = true; log('@@진행 로그인 대기 · 네이버 첫 화면에서 직접 로그인해 주세요 (아이디·비밀번호·IP보안 해제는 사람이 직접)'); log('로그인 대기 중: 네이버 첫 화면(www.naver.com)에서 로그인하면 블로그로 이동해 이어서 진행합니다'); await page.bringToFront().catch(() => { }); }
    // 사용자 지시(2026-11-05): 로그인은 네이버 첫 화면에서 하고, 로그인이 확인된 뒤에 블로그 → 글쓰기로 이동한다.
    //   로그인 쿠키(NID_AUT)가 생기기 전에는 화면을 옮기지 않는다(로그인 중인 사람을 끌고 가지 않도록).
    if (Date.now() - lastNudge > 8000 && !/nid\.naver\.com/.test(url) && !f) {
      const logged = (await page.cookies('https://www.naver.com').catch(() => [])).some(c => c.name === 'NID_AUT');
      if (logged) {
        lastNudge = Date.now();
        const home = writeUrl.replace(/\/postwrite.*$/i, '').replace(/\?.*$/, '');
        if (!/blog\.naver\.com/.test(url)) { await page.goto(home, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => { }); await sleep(2500); }
        await page.goto(writeUrl, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => { });
      }
    }
    await sleep(3000);
  }
  throw new Error(`로그인 대기 ${Math.round(limit / 60000)}분이 지났습니다. 창에서 로그인한 뒤 다시 실행해 주세요`);
}

// 최상위 문서가 naver 밖으로 나가면 막는다
async function guard(page) {
  await page.setRequestInterception(true);
  page.on('request', req => {
    const top = req.isNavigationRequest() && req.frame() === page.mainFrame();
    if (top && !ALLOWED.test(req.url()) && !req.url().startsWith('about:')) {
      console.log('차단한 이동:', req.url()); return req.abort();
    }
    req.continue();
  });
  return page;
}

async function launch() {
  const browser = await open();
  try { await verifyIp(browser); }
  catch (e) {   // 고정 IP가 아니면 네이버를 열지 않고 창을 닫는다
    console.error('중단: ' + e.message);
    if (browser.wipe) await browser.wipe(); else await browser.close().catch(() => { });
    throw e;
  }
  const page = browser.attached ? await browser.newPage() : (await browser.pages())[0] || await browser.newPage();
  await guard(page);
  return { browser, page };
}

module.exports = { BLOG_ID, PROFILE, WRITE_URL, ALLOWED, LOGIN_MODE, PROXY, FIXED_IP, sleep, pause, launch, guard, waitLogin, verifyIp };
