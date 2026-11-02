# bokbok 도구 모음 (_도구)

- `bokbok_app/` 블로그 육성·원고·발행 앱 (Node 내장 모듈만, `node server.js` → http://127.0.0.1:3600)
- `naver_post/` 네이버 블로그 입력 엔진 (puppeteer-core + 로컬 Chrome, 사람 속도 타이핑·전수검사)
- `그룹템플릿/`, `연애궁합템플릿/` 이미지 렌더 템플릿, `원고데이터/` 복복이 원고, `build_post.js` 원고 HTML
- `chrome.js` puppeteer-core 모듈과 Chrome 실행 파일을 PC마다 자동으로 찾는 공용 모듈

## 다른 PC에 설치
1. Node 20 이상, Git 설치. 저장소를 받는다: `git clone <저장소 주소> "애드포스트 프로젝트/_도구"` (상위 폴더 이름은 자유. 앱 데이터는 `%LOCALAPPDATA%\bokbok\` 에 따로 생긴다)
2. `_도구` 에서 `npm install` (puppeteer-core)
3. Chrome: 설치된 Chrome 이 있으면 자동으로 쓴다. 없거나 버전을 맞추려면 `npm run chrome` (puppeteer 캐시에 149 버전 설치). 특정 경로를 쓰려면 환경변수 `BOKBOK_CHROME=<chrome.exe 경로>`
4. 앱 실행 `npm start` → 브라우저에서 http://127.0.0.1:3600 → 첫 가입자가 관리자
5. 블로그 계정 추가 → 블로그 성격(카테고리는 편집기 이름 그대로)·원고 프롬프트·히든 이미지 → [로그인 창 열기] 로 전용 Chrome 에 한 번 직접 로그인 → 데이터 설정에 API 키(검색·검색광고·OpenAI) 입력
6. 테스트 `npm test`

## 저장소에 넣지 않는 것
- 로그인 세션·비밀값·수집 데이터: `%LOCALAPPDATA%\bokbok\`, `%LOCALAPPDATA%\naver-blog-profile\` (PC마다 따로)
- 원고함·사진함·검수 보고서 등 산출물 (`애드포스트 프로젝트\원고함`, `03_원고` 등)
- `node_modules/`

## 개발 ↔ 테스트 PC
- 개발 PC: 수정 → `npm test` → 커밋 → push
- 테스트 PC: `git pull` → 서버 재시작(`npm start`) → 테스트. 결과(검수 HTML·로그)는 NAS 공유폴더 또는 메신저로.
