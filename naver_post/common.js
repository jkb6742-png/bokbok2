// 네이버 블로그 자동 입력 공통 설정
// 보안 원칙
//  - 아이디·비밀번호는 코드·파일 어디에도 저장하지 않는다. 로그인은 사람이 창에서 직접 한다.
//  - 로그인 세션(쿠키)은 바탕화면(NAS 공유)이 아닌 %LOCALAPPDATA% 아래 계정별 크롬 폴더에만 남는다.
//    (복복이 jsrjkb6742 = naver-blog-profile, 그 외 계정 = bokbok\profiles\<블로그아이디>)
//  - 외부 패키지 추가 없음. 이미 설치된 puppeteer-core + 로컬 Chrome만 쓴다.
//  - naver.com 외 주소로는 이동하지 않는다.
//  - 최종 '발행'은 전수검사 전 항목 통과 + PUBLISH=1 일 때만 누른다.
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
      defaultViewport: null, args: ['--window-size=1280,960', '--lang=ko-KR', '--incognito', '--no-first-run', '--no-default-browser-check'],
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
    browser.attached = true;
    return browser;
  } catch (e) {
    return puppeteer.launch({
      executablePath: CHROME, headless: false, userDataDir: PROFILE,
      defaultViewport: null, args: ['--window-size=1280,960', '--lang=ko-KR'],
    });
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
    if (!told) { told = true; log('@@진행 로그인 대기 · 전용 크롬 창에서 직접 로그인해 주세요 (아이디·비밀번호·IP보안 해제는 사람이 직접)'); log('로그인 대기 중: 열린 크롬 창에서 직접 로그인하면 이어서 진행합니다'); await page.bringToFront().catch(() => { }); }
    // 로그인 뒤 글쓰기 화면으로 안 돌아오면 다시 글쓰기 주소로
    if (Date.now() - lastNudge > 20000 && !/nid\.naver\.com/.test(url) && !f) { lastNudge = Date.now(); await page.goto(writeUrl, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => { }); }
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
  const page = browser.attached ? await browser.newPage() : (await browser.pages())[0] || await browser.newPage();
  await guard(page);
  return { browser, page };
}

module.exports = { BLOG_ID, PROFILE, WRITE_URL, ALLOWED, LOGIN_MODE, sleep, pause, launch, guard, waitLogin };
