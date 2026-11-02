# GPT 원고·이미지 생성 규격 (bokbok 네이버 블로그)

사용자 결정(2026-11-01): 키워드·주제 입력 → GPT가 원고 작성 + 이미지 생성 → **앱에서 미리보기·수정** → [실행]으로 기존 입력 엔진(naver_post)이 타이핑·전수검사·발행.
이미지: **1번(대표) = OpenAI 이미지 생성**, 나머지 = GPT가 쓴 문구로 **범용 카드 템플릿 렌더**(글자 정확).
API 키: 앱 설정에 사용자가 직접 입력 → `engines\secrets.js` (`setSecret('openai','apiKey')`, DPAPI).
Claude로 원고 만들기 방식은 없앤다.

원칙: Node 내장 + 전역 fetch만 (npm 추가 금지). 렌더는 기존 puppeteer-core `C:/Users/jjang/Desktop/dental-saas/node_modules/puppeteer-core` + Chrome `C:/Users/jjang/.cache/puppeteer/chrome/win64-149.0.7827.22/chrome-win64/chrome.exe`. **시험에서 실제 OpenAI 호출 금지**(fetch 주입으로 가짜 응답).
`..\..\naver_post\` 입력 엔진은 수정하지 않는다. 원고는 그 엔진이 이미 읽는 **.txt 형식**으로 저장한다.

## .txt 원고 형식 (naver_post\manuscript.js parseTxt — 반드시 이걸로 다시 읽혀야 함)
```
제목: …
카테고리: …
태그: 가, 나, 다
사진폴더: C:\…\(원고 폴더)

