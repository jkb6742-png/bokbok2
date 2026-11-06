// 병원 블로그 지수(index_web) 편입 — bokbok 서버가 지수 서버(3610)를 띄우고 로그인을 이어 준다.
//   ensure(): 3610 이 꺼져 있으면 node ../index_web/server.js 를 자식 프로세스로 띄움(로그 %LOCALAPPDATA%\bokbok\idx.log)
//   ticket(): index_web/_data/bridge_token 으로 1회용 입장권 → 앱 화면 iframe 이 그 주소로 들어가면 지수 세션이 생긴다
//   cmd(): 관리자 명령(일반 블로그 분석·병원 등록부). bokbok 관리자만.
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', 'index_web');
const PORT = +process.env.INDEX_PORT || 3610;
const IDATA = process.env.INDEX_DATA || path.join(ROOT, '_data');
let child = null, starting = null, logFile = null;

function req(method, p, body, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let tok = ''; try { tok = fs.readFileSync(path.join(IDATA, 'bridge_token'), 'utf8').trim(); } catch { }
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, timeout: timeoutMs,
      headers: Object.assign({ 'x-bokbok-bridge': tok }, data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) }, res => {
      let s = ''; res.setEncoding('utf8'); res.on('data', c => s += c);
      res.on('end', () => { let j = {}; try { j = JSON.parse(s); } catch { } if (res.statusCode >= 400) return reject(Object.assign(new Error(j.error || ('지수 서버 오류 ' + res.statusCode)), { status: res.statusCode })); resolve(j); });
    });
    r.on('timeout', () => r.destroy(new Error('지수 서버 응답 없음')));
    r.on('error', reject);
    if (data) r.write(data); r.end();
  });
}
const alive = () => req('GET', '/api/auth/config', null, 1500).then(() => true, () => false);

async function ensure(dataDir) {
  if (await alive()) return { ok: true, started: false };
  if (starting) return starting;
  starting = (async () => {
    logFile = path.join(dataDir || __dirname, 'idx.log');
    const out = fs.openSync(logFile, 'a');
    child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: Object.assign({}, process.env, { INDEX_HOST: process.env.INDEX_HOST || '0.0.0.0', BOKBOK_DATA: '' }), stdio: ['ignore', out, out], windowsHide: true });
    child.on('exit', code => { child = null; try { fs.appendFileSync(logFile, `\n[idx] 종료 code=${code} ${new Date().toISOString()}\n`); } catch { } });
    for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 250)); if (await alive()) return { ok: true, started: true }; }
    return { ok: false, error: '지수 서버를 띄우지 못했습니다. idx.log 를 확인하세요' };
  })();
  try { return await starting; } finally { starting = null; }
}
function stop() { if (child) { try { child.kill(); } catch { } child = null; } }

// host = 앱을 연 주소의 호스트(127.0.0.1 / localhost). 같은 호스트여야 iframe 안 쿠키가 같은 사이트로 붙는다
async function enter({ user, role, to, theme, host, dataDir }) {
  const e = await ensure(dataDir); if (!e.ok) throw new Error(e.error);
  const t = await req('POST', '/api/bridge/ticket', { user, role });
  const h = /^(localhost|127\.0\.0\.1)$/.test(host) ? host : '127.0.0.1';
  const q = new URLSearchParams({ t: t.t, to: String(to || '/'), theme: theme === 'light' ? 'light' : 'dark' });
  return { url: `http://${h}:${PORT}/api/bridge/enter?${q}`, role: t.role };
}
async function cmd({ line, user, role, dataDir }) {
  const e = await ensure(dataDir); if (!e.ok) throw new Error(e.error);
  return req('POST', '/api/bridge/cmd', { line, user, role }, 30000);
}
async function hospitals({ dataDir, user, role, save, remove }) { const e = await ensure(dataDir); if (!e.ok) throw new Error(e.error); return req('POST', '/api/bridge/hospitals', { user, role, save, remove }); }

module.exports = { ensure, stop, enter, cmd, hospitals, alive, PORT };
