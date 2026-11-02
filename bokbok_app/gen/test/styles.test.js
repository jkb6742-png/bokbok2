// toTxt: 블로그 성격의 인용구·구분선 스타일이 원고 머리말로 들어가고, 엔진 manuscript.load 가 그대로 읽는다
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const writer = require('../writer');
const manuscript = require('../../../naver_post/manuscript');
const { PNG, tmpDir } = require('./fixtures');

const d = () => ({ title: '세종치과 임플란트 기간', category: '임플란트', tags: ['세종치과', '임플란트'], images: [{ file: '01_사진.png' }],
  blocks: [{ quote: '요약' }, { text: ['본문 한 줄'] }, { line: true }, { img: 0 }, { text: ['사진 설명'] }, { hashtags: true }] });

test('기본 스타일이면 머리말에 스타일 줄이 없다', () => {
  const txt = writer.toTxt(d(), null, { quoteStyle: 'default', lineStyle: 'default' });
  assert.ok(!/인용구스타일|구분선스타일/.test(txt));
  assert.ok(!/인용구스타일/.test(writer.toTxt(d())));
});

test('세로선·구분선2 → 머리말 + manuscript.load 왕복', () => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, '01_사진.png'), PNG);
    const txt = writer.toTxt(d(), dir, { quoteStyle: 'quotation_line', lineStyle: 'line1' });
    assert.match(txt, /^인용구스타일: 세로선$/m);
    assert.match(txt, /^구분선스타일: 구분선2$/m);
    const file = path.join(dir, '원고.txt'); fs.writeFileSync(file, txt);
    const S = manuscript.load(file);
    assert.strictEqual(S.quoteStyle, 'quotation_line'); assert.strictEqual(S.lineStyle, 'line1');
    assert.deepStrictEqual(S.blocks, d().blocks);   // 블록 모양은 그대로(스타일은 머리말에만)
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
