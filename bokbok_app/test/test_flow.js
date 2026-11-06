// node test/test_flow.js — 원고 흐름(flow.js) 점검. 네이버 입력·실제 LOGMETER 호출 없음.
//   G2 PASS → SAVE 실행 환경(가짜 spawn) · G2 REWRITE → 막힘 · 운영자 예외 · 실제 원고함 발행 대기 찾기(읽기만)
//   · 공개 글 목록 제목 대조 · 발행 감지 → publish_record.json · LOGMETER 클라이언트(가짜 서버)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), crypto = require('crypto');
const { createFlow, parseTitleList, parseAddDate, matchPost, normTitle } = require('../flow.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bokbok-flow-'));
process.env.LOCALAPPDATA = path.join(TMP, 'localappdata');      // quality 기본 저장 위치도 임시로
const quality = require('../quality');
const PROJECT = path.resolve(__dirname, '..', '..', '..');
const REAL_DIR = path.join(PROJECT, '원고함', 'jsrjkb6742', '20261104_1900_INTP미루는습관');
const REAL_MS = path.join(REAL_DIR, '원고.txt');
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const mkdir = n => { const d = path.join(TMP, n); fs.mkdirSync(d, { recursive: true }); return d; };

// 판정을 정해 둔 가짜 quality (runG2 가 quality.json 을 실제처럼 쓴다)
function stubQuality(verdict) {
  return {
    ...quality,
    runG2(file, opts) {
      const r = { verdict, status: verdict, score: verdict === 'PASS' ? 100 : 60, title: 't', checkedAt: new Date().toISOString(), manuscriptSha256: sha(file),
        approvedHash: verdict === 'PASS' ? sha(file) : null, findings: verdict === 'PASS' ? [] : [{ level: verdict, code: 'STRUCTURE_CLUSTER', message: '구성 반복' }], unknowns: [], checks: {}, metrics: { comparedCount: 3 } };
      if (opts.write !== false) { const out = quality.qualityJsonPath(file); fs.writeFileSync(out, JSON.stringify(r)); r.qualityJson = out; }
      return r;
    },
  };
}
function manuscriptCopy(name) {
  const d = mkdir(name); const f = path.join(d, '원고.txt');
  fs.copyFileSync(REAL_MS, f); return f;
}
// write.js 를 대신하는 가짜 spawn: server.js run() 과 같은 방식으로 env 를 만든다
function fakeSpawnRun(flow, plan, file) {
  const calls = [];
  const spawn = (cmd, args, opts) => { calls.push({ cmd, args, env: opts.env }); return { pid: 1 }; };
  if (plan.ok) spawn(process.execPath, ['write.js', file], { env: flow.runEnv({ ...process.env, PUBLISH: '1', ALLOW_AUTO_PUBLISH: '1' }, plan.mode, { skipG2: plan.skipG2 }) });
  return calls;
}

test('G2 PASS → SAVE=1 로 실행 (PUBLISH·SKIP_G2 없음)', () => {
  const DATA = mkdir('data-pass');
  const flow = createFlow({ DATA, quality: stubQuality('PASS'), historyRoot: mkdir('hist-pass') });
  const f = manuscriptCopy('ms-pass');
  const plan = flow.planRun({ file: f, blogId: 'jsrjkb6742', mode: 'publish' });   // 예전 'publish' 도 save 로 바뀜
  assert.equal(plan.ok, true); assert.equal(plan.mode, 'save'); assert.equal(plan.g2.verdict, 'PASS');
  const calls = fakeSpawnRun(flow, plan, f);
  assert.equal(calls.length, 1);
  const env = calls[0].env;
  assert.equal(env.SAVE, '1'); assert.equal(env.PUBLISH, undefined); assert.equal(env.ALLOW_AUTO_PUBLISH, undefined); assert.equal(env.SKIP_G2, undefined);
  // write.js(save.js g2Gate)가 읽는 원고 옆 quality.json 이 PASS·해시 일치
  const q = JSON.parse(fs.readFileSync(path.join(path.dirname(f), 'quality.json'), 'utf8'));
  assert.equal(q.verdict, 'PASS'); assert.equal(q.approvedHash, sha(f));
  const g = require('../../naver_post/save.js').g2Gate(f);
  assert.equal(g.ok, true, g.message);
});

