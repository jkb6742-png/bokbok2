// bokbok 원고 흐름 (G2 품질검사 → SAVE 임시저장 → 사람 발행 → 발행 감지 → LOGMETER 기록)
//   server.js 가 createFlow(...)로 한 번 만들어 쓴다. Node 내장 모듈만 사용.
//   - G2: quality 모듈(runG2)을 부르기만 한다(수정 금지 모듈).
//   - SAVE: naver_post/write.js 를 SAVE=1 로 실행할 환경을 만든다(PUBLISH 는 절대 넣지 않음).
//   - 발행 대기: 원고 옆 save_result.json(SAVE_CONFIRMED) 중 publish_record.json 이 없는 것.
//   - 발행 감지: 블로그 공개 글 목록(PostTitleListAsync)에서 같은 제목 + 저장 시각 이후 글을 찾는다.
//   - LOGMETER: 127.0.0.1:3610 exe API (헤더 x-exe-token). 연결 안 되면 조용히 건너뛰고 화면에 표시만.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const STATUS_KO = {
  SAVE_CONFIRMED: '임시저장 확인', SAVE_FAILED: '저장 실패', SAVE_UNVERIFIED: '저장 확인 안 됨', EXISTING_DRAFT: '기존 임시저장 글이 있어 중단',
  G2_NOT_APPROVED: 'G2 승인 없음 · 입력 안 함', INSPECTION_FAILED: '전수검사 실패 · 저장 안 함', INPUT_FAILED: '입력 실패', DRAFT_CONFLICT: '임시저장 충돌',
  MANUAL_PACKAGE_WRITTEN: '직접 입력 꾸러미 작성', RUNNING: '끝나지 않음(중단)', PUBLISH_REFUSED: '자동 발행 거부',
};
const VERDICT_KO = { PASS: '통과', REWRITE: '수정 필요', HOLD: '보류', REJECT: '거부' };
const LEVEL_KO = { REJECT: '거부', HOLD: '보류', REWRITE: '수정', WARN: '경고', INFO: '참고' };
const MODES = ['save', 'stop', 'test', 'manual'];

const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch { return null; } };
const writeJson = (f, v) => { const t = f + '.' + process.pid + '.tmp'; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, f); };
const sha256File = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const samePath = (a, b) => path.resolve(String(a || '')).toLowerCase() === path.resolve(String(b || '')).toLowerCase();

