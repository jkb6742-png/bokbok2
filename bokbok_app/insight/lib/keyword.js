// 키워드 도구 (dentalbox src/lib/blog-lookup.ts primaryKeyword 이식)
'use strict';

// 제목에서 그 글이 노리는 키워드를 뽑는다.
// 제목 전체를 검색어로 쓰면 긴 문장이 관련도 정렬에서 밀려 멀쩡한 글도 "노출 안 됨"이 된다(dentalbox 실측 10건 중 9건).
// 네이버 블로그 제목은 보통 "핵심키워드 | 설명문" 꼴이라 앞 절을 키워드로 본다.
function primaryKeyword(title) {
  const words = s => s.split(/\s+/).filter(Boolean);
  const t = String(title || '').replace(/^\s*\[[^\]]{1,20}\]\s*/, '');   // "[MBTI] ..." 말머리 제거
  const head = (t.split(/[,?!·|:：~–—]/)[0] ?? t).trim();
  const hw = words(head);
  if (hw.length === 1 && head.length >= 3) return head;
  if (hw.length >= 2 && hw.length <= 5 && head.length <= 24) return head;
  const all = words(t.replace(/[,?!·|:：~–—]/g, ' '));
  return all.slice(0, 3).join(' ') || t.slice(0, 20);
}

// 비교용 정규화: 공백 제거 + 소문자 (검색광고 API는 공백 없는 키워드를 돌려준다)
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, '');

// 제목 안 키워드 위치: 0=맨 앞, -1=없음 (공백 무시)
function keywordPosition(title, kw) {
  const T = norm(title), K = norm(kw);
  if (!K) return -1;
  return T.indexOf(K);
}

// 단어 조각(2자 이상) — 추천 키워드가 내 블로그 주제와 관련 있는지 볼 때 사용
function tokens(s) {
  return String(s || '').toLowerCase().split(/[^0-9a-z가-힣]+/).filter(w => w.length >= 2);
}

module.exports = { primaryKeyword, norm, keywordPosition, tokens };
