# bokbok 채널 엔진 규격

위치: `bokbok_app\engines\` · Node 18+ 내장 모듈과 전역 fetch만 사용 (npm 패키지·GitHub 코드 복붙 금지)
원칙: **공식 API만** 쓴다. 브라우저 자동 클릭·비공식 API·스크래핑 로그인 금지. 비밀번호를 받거나 저장하지 않는다(OAuth 또는 사용자가 개발자 콘솔에서 발급한 토큰만).
블로그는 기존 `..\naver_post`(공식 글쓰기 API가 없어 브라우저 입력) — 엔진 대상 아님.

## 공통 모듈 (작성 완료, 수정 금지)
- `common.js`: `request(url, {method, query, form, json, multipart, headers, timeoutMs, retries, step, log})` → 파싱된 JSON(또는 text). 429·5xx는 지수 백오프 재시도(Retry-After 존중), 4xx는 `ApiError{status, body, step}` throw. 로그에 토큰·secret 값은 `***`로 가림. `sleep(ms)`, `redact(str)`, `readImage(path)` → `{buf, name, type}` (jpg/png/gif/webp, 8MB 이하만).
- `secrets.js`: Windows DPAPI(현재 사용자 계정)로 암호화해 `%LOCALAPPDATA%\bokbok\secrets\<platform>.<key>.bin`에 저장. `await getSecret(platform, key)`, `await setSecret(platform, key, value)`, `await delSecret(platform, key)`, `hasSecret(platform, key)`.

## 엔진 인터페이스 (각 엔진 파일이 export)
```js
module.exports = {
  platform: 'cafe' | 'instagram' | 'threads' | 'reddit',
  label: '네이버 카페',
  // 앱 설정 화면에 그릴 입력 항목. secret:true 는 secrets.js 로 저장(화면에 다시 보여주지 않음)
  configFields: [{ key, label, secret, hint, required }],
  limits: { dailyMax, minIntervalMin, titleMax, bodyMax, imagesMax },
  // OAuth가 있는 엔진만. redirectUri = http://127.0.0.1:3600/oauth/<platform>/callback
  authUrl?(ctx) -> string,                    // state 값은 ctx.state 사용
  authCallback?(ctx, query) -> { account: {name, handle, id} },  // 토큰은 ctx.setSecret 으로 저장
  check(ctx) -> { ok, name, detail },          // 연결 확인(토큰 유효·만료일 등)
  validate(post) -> string[]                   // 문제 목록(빈 배열이면 통과). 네트워크 호출 없음
  publish(ctx, post, { dryRun }) -> { id, url, dryRun, payload? }
}
```
`ctx` = `{ platform, config /*비밀 아닌 설정값*/, getSecret(key), setSecret(key,v), redirectUri, state, log(line) }`

## 원고(post) 형식 — 원고함\<채널>\*.json
```json
{
  "platform": "cafe",
  "title": "제목",
  "body": "본문 (줄바꿈 \n). 카페는 HTML 허용 안 함 → 엔진이 이스케이프 후 <br> 변환",
  "images": ["C:\\...\\a.png"],
  "imageUrls": ["https://공개주소/a.png"],
  "link": "https://...",
  "tags": ["태그"],
  "target": { "clubId": "", "menuId": "" } | { "subreddit": "" } | {},
  "options": { "flairId": "", "nsfw": false }
}
```
- 인스타·쓰레드는 Meta 서버가 이미지를 직접 가져가므로 **imageUrls(공개 https 주소)** 필요. images(로컬)만 있으면 validate에서 "공개 이미지 주소 필요" 반환.
- 카페는 로컬 images를 multipart로 업로드.
- 레딧은 텍스트 글(self)과 링크 글(link)만 1차 지원. 이미지 글은 validate에서 "레딧 이미지 글은 아직 지원 안 함".

## 시험
실제 계정·토큰이 없으므로 **실제 발행 호출 금지**. 각 엔진은 `engines\test\<platform>.test.js`(node 내장 `node:test` + `assert`)로:
validate 규칙, dryRun payload 모양, authUrl 파라미터, 응답 파싱(가짜 fetch 주입: `common.request`를 `ctx.request`로 넘겨받거나 모듈 수준 `_setRequest(fn)` 제공)을 검사. `node --test engines\test` 로 실행.
