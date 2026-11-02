// node --test manuscript.test.js : 인용구·구분선 스타일 머리말과 칸별 지정이 읽히는지
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), os = require('os');
const M = require('./manuscript');
const ST = require('./styles');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
function tmp(txt) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-'));
  fs.writeFileSync(path.join(d, 'a.png'), PNG);
  const f = path.join(d, '원고.txt'); fs.writeFileSync(f, txt);
  return f;
}

test('styles: 이름·별칭·키 → 편집기 키, 모르는 이름은 오류', () => {
  assert.strictEqual(ST.quoteKey(''), 'default');
  assert.strictEqual(ST.quoteKey('따옴표'), 'default');
  assert.strictEqual(ST.quoteKey('세로선'), 'quotation_line');
  assert.strictEqual(ST.quoteKey('인용구 2'), 'quotation_line');
  assert.strictEqual(ST.quoteKey('quotation_line'), 'quotation_line');
  assert.strictEqual(ST.lineKey('구분선2'), 'line1');
  assert.strictEqual(ST.lineKey('기본'), 'default');
  assert.strictEqual(ST.quoteLabel('quotation_line'), '세로선');
  assert.throws(() => ST.quoteKey('동그라미'), /알 수 없는 인용구 스타일/);
});

test('txt 머리말 없음 → 기본 스타일, 블록에 style 없음(예전 원고 그대로)', () => {
  const S = M.load(tmp('제목: 시험\n카테고리: 임플란트\n태그: a, b\n\n> 제목 인용구\n본문 줄\n---\n[사진] a.png\n[해시태그]\n'));
  assert.strictEqual(S.quoteStyle, 'default'); assert.strictEqual(S.lineStyle, 'default');
  assert.deepStrictEqual(S.blocks[0], { quote: '제목 인용구' });
  assert.deepStrictEqual(S.blocks[2], { line: true });
});

test('txt 머리말 인용구스타일·구분선스타일 + 칸별 지정 >[따옴표] ---[구분선1]', () => {
  const S = M.load(tmp('제목: 시험\n카테고리: 임플란트\n태그: a\n인용구스타일: 세로선\n구분선스타일: 구분선2\n\n> 요약\n>[따옴표] “환자 질문”\n본문\n---\n---[구분선1]\n[사진] a.png\n'));
  assert.strictEqual(S.quoteStyle, 'quotation_line'); assert.strictEqual(S.lineStyle, 'line1');
  assert.deepStrictEqual(S.blocks[0], { quote: '요약' });
  assert.deepStrictEqual(S.blocks[1], { quote: '“환자 질문”', style: 'default' });
  assert.deepStrictEqual(S.blocks[3], { line: true });
  assert.deepStrictEqual(S.blocks[4], { line: true, style: 'default' });
  assert.throws(() => M.load(tmp('제목: 시험\n인용구스타일: 없는것\n\n본문\n')), /알 수 없는 인용구 스타일/);
});

test('layout.js 원고: quoteStyle/lineStyle 선택 항목(이름)과 블록 style 이 키로 바뀐다', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-'));
  fs.writeFileSync(path.join(d, 'a.png'), PNG);
  const f = path.join(d, 'x_layout.js');
  fs.writeFileSync(f, `module.exports = { title: 't', category: 'c', tags: ['a'], quoteStyle: '세로선', images: [${JSON.stringify(path.join(d, 'a.png'))}], blocks: [{ quote: 'q' }, { quote: 'q2', style: '말풍선' }, { line: true, style: '구분선3' }, { img: 0 }] };`);
  const S = M.load(f);
  assert.strictEqual(S.quoteStyle, 'quotation_line'); assert.strictEqual(S.lineStyle, 'default');
  assert.strictEqual(S.blocks[1].style, 'quotation_bubble'); assert.strictEqual(S.blocks[2].style, 'line2');
});

test('editor.tokens: 굵게·밑줄·글자색·형광펜을 겹쳐도 run 으로 나눈다', () => {
  const { tokens } = require('./editor');
  const R = (text, o = {}) => ({ bold: false, ul: false, color: null, text, ...o });
  assert.deepStrictEqual(tokens('**[[진단|#fff8b2]] → 식립**'), [R('진단', { bold: true, hl: '#fff8b2' }), R(' → 식립', { bold: true })]);
  assert.deepStrictEqual(tokens('앞 [[CT|#FFF8B2]] 뒤 **굵게**'), [R('앞 '), R('CT', { hl: '#fff8b2' }), R(' 뒤 '), R('굵게', { bold: true })]);
  assert.deepStrictEqual(tokens('그냥 줄'), [R('그냥 줄')]);
  assert.deepStrictEqual(tokens('__밑줄 {{빨강|#FF0010}}__ 끝'), [R('밑줄 ', { ul: true }), R('빨강', { ul: true, color: '#ff0010' }), R(' 끝')]);
});
