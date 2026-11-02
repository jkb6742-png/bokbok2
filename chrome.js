// 공용: puppeteer-core 모듈과 크롬 실행 파일 위치 찾기 (PC마다 경로가 달라도 되게)
//   puppeteer-core : 이 폴더(_도구)의 node_modules → 예전 절대경로(dental-saas) 순서로 찾는다. `npm install` 한 번이면 끝.
//   크롬           : 환경변수 BOKBOK_CHROME 또는 PUPPETEER_EXECUTABLE_PATH → puppeteer 캐시(~/.cache/puppeteer/chrome/*, 최신)
//                    → 설치된 Chrome(Program Files) 순서. 없으면 설치 방법을 알려 주는 오류.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');

function loadPuppeteer() {
  const tried = [];
  for (const spec of ['puppeteer-core', path.join(__dirname, 'node_modules', 'puppeteer-core'), 'C:/Users/jjang/Desktop/dental-saas/node_modules/puppeteer-core']) {
    try { return require(spec); } catch (e) { tried.push(spec); }
  }
  throw new Error(`puppeteer-core 를 찾지 못했습니다. "${__dirname}" 에서 npm install 을 실행하세요 (찾아본 곳: ${tried.join(', ')})`);
}

function findChrome() {
  const env = process.env.BOKBOK_CHROME || process.env.PUPPETEER_EXECUTABLE_PATH;
  if (env && fs.existsSync(env)) return env;
  const cands = [];
  const cache = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome');
  try {
    for (const d of fs.readdirSync(cache).sort().reverse()) {   // 버전 이름 내림차순 = 최신 먼저
      for (const sub of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome-linux64/chrome'])
        cands.push(path.join(cache, d, sub));
    }
  } catch { }
  cands.push(
    path.join(process.env['PROGRAMFILES'] || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome',
  );
  for (const c of cands) if (c && fs.existsSync(c)) return c;
  throw new Error('크롬 실행 파일을 찾지 못했습니다. 환경변수 BOKBOK_CHROME 에 chrome.exe 경로를 넣거나, "_도구" 에서 npx puppeteer browsers install chrome 을 실행하세요');
}

let _pp = null, _chrome = null;
module.exports = {
  get puppeteer() { return _pp || (_pp = loadPuppeteer()); },
  get CHROME() { return _chrome || (_chrome = findChrome()); },
  findChrome, loadPuppeteer,
};
