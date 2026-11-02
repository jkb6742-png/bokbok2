# bokbok 앱 v2 규격 (작업자 공통 계약)

앱 위치: `C:\Users\jjang\Desktop\애드포스트 프로젝트\_도구\bokbok_app`
기존 버전 백업: `_backup_20261101\server.js`, `_backup_20261101\ui.html` (현재 동작하는 v1 — 블로그 발행 로직의 원본)
엔진: `..\naver_post\` (write.js, login.js, manuscript.js 등) — **수정 금지**
실행: `node server.js` → http://127.0.0.1:3600 , bokbok.exe가 Edge `--app` 창으로 연다 (launcher.cs 수정 금지)
외부 npm 패키지 추가 금지. Node 내장 모듈만. 프론트도 CDN·프레임워크 없이 순수 JS.

## 디자인
Cloudflare 대시보드처럼 단순·조용한 관리 화면.
- 상단바(흰색, 높이 52px, 아래 1px 선): 왼쪽 로고 `bokbok`(주황 점 + 글자) · 브레드크럼, 오른쪽 사용자 메뉴(이니셜 원 + 이름 ▾ → 내 계정 정보 / 환경설정 / 구분선 / 로그아웃 / 앱 종료)
- 홈: 제품 카드 그리드 (흰 카드, 얇은 회색 테두리, 그림자 없음 또는 아주 약하게). 카드 클릭 → 같은 창에서 그 모듈로 이동(hash 라우팅, 새 창 금지)
- 모듈 화면: 왼쪽 사이드바(흰색 220px, 오른쪽 1px 선) = 모듈 이름 + 메뉴(설정·계정 등록 등) + 맨 아래 "← 전체 서비스"
- 본문 배경 #F7F7F8, 본문 안의 표·폼은 흰 카드(.panel) 안에
- 색: ink #1F1F1F, sub #6B6B6B, line #E3E3E3, primary(버튼) #0051C3, 로고 점·포커스 강조 #F6821F, ok #0F7B6C, bad #D93025
- 글꼴: 'Pretendard','Malgun Gothic',sans-serif 14px
- 배지·칩·왼쪽 굵은 테두리 박스·진한 카드 금지. "준비 중" 같은 상태는 회색 작은 글자로만.
- 이모지 금지.

## 파일 구성 (각 작업자는 자기 파일만 수정)
| 파일 | 담당 |
|---|---|
| server.js | A |
| ui.html, static/app.css, static/core.js | B |
| static/auth.js, static/account.js | C |
| static/blog.js | D |
| static/channels.js | E |

ui.html은 아래 순서로 스크립트를 로드하고 마지막에 `BB.boot()` 호출:
`static/core.js, static/auth.js, static/account.js, static/blog.js, static/channels.js`
(모두 일반 `<script src>`; 파일이 없거나 오류여도 나머지가 돌도록 각 파일은 IIFE)

## 서버 API (A가 구현, 나머지는 이대로 호출)
모든 응답 JSON. 실패는 4xx + `{error:"한국어 메시지"}`. 세션 없으면 401 `{error:"로그인이 필요합니다"}`.
Host 헤더가 `127.0.0.1:3600` / `localhost:3600` 이 아니면 403.

정적: `GET /` → ui.html, `GET /static/<파일>` → static 폴더 (.js .css .svg .png만, 경로 이탈 차단). 둘 다 세션 불필요.

인증(세션 불필요):
- `GET /api/auth/me` → `{user}` 또는 401
- `POST /api/auth/signup {name,email,password}` → `{user}` + 쿠키. 이메일 형식, 비번 8자 이상, 이름 1~30자, 중복 이메일 거부
- `POST /api/auth/login {email,password,remember}` → `{user}` + 쿠키. 실패 시 "이메일 또는 비밀번호가 맞지 않습니다"
- `POST /api/auth/logout` → `{ok:true}` 쿠키 삭제

`user` = `{name,email,createdAt,prefs:{startView:'home'|'blog'}}`

세션 필요:
- `POST /api/auth/profile {name}` → `{user}`
- `POST /api/auth/password {current,next}` → `{ok:true}` (다른 세션 모두 끊음, 현재 세션 유지)
- `POST /api/auth/prefs {startView}` → `{user}`
- `GET /api/app` → `{version:'2.0.0', dataDir, port:3600, project}`
- 블로그(기존 v1 그대로): `GET /api/state?blogId=` , `POST /api/accounts {name,blogId}`, `/api/accounts/delete {blogId}`, `/api/login {blogId}`, `/api/pick {}`, `/api/unregister {file}`, `/api/settings {...}`, `/api/run {blogId,file,mode}`, `/api/stop`, `/api/open {path}`, `/api/claude {blogId}`, `/api/quit`
  - `/api/state` 응답: `{accounts:[{name,blogId}], settings:{tpm,jitter,linePause,tagPause,mode,scanDirs[]}, manuscripts:[{ok,error,file,title,category,chars,images,registered,posted,last}], job}` (v1과 동일)
- `GET /api/history?blogId=` → `{items:[{at,blogId,file,mode,code,pass,fails,published,report}]}` (blogId 없으면 전체, 최신순)
- 채널 계정(카페·인스타·쓰레드·레딧 공통): `GET /api/channels?p=cafe|instagram|threads|reddit` → `{items:[{name,handle,memo,addedAt}]}`, `POST /api/channels {p,name,handle,memo}`, `POST /api/channels/delete {p,handle}`
- 채널 설정: `GET /api/channel-settings?p=` → `{settings:{...}}`, `POST /api/channel-settings {p,settings}` (객체 그대로 저장, 키·값 문자열/숫자/불리언만, 4KB 제한)
- `GET /api/events` SSE (세션 필요): `data: {"type":"log"|"progress"|"done","data":...}`

저장 위치: `%LOCALAPPDATA%\bokbok\*.json` (users, sessions, accounts, settings, manuscripts, history, channels, channel_settings)
비밀번호: crypto.scrypt + 사용자별 salt, 비교는 timingSafeEqual. 세션 토큰은 해시로만 저장. 쿠키 `bb_sid` HttpOnly; SameSite=Strict; Path=/ (remember면 Max-Age 30일, 아니면 세션 쿠키 + 서버 만료 1일).

## 프론트 전역 계약 (B가 core.js에 구현, C·D·E가 사용)
```js
window.BB = {
  api(path, body?) -> Promise<json>   // body 있으면 POST JSON. 실패 시 toast(error) 후 throw. 401이면 (auth 경로 제외) 로그인 화면으로
  toast(msg), esc(str), fname(path), openP(pathOrUrl),  // openP = api('/api/open',{path})
  confirm(msg) -> Promise<bool>        // 브라우저 confirm 대신 앱 안 모달
  user,                                 // 현재 사용자 (boot 후)
  go(hash),                             // location.hash 변경
  onEvent(fn),                          // SSE 메시지 {type,data} 구독
  setUser(user),                        // 상단바 이름 갱신
  // 등록 API
  mod(key, def),      // 모듈 등록. def = {name, desc, order, ready:bool, nav:[[page,label],...], sideTop?(el), render(page, el)}
  page(key, def),     // 모듈 아닌 단독 페이지(사이드바 없음). def = {title, render(el)}  — 'me','prefs'
  auth: null,         // C가 BB.auth = {render(mode:'login'|'signup', el)} 설정
  boot(),
}
```
라우팅 (hash):
- `#/login`, `#/signup` → 상단바·사이드바 없이 전체 화면에 `BB.auth.render(mode, el)`
- `#/home` → 제품 카드 그리드 (BB.mod 등록된 것 order순. 카드 = 이름, desc, ready면 "사용 가능" 아니면 "준비 중" 회색 글자)
- `#/<mod>` → `#/<mod>/<nav[0][0]>`로
- `#/<mod>/<page>` → 사이드바(모듈 이름, sideTop, nav, 맨 아래 "← 전체 서비스") + 본문 `def.render(page, el)`
- `#/me`, `#/prefs` → BB.page 등록된 페이지
- boot: `/api/auth/me` → 401이면 `#/login`. 로그인 상태에서 hash가 비었거나 login/signup이면 `user.prefs.startView`(기본 home)로.
- 로그인 성공 후 C는 `BB.setUser(user); BB.go('#/home' 또는 startView)` 호출.
- 브레드크럼: `전체 서비스 / 모듈이름 / 메뉴라벨` (각 앞 단계 클릭 가능)
- 상단 사용자 메뉴: 내 계정 정보(#/me), 환경설정(#/prefs), 로그아웃(POST logout → #/login), 앱 종료(confirm 후 /api/quit, 화면에 "종료했습니다" 표시)
- 페이지 이동 시 이전 페이지 정리를 위해 render가 함수를 반환하면 이동 직전에 호출(cleanup).

## 공용 CSS 클래스 (B가 app.css에 정의, C·D·E는 이 클래스만 사용, 각 JS는 꼭 필요할 때만 소량 인라인 style)
- 레이아웃: `.page-h` (페이지 제목 영역: `h1` 22px + `.sub` 설명), `.panel` (흰 카드, 1px 선, 8px 라운드, 안쪽 20px), `.panel-h` (패널 제목줄: 제목 + 오른쪽 버튼), `.stack` (세로 간격 16px), `.row` (가로 flex gap 8px 줄바꿈 허용), `.grow` (flex:1)
- 버튼: `.btn`, `.btn.pri`(파랑), `.btn.danger`(빨강 글자), `.btn.sm`, `.link`(밑줄 없는 파랑 글자 버튼)
- 표: `table.tbl` (th 회색 12px, td 1px 아래선, `tr.sel` 선택행 연파랑, `tr.click` 커서), `.num` 오른쪽정렬
- 폼: `.form` (세로), `.field` (라벨 위·입력 아래), `.field label`, `.field .hint`(회색 12px), `input.inp`, `select.inp`, `textarea.inp`, `.seg`(세그먼트 버튼 묶음, `button.on`)
- 상태 글자: `.ok`, `.bad`, `.muted`, `.mono`(작은 고정폭)
- 기타: `.empty`(가운데 회색 안내), `.prog > i`(진행 막대), `.log`(고정폭 로그 박스 높이 180px 스크롤), `.kv`(정의 목록 2열: dt 회색 / dd)
- 인증 화면: `.auth-wrap`(전체 화면 가운데 정렬, 배경 #F7F7F8), `.auth-card`(흰 카드 400px), `.auth-logo`
