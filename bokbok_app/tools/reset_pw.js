// bokbok 앱 로컬 사용자 비밀번호 재설정 (이 PC의 %LOCALAPPDATA%\bokbok\users.json 만 바꿈)
//   node tools/reset_pw.js <아이디>
// 새 비밀번호는 화면에 찍지 않고 %LOCALAPPDATA%\bokbok\<아이디>_새비밀번호.txt 에 적고 메모장으로 연다.
// 앱 server.js 의 setPw 와 같은 방식(scrypt 64바이트, 16바이트 salt).
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { spawn } = require('child_process');
const DATA = path.join(process.env.LOCALAPPDATA, 'bokbok');
const F = path.join(DATA, 'users.json');
const id = process.argv[2];
if (!id) { console.error('사용법: node tools/reset_pw.js <아이디>'); process.exit(1); }
const list = JSON.parse(fs.readFileSync(F, 'utf8'));
const u = list.find(x => x.email === id || x.name === id);
if (!u) { console.error('그런 사용자가 없음:', id); process.exit(1); }
const pw = crypto.randomBytes(9).toString('base64url');
u.salt = crypto.randomBytes(16).toString('hex');
u.hash = crypto.scryptSync(pw, u.salt, 64).toString('hex');
fs.copyFileSync(F, F + '.bak');
fs.writeFileSync(F, JSON.stringify(list, null, 2));
const out = path.join(DATA, `${id}_새비밀번호.txt`);
fs.writeFileSync(out, `bokbok 앱 (http://127.0.0.1:3600)\r\n아이디: ${u.email}\r\n새 비밀번호: ${pw}\r\n\r\n로그인 뒤 앱의 내 정보에서 원하는 비밀번호로 바꾸고 이 파일은 지우세요.\r\n`);
spawn('notepad.exe', [out], { detached: true, stdio: 'ignore' }).unref();
console.log('재설정 완료 →', out, '(메모장으로 열었음, 원본 백업 users.json.bak)');
