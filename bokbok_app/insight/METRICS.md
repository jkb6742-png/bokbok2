# 블로그 육성 지표 정의 (insight)

모든 날짜는 한국시간(KST) 기준. 계산 코드는 `metrics.js`, 수집은 `collectors/*.js`.
"오늘"은 수집일 또는 `dashboard(today)` 값.

## 1. 데이터 출처

| 키 | 주소 | 얻는 값 | 확인 | robots.txt |
|---|---|---|---|---|
| titleList | `blog.naver.com/PostTitleListAsync.naver?blogId=&currentPage=&countPerPage=30` | 전체 글 logNo·제목·categoryNo·날짜(일 단위 또는 "N시간 전")·totalCount·댓글 수(있을 때) | 2026-11-01 실측 | 허용 |
| mobileList | `m.blog.naver.com/api/blogs/<id>/post-list?categoryNo=0&itemCount=30&page=N` (Referer 필수) | 글별 공감(sympathyCnt)·댓글(commentCnt)·공유(shareCnt)·사진 수(thumbnailCount)·발행 시각(ms)·카테고리 이름·검색 허용(searchYn)·전체공개 | 실측 | `/api/` 비허용 → `strictRobots` 로 끔 |
| blogInfo | `m.blog.naver.com/api/blogs/<id>` (Referer 필수) | 블로그 이름·이웃 수(subscriberCount)·누적 방문자(totalVisitorCount)·오늘 방문자(수집 시점까지)·디렉터리 주제·파워/인플루언서 여부 | 실측 | 비허용 → `strictRobots` 로 끔 |
| rss | `rss.blog.naver.com/<id>.xml` | 최근 약 50개 글의 정확한 발행 시각·태그·카테고리 | 실측 | 전체 비허용(구독용 공개 피드) |
| searchApi | `naverapihub.apigw.ntruss.com/search/v1/blog` 또는 `openapi.naver.com/v1/search/blog.json` | 키워드 블로그 검색 순위(관련도 100~1000위), 제목 날짜순 색인 확인, 상위 글 작성일 | 키 없음, 형식은 공식 문서·dentalbox 코드 | 공식 API |
| serpTab | `search.naver.com/search.naver?ssc=tab.blog.all&query=` | 블로그 탭 1쪽 30건 순위(`data-cr-on="r=N"`) | 1회 실측 | 전체 비허용 → 기본 꺼짐(`serp`) |
| serpTotal | `search.naver.com/search.naver?where=nexearch&query=` | 영역 순서(layout `"main":[{area,rank}]`), 스마트블록 안 내 글 위치, AI 브리핑 인용 글 | 1회 실측 | 전체 비허용 → 기본 꺼짐 |
| keywordTool | `api.searchad.naver.com/keywordstool?hintKeywords=&showDetail=1` (HMAC 서명) | 월 PC·모바일 검색량, 경쟁도(낮음/중간/높음), 월 평균 클릭·CTR, 평균 광고 수, 연관 키워드 | 키 없음, 형식은 사내 코드 | 공식 API |
| owner | `admin.blog.naver.com/<id>/stat/today` 화면이 부르는 `blog.stat.naver.com/api/blog/daily/cv?timeDimension=DATE&startDate=` | 일별 조회수(cv) 15일 + 같은 응답의 표 7개(방문자·유입 검색어·유입 경로·인기 글 추정) | cv 표만 구조 실측, 나머지 열 이름은 미확인 | 본인 로그인 화면(읽기 전용) |

쓰지 않음: `NVisitorgp4Ajax.naver`(204 빈 응답 + robots 비허용) → 일 방문자는 누적 방문자 차이로 계산. `BlogTagListInfo.naver`(robots 비허용) → 태그는 RSS로.

## 2. 발행

| 지표 | 정의 | 출처 |
|---|---|---|
| posts7 / posts28 / posts30 / posts90 | 발행일이 오늘 기준 0~(N-1)일 전인 글 수 | titleList·mobileList |
| perWeek | posts28 ÷ 4 | |
| goalPct | posts30 ÷ 목표(기본 30일 20편, `config.goals.postsPer30`) × 100 | |
| avgGap / maxGap90 / currentGap | 최근 90일 발행일(중복 제거) 사이 간격 평균·최대(현재 공백 포함), 마지막 발행 후 지난 일수 | |
| activeWeeks | 최근 4주(7일 단위) 중 1편 이상 쓴 주 수 | |
| **발행 꾸준함 점수**(consistencyScore, 0~100) | `40 × activeWeeks/4 + 40 × min(posts28 ÷ (목표×28/30), 1) + 20 × clamp(1 − (maxGap90 − 3)/11, 0, 1)` — 공백 3일 이하는 만점, 14일 이상 0점 | |

## 3. 반응(공개)

