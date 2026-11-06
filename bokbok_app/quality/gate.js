// G2 원고 품질 검사 (1차 최소 검사)
// runG2(manuscriptPath, { blogId, history, historyRoot, profile, mainKeyword, write, add }) → result
const fs = require('fs'), path = require('path');
const T = require('./thresholds');
const N = require('./normalize');
const FP = require('./fingerprint');
const SIM = require('./similarity');
const STYLE = require('./style');
const { History } = require('./history');
const IDF = require('./idf');
const MEDLAW = (() => { try { return require('../medical/medlaw.js'); } catch { return null; } })();

const r3 = x => Math.round(x * 1000) / 1000;
const ORDER = { PASS: 0, REWRITE: 1, HOLD: 2, REJECT: 3 };
const LABEL = e => e.title || e.id || '(제목 없음)';

function localIso(d = new Date()) {
  const off = -d.getTimezoneOffset(), sign = off >= 0 ? '+' : '-', p = n => String(Math.abs(n)).padStart(2, '0');
  const l = new Date(d.getTime() + off * 60000).toISOString().slice(0, 19);
  return `${l}${sign}${p(Math.trunc(off / 60))}:${p(off % 60)}`;
}

// history 옵션: History 인스턴스 | 지문 배열(최신이 앞) | 없음(blogId 로 기본 저장소)
function resolveHistory(opts) {
  if (opts.history instanceof History) return opts.history;
  if (Array.isArray(opts.history)) {
    const arr = opts.history;
    return { recent: (n, ex) => arr.filter(e => !ex || e.id !== ex).slice(0, n), profile: {}, metaphorLexicon: [], add() {}, _array: true };
  }
  if (opts.blogId) return new History(opts.blogId, { root: opts.historyRoot });
  return { recent: () => [], profile: {}, metaphorLexicon: [], add() {}, _array: true };
}

function qualityJsonPath(file) {
  return /\.txt$/i.test(file) ? path.join(path.dirname(file), 'quality.json') : file.replace(/\.js$/i, '.quality.json');
}

