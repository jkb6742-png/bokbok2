#!/usr/bin/env node
// 사용법:
//   node quality/cli.js <원고.txt|*_layout.js> [--blog <블로그ID>] [--add] [--no-write] [--json]
//   node quality/cli.js --build-idf [애드포스트 프로젝트 폴더]
const path = require('path');
const Q = require('./index');

const VERDICT = { PASS: '통과', REWRITE: '수정 필요', HOLD: '보류', REJECT: '거부' };
const LEVEL = { REJECT: '거부', HOLD: '보류', REWRITE: '수정', WARN: '경고', INFO: '참고' };
const CHECK = { text: '본문 유사도', structure: '구성 반복', title: '제목 공식', phrase: '고정 문구', tags: '태그', style: '반복 문체' };
const STATUS = { OK: '이상 없음', FLAGGED: '걸림', DATA_UNKNOWN: '자료 부족(미확인)' };

// 한글 폭 2칸으로 맞춤
const width = s => [...String(s)].reduce((a, c) => a + (/[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(c) ? 2 : 1), 0);
const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - width(s)));

function table(rows) {
  const w = rows[0].map((_, i) => Math.max(...rows.map(r => width(r[i]))));
  return rows.map((r, k) => r.map((c, i) => pad(c, w[i])).join('  ') + (k === 0 ? '\n' + w.map(x => '-'.repeat(x)).join('  ') : '')).join('\n');
}

function main(argv) {
  const args = argv.slice(2);
  const flag = f => args.includes(f);
  const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

  if (flag('--build-idf')) {
    const root = val('--build-idf') || path.resolve(__dirname, '..', '..', '..');
    const files = Q.idf.findCorpus(root);
    const r = Q.idf.buildBase(files);
    console.log(`IDF 기준표 작성: 원고 ${r.n}편 → ${r.file}`);
    for (const s of r.skipped) console.log(`  건너뜀: ${s.file} (${s.error})`);
    return 0;
  }

  const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--blog');
  if (!file) { console.error('사용법: node quality/cli.js <원고> [--blog <블로그ID>] [--add] [--no-write] [--json]'); return 2; }
  const blogId = val('--blog');
  const r = Q.runG2(path.resolve(file), { blogId, add: flag('--add'), write: !flag('--no-write') });
  if (flag('--json')) { console.log(JSON.stringify(r, null, 2)); return 0; }

  const m = r.metrics;
  console.log(`\n[G2 품질검사] ${r.title}`);
  console.log(`판정: ${r.verdict} (${VERDICT[r.verdict]})   내부 점수: ${r.score}   비교 이력: ${m.comparedCount}편${blogId ? ` (${blogId})` : ''}\n`);
  console.log(table([
    ['지표', '값', '기준'],
    ['3-gram 코사인 최대', m.char3CosineMax + (m.char3CosineWith ? ` (${m.char3CosineWith.slice(0, 24)})` : ''), '0.25 수정 / 0.45 보류'],
    ['5어절 shingle 최대', m.shingleJaccardMax, '0.30 수정 / 0.50 보류'],
    ['구조 LCS 최대', m.structureLcsMax + ` (최근3편 중 ${m.structureRepeatCountRecent3}편 ≥0.80)`, '2편 이상이면 수정'],
    ['제목 패턴 최대', m.titlePatternMax + ` (최근5편 중 ${m.titleRepeatCountRecent5}편 ≥0.85)`, '2편 이상이면 수정'],
    ['고정 문구 반복', m.fixedPhraseRepeat, '2편 이상 공유 시 수정'],
    ['태그 수 / 한 어간 최대', `${m.tagCount} / ${m.tagVariantMax}`, '15 경고 / 3 초과 수정'],
    ['구조', m.structure, ''],
  ]));
  console.log('\n' + table([['검사', '상태'], ...Object.entries(r.checks).map(([k, v]) => [CHECK[k] || k, STATUS[v] || v])]));
  if (r.findings.length) {
    console.log('\n' + table([['수준', '코드', '내용'], ...r.findings.map(f => [LEVEL[f.level] || f.level, f.code, f.message])]));
  }
  if (r.unknowns.length) {
    console.log('\n미확인 항목:');
    for (const u of r.unknowns) console.log(`  - ${u.code}: ${u.message}`);
  }
  if (r.approvedHash) console.log(`\n승인 해시: ${r.approvedHash}`);
  if (r.qualityJson) console.log(`\n결과 저장: ${r.qualityJson}`);
  if (flag('--add')) console.log(`이력 추가: ${blogId || '(블로그 미지정 — 추가 안 됨)'}`);
  return 0;
}

if (require.main === module) {
  try { process.exitCode = main(process.argv); }
  catch (e) { console.error('오류: ' + e.message); process.exitCode = 1; }
}
module.exports = { main };