| 지표 | 정의 |
|---|---|
| sympathy / comments / shares | 글별 최신 수집값. 날짜별 이력 `posts.json > history[날짜] = {s, c, sh}` |
| sympathyTotal / commentTotal | 전체 글 최신값 합 (스냅샷 KPI → 추세) |
| engagement(글) | `공감 + 2×댓글 + 3×공유`. 발행 7일 미만 글은 `× 7 ÷ 경과일`로 환산 |
| 이웃 수 | blogInfo.subscriberCount, 7일 변화 = KPI delta7 |

## 4. 방문

| 지표 | 정의 | 출처 |
|---|---|---|
| visitors(일) | 주인 통계 일별 방문자(있으면) > 연속 스냅샷 누적 방문자 차이 ÷ 간격 일수(근사, `approx`) | owner > blogInfo |
| views(일) | 주인 통계 일별 조회수(cv) | owner |
| 30일 평균 방문자 | 최근 30일 visitors 평균 (애드포스트 체크리스트) | |

## 5. 검색 노출

판정(글 1개 × 타깃 키워드 1개, 하루 1번). 타깃 키워드 = `config.keywords[logNo]` 또는 제목에서 뽑은 키워드(dentalbox `primaryKeyword`: 제목 앞 절, `[말머리]` 제거).

| 상태 | 뜻 |
|---|---|
| EXPOSED | 블로그 탭에서 찾음(API: 관련도 100위 안 / 화면: 1쪽 30위 안) 또는 통합검색 영역 안에 그 글이 있음 |
| OUT_OF_RANGE | API 기준 색인은 됐지만(제목 날짜순 100위 안) 키워드 100위 밖 |
| MISSING | 제목으로도 검색에 없음, 발행 24시간 지남(색인 누락) |
| NOT_FOUND | 화면 모드에서 1쪽에 없음(색인 여부 모름) |
| PENDING | 발행 24시간 미만 — 판정 보류 |

| 지표 | 정의 |
|---|---|
| **노출 성공률**(exposureRate) | EXPOSED 글 ÷ 판정한 글(PENDING 제외) × 100. 글마다 최신 판정, 키워드 여럿이면 가장 좋은 것 |
| top10 / top3 / avgRank / medianRank | EXPOSED 글의 블로그 탭 순위 집계 |
| smartBlock | 통합검색 영역(인기글·스마트블록 등) 안에 타깃 글이 있는 글 수. 위치 = 영역 순서(layout rank) + 영역 안 순번(r=) |
| aiCited | 통합검색 AI 브리핑 영역에 인용된 내 글 수 |
| cannibal(키워드 잠식) | 한 키워드 결과에 내 글이 2개 이상 |
| coverage | 노출 판정 기록이 있는 글 ÷ 전체 글 |
| top10AgeDays | 그 키워드 상위 10개 글 작성일 나이 중앙값(API만) — 작으면 "최신 글이 이기는 키워드" |
| 순위 이력 | `ranks.json > keywords["정규화키워드|logNo"].history[날짜]` |

## 6. 키워드·기회

| 지표 | 정의 | 출처 |
|---|---|---|
| volume | 월 PC + 모바일 검색량 ("< 10"은 5로 보고 lowVolume) | keywordTool |
| compIdx | 검색광고 경쟁도(낮음/중간/높음). 광고 경쟁이지만 상업성·경쟁 강도 대용으로 씀 | keywordTool |
| mobileShare | 모바일 ÷ 전체 × 100 | |
| **추정 월 검색 유입**(estSearchTraffic) | Σ 키워드 `volume × CTR(순위)`. CTR 곡선(가정): 1위 25%, 2위 15%, 3위 10%, 4~5위 7%, 6~10위 4%, 11~20위 1.5%, 21~30위 0.7%, 31~100위 0.1%, 밖 0. `config.ctrCurve` 로 변경 | ranks + keywordTool |
| potentialTop3 | `volume × CTR(3)` — 3위 안에 들면 기대 월 유입 |
| **키워드 경쟁도 대비 순위** | 표 `tables.keywords`: 키워드·검색량·경쟁도·현재 순위·추정 유입·potentialTop3 (potentialTop3 큰 순) |

## 7. 글별 성과 점수 (0~100)

`engPct` = 전체 글 중 engagement(나이 보정) 백분위(0~1).
`expo` = EXPOSED 면 `max(rankScore(순위), 스마트블록 안이면 60)`, 아니면 0, 판정 없으면 없음.
`rankScore`(dentalbox 이식): 1위 100, 2위 88, 3위 78, ~5위 68, ~10위 52, ~20위 32, ~30위 18, ~50위 8, ~100위 3.
**score** = 판정 있으면 `50×engPct + 50×expo/100`, 없으면 `100×engPct`.
함께 보여 줄 값: 제목 길이, 제목 속 키워드 위치(0=맨 앞, −1=없음), 사진 수, 태그 수, 검색량.

