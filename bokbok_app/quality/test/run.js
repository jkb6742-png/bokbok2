// node quality/test/run.js — G2 품질검사 회귀 테스트 (이력은 임시 폴더에만 기록)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const Q = require('..');
const N = Q.normalize, F = Q.fingerprint, SIM = Q.similarity;

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');           // 애드포스트 프로젝트
const BOX = path.join(ROOT, '원고함', 'jsrjkb6742');
const ENFP = path.join(BOX, '20261104_2000_INTP_ENFP궁합', '원고.txt');
const MIRU = path.join(BOX, '20261104_1900_INTP미루는습관', '원고.txt');
const ISTP = path.join(ROOT, '_도구', '원고데이터', '09_ISTP_layout.js');
const ISFP = path.join(ROOT, '_도구', '원고데이터', '10_ISFP_layout.js');

// 실제 %LOCALAPPDATA% 에 쓰지 않도록 기본 위치를 임시 폴더로 바꿔 둔다
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bokbok-q-'));
process.env.LOCALAPPDATA = path.join(TMP, 'localappdata');
const histRoot = name => path.join(TMP, 'hist-' + name);
const fpOf = f => F.build(N.loadManuscript(f));
const report = {};

// 같은 블록 구조에 전혀 다른 문장을 채운 원고 만들기
function rng(seed) { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32; }
function synth(srcFile, seed, { title, tags } = {}) {
  const S = N.loadManuscript(srcFile), r = rng(seed);
  const syl = '가나다라마바사아자차카타파하고노도로모보소오조초코토포호구누두루무부수우주추쿠투푸후기니디리미비시이지치키티피히';
  const word = () => Array.from({ length: 2 + Math.floor(r() * 3) }, () => syl[Math.floor(r() * syl.length)]).join('');
  const sent = () => Array.from({ length: 4 + Math.floor(r() * 4) }, word).join(' ') + '다.';
  const out = [`제목: ${title || word() + ' ' + word() + ' 이야기 ' + seed}`, '카테고리: 테스트', `태그: ${(tags || [word(), word(), word()]).join(', ')}`, ''];
  for (const b of S.blocks) {
    if (b.text) for (const l of b.text) out.push(String(l).trim() ? sent() : '[빈줄]');
    else if (b.quote !== undefined) out.push('> ' + (N.stripMarkup(b.quote).length <= 24 ? word() + ' ' + word() : sent()));
    else if (b.table) { out.push('[표]'); for (const row of b.table) out.push(row.map(word).join(' | ')); out.push('[/표]'); }
    else if (b.img !== undefined) out.push(`[사진] img${b.img}.png`);
    else if (b.line) out.push('---');
    else if (b.hashtags) out.push('[해시태그]');
  }
  const d = fs.mkdtempSync(path.join(TMP, 'syn-'));
  const f = path.join(d, '원고.txt');
  fs.writeFileSync(f, out.join('\n') + '\n');
  return f;
}

test('ENFP 궁합 ↔ 미루는 습관: 텍스트는 다르고 구조는 비슷하다', () => {
  const a = fpOf(ENFP), b = fpOf(MIRU);
  const { idf } = Q.idf.idfFor(Q.idf.loadBase(), [a, b].map(x => ({ sha: x.bodySha256, tf: x.tf3 })));
  const cos = SIM.cosine(a.tf3, b.tf3, idf), jac = SIM.jaccard(a.shingles, b.shingles), lcs = SIM.structureLcs(a.structure, b.structure);
  // 문단 병합 전(GPT 측정 방식) 구조 LCS
  const raw = [ENFP, MIRU].map(f => F.manuscriptBlocks(N.loadManuscript(f)).map(x => x.type).join(''));
  const lcsRaw = SIM.structureLcs(raw[0], raw[1]);
  Object.assign(report, { enfpMiru: { cos: +cos.toFixed(3), jac: +jac.toFixed(3), lcs: +lcs.toFixed(3), lcsUnmerged: +lcsRaw.toFixed(3) } });
  assert.ok(cos < 0.25, 'cosine ' + cos);
  assert.ok(jac < 0.05, 'jaccard ' + jac);
  assert.ok(lcs >= 0.80, 'lcs ' + lcs);
  assert.ok(Math.abs(lcsRaw - 0.873) < 0.01, 'unmerged lcs ' + lcsRaw);
});