> 인용구(키워드 제목)
도입 줄
**굵게** 일부
[[강조어|#bdfbfa]]   ← 형광펜(네이버 팔레트 색만)
---
> 소제목 인용구
[사진] 01_대표.png
## 1. 소주제 (19pt 굵게)
설명 줄
---
> 오늘의 포스팅을 정리하면?
요약 줄
[링크]
[해시태그]
```
본문은 가운데 정렬, 한 줄 15~28자 정도로 짧게 끊는다. 빈 줄 = 빈 줄. 번호는 `## 1. …`처럼 글자로.

## 레이아웃 관례 (기존 발행글 기준)
인용구(키워드 제목) → 도입 → [구분선 → 인용구 소제목 → 사진 → 본문] × (이미지 수) → 구분선 → 인용구 "오늘의 포스팅을 정리하면?" → 요약(Q&A 2~3개 `## Q. …`) → [링크] → [해시태그]

## 모듈 (bokbok_app\gen\)
### openai.js (작업자 K)
- `chatJSON({ apiKey, model, system, user, maxTokens }) -> object` — POST https://api.openai.com/v1/chat/completions, `response_format:{type:'json_object'}`. JSON 파싱 실패 시 1회 재요청.
- `image({ apiKey, model, prompt, size='1536x1024', quality='medium' }) -> Buffer` — POST /v1/images/generations (b64_json).
- 오류는 한국어: 401 "API 키가 맞지 않습니다", 429 rate/insufficient_quota 구분, 400 content_policy("이미지 프롬프트가 정책에 걸렸습니다").
- `_setFetch(fn)` 주입. 키는 로그·오류에 절대 노출하지 않는다(common.redact 사용 가능: `..\engines\common.js`).

### writer.js (작업자 K)
- 입력 `input = { keyword, topic, category?, notes?, imageCount=4 (2~6), length='보통' }`
- 블로그 성격 `profile = { blogId, blogName, persona(화자·말투), audience, categories:[], rules, color }`
- `buildMessages(input, profile) -> {system, user}` · `write({ apiKey, model, input, profile, log }) -> draft`
- `draft = { title, category, tags:[5~10], blocks:[…], images:[ {kind:'ai', file:'01_대표.png', prompt, alt}, {kind:'card', file:'02_….png', template:'points'|'compare'|'checklist'|'steps', data:{…}} … ] }`
  - blocks는 manuscript.js 블록과 같은 모양: `{quote}`, `{text:[줄…]}`, `{img: i}`, `{line:true}`, `{link:true}`, `{hashtags:true}`
  - images[0]은 항상 kind:'ai'. 나머지는 card. img 블록 수 == images 수, 순서 일치.
  - 카드 data 모양은 cards 규격(아래)과 일치해야 한다.
- `validateDraft(draft) -> string[]` (구조·길이·형광펜 색·카드 data 필수값·금지 표현)
- `toTxt(draft, dir) -> string` (위 .txt 형식, 사진폴더=dir)
- 프롬프트 규칙: 키워드는 제목 앞쪽 + 본문에 자연스럽게 3~5회 · 지어낸 통계·연구·후기·인용 금지 · 의료·금융·건강 효과 단정/보장 금지 · 과장 광고 문구 금지 · 다른 블로그 문장 복제 금지 · 화자 persona 유지 · AI 티 나는 상투어("결론적으로", "~에 대해 알아보겠습니다", "여러분") 지양 · 형광펜 색은 네이버 팔레트 중 `#bdfbfa #fff8b2 #ffa94f #ffc1c8 #d4d4ff #c8f5c8`만.
- 이미지 프롬프트(ai): 글자·로고·워터마크 없는 사진/일러스트, 주제 장면 묘사, 실존 인물·브랜드 금지.

### cards (작업자 L) — gen\cards\*.html + gen\cards\render.js
- `renderCards(cards, { color, outDir, log }) -> [{file, width, height}]` — cards = `[{template, data, file}]`. 폭 860, deviceScaleFactor 2, 높이는 내용에 맞춤(기존 _도구\그룹템플릿\render.js 방식 참고). 브라우저 1개로 여러 장.
- 템플릿 4종 (모두 한글 글자 정확·가독성 우선, 색은 profile.color 하나로 톤 맞춤, 글꼴은 Pretendard 로컬 없으면 Malgun Gothic):
  - `points`: `{ title, items:[{head, body}] (3~5) }` — 번호 붙은 핵심 정리
  - `compare`: `{ title, left:{label, items:[]}, right:{label, items:[]} }` — 둘 비교(2~5줄씩)
  - `checklist`: `{ title, items:[문장] (3~6) }` — 체크 항목
  - `steps`: `{ title, steps:[{head, body}] (3~5) }` — 순서/방법
- 넘침 방지: 글자가 길면 줄바꿈·글자 크기 자동 축소, 잘리면 안 됨. `validateCard(template, data) -> string[]` 제공.
- 카드 하단에 작은 블로그 이름 표기 옵션 `{ footer }`.

### pipeline.js (작업자 K, L의 renderCards 사용)
- `generate({ input, profile, settings:{model, imageModel, imageQuality}, apiKey, outRoot, log, step }) -> { dir, txt, draft }`
  - dir = `<outRoot>\<blogId>\<YYYYMMDD_HHmm>_<키워드 slug>\` 에 `draft.json`, `원고.txt`, 이미지 png 저장
  - step(name, i, n): '원고 작성' → '대표 이미지 생성' → '카드 렌더' → '원고 저장'
  - 실패 시 이미 만든 것 남기고 오류 throw(한국어)
- `regenImage({ dir, index, prompt?, apiKey, settings, profile, log })` — ai면 다시 생성, card면 draft.json 데이터로 다시 렌더
- `saveTxt(dir, txt)` — manuscript.js `load()`로 검증 후 저장(실패 시 오류)

## 서버·화면 (작업자 M)
- 설정: `GET /api/gen/settings` → `{model:'gpt-5', imageModel:'gpt-image-1', imageQuality:'medium', hasKey}` (기본값), `POST /api/gen/settings {apiKey?, clearKey?, model, imageModel, imageQuality}`
- 블로그 성격: accounts.json 항목에 `persona, audience, categories[], rules, color` 추가 — `POST /api/accounts/profile {blogId, …}`
- 생성: `POST /api/gen/start {blogId, keyword, topic, category, notes, imageCount}` (한 번에 1건) → SSE `{type:'genstep'|'genlog'|'gendone', data}`
- 초안: `GET /api/gen/drafts?blogId=` · `GET /api/gen/draft?dir=` → `{txt, draft, images:[{file, url}]}` · 이미지 제공 `GET /api/gen/img?dir=&file=` (원고함 안만, png/jpg만) · `POST /api/gen/save {dir, txt}` · `POST /api/gen/regen {dir, index, prompt?}` · `POST /api/gen/delete {dir}` (원고함\_휴지통으로 이동)
- 원고 목록(/api/state)에 `원고함\<blogId>\*\원고.txt` 포함 → 기존 [실행]으로 입력·검사·발행
- `/api/claude` 와 [Claude로 원고 만들기] 버튼 제거
- 화면(static\blog.js) nav: 원고 만들기 / 원고·발행 / 블로그 계정 / 발행 기록 / 입력 설정(+ AI 설정)

## 추가 요구 (2026-11-01 사용자) — 같은 모양 글이 반복되지 않게
### 1. 이미지 스타일 선택 (input.imageStyle, 기본 'auto')
writer/pipeline이 AI 이미지 프롬프트에 붙이는 스타일 프리셋. `gen\styles.js`(작업자 K)에 정의·export:
- `photo` 실사 사진 (자연광, 실제 장소·사물, 인물은 얼굴 식별 안 되게)
- `character` 귀여운 캐릭터 일러스트 (둥근 2등신 캐릭터, 파스텔)
- `flat` 플랫 일러스트 (단순 도형·면 색)
- `watercolor` 수채화
- `3d` 3D 렌더 (부드러운 클레이 질감)
- `minimal` 미니멀 정물 (여백 많은 배경 + 사물 하나)
- `auto` = 주제에 맞게 GPT가 위 중 하나 고름 (같은 계정 직전 글과 다른 것 우선)
- `aiCount` (1~2): AI 이미지 장수. 나머지는 카드. 2면 images[0]과 중간 하나가 ai.
### 2. 원고 레이아웃 템플릿 (input.layout, 기본 'auto')
`gen\layouts.js`(작업자 K) — 각 레이아웃은 블록 순서 규칙 + 프롬프트 지시문 + validate 규칙:
- `classic` 기본형: 인용구 제목 → 도입 → [구분선 → 인용구 소제목 → 사진 → 본문]×N → 정리 Q&A → 링크 → 해시태그
- `qa` 질문형: 소제목이 전부 질문(`## Q. …`), 인용구는 제목·정리에만
- `list` 리스트형: `## 1.` 번호 소주제 연속, 구분선 최소, 사진은 소주제 사이
- `story` 경험담형: 화자 경험 흐름(처음→과정→깨달음), 인용구 1~2개, 소주제 적게
- `compare` 비교형: A vs B 축으로 전개, compare 카드 필수
- `howto` 방법형: 단계별 `## STEP 1.`, steps 카드 필수
- `auto` = 같은 계정의 최근 3개 초안·발행 원고와 다른 레이아웃 우선 선택 (draft.json의 layout 기록으로 판단)
- 정리 섹션 제목·도입 첫 문장 패턴도 레이아웃마다 여러 후보에서 무작위 → 반복 방지
- draft.json에 `layout`, `imageStyle`, `deco` 기록
### 3. 장식 사용 여부 (input.deco, 기본 'auto')
- `off`: 본문 기호 없음, 카드도 체크박스·번호 원·아이콘 없이 글자와 선만
- `auto`: 카드는 템플릿에 맞게(checklist는 체크박스), 본문 기호는 목록 줄에만 가끔(✔ ▶ ·)
- `rich`: 카드 체크박스·번호 원·아이콘 적극, 본문 목록 줄머리에 ✔ 사용
- 본문 허용 기호는 `✔ ▶ · ✓ ※` 만(이모지 금지 — 네이버 에디터 입력·전수검사 안정성). cards render는 `deco` 옵션을 받아 장식 on/off.
### 화면 (작업자 M)
원고 만들기 폼에 [이미지 스타일](카드형 선택지 + 미리보기 설명) · [AI 이미지 수] · [레이아웃](자동 + 6종) · [장식](안 씀/적당히/많이) 추가. 각 선택지 옆 한 줄 설명.
