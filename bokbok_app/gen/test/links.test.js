// 글 끝 링크: 관련 글 내부 링크 + 홈페이지(없으면 블로그 홈)가 검사 규칙에 맞게 붙는지
const test = require('node:test');
const assert = require('node:assert');
const writer = require('../writer');
const { PROFILE, INPUT, goodRaw } = require('./fixtures');

writer._setCardValidator(null);
const links = { related: [{ title: 'INTP 연애 특징 정리', url: 'https://blog.naver.com/jsrjkb6742/224000000001' }, { title: 'INTP 궁합', url: 'https://blog.naver.com/jsrjkb6742/224000000002' }], homepage: 'https://www.example-dental.com', label: '치과 홈페이지 바로가기' };

test('관련 글 2개 + 홈페이지: 본문 → 링크 → 본문 → 링크 → 안내 → 홈페이지 링크 → 해시태그', () => {
  const P = writer.planDraft({ ...INPUT, links }, PROFILE, { history: [] });
  const d = writer.normalizeDraft(goodRaw(), P, { input: { ...INPUT, links }, profile: PROFILE });
  const B = d.blocks, n = B.length;
  assert.ok(B[n - 1].hashtags); assert.strictEqual(B[n - 2].link, 'https://www.example-dental.com');
  assert.deepStrictEqual(B[n - 3].text, ['치과 홈페이지 바로가기']);
  assert.strictEqual(B[n - 4].link, 'https://blog.naver.com/jsrjkb6742/224000000002');
  assert.deepStrictEqual(B[n - 5].text, ['INTP 궁합']);
  assert.strictEqual(B[n - 6].link, 'https://blog.naver.com/jsrjkb6742/224000000001');
  assert.ok(B[n - 7].text.includes('## 함께 보면 좋은 글') && B[n - 7].text[B[n - 7].text.length - 1] === 'INTP 연애 특징 정리');
  assert.strictEqual(B.filter(b => b.link === true).length, 0, '홈페이지가 있으면 블로그 홈 링크는 뺀다');
  assert.deepStrictEqual(writer.validateDraft(d, { profile: PROFILE }), []);
  assert.match(writer.toTxt(d), /\[링크\] https:\/\/www\.example-dental\.com/);
});

test('홈페이지 없으면 블로그 홈 링크 유지, 지어낸 주소·빈 제목은 버림', () => {
  const l2 = { related: [{ title: '', url: 'https://blog.naver.com/x/1' }, { title: '가짜', url: 'javascript:alert(1)' }, { title: '진짜', url: 'https://blog.naver.com/jsrjkb6742/3' }] };
  const P = writer.planDraft({ ...INPUT, links: l2 }, PROFILE, { history: [] });
  const d = writer.normalizeDraft(goodRaw(), P, { input: { ...INPUT, links: l2 }, profile: PROFILE });
  const B = d.blocks, n = B.length;
  assert.strictEqual(B[n - 2].link, true);
  assert.strictEqual(B.filter(b => typeof b.link === 'string').length, 1);
  assert.deepStrictEqual(writer.validateDraft(d, { profile: PROFILE }), []);
  const d0 = writer.normalizeDraft(goodRaw(), P, { input: INPUT, profile: PROFILE });
  assert.strictEqual(d0.blocks.filter(b => b.link).length, 1);
});