// ── 제목 비교 ──
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e.toLowerCase()] ?? m));
}
const normTitle = s => decodeEntities(s).normalize('NFC').replace(/[\s​ ]+/g, '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").toLowerCase();

// 공개 글 목록 응답(JSON 안에 \' 가 섞임) → [{logNo,title,addDate}]
function parseTitleList(text) {
  const j = JSON.parse(String(text).replace(/\\'/g, "'"));
  return (j.postList || []).map(x => {
    let t = String(x.title || '').replace(/\+/g, ' ');
    try { t = decodeURIComponent(t); } catch { }
    return { logNo: String(x.logNo || ''), title: decodeEntities(t), addDate: String(x.addDate || '') };
  });
}
// addDate("방금 전" / "12분 전" / "6시간 전" / "2026. 11. 3.") → {est, upper} (ms). upper = 그 글이 올라갔을 수 있는 가장 늦은 시각
function parseAddDate(s, now = Date.now()) {
  const t = String(s || '').trim();
  let m;
  if (/방금/.test(t)) return { est: now, upper: now };
  if ((m = t.match(/(\d+)\s*초\s*전/))) return { est: now - m[1] * 1000, upper: now };
  if ((m = t.match(/(\d+)\s*분\s*전/))) return { est: now - m[1] * 60000, upper: now - (m[1] - 1) * 60000 };
  if ((m = t.match(/(\d+)\s*시간\s*전/))) return { est: now - m[1] * 3600000, upper: now - (m[1] - 1) * 3600000 };
  if ((m = t.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/))) {
    const day = Date.parse(`${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}T00:00:00+09:00`);
    return { est: day + 12 * 3600000, upper: day + 86400000 - 1 };
  }
  return null;
}
// 대기 글 하나와 공개 글 목록 대조: 정규화 제목 일치 + 저장 시각 이후(1분 여유)
function matchPost(item, posts, now = Date.now()) {
  const want = normTitle(item.title), saved = Date.parse(item.savedAt || '') || 0;
  if (!want) return null;
  for (const p of posts) {
    if (normTitle(p.title) !== want) continue;
    const d = parseAddDate(p.addDate, now);
    if (!d || d.upper < saved - 60000) continue;
    return { post: p, date: d };
  }
  return null;
}

function createFlow(o = {}) {
  const DATA = o.DATA;
  const quality = o.quality;
  const historyRoot = o.historyRoot || path.join(DATA, 'quality');
  const lmBase = o.logmeterBase || process.env.BOKBOK_LOGMETER || 'http://127.0.0.1:3610';
  const tokenFile = o.tokenFile || path.resolve(__dirname, '..', 'index_web', '_data', 'exe_token');
  const secrets = o.secrets || null;
  const fetchFn = o.fetch || ((...a) => fetch(...a));
  const now = o.now || (() => Date.now());
  const dfile = n => path.join(DATA, n + '.json');

  // ── G2 ──
  // write.js(save.js g2Gate)는 항상 '원고 폴더\quality.json'을 본다. *_layout.js 원고는 quality 모듈이 <이름>.quality.json 에 쓰므로
  // PASS 일 때 같은 내용을 폴더 quality.json 에도 둔다(승인 해시가 원고 바이트에 묶여 있어 다른 원고에는 통하지 않음).
  const gateFile = file => path.join(path.dirname(file), 'quality.json');
  const overrideFile = file => { const q = quality.qualityJsonPath(file); return /\.quality\.json$/i.test(q) ? q.replace(/\.quality\.json$/i, '.override.json') : path.join(path.dirname(file), 'override.json'); };
  function g2Summary(r) {
    return {
      verdict: r.verdict, verdictText: VERDICT_KO[r.verdict] || r.verdict, score: r.score, title: r.title, checkedAt: r.checkedAt,
      qualityJson: r.qualityJson || null, comparedCount: (r.metrics && r.metrics.comparedCount) || 0,
      findings: (r.findings || []).map(f => ({ level: f.level, levelText: LEVEL_KO[f.level] || f.level, code: f.code, message: f.message })),
      unknowns: (r.unknowns || []).map(u => ({ check: u.check, code: u.code, message: u.message })),
      checks: r.checks || {}, notChecked: r.notChecked || [],
    };
  }
  // 병의원 계정이면 G2 에 의료광고 검수(medical/medlaw.js)를 더한다(차단 표현 = 수정 필요)
  function medOpts(blogId) {
    try { const a = (JSON.parse(fs.readFileSync(dfile('accounts'), 'utf8')) || []).find(x => x.blogId === blogId); return a && a.kind !== 'general' && a.dept ? { medical: true, dept: a.dept } : {}; } catch { return {}; }
  }
  function runG2(file, blogId) {
    if (!file || !fs.existsSync(file)) throw new Error('원고 파일을 찾을 수 없습니다');
    const r = quality.runG2(file, Object.assign({ blogId: blogId || null, historyRoot, write: true }, medOpts(blogId)));
    const qf = r.qualityJson, gf = gateFile(file);
    if (qf && !samePath(qf, gf)) {
      if (r.verdict === 'PASS') fs.copyFileSync(qf, gf);
      else { const g = readJson(gf); if (g && g.approvedHash && g.approvedHash === r.manuscriptSha256) { try { fs.unlinkSync(gf); } catch { } } }
    }
    return g2Summary(r);
  }
  // 최근 G2 결과(파일만 읽음) — 원고가 그 뒤 바뀌었으면 stale
  function g2Status(file) {
    const q = readJson(quality.qualityJsonPath(file));
    const ov = readJson(overrideFile(file));
    if (!q && !ov) return null;
    let stale = false;
    try { if (q && q.manuscriptSha256) stale = q.manuscriptSha256 !== sha256File(file); } catch { }
    return q ? { verdict: q.verdict, verdictText: VERDICT_KO[q.verdict] || q.verdict, score: q.score, checkedAt: q.checkedAt, stale, override: ov ? { reason: ov.reason, at: ov.at } : null }
      : { verdict: ov.verdict || null, verdictText: '운영자 예외', score: null, checkedAt: null, stale: false, override: { reason: ov.reason, at: ov.at } };
  }
  // 운영자 예외: override.json 기록 → quality.json 을 quality.overridden.json 으로 옮김(write.js 는 quality.json 이 없을 때만 SKIP_G2 를 받아 준다)
  function override(file, blogId, { reason, by, g2 } = {}) {
    const why = String(reason || '').trim();
    if (why.length < 2) throw new Error('예외로 진행하는 이유를 적어 주세요');
    if (why.length > 500) throw new Error('이유는 500자 안으로 적어 주세요');
    const sha = sha256File(file);
    const q = readJson(quality.qualityJsonPath(file)) || {};
    const rec = { operatorOverride: true, reason: why, at: new Date(now()).toISOString(), by: by || '', blogId: blogId || null, manuscript: file, manuscriptSha256: sha,
      verdict: (g2 && g2.verdict) || q.verdict || null, score: (g2 && g2.score) ?? q.score ?? null, findings: ((g2 && g2.findings) || q.findings || []).filter(f => f.level !== 'INFO').map(f => f.code) };
    const of = overrideFile(file);
    writeJson(of, rec);
    const gf = gateFile(file);
    if (fs.existsSync(gf)) {
      if (samePath(gf, quality.qualityJsonPath(file))) fs.renameSync(gf, path.join(path.dirname(gf), 'quality.overridden.json'));
      else fs.unlinkSync(gf);
    }
    const log = readJson(dfile('override_log')) || [];
    log.unshift({ ...rec }); writeJson(dfile('override_log'), log.slice(0, 300));
    return { ...rec, file: of };
  }

  // ── 실행 계획: G2 확인 후 write.js 환경 ──
  function runEnv(base, mode, { skipG2 = false } = {}) {
    const env = { ...base };
    for (const k of ['FAST', 'PUBLISH', 'ALLOW_AUTO_PUBLISH', 'SAVE', 'SKIP_G2', 'INPUT_MODE']) delete env[k];
    if (mode === 'test') env.FAST = '1';
    if (mode === 'save') env.SAVE = '1';
    if (mode === 'manual') env.INPUT_MODE = 'MANUAL_EDITOR';
    if (skipG2) env.SKIP_G2 = '1';
    return env;
  }
  const normMode = m => (m === 'publish' || !MODES.includes(m) ? 'save' : m);
  // {ok:true, mode, skipG2, g2, override} | {ok:false, status:409, error, g2}
  function planRun({ file, blogId, mode, override: ov, by }) {
    const m = normMode(mode);
    if (ov) {
      const g2 = (() => { try { return runG2(file, blogId); } catch { return null; } })();
      if (g2 && g2.verdict === 'PASS') return { ok: true, mode: m, skipG2: false, g2, override: null };
      const rec = override(file, blogId, { reason: ov.reason, by, g2 });
      return { ok: true, mode: m, skipG2: true, g2, override: rec };
    }
    const g2 = runG2(file, blogId);
    if (g2.verdict !== 'PASS') return { ok: false, status: 409, error: `G2 품질검사 판정이 '${g2.verdictText}'라 실행하지 않았습니다`, g2 };
    return { ok: true, mode: m, skipG2: false, g2, override: null };
  }
  // 실행이 끝난 뒤 원고 옆 save_result.json (이번 실행에서 쓴 것만)
  function readSaveResult(file, since = 0) {
    const f = path.join(path.dirname(file), 'save_result.json');
    try { if (fs.statSync(f).mtimeMs + 2000 < since) return null; } catch { return null; }
    const r = readJson(f); if (!r) return null;
    return { file: f, status: r.status, statusText: STATUS_KO[r.status] || r.status, savedAt: r.savedAt, manualPackage: r.manualPackage || null, errors: r.errors || [] };
  }

  // ── 발행 대기 목록 ──
  const stateFile = dfile('pending_state');
  const states = () => readJson(stateFile) || {};
  const idOf = rf => crypto.createHash('sha1').update(path.resolve(rf).toLowerCase()).digest('hex').slice(0, 12);
  function itemOf(rf, st) {
    const sr = readJson(rf); if (!sr || typeof sr !== 'object') return null;
    const dir = path.dirname(rf);
    const ms = sr.manuscript && fs.existsSync(sr.manuscript) ? sr.manuscript : null;
    const g2 = ms ? g2Status(ms) : null;
    const pr = readJson(path.join(dir, 'publish_record.json'));
    const id = idOf(rf), local = st[id] || null;
    const confirmed = sr.status === 'SAVE_CONFIRMED';
    const state = pr ? 'published' : !confirmed ? 'other' : local && local.state === 'discard' ? 'discard' : local && local.state === 'hold' ? 'hold' : 'pending';
    return {
      id, dir, resultFile: rf, blogId: sr.blogId || null, title: sr.draftTitle || sr.title || '', manuscript: sr.manuscript || null,
      status: sr.status, statusText: STATUS_KO[sr.status] || sr.status, savedAt: sr.savedAt || null, inputMode: sr.inputMode || null,
      inspection: { passed: !!(sr.inspection && sr.inspection.passed), failed: ((sr.inspection && sr.inspection.failed) || []).length, report: (sr.inspection && sr.inspection.report) || null },
      g2: g2 ? g2 : (sr.g2 && sr.g2.skipped ? { verdict: null, verdictText: 'G2 건너뜀', score: null, skipped: true } : null),
      publish: pr, state, stateAt: local ? local.at : null,
      errors: (sr.errors || []).slice(0, 3).map(e => e.message || e.code || String(e)),
    };
  }
  // files: 원고 경로 목록(manuscripts.json + 자동 찾기 폴더 + 원고함 초안). 폴더마다 save_result.json 하나.
  function scan(files) {
    const st = states(), seen = new Set(), out = [];
    for (const f of files) {
      const rf = path.join(path.dirname(f), 'save_result.json');
      const k = path.resolve(rf).toLowerCase();
      if (seen.has(k)) continue; seen.add(k);
      if (!fs.existsSync(rf)) continue;
      const it = itemOf(rf, st); if (it) out.push(it);
    }
    return out.sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
  }
  function setState(id, state, by) {
    if (!['pending', 'hold', 'discard'].includes(state)) throw new Error('상태 값이 올바르지 않습니다');
    const st = states();
    if (state === 'pending') delete st[id]; else st[id] = { state, at: new Date(now()).toISOString(), by: by || '' };
    writeJson(stateFile, st);
  }

  // ── LOGMETER ──
  let tokenSaved = false, tokenMem = null;
  async function token() {
    let t = null;
    try { t = fs.readFileSync(tokenFile, 'utf8').trim(); } catch { }
    if (t && /^[0-9a-f]{32,}$/i.test(t)) {
      tokenMem = t;
      if (secrets && !tokenSaved) { tokenSaved = true; Promise.resolve().then(() => secrets.setSecret('logmeter', 'token', t)).catch(() => { tokenSaved = false; }); }
      return { token: t, source: 'file' };
    }
    if (tokenMem) return { token: tokenMem, source: 'memory' };
    if (secrets && secrets.hasSecret && secrets.hasSecret('logmeter', 'token')) {
      try { tokenMem = await secrets.getSecret('logmeter', 'token'); if (tokenMem) return { token: tokenMem, source: 'secret' }; } catch { }
    }
    return { token: null, source: null };
  }
  // {ok, status, body, error, offline}
  async function lm(method, p, body) {
    const tk = await token();
    if (!tk.token) return { ok: false, status: 0, offline: true, error: 'LOGMETER 연결 토큰이 없습니다 (index_web\\_data\\exe_token)' };
    try {
      const r = await fetchFn(lmBase + p, { method, headers: { 'x-exe-token': tk.token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(o.lmTimeout || 8000) });
      let j = null; try { j = await r.json(); } catch { }
      return { ok: r.ok, status: r.status, body: j, error: r.ok ? null : (j && j.error) || `LOGMETER 응답 ${r.status}` };
    } catch (e) {
      return { ok: false, status: 0, offline: true, error: 'LOGMETER 미연결 (' + (e.name === 'TimeoutError' ? '응답 시간 초과' : e.cause && e.cause.code || e.message) + ')' };
    }
  }
  const lmHealth = async () => { const r = await lm('GET', '/api/exe/health'); const tk = await token(); return { connected: !!(r.ok && r.body && r.body.ok), status: r.status, error: r.error, tokenSource: tk.source, base: lmBase, fingerprintVersion: r.body && r.body.fingerprintVersion }; };
  const cacheFile = dfile('logmeter_cache');
  async function recommendations(blogId, { limit = 10, refresh = false } = {}) {
    const q = `/api/exe/recommendations?blogId=${encodeURIComponent(blogId)}&limit=${limit}${refresh ? '&refresh=1' : ''}`;
    const r = await lm('GET', q);
    const cache = readJson(cacheFile) || {};
    if (r.ok && r.body) {
      cache[blogId] = { at: new Date(now()).toISOString(), data: r.body };
      try { writeJson(cacheFile, cache); } catch { }
      return { ...r.body, offline: false, fetchedAt: cache[blogId].at };
    }
    const c = cache[blogId];
    if (c) return { ...c.data, offline: true, fetchedAt: c.at, error: r.error };
    return { offline: true, error: r.error, recommendations: [], fetchedAt: null, status: r.status };
  }
  async function reserve(body) {
    const r = await lm('POST', '/api/exe/reservations', body);
    if (r.status === 409 && r.body) {
      const h = r.body.heldBy || {};
      const until = h.expiresAt ? new Date(h.expiresAt).toLocaleString('ko-KR') : '';
      return { ok: false, conflict: true, message: `같은 검색 의도를 다른 블로그(${h.blogId || '?'})가 잡고 있습니다 · 상태 ${h.status || '?'}${until ? ' · ' + until + '까지' : ''}`, heldBy: h };
    }
    if (!r.ok) return { ok: false, offline: !!r.offline, message: r.error };
    return { ok: true, reservation: r.body && r.body.reservation };
  }
  async function syncFingerprints(blogId) {
    const r = await lm('GET', `/api/exe/fingerprints?blogId=${encodeURIComponent(blogId)}`);
    if (!r.ok) return { ok: false, error: r.error, offline: !!r.offline };
    const H = new quality.History(blogId, { root: historyRoot });
    let added = 0, skipped = 0;
    for (const it of (r.body && r.body.items) || []) { try { H.addExternal(it); added++; } catch { skipped++; } }
    return { ok: true, added, skipped, structureKnown: r.body.structureKnown || 0, fingerprintVersion: r.body.fingerprintVersion };
  }

  // ── 발행 감지 ──
  async function fetchTitleText(blogId) {
    const r = await fetchFn(`https://blog.naver.com/PostTitleListAsync.naver?blogId=${encodeURIComponent(blogId)}&currentPage=1&countPerPage=30`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('공개 글 목록 응답 ' + r.status);
    return r.text();
  }
  // 대기 글(같은 blogId)을 공개 글 목록과 대조. 찾으면 publish_record.json → LOGMETER → 품질 이력
  async function detect(blogId, items, { text } = {}) {
    const mine = items.filter(it => it.state === 'pending' && it.blogId === blogId);
    if (!mine.length) return { blogId, checked: 0, found: [] };
    const posts = parseTitleList(text != null ? text : await fetchTitleText(blogId));
    const found = [];
    for (const it of mine) {
      const m = matchPost(it, posts, now()); if (!m) continue;
      const rec = {
        blogId, logNo: m.post.logNo, url: `https://blog.naver.com/${blogId}/${m.post.logNo}`, title: m.post.title,
        publishedAt: new Date(m.date.est).toISOString(), publishedAtText: m.post.addDate, detectedAt: new Date(now()).toISOString(),
        manuscript: it.manuscript, saveResult: it.resultFile, savedAt: it.savedAt,
      };
      const rf = path.join(it.dir, 'publish_record.json');
      writeJson(rf, rec);
      rec.logmeter = await sendPublication(rec, it);
      rec.qualityHistory = addHistory(rec, it);
      writeJson(rf, rec);
      found.push({ id: it.id, ...rec });
    }
    return { blogId, checked: mine.length, posts: posts.length, found };
  }
  function keywordOf(it) {
    try { const S = quality.normalize.loadManuscript(it.manuscript); return S.keyword || (S.tags && S.tags[0]) || null; } catch { return null; }
  }
  async function sendPublication(rec, it) {
    const r = await lm('POST', '/api/exe/publications', { blogId: rec.blogId, logNo: rec.logNo, url: rec.url, title: rec.title, keyword: keywordOf(it || rec), publishedAt: rec.publishedAt });
    return r.ok ? { sent: true, at: new Date(now()).toISOString(), duplicate: !!(r.body && r.body.duplicate) } : { sent: false, at: new Date(now()).toISOString(), error: r.error, offline: !!r.offline };
  }
  function addHistory(rec, it) {
    if (!it.manuscript || !fs.existsSync(it.manuscript)) return { added: false, error: '원고 파일 없음' };
    try {
      const r = quality.runG2(it.manuscript, Object.assign({ blogId: rec.blogId, historyRoot, write: false }, medOpts(rec.blogId)));
      new quality.History(rec.blogId, { root: historyRoot }).add(r.fingerprint, { source: 'local', publishedAt: rec.publishedAt, url: rec.url });
      return { added: true };
    } catch (e) { return { added: false, error: e.message }; }
  }
  // LOGMETER 에 못 보낸 발행 기록 다시 보내기
  async function retryUnsent(items) {
    const out = [];
    for (const it of items) {
      const p = it.publish; if (!p || (p.logmeter && p.logmeter.sent)) continue;
      p.logmeter = await sendPublication(p, it);
      writeJson(path.join(it.dir, 'publish_record.json'), p);
      out.push({ id: it.id, sent: p.logmeter.sent, error: p.logmeter.error || null });
    }
    return out;
  }

  return { runG2, g2Status, override, planRun, runEnv, normMode, readSaveResult, scan, setState, detect, retryUnsent, lm, lmHealth, recommendations, reserve, syncFingerprints, token, gateFile, overrideFile, historyRoot };
}

module.exports = { createFlow, parseTitleList, parseAddDate, matchPost, normTitle, STATUS_KO, VERDICT_KO, MODES };