test('G2 REWRITE → 실행 막힘, 운영자 예외는 override.json + SKIP_G2', () => {
  const DATA = mkdir('data-rw');
  const flow = createFlow({ DATA, quality: stubQuality('REWRITE'), historyRoot: mkdir('hist-rw') });
  const f = manuscriptCopy('ms-rw');
  const plan = flow.planRun({ file: f, blogId: 'jsrjkb6742', mode: 'save' });
  assert.equal(plan.ok, false); assert.equal(plan.status, 409); assert.equal(plan.g2.verdict, 'REWRITE');
  assert.equal(fakeSpawnRun(flow, plan, f).length, 0);
  assert.throws(() => flow.planRun({ file: f, blogId: 'jsrjkb6742', mode: 'save', override: { reason: '' } }), /이유/);
  const p2 = flow.planRun({ file: f, blogId: 'jsrjkb6742', mode: 'save', override: { reason: '시리즈 글이라 구성 반복 의도' }, by: '테스트' });
  assert.equal(p2.ok, true); assert.equal(p2.skipG2, true);
  const ov = JSON.parse(fs.readFileSync(path.join(path.dirname(f), 'override.json'), 'utf8'));
  assert.equal(ov.operatorOverride, true); assert.equal(ov.reason, '시리즈 글이라 구성 반복 의도'); assert.ok(ov.at); assert.equal(ov.verdict, 'REWRITE');
  assert.equal(fs.existsSync(path.join(path.dirname(f), 'quality.json')), false);
  assert.equal(fs.existsSync(path.join(path.dirname(f), 'quality.overridden.json')), true);
  const env = fakeSpawnRun(flow, p2, f)[0].env;
  assert.equal(env.SAVE, '1'); assert.equal(env.SKIP_G2, '1'); assert.equal(env.PUBLISH, undefined);
  assert.equal(JSON.parse(fs.readFileSync(path.join(DATA, 'override_log.json'), 'utf8')).length, 1);
  // quality.json 이 없으니 write.js 의 g2Gate 는 SKIP_G2=1 일 때만 통과
  process.env.SKIP_G2 = '1'; try { assert.equal(require('../../naver_post/save.js').g2Gate(f).ok, true); } finally { delete process.env.SKIP_G2; }
});

test('직접 입력 모드 → INPUT_MODE=MANUAL_EDITOR, 저장·발행 변수 없음', () => {
  const flow = createFlow({ DATA: mkdir('data-man'), quality: stubQuality('PASS') });
  const env = flow.runEnv({ PUBLISH: '1', SAVE: '1' }, 'manual');
  assert.equal(env.INPUT_MODE, 'MANUAL_EDITOR'); assert.equal(env.SAVE, undefined); assert.equal(env.PUBLISH, undefined);
});

test('실제 G2 모듈: 원고 사본 검사 → quality.json 기록', () => {
  const flow = createFlow({ DATA: mkdir('data-real'), quality, historyRoot: mkdir('hist-real') });
  const f = manuscriptCopy('ms-real');
  const g = flow.runG2(f, 'jsrjkb6742');
  assert.ok(['PASS', 'REWRITE', 'HOLD', 'REJECT'].includes(g.verdict));
  const q = JSON.parse(fs.readFileSync(path.join(path.dirname(f), 'quality.json'), 'utf8'));
  assert.equal(q.verdict, g.verdict);
  console.log(`  실제 G2(이력 없음): ${g.verdict} · ${g.score}점 · 미확인 ${g.unknowns.length}건`);
});

test('발행 대기: 실제 원고함 save_result.json(SAVE_CONFIRMED) 찾기 (읽기만)', () => {
  assert.ok(fs.existsSync(path.join(REAL_DIR, 'save_result.json')), '실제 save_result.json 이 있어야 함');
  const before = fs.readdirSync(REAL_DIR).sort().join('|');
  const flow = createFlow({ DATA: mkdir('data-scan'), quality });
  const items = flow.scan([REAL_MS, path.join(PROJECT, '원고함', 'jsrjkb6742', '20261104_2000_INTP_ENFP궁합', '원고.txt')]);
  const it = items.find(x => x.dir.toLowerCase() === REAL_DIR.toLowerCase());
  assert.ok(it, '발행 대기 항목');
  assert.equal(it.status, 'SAVE_CONFIRMED'); assert.equal(it.blogId, 'jsrjkb6742');
  assert.equal(it.publish, null); assert.equal(it.state, 'pending'); assert.equal(it.inspection.passed, true);
  assert.equal(items.length, 1, '궁합 폴더에는 save_result.json 이 없음');
  assert.equal(fs.readdirSync(REAL_DIR).sort().join('|'), before, '실제 폴더에 아무것도 쓰지 않음');
  console.log(`  발행 대기: ${it.title} · 저장 ${it.savedAt} · G2 ${it.g2 ? it.g2.verdictText : '없음'}`);
  // 보류 → 대기 되돌리기
  flow.setState(it.id, 'hold'); assert.equal(flow.scan([REAL_MS])[0].state, 'hold');
  flow.setState(it.id, 'pending'); assert.equal(flow.scan([REAL_MS])[0].state, 'pending');
});