function runG2(manuscriptPath, opts = {}) {
  const hist = resolveHistory(opts);
  const profile = { ...(hist.profile || {}), ...(opts.profile || {}) };
  const S = N.loadManuscript(manuscriptPath);
  const fp = FP.build(S, { metaphorLexicon: hist.metaphorLexicon || [] });
  const findings = [];
  const add = (code, level, value, threshold, message, extra) => findings.push({ code, level, value, threshold, message, ...(extra || {}) });

  const all = hist.recent(T.compareRecentMax, fp.id);
  const metrics = { comparedCount: all.length };
  const checks = {};            // 검사별 상태: OK | FLAGGED | DATA_UNKNOWN
  const unknowns = [];          // 비교 자료가 없어 판단하지 못한 항목(통과로 치지 않음)
  const unknown = (check, code, message) => { checks[check] = 'DATA_UNKNOWN'; unknowns.push({ check, code, message }); };
  const mark = (check, flagged) => { if (!checks[check]) checks[check] = flagged ? 'FLAGGED' : 'OK'; };

  // 본문 비교는 본문 지문이 있는 로컬 이력만. LOGMETER 지문(제목·구조만)은 본문 비교에서 미확인으로 남긴다
  const textable = all.filter(e => e.source !== 'logmeter' && e.tf3 && e.shingles && e.bodySha256);
  const noText = all.filter(e => !textable.includes(e));
  if (!all.length) unknown('text', 'TEXT_SIMILARITY_UNKNOWN', '비교할 이력이 없어 본문 유사도를 확인하지 못함');
  else if (noText.length) unknowns.push({ check: 'text', code: 'TEXT_SIMILARITY_UNKNOWN', message: `이력 ${noText.length}편은 본문 지문이 없어(제목·구조만) 본문 유사도 미확인`, items: noText.map(LABEL) });

  // 1) 본문 해시 완전 일치
  const dup = textable.find(e => e.bodySha256 === fp.bodySha256);
  if (dup) add('DUPLICATE_BODY', 'REJECT', 1, 1, `기존 원고와 본문이 똑같음: ${LABEL(dup)}`, { with: dup.id });

  // 2) 문자 3-gram TF-IDF 코사인 (IDF = 로컬 기준표 + 비교 문서)
  const base = opts.idfBase !== undefined ? opts.idfBase : IDF.loadBase();
  const { idf, n: idfN, hasBase } = IDF.idfFor(base, [fp, ...textable].map(e => ({ sha: e.bodySha256, tf: e.tf3 })));
  metrics.idfDocs = idfN;
  if (textable.length && !hasBase) unknowns.push({ check: 'text', code: 'IDF_BASE_MISSING', message: 'IDF 기준표(idf_base.json)가 없어 코사인 값이 부정확할 수 있음 — cli.js --build-idf 실행' });
  let cMax = 0, cWith = null;
  for (const e of textable) { const c = SIM.cosine(fp.tf3, e.tf3, idf); if (c > cMax) { cMax = c; cWith = e; } }
  metrics.char3CosineMax = r3(cMax); metrics.char3CosineWith = cWith ? LABEL(cWith) : null;
  if (!dup && cMax >= T.char3Cosine.hold) add('TEXT_SIMILAR', 'HOLD', r3(cMax), T.char3Cosine.hold, `본문 글자 유사도가 매우 높음 (${LABEL(cWith)})`);
  else if (!dup && cMax >= T.char3Cosine.rewrite) add('TEXT_SIMILAR', 'REWRITE', r3(cMax), T.char3Cosine.rewrite, `본문 글자 유사도가 높음 (${LABEL(cWith)})`);

  // 3) 5-토큰 shingle Jaccard
  let jMax = 0, jWith = null;
  for (const e of textable) { const j = SIM.jaccard(fp.shingles, e.shingles); if (j > jMax) { jMax = j; jWith = e; } }
  metrics.shingleJaccardMax = r3(jMax); metrics.shingleJaccardWith = jWith ? LABEL(jWith) : null;
  if (!dup && jMax >= T.shingleJaccard.hold) add('SHINGLE_OVERLAP', 'HOLD', r3(jMax), T.shingleJaccard.hold, `같은 어절 묶음이 대량으로 겹침 (${LABEL(jWith)})`);
  else if (!dup && jMax >= T.shingleJaccard.rewrite) add('SHINGLE_OVERLAP', 'REWRITE', r3(jMax), T.shingleJaccard.rewrite, `같은 어절 묶음이 많이 겹침 (${LABEL(jWith)})`);
  if (textable.length) mark('text', cMax >= T.char3Cosine.rewrite || jMax >= T.shingleJaccard.rewrite || !!dup);

  // 4) 구조 LCS — 최근 3편 중 2편 이상 0.80 (LOGMETER 구조 지문 포함)
  const rs = all.filter(e => e.structure).slice(0, T.structureRecent);
  const lcsList = rs.map(e => ({ with: LABEL(e), source: e.source || 'local', lcs: r3(SIM.structureLcs(fp.structure, e.structure)) }));
  const sHit = lcsList.filter(x => x.lcs >= T.structureLcs);
  metrics.structure = fp.structure;
  metrics.structureLcsMax = lcsList.reduce((m, x) => Math.max(m, x.lcs), 0);
  metrics.structureRepeatCountRecent3 = sHit.length;
  metrics.structureLcsRecent = lcsList;
  if (sHit.length >= T.structureClusterMin) {
    checks.structure = 'FLAGGED';
    if (profile.structureExempt) add('STRUCTURE_CLUSTER', 'INFO', sHit.length, T.structureClusterMin, `최근 ${rs.length}편 중 ${sHit.length}편과 구성이 같지만 정기 시리즈 예외로 통과`);
    else add('STRUCTURE_CLUSTER', 'REWRITE', sHit.length, T.structureClusterMin, `최근 ${rs.length}편 중 ${sHit.length}편과 글 구성(블록 순서)이 거의 같음 (LCS ≥ ${T.structureLcs})`, { detail: sHit });
  } else if (rs.length < T.structureRecent) unknown('structure', 'STRUCTURE_CLUSTER_UNKNOWN', `구조 비교 이력이 ${rs.length}편뿐이라(3편 필요) 구성 반복 여부 미확인`);
  else mark('structure', false);

  // 5) 제목 패턴 — 최근 5편 중 2편 이상 0.85
  const rt = all.filter(e => e.titlePattern).slice(0, T.titleRecent);
  const tList = rt.map(e => ({ with: LABEL(e), sim: r3(SIM.titleSim(fp.titlePattern, e.titlePattern)) }));
  const tHit = tList.filter(x => x.sim >= T.titlePatternSim);
  metrics.titlePattern = fp.titlePattern.join(' ');
  metrics.titlePatternMax = tList.reduce((m, x) => Math.max(m, x.sim), 0);
  metrics.titleRepeatCountRecent5 = tHit.length;
  if (tHit.length >= T.titleRepeatMin) { checks.title = 'FLAGGED'; add('TITLE_PATTERN_REPEAT', 'REWRITE', tHit.length, T.titleRepeatMin, `제목 공식이 최근 ${rt.length}편 중 ${tHit.length}편과 같음`, { detail: tHit }); }
  else {
    if (tHit.length === 1) add('TITLE_PATTERN_SIMILAR', 'WARN', tHit[0].sim, T.titlePatternSim, `제목 공식이 최근 글과 같음 (${tHit[0].with}) — 한 편 더 반복되면 수정 대상`);
    if (rt.length < T.titleRepeatMin) unknown('title', 'TITLE_PATTERN_UNKNOWN', `제목 비교 이력이 ${rt.length}편뿐이라 제목 공식 반복 여부 미확인`);
    else mark('title', tHit.length > 0);
  }

  // 6) 고정 문구 15자 이상 — 최근 5편 중 2편 이상과 공유 (본문 지문 있는 이력만)
  const rp = textable.filter(e => e.phrases).slice(0, T.phraseRecent);
  const curText = N.slotTypes(N.bodyText(S).replace(/\s+/g, ''));
  const runs = rp.length ? SIM.sharedPhrases(fp.phrases, curText, rp, T.phraseMinChars) : [];
  const rep = runs.filter(r => r.count >= T.phraseRepeatMin);
  metrics.sharedPhraseCount = runs.length;
  metrics.fixedPhraseRepeat = rep.length;
  if (rep.length) add('FIXED_PHRASE_REPEAT', 'REWRITE', rep.length, T.phraseRepeatMin, `최근 글 ${T.phraseRepeatMin}편 이상에 똑같이 쓰인 문구 ${rep.length}개`, { samples: rep.slice(0, 5).map(r => r.text) });
  else if (runs.length) add('SHARED_PHRASE', 'INFO', runs.length, null, `최근 글 1편과 겹치는 15자 이상 문구 ${runs.length}개`, { samples: runs.slice(0, 3).map(r => r.text) });
  if (rp.length < T.phraseRepeatMin && !rep.length) unknown('phrase', 'FIXED_PHRASE_UNKNOWN', `본문 지문 있는 이력이 ${rp.length}편뿐이라 고정 문구 반복 여부 미확인`);
  else mark('phrase', rep.length > 0);

  // 7) 태그
  const groups = STYLE.tagVariants(fp.tags);
  const over = groups.filter(g => g.count > T.tagVariantMax);
  metrics.tagCount = fp.tags.length;
  metrics.tagVariantMax = groups.length ? groups[0].count : 0;
  if (over.length) add('TAG_VARIANT', 'REWRITE', over[0].count, T.tagVariantMax, `한 단어를 바꿔 단 태그가 많음: ${over.slice(0, 3).map(g => `${g.stem} ${g.count}개(${g.variants.join('·')})`).join(' / ')}`, { groups: over });
  checks.tags = over.length ? 'FLAGGED' : 'OK';
  if (fp.tags.length > T.tagCountWarn) add('TAG_COUNT', 'WARN', fp.tags.length, T.tagCountWarn, `태그가 ${fp.tags.length}개로 많음`);

  // 8) 반복 문체
  const st = STYLE.check(S, fp, { recent: all, mainKeyword: opts.mainKeyword || profile.mainKeyword });
  findings.push(...st.findings);
  Object.assign(metrics, { style: st.metrics });
  checks.style = st.findings.length ? 'FLAGGED' : 'OK';
  if (st.findings.length >= T.styleStackRewrite) add('STYLE_STACK', 'REWRITE', st.findings.length, T.styleStackRewrite, `반복 문체 경고가 ${st.findings.length}개 겹침 — 문체 수정 필요`);

  // 9) 의료광고 검수(병의원 계정만: opts.medical). 차단 = 수정 필요, 경고 = 경고, 주의 = 참고
  if (opts.medical && MEDLAW) {
    const ml = MEDLAW.check(N.bodyText(S), { title: S.title || '', dept: opts.dept || null });
    metrics.medlaw = { version: MEDLAW.VERSION, level: ml.level, counts: ml.counts };
    for (const h of ml.hits) add('MEDLAW_' + h.id, h.level === 'block' ? 'REWRITE' : h.level === 'warn' ? 'WARN' : 'INFO', 1, null, `의료법 · ${h.name}${h.context && h.at >= 0 ? ': ' + h.context : ''}`, { law: h.law, fix: h.fix });
    checks.medlaw = ml.level === 'ok' ? 'OK' : 'FLAGGED';
  }

  // 판정
  let verdict = 'PASS';
  for (const f of findings) if (ORDER[f.level] > ORDER[verdict]) verdict = f.level;
  const score = verdict === 'REJECT' ? 0 : Math.max(0, 100 - findings.reduce((a, f) => a + (T.penalty[f.level] || 0), 0));

  const result = {
    schemaVersion: T.schemaVersion, ruleVersion: T.ruleVersion, fingerprintVersion: FP.FINGERPRINT_VERSION, gate: 'G2',
    blogId: opts.blogId || null, manuscriptPath: S.file, title: S.title,
    status: verdict, verdict, score, scoreKind: 'BOKBOK_INTERNAL',
    manuscriptSha256: fp.manuscriptSha256, bodySha256: fp.bodySha256,
    // SAVE 엔진은 이 값과 원고 파일 바이트 SHA-256 이 다르면 입력을 거부한다 (PASS 일 때만 채움)
    approvedHash: verdict === 'PASS' ? fp.manuscriptSha256 : null,
    checks, unknowns, metrics, findings,
    violations: findings.filter(f => ORDER[f.level] > 0).map(f => f.code),
    notChecked: ['EVIDENCE_FIRST_PERSON(1인칭 체험 근거)', 'SOURCE_REQUIRED(필수 출처)', 'COMPLIANCE(광고·의료 고지)'],
    checkedAt: localIso(),
  };

  if (opts.write !== false) {
    const out = qualityJsonPath(S.file);
    const tmp = out + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(result, null, 2));
    fs.renameSync(tmp, out);
    result.qualityJson = out;
  }
  if (opts.add) hist.add(fp, { source: 'local' });
  Object.defineProperty(result, 'fingerprint', { value: fp, enumerable: false });
  return result;
}

module.exports = { runG2, qualityJsonPath, localIso };