## 8. 카테고리별 효율

카테고리별 글 수, 평균 공감, 평균 댓글, 노출 성공률, 평균 성과 점수(정렬 기준).

## 9. 요일·시간대별 발행 효과

글의 발행 시각(mobileList ms 또는 RSS, 없으면 날짜만 → 요일만)으로 묶어 글 수·평균 성과 점수·노출 성공률.
시간대: 새벽 0~6시, 오전 6~12, 오후 12~18, 저녁 18~24. 글 3편 미만 칸은 `enough:false`(추천에 안 씀).

## 10. 저품질 의심 신호 (signals)

| 코드 | 조건 | 등급 |
|---|---|---|
| EXPOSURE_DROP | 스냅샷 6개 이상, 이전 14회 평균 노출률 ≥ 20% 이고 최근 3회 평균 ≤ 그 절반 | high |
| NEW_POSTS_UNEXPOSED | 발행 1~10일 지난 판정 글 최근 5개 모두 EXPOSED 아님 (dentalbox LOWQUALITY_STREAK=5) | high |
| NOT_INDEXED | 위 5개 중 MISSING 2개 이상 | mid |
| RANK_LOST | 3일 이내 연속 판정에서 30위 안 → 밖이 된 키워드 3개 이상 | mid |
| VISITOR_DROP | 방문자 14일치 이상, 이전 21일 평균 ≥ 10명이고 최근 7일 평균 ≤ 그 절반 | mid |
| HIDDEN_POSTS | 검색 비허용이거나 전체공개 아닌 글 존재 | low |

## 11. 애드포스트 준비도

네이버는 애드포스트 미디어 승인 숫자 기준을 공식 공개하지 않는다. "개설 90일"은 여러 자료에 공통으로 나오고, "게시글 50개·일 방문자 100명"은 업계 통설이다(예: brunch.co.kr/@314fa4ff05fa455/290, keyzard.cc 글 — 신청 전월 방문자 기준이라고 설명). 그래서 `config.adpost = {minDays, minPosts, minDailyVisitors}`로 바꿀 수 있게 했고 화면에 이 안내를 함께 보여 준다.

| 항목 | 값 | 가중치 |
|---|---|---|
| 운영 기간 ≥ minDays | 첫 글 날짜부터 오늘까지(개설일은 공개되지 않음) | 20 |
| 게시글 ≥ minPosts | totalPosts | 25 |
| 일 방문자 ≥ minDailyVisitors | 최근 30일 visitors 평균(7일 미만이면 안내) | 30 |
| 최근 4주 매주 발행 | activeWeeks = 4 | 10 |
| 저품질 신호 없음 | high 신호 0건 | 10 |
| 전체공개·검색 허용 | 예외 글 0개 | 5 |

**readinessScore** = Σ 가중치 × 진행률(0~1). 예상일: 운영 기간 충족일 = 첫 글 + minDays, 글 수 충족일 = 오늘 + 남은 글 ÷ (posts28/28).

## 12. 추천 (recommendations, priority 오름차순)

| type | 근거 |
|---|---|
| NEW_KEYWORD | 연관 키워드 중 검색량 ≥ 30, 아직 타깃 아님, 내 제목·태그·카테고리 단어와 겹침. 점수 = `log10(volume+10) × 경쟁도가중(낮음 1, 중간 0.6, 높음 0.3) × min(1 + 0.25×겹친 단어 수, 2)`. 주인 통계 유입 검색어 중 타깃 아닌 것은 +1 (이미 그 말로 들어오는 사람이 있음) |
| FIX_MISSING | MISSING 글 |
| GAP | currentGap ≥ 3 |
| PUSH_TOP10 | 순위 11~30 글(검색량 큰 순) |
| OPPORTUNITY | 추정 유입 표에서 순위 없음/10위 밖, potentialTop3 큰 순 |
| CANNIBAL | 키워드 잠식 |
| TITLE | 키워드 없음 / 키워드 위치 > 10자 / 제목 12자 미만·45자 초과 |
| IMAGES | 사진 3장 미만 |
| TIMING | 글 3편 이상 쌓인 요일·시간대 중 평균 성과 점수 최고 |

## 13. 스냅샷 KPI (trend 에서 쓰는 이름)

`totalPosts, subscriberCount, totalVisitorCount, visitors, views, posts7, posts30, consistencyScore, currentGap, sympathyTotal, commentTotal, exposureRate, exposed, top10, avgRank, smartBlock, aiCited, estSearchTraffic, readinessScore, signals`
그 외 trend 이름: `visitors`, `views`(시계열 계산), `rank:<키워드>`, `post:<logNo>:sympathy|comments|shares`.
