// 스마트에디터 ONE 인용구·구분선 스타일 이름표
//   편집기 컴포넌트 클래스: .se-quotation.se-l-<key> / .se-horizontalLine.se-l-<key>
//   툴바: .se-toolbar-item-insert-quotation  .se-document-toolbar-icon-select-button[data-value=<key>] (기본 단추, 마지막에 쓴 스타일을 기억)
//         .se-document-toolbar-select-option-button → 옵션 .se-toolbar-option-insert-quotation-<key>-button (누르면 그 스타일로 바로 삽입)
//         구분선도 같은 모양(insert-horizontal-line)
'use strict';
const QUOTE_STYLES = [
  { key: 'default', label: '따옴표', aliases: ['인용구1', '인용구 1', '기본', 'quotation_default', 'default'] },
  { key: 'quotation_line', label: '세로선', aliases: ['인용구2', '인용구 2', '버티컬라인', '세로줄', '왼쪽선', 'line', 'quotation_line'] },
  { key: 'quotation_bubble', label: '말풍선', aliases: ['인용구3', '인용구 3', 'bubble', 'quotation_bubble'] },
  { key: 'quotation_underline', label: '밑줄', aliases: ['인용구4', '인용구 4', '라인&따옴표', 'underline', 'quotation_underline'] },
  { key: 'quotation_postit', label: '포스트잇', aliases: ['인용구5', '인용구 5', 'postit', 'quotation_postit'] },
  { key: 'quotation_corner', label: '프레임', aliases: ['인용구6', '인용구 6', '모서리', 'corner', 'quotation_corner'] },
];
const LINE_STYLES = [
  { key: 'default', label: '구분선1', aliases: ['기본', '구분선 1', 'default'] },
  ...[1, 2, 3, 4, 5, 6, 7].map(n => ({ key: `line${n}`, label: `구분선${n + 1}`, aliases: [`구분선 ${n + 1}`, `선${n}`, `line${n}`] })),
];
const norm = s => String(s || '').trim().replace(/\s+/g, '').toLowerCase();
function find(list, name, what) {
  const n = norm(name);
  if (!n) return 'default';
  const hit = list.find(x => norm(x.key) === n || norm(x.label) === n || x.aliases.some(a => norm(a) === n));
  if (!hit) throw new Error(`알 수 없는 ${what} 스타일: ${name} (가능: ${list.map(x => x.label).join(', ')})`);
  return hit.key;
}
const quoteKey = name => find(QUOTE_STYLES, name, '인용구');
const lineKey = name => find(LINE_STYLES, name, '구분선');
const quoteLabel = key => (QUOTE_STYLES.find(x => x.key === key) || QUOTE_STYLES[0]).label;
const lineLabel = key => (LINE_STYLES.find(x => x.key === key) || LINE_STYLES[0]).label;
module.exports = { QUOTE_STYLES, LINE_STYLES, quoteKey, lineKey, quoteLabel, lineLabel };