test('구조 묶음: 최근 3편 중 2편 이상 LCS≥0.80 → STRUCTURE_CLUSTER 로 REWRITE', () => {
  const h = new Q.History('jsrjkb6742', { root: histRoot('struct') });
  const third = synth(MIRU, 11);
  for (const f of [third, ENFP, MIRU]) h.add(fpOf(f));
  const cand = synth(MIRU, 22);
  const r = Q.runG2(cand, { blogId: 'jsrjkb6742', history: h, write: false });
  report.structureCluster = { verdict: r.verdict, lcs: r.metrics.structureLcsRecent.map(x => x.lcs), cos: r.metrics.char3CosineMax, codes: r.findings.map(f => f.code) };
  assert.ok(r.findings.some(f => f.code === 'STRUCTURE_CLUSTER' && f.level === 'REWRITE'));
  assert.ok(!r.findings.some(f => f.code === 'TEXT_SIMILAR' || f.code === 'SHINGLE_OVERLAP'), '본문 유사도는 걸리지 않아야 함');
  assert.equal(r.verdict, 'REWRITE');
  assert.equal(r.approvedHash, null);
  // 정기 시리즈 예외 프로필
  const ex = Q.runG2(cand, { blogId: 'jsrjkb6742', history: h, write: false, profile: { structureExempt: true } });
  assert.ok(!ex.findings.some(f => f.code === 'STRUCTURE_CLUSTER' && f.level === 'REWRITE'));
});

test('이력이 3편 미만이면 구성 반복은 DATA_UNKNOWN (통과 아님)', () => {
  const h = new Q.History('few', { root: histRoot('few') });
  h.add(fpOf(ENFP));
  const r = Q.runG2(synth(ENFP, 5), { blogId: 'few', history: h, write: false });
  assert.equal(r.checks.structure, 'DATA_UNKNOWN');
  assert.ok(r.unknowns.some(u => u.code === 'STRUCTURE_CLUSTER_UNKNOWN'));
});

test('ISTP ↔ ISFP 제목 패턴: 유사도 높음, 최근 5편 중 2편 → TITLE_PATTERN_REPEAT', () => {
  const sim = SIM.titleSim(fpOf(ISTP).titlePattern, fpOf(ISFP).titlePattern);
  report.istpIsfpTitle = +sim.toFixed(3);
  assert.ok(sim >= 0.85, 'title sim ' + sim);
  const h = new Q.History('jsrjkb6742', { root: histRoot('title') });
  h.add(fpOf(ISTP));
  // LOGMETER가 보낸 발행 글 지문(제목·구조만)
  h.addExternal({ title: 'ESTP 특징 | 일단 몸이 먼저 나가는 엣팁, INTP가 옆에서 본 5가지 모습', structure: 'PIHPIHPX', publishedAt: '2026-10-30T20:00:00+09:00', logNo: '224000000001' });
  const r = Q.runG2(ISFP, { blogId: 'jsrjkb6742', history: h, write: false });
  const a = fpOf(ISTP), b = fpOf(ISFP);
  const { idf } = Q.idf.idfFor(Q.idf.loadBase(), [a, b].map(x => ({ sha: x.bodySha256, tf: x.tf3 })));
  report.istpIsfp = { verdict: r.verdict, cos: +SIM.cosine(a.tf3, b.tf3, idf).toFixed(3), jac: +SIM.jaccard(a.shingles, b.shingles).toFixed(3), lcs: SIM.structureLcs(a.structure, b.structure), codes: r.findings.map(f => f.code) };
  assert.ok(r.findings.some(f => f.code === 'TITLE_PATTERN_REPEAT'));
  assert.ok(r.unknowns.some(u => u.code === 'TEXT_SIMILARITY_UNKNOWN'), 'LOGMETER 지문은 본문 유사도 미확인으로 표시');
  assert.notEqual(r.verdict, 'PASS');
});

