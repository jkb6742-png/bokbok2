// 채널 토큰 저장소 — Windows DPAPI(현재 사용자)로 암호화. 다른 Windows 계정·다른 PC에서는 풀리지 않는다.
// 값은 명령줄이 아닌 표준입력으로만 PowerShell에 넘긴다(프로세스 목록에 노출 방지).
const fs = require('fs'), path = require('path'), os = require('os');
const { execFile } = require('child_process');

// 앱과 같은 데이터 폴더(BOKBOK_DATA 점검용 덮어쓰기 포함) 아래 secrets
const DIR = path.join(process.env.BOKBOK_DATA || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'bokbok'), 'secrets');
const NAME = /^[A-Za-z0-9_-]{1,40}$/;
const file = (p, k) => {
  if (!NAME.test(p) || !NAME.test(k)) throw new Error('비밀값 이름 형식이 아님');
  return path.join(DIR, `${p}.${k}.bin`);
};

function ps(script, input) {
  return new Promise((res, rej) => {
    const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 20 },
      (e, out, err) => e ? rej(new Error('DPAPI 처리 실패: ' + (err || e.message).trim())) : res(out.trim()));
    child.stdin.end(input);
  });
}
const PRE = 'Add-Type -AssemblyName System.Security; $i=[Console]::In.ReadToEnd().Trim(); ';
const enc = b64 => ps(PRE + "$b=[Convert]::FromBase64String($i); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser'))", b64);
const dec = b64 => ps(PRE + "$b=[Convert]::FromBase64String($i); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser'))", b64);

async function setSecret(p, k, value) {
  const f = file(p, k);
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(f, await enc(Buffer.from(String(value), 'utf8').toString('base64')));
}
async function getSecret(p, k) {
  const f = file(p, k);
  if (!fs.existsSync(f)) return null;
  return Buffer.from(await dec(fs.readFileSync(f, 'utf8').trim()), 'base64').toString('utf8');
}
async function delSecret(p, k) { try { fs.unlinkSync(file(p, k)); } catch { } }
const hasSecret = (p, k) => fs.existsSync(file(p, k));

module.exports = { setSecret, getSecret, delSecret, hasSecret, DIR };