const enc = s => encodeURIComponent(s).replace(/%20/g, '+');
const TITLE = 'INTP 미루는 습관 | 게으른 게 아니라 머릿속에선 이미 끝났다, 나에 대한 고찰';
const sampleList = (title, addDate, logNo = '224470000001') => JSON.stringify({ resultCode: 'S', postList: [
  { logNo: '224465013597', title: enc("연애 궁합 INTP와 ENFP는 어떤 부분이 잘 맞을까? INTP인 나한테 직접 물어봤다"), addDate: '6시간 전' },
  { logNo, title: enc(title), addDate },
], pagingHtml: "<div class='x'>" }).replace("class='x'", "class=\\'x\\'");

test('제목 대조: + 는 공백, \\\' 제거, HTML 엔티티, 저장 시각 이후만', () => {
  const now = Date.parse('2026-11-05T12:00:00+09:00');
  const posts = parseTitleList(sampleList(TITLE.replace(',', '&#44;'), '3시간 전'));
  assert.equal(posts[1].title.replace('&#44;', ','), TITLE);
  assert.equal(normTitle(posts[1].title), normTitle(TITLE));
  const item = { title: TITLE, savedAt: '2026-11-05T00:44:32+09:00' };
  assert.ok(matchPost(item, posts, now));
  assert.equal(matchPost({ ...item, title: '다른 제목' }, posts, now), null);
  const old = parseTitleList(sampleList(TITLE, '2026. 11. 3.'));
  assert.equal(matchPost(item, old, now), null, '저장 전에 올라간 같은 제목 글은 아님');
  assert.deepEqual(parseAddDate('2026. 11. 5.', now).upper, Date.parse('2026-11-06T00:00:00+09:00') - 1);
  assert.ok(parseAddDate('12분 전', now).est === now - 12 * 60000);
});

// 가짜 LOGMETER (토큰 헤더 확인)
function mockLogmeter(token) {
  const got = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', d => b += d); req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      got.push({ method: req.method, path: u.pathname, query: u.search, token: req.headers['x-exe-token'], body: b ? JSON.parse(b) : null });
      const send = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.headers['x-exe-token'] !== token) return send(401, { error: '연결 토큰이 올바르지 않아요' });
      if (u.pathname === '/api/exe/health') return send(200, { schemaVersion: '1.3', ok: true, auth: 'LOCAL_TOKEN', fingerprintVersion: 'fp-1.0' });
      if (u.pathname === '/api/exe/recommendations') return send(200, { schemaVersion: '1.3', blogId: u.searchParams.get('blogId'), mode: 'NO_KEY', generatedAt: 1, recommendations: [{ candidateId: 'kwc_1', keyword: 'ENFP 특징', intentClusterId: 'info:enfp', status: 'CHALLENGE', statusText: '도전 후보', confidence: 'LOW', reasons: ['근거'], cautions: ['주의'] }] });
      if (u.pathname === '/api/exe/reservations') return send(409, { schemaVersion: '1.3', ok: false, conflict: true, reservation: null, heldBy: { blogId: 'victoreconomic', status: 'RESERVED', expiresAt: null } });
      if (u.pathname === '/api/exe/publications') return send(200, { schemaVersion: '1.3', ok: true, duplicate: false });
      if (u.pathname === '/api/exe/fingerprints') return send(200, { schemaVersion: '1.3', items: [{ logNo: '1', title: 'ENFP 특징 | 테스트', titlePattern: null, structure: ['T', 'Q', 'I', 'T'], publishedAt: 1 }], structureKnown: 1 });
      send(404, { error: 'not found' });
    });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, got, base: `http://127.0.0.1:${srv.address().port}` })));
}

