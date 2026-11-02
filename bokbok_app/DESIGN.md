# bokbok UI 리디자인 기준 (2026-11-01, ChatGPT 상담 결과 요약)

출처: ChatGPT 대화 "UI 리디자인 가이드" (madup.com 느낌 요청). 핵심만 정리.

## 방향
- 키워드: BLACK / CHROME / BLUE / GRID / EDITORIAL / INDUSTRIAL
- "회색 페이지 → 흰 둥근 카드 → 파란 버튼" 구조 금지. 면과 선의 대비로 나눈다.
- 홈·로그인 = 브랜드 페이지(큰 영문 대문자 타이포, 크롬/유리 오브젝트). 업무 모듈 = 정보 밀도 높은 툴(Linear·개발툴 느낌).
- 파랑 #0062FF 비율 5% 이하: 핵심 행동(발행·저장·연결)·선택 표시·hover만. 무채색 82%.

## 토큰
- 다크: canvas #000, surface-1 #080808, surface-2 #101010, surface-3 #161616, hover #171717, sidebar #070707, border-subtle #181818, border #292929, border-strong #3a3a3a, text #fff / #b8b8b8 / #777 / #505050, field #0b0b0b
- 라이트(인쇄물 톤): canvas #f2f2ef, surface-1 #ecece9, surface-2 #fff, surface-3 #f7f7f5, sidebar #e9e9e5, border #d1d1cc, border-strong #b9b9b3, text #0a0a0a / #555 / #888
- 상태: success #3ddc84, warning #ffb020, danger #ff4d4f, info #6695ff
- 글꼴: SUIT → Pretendard → 시스템. 숫자·IP·시간·로그는 mono(Consolas) + tabular-nums
- 라디우스: 입력·버튼·표·사이드바 4px, 모달 8px, 서비스 카드 2~8px. pill(999)은 작은 상태 표시만.
- 그림자 대신 1px 선. 상단바 52~56px, border-bottom 1px, 반투명 + blur.

## 컴포넌트
- 버튼: primary(파랑, 결과 만드는 동작만) / secondary(surface-2 + border) / ghost(투명). hover = brightness·translateY(-1px)
- 사이드바: 224px, 그룹 라벨 대문자 10px letter-spacing .12em, 선택 항목은 파란 박스 대신 왼쪽 2px 파란 막대 + surface-2
- 상단바: 왼쪽 경로(NAVER / BLOG), 오른쪽 IP는 mono 작은 글씨(배지 X), 새로고침 아이콘, 사용자
- 서비스 카드: 높이 260~320, 큰 번호(01, mono), 영문 대문자 채널명 큰 타이포(36~58px, 800, letter-spacing -.055em), 짧은 설명, ↗. hover 시 카드만 #0062FF로 바뀌고 글자 흰색. 아이콘 원형 배경 금지.
- 섹션 헤더: eyebrow(01 / NAVER, mono, 파랑) → 큰 제목 → 설명 → divider
- 표: 카드에 넣지 말고 표 자체가 화면. 헤더 대문자 작은 회색, 행 hover surface-hover, 선 중심.
- 입력: 4px 사각, focus = 파란 1px 테두리 + 1px 링(glow 금지)
- 로그: #050505 배경, mono, INFO 회색·OK 초록·WARN 앰버·ERROR 빨강
- 로그인: 50:50 (왼쪽 큰 타이포 + 크롬 오브젝트, 오른쪽 폼 컬럼 — 둥근 카드 금지)
- 상태 표시: 작은 점 + mono 글자, 배경 9% 틴트

## 피할 것
연회색 배경 + 16px 라디우스 흰 카드 + 소프트 그림자 + 파란 pill 버튼 + 보라 그라데이션 + 반짝이 아이콘 / 모든 영역 카드화 / 카드마다 원형 아이콘 배경 / 큰 컬러 배지 / 친절한 긴 설명문 / 이모지 / 유리 효과 남발