test('ENFP 태그: 한 어간 변형 과다 → TAG_VARIANT', () => {
  const r = Q.runG2(ENFP, { history: [], write: false });
  const f = r.findings.find(x => x.code === 'TAG_VARIANT');
  report.enfpTags = { verdict: r.verdict, value: f && f.value, message: f && f.message };
  assert.ok(f && f.level === 'REWRITE');
  const intp = f.groups.find(g => g.stem === 'INTP');
  for (const t of ['INTP', '인팁', 'INTP연애', 'INTP궁합', '인팁엔프피', 'INTPENFP']) assert.ok(intp.variants.includes(t), t);
});

test('똑같은 사본 → REJECT', () => {
  const h = new Q.History('jsrjkb6742', { root: histRoot('dup') });
  h.add(fpOf(MIRU));
  const d = fs.mkdtempSync(path.join(TMP, 'copy-'));
  const copy = path.join(d, '원고.txt');
  fs.copyFileSync(MIRU, copy);
  const r = Q.runG2(copy, { blogId: 'jsrjkb6742', history: h, write: false });
  report.copy = r.verdict;
  assert.equal(r.verdict, 'REJECT');
  assert.ok(r.findings.some(f => f.code === 'DUPLICATE_BODY'));
  // 같은 원고 재검사(같은 경로)는 자기 자신과 비교하지 않는다
  assert.notEqual(Q.runG2(MIRU, { blogId: 'jsrjkb6742', history: h, write: false }).verdict, 'REJECT');
});

test('PASS 원고: approvedHash = 파일 바이트 SHA-256, quality.json·이력에 버전 기록, 이력에 본문 없음', () => {
  const h = new Q.History('clean', { root: histRoot('clean') });
  for (const [src, s] of [[ENFP, 101], [MIRU, 102], [ENFP, 103]]) h.add(fpOf(synth(src, s)));
  // 구조가 다른 원고: ISFP 레이아웃 구조 + 새 문장
  const f = synth(ISFP, 777, { title: '혼자 떠난 바닷가 여행 기록', tags: ['바닷가', '여행기록', '혼행'] });
  const r = Q.runG2(f, { blogId: 'clean', history: h, add: true });
  report.clean = { verdict: r.verdict, codes: r.findings.map(x => x.code), unknowns: r.unknowns.map(u => u.code) };
  assert.equal(r.verdict, 'PASS', JSON.stringify(r.findings));
  const sha = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  assert.equal(r.approvedHash, sha);
  const qj = JSON.parse(fs.readFileSync(path.join(path.dirname(f), 'quality.json'), 'utf8'));
  for (const k of ['schemaVersion', 'fingerprintVersion', 'ruleVersion']) assert.ok(qj[k], k);
  assert.equal(qj.approvedHash, sha);
  const raw = fs.readFileSync(h.file, 'utf8');
  const hj = JSON.parse(raw);
  for (const e of hj.entries) for (const k of ['schemaVersion', 'fingerprintVersion', 'ruleVersion', 'source']) assert.ok(e[k], k);
  const firstLine = fs.readFileSync(f, 'utf8').split('\n')[4];
  assert.ok(!raw.includes(firstLine.slice(0, 12)), '이력에 본문 문장이 들어가면 안 됨');
  // 기본 저장 위치는 (테스트에서 바꾼) LOCALAPPDATA 아래
  assert.ok(Q.defaultHistoryRoot().startsWith(path.join(TMP, 'localappdata')));
});

test('structureFromBlocks: 공용 구조 규격(연속 P·L 병합, 모르는 요소 무시)', () => {
  const s = Q.structureFromBlocks([{ type: 'I' }, { type: 'P' }, { type: 'p' }, { type: 'H' }, { type: 'LINK' }, { type: 'L' }, { type: 'L' }, { type: 'T' }, { type: 'P' }, { type: 'X' }]);
  assert.equal(s, 'IPHLTPX');
  assert.equal(Q.FINGERPRINT_VERSION, 'fp-1.0');
});

test.after(() => {
  console.log('\n측정값:', JSON.stringify(report, null, 1));
  fs.rmSync(TMP, { recursive: true, force: true });
});