test('LOGMETER 클라이언트: 토큰 헤더 · 추천 캐시 · 409 · 미연결 시 캐시', async () => {
  const token = 'ab'.repeat(32), tf = path.join(mkdir('lm'), 'exe_token');
  fs.writeFileSync(tf, token + '\n');
  const m = await mockLogmeter(token);
  const saved = [];
  const secrets = { setSecret: async (p, k, v) => saved.push([p, k, v]), hasSecret: () => false, getSecret: async () => null };
  const DATA = mkdir('data-lm');
  const flow = createFlow({ DATA, quality, historyRoot: mkdir('hist-lm'), logmeterBase: m.base, tokenFile: tf, secrets });
  const h = await flow.lmHealth();
  assert.equal(h.connected, true); assert.equal(h.tokenSource, 'file');
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(saved[0], ['logmeter', 'token', token], '토큰을 비밀값 저장소에도 둠');
  const rec = await flow.recommendations('jsrjkb6742', { limit: 5 });
  assert.equal(rec.offline, false); assert.equal(rec.recommendations[0].keyword, 'ENFP 특징');
  assert.match(m.got.find(x => x.path === '/api/exe/recommendations').query, /blogId=jsrjkb6742&limit=5/);
  assert.ok(m.got.every(x => x.token === token), '모든 요청에 x-exe-token');
  const rv = await flow.reserve({ blogId: 'jsrjkb6742', keyword: 'ENFP 특징', intentClusterId: 'info:enfp' });
  assert.equal(rv.ok, false); assert.equal(rv.conflict, true); assert.match(rv.message, /victoreconomic/);
  const fp = await flow.syncFingerprints('jsrjkb6742');
  assert.equal(fp.ok, true); assert.equal(fp.added, 1);
  await new Promise(r => m.srv.close(r));
  const off = await flow.recommendations('jsrjkb6742');
  assert.equal(off.offline, true); assert.ok(off.fetchedAt, '마지막 받은 시각'); assert.equal(off.recommendations.length, 1);
  assert.match(off.error, /LOGMETER 미연결/);
  const h2 = await flow.lmHealth(); assert.equal(h2.connected, false);
});

test('발행 감지: 같은 제목 → publish_record.json · LOGMETER 기록 · 품질 이력 추가', async () => {
  const token = 'cd'.repeat(32), tf = path.join(mkdir('lm2'), 'exe_token');
  fs.writeFileSync(tf, token);
  const m = await mockLogmeter(token);
  const DATA = mkdir('data-det'), hist = mkdir('hist-det');
  const flow = createFlow({ DATA, quality, historyRoot: hist, logmeterBase: m.base, tokenFile: tf, now: () => Date.parse('2026-11-05T12:00:00+09:00') });
  const f = manuscriptCopy('ms-det');
  const sr = JSON.parse(fs.readFileSync(path.join(REAL_DIR, 'save_result.json'), 'utf8'));
  sr.manuscript = f;
  fs.writeFileSync(path.join(path.dirname(f), 'save_result.json'), JSON.stringify(sr));
  const items = flow.scan([f]);
  assert.equal(items[0].state, 'pending');
  const r = await flow.detect('jsrjkb6742', items, { text: sampleList(sr.title, '2시간 전', '224470000009') });
  assert.equal(r.found.length, 1);
  const rec = JSON.parse(fs.readFileSync(path.join(path.dirname(f), 'publish_record.json'), 'utf8'));
  assert.equal(rec.logNo, '224470000009'); assert.equal(rec.url, 'https://blog.naver.com/jsrjkb6742/224470000009');
  for (const k of ['blogId', 'logNo', 'url', 'title', 'publishedAt', 'detectedAt']) assert.ok(rec[k], k);
  assert.equal(rec.logmeter.sent, true); assert.equal(rec.qualityHistory.added, true);
  const pub = m.got.find(x => x.path === '/api/exe/publications');
  assert.equal(pub.body.logNo, '224470000009'); assert.equal(pub.body.blogId, 'jsrjkb6742'); assert.ok(pub.body.title);
  const H = new quality.History('jsrjkb6742', { root: hist });
  assert.equal(H.recent(5)[0].url, rec.url, '다음 G2 비교 대상에 들어감');
  assert.equal(flow.scan([f])[0].state, 'published');
  // LOGMETER 꺼진 상태: 기록은 남기고 '미연결' 표시 → 나중에 다시 보내기
  await new Promise(res => m.srv.close(res));
  const f2 = manuscriptCopy('ms-det2');
  fs.writeFileSync(path.join(path.dirname(f2), 'save_result.json'), JSON.stringify({ ...sr, manuscript: f2 }));
  const r2 = await flow.detect('jsrjkb6742', flow.scan([f2]), { text: sampleList(sr.title, '1시간 전', '224470000010') });
  assert.equal(r2.found[0].logmeter.sent, false); assert.match(r2.found[0].logmeter.error, /LOGMETER 미연결/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(path.dirname(f2), 'publish_record.json'), 'utf8')).logNo, '224470000010');
});

test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { } });
