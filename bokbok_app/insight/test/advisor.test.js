// 주제 조회: 최근 같은 축·노출 중 키워드는 피하고, 추천 키워드·오래된 좋은 축은 권한다
const test = require('node:test');
const assert = require('node:assert');
const { advise, axes, overview } = require('../advisor');

const T = '2026-11-02';
const P = (title, date, score, extra = {}) => ({ logNo: title, title, date, score, category: 'c', sympathy: 3, comments: 1, keyword: null, rank: null, ...extra });
const posts = [
  P('INTP 연애 특징 정리', '2026-10-28', 70, { keyword: 'INTP 연애', rank: 5 }),
  P('INTP 연애 궁합', '2026-10-10', 65, { keyword: 'INTP 궁합' }),
  P('INTP 직업 추천', '2026-09-01', 20),
  P('INTP 직업 현실', '2026-08-20', 15),
  P('ENFP 특징', '2026-05-01', 55),
  P('ENFP 연애', '2026-04-20', 50),
];
const recs = [{ type: 'NEW_KEYWORD', items: [{ keyword: 'INFJ 연애', volume: 900 }] }, { type: 'CANNIBAL', items: [{ keyword: 'INTP 연애' }] }, { type: 'PUSH_TOP10', items: [{ title: 'INTP 연애 궁합', keyword: 'INTP 궁합', rank: 14 }] }];

test('같은 키워드가 노출 중 + 5일 전 글 → 피하기, 점검 항목·결론·각도 제안이 붙는다', () => {
  const r = advise({ topic: 'INTP 연애', posts, recs, today: T });
  assert.strictEqual(r.verdict, 'avoid', JSON.stringify(r));
  assert.ok(r.checks.find(c => c.key === 'ranked').state === 'bad');
  assert.ok(r.checks.find(c => c.key === 'gap').text.includes('5일 전'));
  assert.ok(r.checks.find(c => c.key === 'cannibal').state === 'bad');
  assert.strictEqual(r.checks.reduce((s, c) => s + c.delta, 50), r.score);
  assert.match(r.conclusion, /부딪히/);
  assert.ok(r.tips.length >= 3 && r.tips.every(t => t.startsWith('INTP 연애 ')));
  assert.ok(!r.tips.some(t => /궁합|특징/.test(t)), '이미 쓴 각도는 빼야 함');
  assert.ok(r.related[0].same);
  assert.ok(r.alternatives.some(a => a.keyword === 'INFJ 연애'));
});

test('반응 약했던 축 → 미루기, 추천 키워드 → 좋음, 오래된 좋은 축 → 갱신', () => {
  assert.strictEqual(advise({ topic: 'INTP 직업', posts, recs, today: T }).verdict, 'wait');
  const g = advise({ topic: 'INFJ 연애', posts, recs, today: T });
  assert.strictEqual(g.verdict, 'good'); assert.ok(g.checks.find(c => c.key === 'newkw').state === 'good');
  const e = advise({ topic: 'ENFP 특징', posts, recs, today: T });
  assert.ok(e.score > 50, JSON.stringify(e)); assert.ok(e.checks.find(c => c.key === 'stale'));
  assert.throws(() => advise({ topic: '  ' , posts }), /주제나 키워드/);
});

test('axes: 축 이름·상태·대표 글·빈 각도 (조사 제거)', () => {
  const a = axes({ posts: [...posts, P('INTP가 싫어하는 말', '2026-07-01', 30)], today: T });
  const intp = a.find(x => x.axis === 'intp'), enfp = a.find(x => x.axis === 'enfp');
  assert.strictEqual(intp.posts, 5); assert.strictEqual(intp.status, 'hot'); assert.strictEqual(intp.label, 'INTP');
  assert.strictEqual(intp.top[0].title, 'INTP 연애 특징 정리');
  assert.ok(intp.missingAngles.length && !intp.missingAngles.includes('연애') && !intp.missingAngles.includes('직업'));
  assert.strictEqual(enfp.status, 'stale'); assert.ok(enfp.lastAgo >= 120);
});

test('overview: 쓰기 좋은 / 피할 / 보강할', () => {
  const o = overview({ posts, recs, today: T });
  assert.ok(o.good.some(x => x.keyword === 'INFJ 연애' && x.kind === 'newkw'));
  assert.ok(o.good.some(x => x.kind === 'stale' && /ENFP/.test(x.keyword)));
  assert.ok(o.avoid.some(x => x.status === 'hot' && /INTP/.test(x.keyword)));
  assert.ok(o.avoid.some(x => x.status === 'cannibal'));
  assert.strictEqual(o.boost[0].rank, 14);
});
