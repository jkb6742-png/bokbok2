// bokbok 앱 서버 v2 — 이 PC 안(127.0.0.1)에서만 열린다.
// 사용자·세션·계정·설정·원고 목록은 %LOCALAPPDATA%\bokbok 에 저장. 네이버 비밀번호는 저장하지 않는다.
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const VERSION = '2.0.0';
const PORT = +process.env.BOKBOK_PORT || 3600;                  // 점검용 덮어쓰기만 허용, 기본 3600
const PROJECT = process.env.BOKBOK_PROJECT ? path.resolve(process.env.BOKBOK_PROJECT) : path.resolve(__dirname, '..', '..');   // 애드포스트 프로젝트 (점검용 덮어쓰기 허용)
const TOOL = path.resolve(__dirname, '..', 'naver_post');        // 블로그 엔진은 항상 실제 위치
const STATIC = path.join(__dirname, 'static');
const DATA = process.env.BOKBOK_DATA || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'bokbok');
fs.mkdirSync(DATA, { recursive: true });
const { summary } = require(path.join(TOOL, 'manuscript.js'));
const IDX = require('./idx.js');   // 병원 블로그 지수(index_web) 편입: 3610 자식 프로세스 + 입장권

// ── 저장소 ─────────────────────────────────────────
const file = n => path.join(DATA, n + '.json');
const read = (n, d) => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch { return d; } };
const write = (n, v) => fs.writeFileSync(file(n), JSON.stringify(v, null, 2));

// ── 공인 IP: 상단바 표시용. 1분 캐시, 바뀌면 이전 값·바뀐 시각 기록 ──
let netCache = null;
async function publicIp(force) {
  if (!force && netCache && Date.now() - netCache.checkedAt < 60000) return netCache;
  const isIp = s => /^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-f:]{3,45}$/i.test(s);
  let ip = null;
  for (const url of ['https://api.ipify.org', 'https://checkip.amazonaws.com']) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
      const t = (await r.text()).trim();
      if (r.ok && isIp(t)) { ip = t; break; }
    } catch { }
  }
  const saved = read('net', {});
  if (ip && saved.ip && saved.ip !== ip) { saved.prev = saved.ip; saved.changedAt = Date.now(); }
  if (ip) { saved.ip = ip; write('net', saved); }
  netCache = { ip, prev: saved.prev || null, changedAt: saved.changedAt || null, checkedAt: Date.now() };
  return netCache;
}
// ── 자동 기획: 블로그 데이터로 다음 주제 고르기 (gen\planner.js) ──
async function autoPlan(blogId, { apiKey, n = 3, log = () => { } } = {}) {
  const planner = genModule('planner');
  const profile = blogProfile(blogId);
  let posts = [], recs = [];
  try { if (insight) { const d = await insight.dashboard(blogId, { settings: insSettings() }); posts = (d.tables && d.tables.posts) || []; recs = d.recommendations || []; } } catch (e) { log('블로그 데이터 없이 기획합니다: ' + e.message); }
  let report = null; try { report = analyzer ? analyzer.get(blogId) : null; } catch { }
  const existingTitles = await blogTitles(blogId).catch(() => []);
  const draftTitles = manuscriptFiles(blogId).map(m => { try { return summary(m.path).title; } catch { return null; } }).filter(Boolean);
  const brief = planner.buildBrief({ profile, posts, recs, report, existingTitles, draftTitles });
  if (FAKE_GEN) return { brief, candidates: [{ keyword: `${profile.blogName || blogId} 자동 주제`, subKeywords: ['시험 보조어'], title: `${profile.blogName || blogId} 자동 주제 | 가짜 기획`, topic: '시험용 자동 기획입니다', category: profile.categories[0] || '', titleMode: 'auto', layout: 'auto', reason: 'BOKBOK_FAKE_GEN' }] };
  const r = await planner.plan({ apiKey, model: genSettings().model, brief, profile, n, avoidTitles: [...existingTitles, ...draftTitles], log });
  return { brief, ...r };
}
// 자동 생성 일정: accounts[].auto = { enabled, perDay(1~5), at('HH:MM'), lastDate }
function kstNow() { const d = new Date(Date.now() + 9 * 3600000); return { date: d.toISOString().slice(0, 10), hhmm: d.toISOString().slice(11, 16) }; }
function autoTick() {
  const now = kstNow();
  let changed = false;
  for (const a of accounts) {
    const au = a.auto; if (!au || !au.enabled) continue;
    if (au.lastDate === now.date || now.hhmm < (au.at || '09:00')) continue;
    const n = Math.max(1, Math.min(5, +au.perDay || 1));
    const presets = Array.isArray(a.presets) ? a.presets.filter(p => p.imageMode !== 'photos' && p.imageMode !== 'clinical') : [];   // 사진이 필요한 조합은 자동 기획에서 못 쓴다
    for (let i = 0; i < n; i++) Q.add({ lane: 'generate', kind: 'generate', blogId: a.blogId, label: `${a.name || a.blogId} · 자동 기획 (${i + 1}/${n})`, by: 'auto', payload: { blogId: a.blogId, auto: true, preset: presets.length ? '__rotate__' : '', imageMode: presets.length ? undefined : 'cards' } });
    au.lastDate = now.date; changed = true;
    console.log(`[auto] ${a.blogId} 자동 원고 ${n}편 등록`);
  }
  if (changed) write('accounts', accounts);
}
setInterval(() => { try { autoTick(); } catch (e) { console.error('auto tick:', e.message); } }, 60000);

// ── 네트워크·테더링 (net\tether.js) ──
let tether = null;
try { tether = require(path.join(__dirname, 'net', 'tether.js')); } catch (e) { console.error('네트워크 엔진 불러오기 실패:', e.message); }
const tetherMod = () => { if (!tether) throw new HttpErr(503, '네트워크 엔진(net\\tether.js)을 불러오지 못했습니다'); return tether; };
function netSettings() {
  const st = tether ? tether.readState() : {};
  return { hotspotName: st.hotspotName || '', adbPath: st.adbPath || '', tetherOnly: st.tetherOnly !== false, avoidRegions: Array.isArray(st.avoidRegions) ? st.avoidRegions : [] };
}
let linkCache = null, netJob = null;
async function netStatus(force) {
  const T = tetherMod(), st = netSettings();
  const ipInfo = await publicIp(force);
  if (force || !linkCache || Date.now() - linkCache.at > 20000) linkCache = { at: Date.now(), link: await T.linkInfo(st) };
  const link = linkCache.link;
  const g = ipInfo.ip ? await T.geo(ipInfo.ip) : null;
  if (ipInfo.ip) T.recordIp(ipInfo.ip, g, link);
  const adb = await T.adbDevices(st);
  const h = (T.readState().history || []).slice(0, 30);
  return {
    ...ipInfo, geo: g, region: g ? { key: T.regionKey(g), label: T.regionLabel(g) } : null, link,
    light: T.light({ ip: ipInfo.ip, link, geo: g, settings: st }),
    adb: { available: adb.available, path: adb.path, devices: adb.devices, error: adb.error || null },
    settings: st, regions: T.REGIONS.map(r => ({ key: r.key, label: r.label })), history: h.map(x => ({ ...x, avoided: st.avoidRegions.includes(x.region) })), job: netJob, rolling: T.isRolling(),
  };
}
const DEFAULT_SETTINGS = {
  tpm: 800, jitter: 30, linePause: 300, tagPause: 900, mode: 'save',   // 자동 발행은 꺼짐(2026-11-05) — 기본은 임시저장(SAVE)
  typoN: 3, thinkN: 2,        // 원고 1편당 오타 내고 고치기 · 문장 끝 생각 멈춤 횟수
  readN: 2, readSec: 60,      // 발행 뒤 관련 키워드로 다른 사람 글 N편 읽기(각 약 readSec초, 읽기만)
  clearCache: true,           // 발행 뒤 그 계정 크롬의 캐시만 비움(쿠키·로그인 유지) — keep 방식일 때만 의미 있음
  loginMode: 'fresh',         // fresh: 매번 새 시크릿 창에서 사람이 직접 로그인(끝나면 임시 프로필 삭제) · keep: 계정별 프로필에 로그인 유지
  scanDirs: [path.join(PROJECT, '_도구', '원고데이터'), path.join(PROJECT, '원고함')],
};
const settings = () => { const s = { ...DEFAULT_SETTINGS, ...read('settings', {}) }; if (!['save', 'stop', 'test'].includes(s.mode)) s.mode = 'save'; return s; };
// 블로그별 입력 설정: accounts[].settings 에 바꾼 항목만 저장하고, 없는 항목은 위 기본값(입력 설정 화면)을 따른다.
//   고정 IP가 할당된 블로그는 로그인 방식을 keep(전용 크롬에 로그인 유지)으로 고정한다 — 매번 새 시크릿 창이면 IP가 같아도 네이버가 매번 새 기기로 본다.
const BLOG_SET_KEYS = ['tpm', 'jitter', 'linePause', 'tagPause', 'typoN', 'thinkN', 'readN', 'readSec', 'clearCache', 'loginMode', 'mode'];
function settingsFor(blogId) {
  const a = accounts.find(x => x.blogId === blogId) || {};
  const s = { ...settings() };
  for (const k of BLOG_SET_KEYS) if (a.settings && a.settings[k] !== undefined) s[k] = a.settings[k];
  if (a.ipId) s.loginMode = 'keep';
  return s;
}
function cleanBlogSettings(b) {   // 화면에서 온 값 → 범위 맞춘 값 (주지 않은 항목은 넣지 않음 = 기본값 따름)
  const n = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(+v)));
  const R = { tpm: [100, 3000], jitter: [0, 80], linePause: [0, 3000], tagPause: [300, 5000], typoN: [0, 12], thinkN: [0, 12], readN: [0, 5], readSec: [20, 180] };
  const out = {};
  for (const [k, [lo, hi]] of Object.entries(R)) if (b[k] !== undefined && b[k] !== null && Number.isFinite(+b[k])) out[k] = n(b[k], lo, hi);
  if (typeof b.clearCache === 'boolean') out.clearCache = b.clearCache;
  if (['fresh', 'keep'].includes(b.loginMode)) out.loginMode = b.loginMode;
  if (['save', 'stop', 'test'].includes(b.mode)) out.mode = b.mode;
  return out;
}
let accounts = read('accounts', null);
if (!accounts) { accounts = [{ name: '복복이의 이것저것', blogId: 'jsrjkb6742' }]; write('accounts', accounts); }
// 블로그 계정 소유자(owner = 앱 로그인 아이디): 각자 자기 블로그 계정만 본다. 소유자가 없는 예전 계정은 첫 관리자 것으로.
//   관리자는 사용자 관리 화면에서 소유자를 바꿀 수 있다(/api/admin/accounts). 큐(internal)는 전부 본다.
function ensureOwners() {
  if (!accounts.some(a => !a.owner)) return;
  let adminEmail = '';
  try { const u = users().find(x => x.role === 'admin'); adminEmail = u ? u.email : ''; } catch { }
  if (!adminEmail) return;
  for (const a of accounts) if (!a.owner) a.owner = adminEmail;
  write('accounts', accounts);
}
// 병의원 전용(2026-11-05): 계정 kind = 'hospital'(진료과·지역) | 'general'(일반 블로그 — 관리자 CMD 로만, 관리자 화면에만 보임)
const DEPT = require(path.join(__dirname, 'medical', 'departments.js'));
(function ensureKinds() {
  let ch = false;
  for (const a of accounts) {
    if (a.kind) continue;
    const g = a.dept || DEPT.guess([a.name, a.blogId, (a.categories || []).join(' ')].join(' '));
    a.kind = g ? 'hospital' : 'general'; if (g) a.dept = g; ch = true;
  }
  if (ch) write('accounts', accounts);
})();
const cleanRegion = r => { r = r || {}; const c = (v, n) => String(v || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n); return { sido: c(r.sido, 20), sigungu: c(r.sigungu, 20), area: c(r.area, 30) }; };
// 병원 계정을 지수 등록부에도 맞춘다(지수 서버가 꺼져 있으면 다음 화면 진입 때 다시)
function syncHospital(a, me) {
  if (!a || a.kind !== 'hospital' || !a.dept || !(a.region && (a.region.sigungu || a.region.area))) return;
  IDX.hospitals({ dataDir: DATA, user: me && me.user ? me.user.name || me.user.email : 'bokbok', role: 'user', save: { blogId: a.blogId, name: a.name, dept: a.dept, region: a.region } }).catch(() => { });
}
const visibleAccounts = me => (!me || me.internal) ? accounts : accounts.filter(a => (!a.owner || a.owner === me.user.email) && (a.kind !== 'general' || (me.user && me.user.role === 'admin')));
function checkOwner(me, blogId, P) {
  if (!me || me.internal || !blogId || P.startsWith('/api/admin/')) return;
  const a = accounts.find(x => x.blogId === String(blogId));
  if (a && a.owner && a.owner !== me.user.email) throw new HttpErr(403, '다른 사용자의 블로그 계정입니다. 관리자가 사용자 관리에서 소유자를 바꿀 수 있습니다');
}
fs.mkdirSync(path.join(PROJECT, '원고함'), { recursive: true });

// ── 원고 찾기: 직접 등록한 파일 + 자동 찾기 폴더(*_layout.js, *.txt) ──
// blogId를 주면 GPT로 만든 그 계정 초안(원고함\<blogId>\*\원고.txt)도 넣는다
function manuscriptFiles(blogId) {
  const reg = read('manuscripts', []);
  const found = [], drafts = {};
  for (const d of settings().scanDirs) {
    try { for (const f of fs.readdirSync(d)) if (/_layout\.js$|\.txt$/.test(f)) found.push(path.join(d, f)); } catch { }
  }
  if (blogId && ID_RE.test(blogId)) {
    const base = path.join(OUT_ROOT, blogId);
    let names = []; try { names = fs.readdirSync(base, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { }
    for (const n of names.sort().reverse()) {
      const f = path.join(base, n, '원고.txt');
      if (fs.existsSync(f)) { found.push(f); drafts[f] = `${blogId}/${n}`; }
    }
  }
  return [...new Set([...reg, ...found])].filter(f => fs.existsSync(f)).map(f => ({ path: f, registered: reg.includes(f), draft: drafts[f] || null }));
}

// 블로그에 이미 올라간 제목 (계정별 5분 캐시)
const titleCache = {};
async function blogTitles(blogId) {
  const c = titleCache[blogId];
  if (c && Date.now() - c.at < 300000) return c.titles;
  const titles = [];
  for (let p = 1; p <= 3; p++) {
    try {
      const r = await fetch(`https://blog.naver.com/PostTitleListAsync.naver?blogId=${encodeURIComponent(blogId)}&currentPage=${p}&countPerPage=30`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const j = JSON.parse((await r.text()).replace(/\\'/g, "'"));
      const list = (j.postList || []).map(x => ({ title: decodeURIComponent(String(x.title || '').replace(/\+/g, ' ')), logNo: String(x.logNo || '') }));
      titles.push(...list);
      if (list.length < 30) break;
    } catch { break; }
  }
  titleCache[blogId] = { at: Date.now(), titles: titles.map(x => x.title), posts: titles };
  return titleCache[blogId].titles;
}
// 다음 글 설계: 이 블로그 최근 원고의 형태(제목 틀·도입·끝맺음 등)와 많이 다룬 소재 → 피할 것·다음 글 설계 (qualityormplan_blog.js)
async function formPlanFor(blogId, n = 5) {
  const fpb = require(path.join(__dirname, 'quality', 'formplan_blog.js'));
  let published = []; try { published = await blogTitles(blogId); } catch { }
  return fpb.forBlog({ blogId, files: manuscriptFiles(blogId), history: read('history', []), published, n });
}
// 제목 + 글 번호 (내부 링크용)
async function blogPosts(blogId) { await blogTitles(blogId); return (titleCache[blogId] && titleCache[blogId].posts) || []; }
// 글 끝 링크 재료: 이 글 주제와 관련 있는 내 글(대시보드 데이터 우선, 없으면 공개 글 목록) + 계정에 등록한 홈페이지
async function buildLinks(blogId, keyword, topic) {
  const a = accounts.find(x => x.blogId === blogId) || {};
  const n = Math.max(0, Math.min(2, Number.isFinite(+a.linkInternal) ? +a.linkInternal : 2));
  const out = { related: [], homepage: /^https?:\/\/\S+$/.test(String(a.homepage || '')) ? String(a.homepage) : null, label: String(a.homepageLabel || '').trim() || (a.homepage ? '홈페이지 바로가기' : '') };
  if (!n) return out;
  let advisor = null; try { advisor = require(path.join(__dirname, 'insight', 'advisor.js')); } catch { return out; }
  const q = String(topic || '').trim() ? `${keyword} ${String(topic).slice(0, 40)}` : keyword;
  let cands = [];
  try { if (insight) { const d = await insight.dashboard(blogId, { settings: insSettings() }); cands = ((d.tables && d.tables.posts) || []).filter(p => p.logNo && p.title); } } catch { }
  if (!cands.length) { try { cands = (await blogPosts(blogId)).filter(p => p.logNo).map(p => ({ ...p, score: 0 })); } catch { } }
  const scored = cands.map(p => ({ p, r: Math.max(advisor.relation(keyword, p), advisor.relation(q, p)) })).filter(x => x.r >= 0.5)
    .sort((x, y) => y.r - x.r || (y.p.score || 0) - (x.p.score || 0));
  out.related = scored.slice(0, n).map(x => ({ title: x.p.title, url: `https://blog.naver.com/${blogId}/${x.p.logNo}` }));
  return out;
}

// ── 실행 (한 번에 하나) ─────────────────────────────
let job = null;            // { proc, blogId, file, mode, lines[], progress, result }
const clients = new Set();
const emitRaw = (type, data) => { const s = `data: ${JSON.stringify({ type, data })}\n\n`; for (const c of clients) c.write(s); };
const emit = (type, data) => { emitRaw(type, data); try { Q.onEvent(type, data); } catch (e) { console.error('queue event:', e.message); } };

// ── 작업 큐: 블로그 여러 개 · 채널 여러 개의 작업을 등록해 두면 차례로 돌린다 ─────────────
//   lane: 'publish'(블로그 입력·발행, 한 번에 1개) · 'generate'(GPT 원고, 1개) · 'channel:<p>'(채널 발행, 채널마다 1개)
//   항목: { id, lane, kind, label, blogId|p, payload, status: queued|running|done|failed|cancelled, createdAt, startedAt, finishedAt, error, result, by }
//   실행은 기존 /api/run · /api/gen/start · /api/engine/publish 를 내부 호출로 그대로 쓴다(검사·기록·이벤트가 한 곳에 남게).
const INTERNAL_TOKEN = crypto.randomBytes(24).toString('hex');
const Q = {
  items: read('queue', []).filter(x => x && x.id),
  state: { paused: false, gapMin: 0, ...read('queue_state', {}) },
  lastFinished: {},            // lane -> 끝난 시각 (간격 두기)
  save() { write('queue', this.items.slice(-300)); write('queue_state', this.state); },
  pub(x) { const { payload, ...rest } = x; return { ...rest, payload: { file: payload && payload.file, mode: payload && payload.mode, keyword: payload && payload.keyword, p: payload && payload.p } }; },
  summary() {
    const c = { queued: 0, running: 0, done: 0, failed: 0 };
    for (const x of this.items) if (c[x.status] !== undefined) c[x.status]++;
    return { ...c, paused: this.state.paused, gapMin: this.state.gapMin };
  },
  broadcast() { emitRaw('queue', { summary: this.summary(), running: this.items.filter(x => x.status === 'running').map(x => this.pub(x)) }); },
  changed() { this.save(); this.broadcast(); },
  laneOf(x) { return x.lane; },
  busy(lane) {
    if (lane === 'publish') return !!(job && !job.done);
    if (lane === 'generate') return genBusy();
    if (lane.startsWith('channel:')) return chJobs.has(lane.slice(8));
    return true;
  },
  running(lane) { return this.items.find(x => x.status === 'running' && x.lane === lane) || null; },
  add(x) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const it = { id, status: 'queued', createdAt: Date.now(), startedAt: null, finishedAt: null, error: null, result: null, ...x };
    this.items.push(it); this.changed(); setTimeout(() => this.tick(), 50);
    return it;
  },
  // 큐를 거치지 않고 바로 시작한 작업([실행]·[원고 만들기])도 현황판·미니창에 '진행 중'으로 보이게 등록한다. 끝은 onEvent가 마감.
  track(x) {
    if (this.running(x.lane)) return null;
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const it = { id, status: 'running', createdAt: Date.now(), startedAt: Date.now(), finishedAt: null, error: null, result: null, by: 'direct', ...x };
    this.items.push(it); this.changed();
    return it;
  },
  async start(it) {
    it.status = 'running'; it.startedAt = Date.now(); it.error = null; this.changed();
    try {
      const r = await internalPost(it.kind === 'publish' ? '/api/run' : it.kind === 'generate' ? '/api/gen/start' : '/api/engine/publish', it.payload);
      if (r.status >= 400) throw new Error((r.body && r.body.error) || `요청 실패 (${r.status})`);
      if (it.kind === 'channel' && r.body && r.body.result && r.body.result.dryRun !== undefined) this.finish(it, true, r.body.result);
      if (it.kind === 'generate' && r.body && r.body.plan && r.body.plan.keyword) { it.label = it.label.replace(/자동 기획.*$/, `자동 · ${r.body.plan.keyword}`); it.plan = r.body.plan; this.changed(); }
    } catch (e) { this.finish(it, false, null, e.message); }
  },
  finish(it, ok, result, error) {
    if (!it || it.status !== 'running') return;
    it.status = ok ? 'done' : 'failed'; it.finishedAt = Date.now(); it.result = result || null; it.error = error || null;
    this.lastFinished[it.lane] = Date.now();
    this.changed();
    emitRaw('queueitem', this.pub(it));
    setTimeout(() => this.tick(), 1500);
  },
  // 각 작업의 끝 이벤트를 받아 running 항목을 마감
  onEvent(type, data) {
    if (type === 'done') { const it = this.running('publish'); const ok = !!(data && (data.saveStatus ? data.saveStatus === 'SAVE_CONFIRMED' || data.saveStatus === 'MANUAL_PACKAGE_WRITTEN' : data.pass)); if (it) this.finish(it, ok, data, ok ? null : (data && data.saveStatusText) || (data && data.fails && data.fails[0]) || '검사 실패'); }
    else if (type === 'gendone') { const it = this.running('generate'); if (it) this.finish(it, !!(data && data.ok), { dir: data && data.dir, title: data && data.title }, data && data.error); }
    else if (type === 'chdone' && data && data.p) { const it = this.running('channel:' + data.p); if (it) this.finish(it, !data.error, data.result || null, data.error || null); }
    else if (type === 'progress' || type === 'genstep') { const it = this.running(type === 'progress' ? 'publish' : 'generate'); if (it) { it.progress = type === 'progress' ? String(data) : (data && data.name) || ''; this.broadcast(); } }
  },
  tick() {
    if (this.state.paused) return;
    const lanes = [...new Set(this.items.filter(x => x.status === 'queued').map(x => x.lane))];
    for (const lane of lanes) {
      if (this.running(lane) || this.busy(lane)) continue;
      const gap = (this.state.gapMin || 0) * 60000;
      if (lane === 'publish' && gap && this.lastFinished[lane] && Date.now() - this.lastFinished[lane] < gap) continue;
      const next = this.items.find(x => x.status === 'queued' && x.lane === lane);
      if (next) this.start(next);
    }
    // 끝 이벤트를 놓친 running 항목 정리(해당 lane이 10초 넘게 한가하면)
    for (const it of this.items) if (it.status === 'running' && !this.busy(it.lane) && Date.now() - it.startedAt > 10000 && !this._graceful(it)) this.finish(it, false, null, '끝을 확인하지 못했습니다');
  },
  _graceful(it) { return Date.now() - it.startedAt < 20000; },
  remove(id) {
    const it = this.items.find(x => x.id === id);
    if (!it) throw new HttpErr(404, '그 작업이 없습니다');
    if (it.status === 'running') {
      if (it.lane === 'publish' && job && !job.done) job.proc.kill();
      else if (it.lane === 'generate' && genBusy()) { genJob.cancel = true; }
      else throw new Error('채널 발행은 진행 중에 멈출 수 없습니다');
      it.status = 'cancelled'; it.finishedAt = Date.now(); this.changed(); return it;
    }
    this.items = this.items.filter(x => x.id !== id); this.changed(); return it;
  },
  move(id, dir) {
    const i = this.items.findIndex(x => x.id === id);
    if (i < 0 || this.items[i].status !== 'queued') throw new Error('대기 중인 작업만 순서를 바꿀 수 있습니다');
    const same = this.items.map((x, k) => [x, k]).filter(([x]) => x.status === 'queued' && x.lane === this.items[i].lane).map(([, k]) => k);
    const pos = same.indexOf(i), j = same[pos + dir];
    if (j === undefined) return;
    [this.items[i], this.items[j]] = [this.items[j], this.items[i]]; this.changed();
  },
  clear() { this.items = this.items.filter(x => x.status === 'queued' || x.status === 'running'); this.changed(); },
};
setInterval(() => { try { Q.tick(); } catch (e) { console.error('queue tick:', e.message); } }, 3000);
// 서버 켤 때 running 으로 남은 항목은 실패 처리(이전 프로세스가 죽은 것)
for (const it of Q.items) if (it.status === 'running') { it.status = 'failed'; it.error = '앱이 꺼져 중단됨'; it.finishedAt = Date.now(); }
Q.save();
// 자기 자신에게 보내는 내부 요청 (큐 실행용). 토큰은 프로세스마다 새로 만들고 밖에 내보내지 않는다.
function internalPost(pathname, body) {
  return new Promise((resolve) => {
    const data = Buffer.from(JSON.stringify(body || {}));
    const rq = http.request({ host: '127.0.0.1', port: PORT, path: pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, 'X-Bokbok-Internal': INTERNAL_TOKEN, Host: `127.0.0.1:${PORT}` } }, res => {
      let t = ''; res.on('data', d => { t += d; }); res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch { } resolve({ status: res.statusCode, body: j }); });
    });
    rq.on('error', e => resolve({ status: 599, body: { error: e.message } }));
    rq.end(data);
  });
}

// 전용 크롬 프로필 폴더: 계정에 loginId(네이버 로그인 아이디)가 따로 있으면 그 이름, 아니면 블로그 아이디 (naver_post/common.js 와 같은 규칙)
function profileDirOf(blogId) {
  const a = accounts.find(x => x.blogId === blogId) || {};
  const id = a.loginId || blogId;
  const LOCAL = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return id === 'jsrjkb6742' ? path.join(LOCAL, 'naver-blog-profile') : path.join(LOCAL, 'bokbok', 'profiles', id);
}
// 고정 IP(프록시) 목록: 앱에 등록해 두고 블로그 계정마다 하나를 할당한다 (fixed_ips.json, 계정 accounts[].ipId)
//   { id, label, proxy: 'host:port' | 'http://host:port' | 'socks5://127.0.0.1:port', ip: '출구 IPv4' }
//   할당된 계정은 크롬을 그 프록시로 띄우고, 네이버를 열기 전·발행 직전에 출구 IP가 ip와 같은지 확인한다(다르면 중단).
let fixedIps = read('fixed_ips', []);
const IP_MAX_BLOGS = 2;   // 고정 IP 하나에 할당할 수 있는 블로그 수
const ipOwner = me => (me && !me.internal && me.user) ? me.user.email : '';
const myIps = me => fixedIps.filter(x => (me && me.internal) || x.owner === ipOwner(me)).map(x => ({ ...x, used: accounts.filter(a => a.ipId === x.id).map(a => a.blogId) }));
const normProxy = v => { const t = String(v || '').trim(); if (!t) return ''; const m = t.match(/^(?:(https?|socks5):\/\/)?([a-zA-Z0-9.-]{1,100}):(\d{2,5})$/); if (!m || +m[3] > 65535) throw new Error('프록시는 주소:포트 형식이어야 합니다 (예: 1.2.3.4:8080 또는 socks5://127.0.0.1:11001)'); return `${m[1] || 'http'}://${m[2]}:${m[3]}`; };
function netEnvOf(blogId) {
  const a = accounts.find(x => x.blogId === blogId) || {};
  const ip = a.ipId && fixedIps.find(x => x.id === a.ipId);
  if (a.ipId && !ip) return { BLOG_PROXY: '', BLOG_FIXED_IP: 'MISSING' };   // 할당한 IP가 목록에서 지워졌으면 실행을 막는다
  return ip ? { BLOG_PROXY: ip.proxy, BLOG_FIXED_IP: ip.ip } : { BLOG_PROXY: '', BLOG_FIXED_IP: '' };
}
function run(blogId, mf, mode, { direct = false, skipG2 = false, override = null } = {}) {
  if (job && !job.done) throw new Error('이미 실행 중');
  const st = settingsFor(blogId);
  if (direct) { const acc = accounts.find(a => a.blogId === blogId) || {}; Q.track({ lane: 'publish', kind: 'publish', blogId, label: `${acc.name || blogId} · ${path.basename(String(mf || ''))}`, payload: { blogId, file: mf, mode } }); }
  const env = { ...process.env, BLOG_ID: blogId, BLOG_PROFILE: profileDirOf(blogId), ...netEnvOf(blogId), TPM: String(st.tpm), JITTER: String(st.jitter), LINE_PAUSE: String(st.linePause), TAG_PAUSE: String(st.tagPause), REPORT_DIR: path.join(DATA, 'reports'),
    TYPO_N: String(st.typoN ?? 0), THINK_N: String(st.thinkN ?? 0), READ_N: String(st.readN ?? 0), READ_SEC: String(st.readSec ?? 60), CLEAR_CACHE: st.clearCache === false ? '0' : '1', LOGIN_MODE: st.loginMode === 'keep' ? 'keep' : 'fresh' };
  // 실행 방식: save(SAVE=1, 기본) · stop · test(FAST) · manual(INPUT_MODE=MANUAL_EDITOR). PUBLISH 는 절대 넣지 않는다.
  const runEnv = flow.runEnv(env, mode, { skipG2 });
  const proc = spawn(process.execPath, [path.join(TOOL, 'write.js'), mf], { cwd: TOOL, env: runEnv });
  job = { proc, blogId, file: mf, mode, lines: [], progress: '', result: null, read: [], done: false, started: Date.now(), override };
  if (override) { const l = `운영자 예외로 G2 건너뜀(SKIP_G2=1) · 판정 ${override.verdict || '없음'} · 이유: ${override.reason}`; job.lines.push(l); emit('log', l); }
  const onLine = l => {
    if (!l.trim()) return;
    if (l.startsWith('@@진행 ')) { job.progress = l.slice(5); return emit('progress', job.progress); }
    if (l.startsWith('@@결과 ')) { try { job.result = JSON.parse(l.slice(5)); } catch { } return; }
    if (l.startsWith('@@읽음 ')) { try { job.read.push(JSON.parse(l.slice(5))); } catch { } return; }
    job.lines.push(l); emit('log', l);
  };
  let buf = '';
  const feed = d => { buf += d; const p = buf.split(/\r?\n/); buf = p.pop(); p.forEach(onLine); };
  proc.stdout.on('data', feed); proc.stderr.on('data', feed);
  proc.on('close', code => {
    if (buf) onLine(buf);
    job.done = true;
    if (mode === 'save' || mode === 'manual') {
      const sr = flow.readSaveResult(mf, job.started);
      job.result = { ...(job.result || { pass: false, fails: ['결과를 받지 못했습니다'] }), saveStatus: sr ? sr.status : 'RUNNING', saveStatusText: sr ? sr.statusText : '저장 결과 파일(save_result.json)을 찾지 못했습니다', resultFile: sr ? sr.file : null, manualPackage: (sr && sr.manualPackage) || (job.result && job.result.manualPackage) || null };
    }
    const h = read('history', []);
    h.unshift({ at: new Date().toISOString(), blogId, file: mf, mode, code, ...(job.result || {}), ...(job.override ? { override: { reason: job.override.reason, verdict: job.override.verdict, at: job.override.at } } : {}), ...(job.read.length ? { read: job.read } : {}) });
    write('history', h.slice(0, 300));
    delete titleCache[blogId];
    emit('done', job.result || { pass: false, fails: ['중단됨'] });
    emitRaw('pending', { at: Date.now() });
    if (job.read.length) neighborScan(blogId, job.read).catch(e => console.error('이웃 후보 점수:', e.message));
  });
}

// ── 발행 대기 · 발행 감지 ──
const flowMod = require(path.join(__dirname, 'flow.js'));
// 원고 출처 전부(직접 등록 manuscripts.json + 자동 찾기 폴더 + 계정별 원고함 초안). me 가 있으면 그 사람 계정만
function flowFiles(me) {
  const list = me ? visibleAccounts(me) : accounts;
  const out = new Set();
  for (const a of list) for (const m of manuscriptFiles(a.blogId)) out.add(m.path);
  if (!list.length) for (const m of manuscriptFiles(null)) out.add(m.path);
  return [...out];
}
const PUB_POLL_MS = process.env.BOKBOK_PUBLISH_POLL === 'off' ? 0 : Math.max(60000, +process.env.BOKBOK_PUBLISH_POLL_MS || 10 * 60000);
let detectLast = null, detectNext = null, detecting = null;
async function detectPublished(onlyBlog, me) {
  if (detecting) return detecting;
  detecting = (async () => {
    const items = flow.scan(flowFiles(me));
    const ids = [...new Set(items.filter(x => x.state === 'pending' && x.blogId && (!onlyBlog || x.blogId === onlyBlog)).map(x => x.blogId))];
    const results = [];
    for (const id of ids) {
      try { results.push(await flow.detect(id, items)); }
      catch (e) { results.push({ blogId: id, error: '공개 글 목록을 읽지 못했습니다: ' + e.message }); }
    }
    detectLast = { at: new Date().toISOString(), results };
    const found = results.flatMap(r => r.found || []);
    if (found.length) { for (const f of found) delete titleCache[f.blogId]; console.log(`[발행 감지] ${found.map(f => f.blogId + '/' + f.logNo).join(', ')}`); }
    emitRaw('pending', { at: Date.now(), found: found.length });
    return detectLast;
  })().finally(() => { detecting = null; });
  return detecting;
}
if (PUB_POLL_MS) {
  const tick = () => {
    detectNext = Date.now() + PUB_POLL_MS;
    try { if (flow.scan(flowFiles(null)).some(x => x.state === 'pending')) detectPublished(null, null).catch(e => console.error('발행 감지:', e.message)); } catch (e) { console.error('발행 감지:', e.message); }
  };
  setTimeout(tick, 30000);
  setInterval(tick, PUB_POLL_MS);
}
// 임시저장 글 열기: 그 계정 전용 크롬(로그인 유지 방식) 또는 새 시크릿 창(새 창 로그인 방식)에 글쓰기 화면을 연다.
//   글쓰기 화면 상단 [저장] 옆 숫자 → 임시저장 목록에서 글을 골라 사람이 직접 [발행]한다. 크롬을 못 찾으면 기본 브라우저로.
function openDraftWindow(blogId) {
  const url = `https://blog.naver.com/${blogId}?Redirect=Write&`;
  // 고정 IP가 할당된 계정: 프록시·출구 IP 확인을 거치는 open_write.js로만 연다. 실패해도 기본 브라우저로 대신 열지 않는다.
  if ((accounts.find(x => x.blogId === blogId) || {}).ipId) return new Promise(resolve => {
    execFile(process.execPath, [path.join(TOOL, 'open_write.js')], { cwd: TOOL, env: { ...process.env, BLOG_ID: blogId, BLOG_PROFILE: profileDirOf(blogId), ...netEnvOf(blogId), LOGIN_MODE: 'keep' }, timeout: 120000, encoding: 'utf8' }, (e, out) => {
      const m = String(out || '').match(/@@결과 (.+)/); let r = null; try { r = m && JSON.parse(m[1]); } catch { }
      if (r && r.ok) resolve({ ok: true, how: 'chrome', fresh: false, url, message: '고정 IP를 확인하고 이 계정 전용 크롬에 글쓰기 화면을 열었습니다. 상단 [저장] 옆 숫자를 눌러 임시저장 목록에서 이 글을 열고 직접 발행하세요.' });
      else resolve({ ok: false, url, message: '고정 IP 확인에 실패해 창을 열지 않았습니다: ' + ((r && r.error) || (e && e.message) || '알 수 없는 오류') });
    });
  });
  const fresh = settingsFor(blogId).loginMode !== 'keep';
  try {
    const chrome = require(path.join(TOOL, '..', 'chrome.js')).findChrome();
    let dir = profileDirOf(blogId);
    const args = ['--lang=ko-KR', '--no-first-run', '--no-default-browser-check'];
    if (fresh) { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bokbok-fresh-')); args.push('--incognito'); }
    else fs.mkdirSync(dir, { recursive: true });
    spawn(chrome, [`--user-data-dir=${dir}`, ...args, url], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true, how: 'chrome', fresh, url, message: fresh
      ? '새 시크릿 창(전용 임시 프로필)에 글쓰기 화면을 열었습니다. 창에서 직접 로그인한 뒤, 상단 [저장] 옆 숫자를 눌러 임시저장 목록에서 이 글을 열고 직접 발행하세요.'
      : '이 계정 전용 크롬에 글쓰기 화면을 열었습니다. 상단 [저장] 옆 숫자를 눌러 임시저장 목록에서 이 글을 열고 직접 발행하세요.' };
  } catch (e) {
    openPath(url);
    return { ok: true, how: 'browser', url, message: `전용 크롬을 열지 못해(${e.message}) 기본 브라우저로 글쓰기 화면을 열었습니다. 그 계정으로 로그인돼 있어야 임시저장 글이 보입니다.` };
  }
}

// ── 이웃 후보: 발행 뒤 읽은 다른 사람 블로그를 공개 정보로 점수 매겨 쌓는다 ──
//   신청·댓글 같은 행동은 하지 않는다. [이웃 추가 창 열기]는 상대 블로그 화면을 열어 둘 뿐이고 단추는 사람이 누른다.
let neighborMod = null;
try { neighborMod = require(path.join(__dirname, 'insight', 'neighbors.js')); } catch (e) { console.error('이웃 후보 모듈 불러오기 실패:', e.message); }
const neighbors = () => read('neighbors', []);
let nbScanning = false;
async function neighborScan(myId, items) {
  if (!neighborMod || !analyzer || !items.length || nbScanning) return;
  nbScanning = true;
  try {
    for (const it of items) {
      if (!ID_RE.test(it.blogId || '') || accounts.find(a => a.blogId === it.blogId)) continue;
      const had = !!analyzer.get(it.blogId);
      let report = had ? analyzer.get(it.blogId) : null;
      if (!report || Date.now() - (report.fetchedAt || 0) > 6 * 3600000) {
        try { report = await analyzer.analyze({ blogId: it.blogId, pages: 1, settings: insSettings(), log: () => { } }); }
        catch (e) { console.error(`이웃 후보 ${it.blogId} 공개 정보:`, e.message); }
        if (!had) { try { analyzer.remove(it.blogId); } catch { } }   // 블로그 분석 목록에는 남기지 않는다
      }
      const r = neighborMod.score(report, { keywords: [it.keyword], readTitle: it.title });
      const list = neighbors();
      const prev = list.find(x => x.myId === myId && x.blogId === it.blogId);
      const row = {
        id: prev ? prev.id : crypto.randomBytes(6).toString('hex'), myId, blogId: it.blogId, name: r.stats.blogName || it.blogId,
        score: r.score, good: r.good, reasons: r.reasons, stats: r.stats,
        post: { url: it.url, title: it.title, keyword: it.keyword, sec: it.sec },
        reads: (prev ? prev.reads || 0 : 0) + 1, status: prev ? prev.status : 'candidate', at: new Date().toISOString(),
      };
      if (prev) Object.assign(prev, row); else list.unshift(row);
      write('neighbors', list.slice(0, 500));
      emit('neighbor', { myId, blogId: it.blogId, score: r.score, good: r.good });
      await new Promise(r => setTimeout(r, 3000));
    }
  } finally { nbScanning = false; }
}
function neighborOpen(it) {
  return new Promise(resolve => {
    execFile(process.execPath, [path.join(TOOL, 'neighbor.js'), it.blogId], { cwd: TOOL, env: { ...process.env, BLOG_ID: it.myId, BLOG_PROFILE: profileDirOf(it.myId), ...netEnvOf(it.myId) }, timeout: 90000, encoding: 'utf8' }, (e, out, err) => {
      const line = String(out || '').split(/\r?\n/).find(l => l.startsWith('@@결과 '));
      let r = null; try { r = line ? JSON.parse(line.slice(5)) : null; } catch { }
      resolve(r || { target: it.blogId, where: 'error', error: (e && e.message) || String(err || '').trim() || '열지 못함' });
    });
  });
}

// ── 윈도우 기능: 파일 선택 창, 열기 ──────────────────
function pickFiles() {
  const ps = `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.OpenFileDialog; $d.Filter = '원고 (*.txt;*_layout.js)|*.txt;*_layout.js'; $d.Multiselect = $true; $d.InitialDirectory = '${path.join(PROJECT, '원고함').replace(/'/g, "''")}'; $null = $d.ShowDialog(); [Console]::OutputEncoding = [Text.Encoding]::UTF8; $d.FileNames -join "\`n"`;
  return new Promise(res => execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', ps], { encoding: 'utf8' }, (e, out) => res((out || '').split('\n').map(s => s.trim()).filter(Boolean))));
}
// 웹 주소는 cmd를 거치지 않는다(주소의 & 가 cmd 명령 구분자로 잘리는 문제)
const openPath = p => /^https?:///i.test(String(p || ''))
  ? spawn('rundll32.exe', ['url.dll,FileProtocolHandler', String(p)], { detached: true, stdio: 'ignore' }).unref()
  : spawn('cmd.exe', ['/c', 'start', '""', p], { detached: true, stdio: 'ignore' }).unref();

// ── 사용자·세션 ─────────────────────────────────────
const DAY = 86400000;
const COOKIE = 'bb_sid';
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const scrypt = (pw, salt) => new Promise((ok, no) => crypto.scrypt(pw, salt, 64, (e, k) => e ? no(e) : ok(k)));
const normEmail = e => String(e || '').trim().toLowerCase();
const pubUser = u => ({ name: u.name, email: u.email, createdAt: u.createdAt, role: roleOf(u), status: statusOf(u), perms: userPerms(u), canSettings: userCanSettings(u), prefs: { startView: 'home', ...(u.prefs || {}) } });
// ── 권한: 플랫폼별 사용 범위 ──
//   level  none(안 보임) < view(보기만) < write(원고·등록·설정) < publish(발행·크롬 조작)   · 네트워크(net)는 write까지
//   상태   active(사용 중) · pending(가입 승인 대기) · disabled(정지)     · 관리자(role admin)는 전부 허용
const PLATFORMS = [['blog', '네이버 블로그'], ['cafe', '네이버 카페'], ['facebook', '페이스북'], ['instagram', '인스타그램'], ['threads', '쓰레드'], ['reddit', '레딧'], ['twitter', 'X'], ['net', '네트워크(IP 바꾸기)']];
const LEVELS = ['none', 'view', 'write', 'publish'];
const LEVEL_LABEL = { none: '사용 안 함', view: '보기만', write: '원고·등록까지', publish: '발행까지' };
const DEFAULT_PERMS = { blog: 'write', cafe: 'view', facebook: 'view', instagram: 'view', threads: 'view', reddit: 'view', twitter: 'view', net: 'none' };
const lvl = v => Math.max(0, LEVELS.indexOf(v));
function normPerms(p, base = DEFAULT_PERMS) {
  const out = {};
  for (const [k] of PLATFORMS) { let v = p && LEVELS.includes(p[k]) ? p[k] : base[k]; if (k === 'net' && v === 'publish') v = 'write'; out[k] = v; }
  return out;
}
const FULL_PERMS = Object.fromEntries(PLATFORMS.map(([k]) => [k, k === 'net' ? 'write' : 'publish']));
const userPerms = u => roleOf(u) === 'admin' ? FULL_PERMS : normPerms(u && u.perms, adminSettings().defaultPerms);
const userCanSettings = u => roleOf(u) === 'admin' || (u && u.canSettings === true);
const statusOf = u => (u && ['pending', 'disabled'].includes(u.status) ? u.status : 'active');
const STATUS_MSG = { pending: '관리자 승인을 기다리는 계정입니다. 승인되면 로그인할 수 있습니다', disabled: '정지된 계정입니다. 관리자에게 문의하세요' };
// 경로마다 필요한 플랫폼·수준. null = 로그인만 하면 됨
const BLOG_RE = /^\/api\/(state|topics|neighbors|history|gen|insight|accounts|login|pick|unregister|run|stop|settings|flow)(\/|$)/;
const CHAN_RE = /^\/api\/(channels|channel-settings|channel-posts|channel-history|engine)(\/|$)/;
const SETTINGS_API = new Set(['/api/settings', '/api/insight/settings', '/api/gen/settings', '/api/net/settings', '/api/quit', '/api/open']);
function needOf(P, method, u, b) {
  if (/^\/api\/(auth|app|events|admin)(\/|$)/.test(P) || P === '/api/queue' || P === '/api/queue/state') return null;
  if (method === 'POST' && SETTINGS_API.has(P)) return { settings: true };
  if (/^\/api\/net(\/|$)/.test(P)) return { platform: 'net', level: method === 'GET' ? 'view' : 'write' };
  if (CHAN_RE.test(P)) {
    const p = method === 'GET' ? u.searchParams.get('p') : b && b.p;
    if (!CHANNELS.includes(p)) return { any: method === 'GET' ? 'view' : 'write' };
    return { platform: p, level: P === '/api/engine/publish' ? 'publish' : method === 'GET' ? 'view' : 'write' };
  }
  if (P === '/api/queue/add') { const lane = b && String(b.lane || ''); return lane === 'channel' && CHANNELS.includes(b.p) ? { platform: b.p, level: 'publish' } : { platform: 'blog', level: lane === 'generate' ? 'write' : 'publish' }; }
  if (/^\/api\/queue\//.test(P)) return { any: 'write' };
  if (BLOG_RE.test(P)) return { platform: 'blog', level: ['/api/run', '/api/stop', '/api/login', '/api/neighbors/open'].includes(P) ? 'publish' : method === 'GET' ? 'view' : 'write' };
  return { any: 'view' };
}
function checkPerm(me, P, method, u, b) {
  if (!me || me.internal || isAdmin(me)) return;
  const n = needOf(P, method, u, b); if (!n) return;
  const perms = userPerms(me.user);
  if (n.settings) { if (!userCanSettings(me.user)) throw new HttpErr(403, '앱 설정을 바꿀 권한이 없습니다. 관리자에게 요청하세요'); return; }
  if (n.any) { if (!Object.values(perms).some(v => lvl(v) >= lvl(n.any))) throw new HttpErr(403, '이 기능을 쓸 권한이 없습니다. 관리자에게 요청하세요'); return; }
  const have = perms[n.platform] || 'none';
  if (lvl(have) < lvl(n.level)) {
    const label = (PLATFORMS.find(x => x[0] === n.platform) || [])[1] || n.platform;
    throw new HttpErr(403, have === 'none' ? `${label}은(는) 사용 권한이 없습니다. 관리자에게 요청하세요` : `${label} 권한이 '${LEVEL_LABEL[have]}'라서 '${LEVEL_LABEL[n.level]}' 기능은 쓸 수 없습니다. 관리자에게 요청하세요`);
  }
}
// 역할: 'admin'(관리자) | 'user'. 역할이 아무에게도 없으면 가장 먼저 가입한 사람이 관리자(예전 데이터 호환)
const roleOf = u => (u && u.role === 'admin' ? 'admin' : 'user');
const users = () => {
  const list = read('users', []);
  if (list.length && !list.some(x => x.role === 'admin')) {
    const first = [...list].sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))[0];
    first.role = 'admin'; write('users', list);
  }
  return list;
};
const saveUsers = v => write('users', v);
const isAdmin = me => !!(me && me.user && roleOf(me.user) === 'admin');
const adminOnly = me => { if (!isAdmin(me)) throw new HttpErr(403, '관리자만 쓸 수 있습니다'); };
// 관리자 설정: 가입 방식(open 바로 사용 · approve 관리자 승인 뒤 · closed 받지 않음) · 새 가입자 기본 권한
const adminSettings = () => { const s = read('admin_settings', {}); return { signupMode: ['open', 'approve', 'closed'].includes(s.signupMode) ? s.signupMode : 'approve', defaultPerms: normPerms(s.defaultPerms, DEFAULT_PERMS), defaultCanSettings: s.defaultCanSettings === true }; };
const adminUserRow = (u, sess) => ({ name: u.name, email: u.email, role: roleOf(u), status: statusOf(u), perms: userPerms(u), canSettings: userCanSettings(u), createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null, sessions: sess.filter(s => s.email === u.email).length });

// 비밀번호 확인 (사용자 없을 때도 같은 시간 들도록 가짜 해시로 비교)
const DUMMY_SALT = crypto.randomBytes(16).toString('hex');
async function checkPw(u, pw) {
  const k = await scrypt(String(pw || ''), u ? u.salt : DUMMY_SALT);
  const h = Buffer.from(u ? u.hash : '0'.repeat(128), 'hex');
  return h.length === k.length && crypto.timingSafeEqual(h, k) && !!u;
}
async function setPw(u, pw) { u.salt = crypto.randomBytes(16).toString('hex'); u.hash = (await scrypt(pw, u.salt)).toString('hex'); }

// 세션: 토큰 해시만 저장, 만료된 것은 정리
function sessions() {
  const now = Date.now(), all = read('sessions', []), live = all.filter(s => s.exp > now);
  if (live.length !== all.length) write('sessions', live);
  return live;
}
function newSession(res, email, remember) {
  const tok = crypto.randomBytes(32).toString('base64url');
  const s = sessions();
  s.push({ h: sha(tok), email, remember: !!remember, createdAt: new Date().toISOString(), exp: Date.now() + (remember ? 30 * DAY : DAY) });
  write('sessions', s);
  res.setHeader('Set-Cookie', `${COOKIE}=${tok}; HttpOnly; SameSite=Strict; Path=/` + (remember ? `; Max-Age=${30 * 86400}` : ''));
}
const clearCookie = res => res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
function cookieTok(req) {
  for (const p of String(req.headers.cookie || '').split(';')) {
    const i = p.indexOf('='); if (i > 0 && p.slice(0, i).trim() === COOKIE) return p.slice(i + 1).trim();
  }
  return '';
}
// 현재 요청의 세션·사용자 (없으면 null)
function auth(req) {
  const tok = cookieTok(req); if (!tok) return null;
  const h = sha(tok), s = sessions().find(x => x.h === h); if (!s) return null;
  const u = users().find(x => x.email === s.email); if (!u) return null;
  if (statusOf(u) !== 'active') return null;   // 승인 대기·정지 계정은 세션이 있어도 막는다
  return { h, user: u };
}

// 로그인 실패 제한: 10분 안에 5번 틀리면 10분 잠금 (메모리)
const fails = new Map();
const LOCK_MS = 600000;
function lockedMsg(email) {
  const f = fails.get(email);
  if (f && f.lockUntil > Date.now()) return `로그인 시도가 너무 많습니다. ${Math.ceil((f.lockUntil - Date.now()) / 60000)}분 뒤 다시 시도하세요`;
  return '';
}
function addFail(email) {
  const now = Date.now(), f = fails.get(email) || { at: [], lockUntil: 0 };
  f.at = f.at.filter(t => now - t < LOCK_MS); f.at.push(now);
  if (f.at.length >= 5) { f.lockUntil = now + LOCK_MS; f.at = []; }
  fails.set(email, f);
}

// ── 채널 계정·설정 ──────────────────────────────────
const CHANNELS = ['cafe', 'facebook', 'instagram', 'threads', 'reddit', 'twitter'];
const chan = p => { if (!CHANNELS.includes(p)) throw new Error('채널 종류가 올바르지 않습니다'); return p; };

// ── 채널 엔진 (engines\*.js) ────────────────────────
// 저장: engine_config.json {p:{key:값}} (비밀 아닌 엔진 설정 — 화면 설정 channel_settings 와 분리),
//       engine_accounts.json {p:{name,handle,id,connectedAt}}, channel_history.json [최신순],
//       비밀값(토큰·client secret)은 engines\secrets.js → <DATA>\secrets\<p>.<key>.bin (DPAPI)
const ENGINES = {};
for (const p of CHANNELS) {
  const f = path.join(__dirname, 'engines', p + '.js');
  if (!fs.existsSync(f)) continue;   // 엔진 준비 전 채널(페이스북·X)은 계정 메모·설정만
  try { ENGINES[p] = require(f); } catch (e) { console.error(`엔진 불러오기 실패 ${p}: ${e.message}`); }
}
const secrets = require(path.join(__dirname, 'engines', 'secrets.js'));
const { redact } = require(path.join(__dirname, 'engines', 'common.js'));
// 원고 흐름: G2 품질검사 → SAVE 임시저장 → 발행 대기 → 발행 감지 → LOGMETER (flow.js)
const flow = require(path.join(__dirname, 'flow.js')).createFlow({ DATA, quality: require(path.join(__dirname, 'quality')), secrets });
const TOKEN_KEYS = ['accessToken', 'refreshToken', 'tokenExpiresAt'];
const isWarn = m => String(m).startsWith('주의:');
const engineOf = p => { const e = ENGINES[chan(p)]; if (!e) throw new Error('이 채널은 발행 기능을 준비 중입니다'); return e; };
const engineConfig = p => (read('engine_config', {})[p]) || {};
const isOAuth = e => typeof e.authUrl === 'function' && typeof e.authCallback === 'function';
const redirectUri = p => `http://127.0.0.1:${PORT}/oauth/${p}/callback`;
// 연결됨: OAuth 엔진은 토큰 보유, 토큰 붙여넣기 엔진은 필수 항목(비밀 포함)이 모두 있음
function isConnected(p) {
  const e = engineOf(p), cfg = engineConfig(p);
  if (isOAuth(e)) return secrets.hasSecret(p, 'refreshToken') || secrets.hasSecret(p, 'accessToken');
  return e.configFields.filter(f => f.required).every(f => f.secret ? secrets.hasSecret(p, f.key) : !!String(cfg[f.key] || '').trim());
}
function engineCtx(p, state = '') {
  return {
    platform: p, config: { ...engineConfig(p) },
    getSecret: k => secrets.getSecret(p, k),
    setSecret: (k, v) => secrets.setSecret(p, k, v),
    redirectUri: redirectUri(p), state,
    log: line => emit('chlog', { p, line: redact(line) }),
  };
}

// OAuth state: 시작한 세션에 묶고 10분 뒤 만료, 한 번만 사용
const oauthStates = new Map();   // state -> {p, sh, exp}
function newState(p, sh) {
  const now = Date.now();
  for (const [k, v] of oauthStates) if (v.exp < now) oauthStates.delete(k);
  const st = crypto.randomBytes(24).toString('base64url');
  oauthStates.set(st, { p, sh, exp: now + 600000 });
  return st;
}
function takeState(p, st) {
  const v = st && oauthStates.get(String(st));
  if (!v) return null;
  oauthStates.delete(String(st));
  if (v.exp < Date.now() || v.p !== p || !sessions().some(s => s.h === v.sh)) return null;
  return String(st);
}
function oauthPage(res, code, ok, msg) {
  const e = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'Referrer-Policy': 'no-referrer' });
  res.end(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>bokbok</title></head><body style="font:14px 'Pretendard','Malgun Gothic',sans-serif;color:#1F1F1F;background:#F7F7F8;display:flex;align-items:center;justify-content:center;min-height:90vh;margin:0"><div style="background:#fff;border:1px solid #E3E3E3;border-radius:8px;padding:28px 32px;max-width:440px"><p style="margin:0 0 8px;font-weight:700;color:${ok ? '#0F7B6C' : '#D93025'}">${ok ? '연결되었습니다. 이 창을 닫고 앱으로 돌아가세요.' : '연결하지 못했습니다'}</p>${msg ? `<p style="margin:0;color:#6B6B6B;line-height:1.6">${e(msg)}</p>` : ''}</div></body></html>`);
}

// 채널 원고: <PROJECT>\원고함\<p>\*.json
const postsDir = p => path.join(PROJECT, '원고함', chan(p));
function resolvePostFile(p, name) {
  const dir = path.resolve(postsDir(p));
  const n = String(name || '');
  if (!n || n.includes('\0')) throw new Error('원고 파일을 지정하세요');
  const full = path.resolve(dir, n);
  if (path.dirname(full) !== dir || path.extname(full).toLowerCase() !== '.json') throw new Error('원고함 안의 .json 파일만 쓸 수 있습니다');
  let real; try { real = fs.realpathSync(full); } catch { throw new HttpErr(404, '원고 파일이 없습니다'); }
  if (path.dirname(real) !== fs.realpathSync(dir) || !fs.statSync(real).isFile()) throw new Error('원고함 안의 .json 파일만 쓸 수 있습니다');
  return real;
}
function readPost(full) {
  try { const v = JSON.parse(fs.readFileSync(full, 'utf8').replace(/^﻿/, '')); return v && typeof v === 'object' && !Array.isArray(v) ? { post: v } : { error: '원고 형식이 아님 (JSON 객체가 아님)' }; }
  catch (e) { return { error: 'JSON 형식 오류: ' + e.message }; }
}
function checkPost(p, post) {
  const e = engineOf(p);
  let list;
  try { list = e.validate(post, engineConfig(p)) || []; } catch (er) { list = ['검사 오류: ' + er.message]; }
  if (post.platform !== p) list.unshift(`원고의 platform 값(${post.platform || '없음'})이 ${p} 이(가) 아님`);
  return { problems: list.filter(m => !isWarn(m)), warnings: list.filter(isWarn) };
}

// 발행 한도: 엔진 한도와 화면 설정(dailyMax·intervalMin) 중 더 엄격한 값, 성공한 실제 발행만 센다
const chHistory = () => read('channel_history', []);
function quota(p) {
  const lim = engineOf(p).limits || {}, ui = read('channel_settings', {})[p] || {};
  const pos = v => Number.isFinite(+v) && +v > 0 ? +v : null;
  const dailyMax = Math.min(...[pos(lim.dailyMax), pos(ui.dailyMax)].filter(Boolean).concat(Infinity));
  const intervalMin = Math.max(0, ...[pos(lim.minIntervalMin), pos(ui.intervalMin)].filter(Boolean));
  const now = Date.now();
  const done = chHistory().filter(h => h.p === p && h.ok && !h.dryRun);
  const used = done.filter(h => now - Date.parse(h.at) < DAY).length;
  const last = done[0] ? Date.parse(done[0].at) : 0;
  const nextAt = last && intervalMin ? last + intervalMin * 60000 : 0;
  return {
    dailyMax: Number.isFinite(dailyMax) ? dailyMax : null, used, left: Number.isFinite(dailyMax) ? Math.max(0, dailyMax - used) : null,
    intervalMin, lastAt: last ? new Date(last).toISOString() : null, nextAt: nextAt > now ? new Date(nextAt).toISOString() : null,
  };
}
const chJobs = new Map();   // p -> {file, started}

// ── GPT 원고 생성 (gen\*.js, 규격: gen\GEN_SPEC.md) ─────
// 초안 폴더: <PROJECT>\원고함\<blogId>\<YYYYMMDD_HHmm>_<slug>\ (draft.json, 원고.txt, 이미지)
// OpenAI 키: engines\secrets.js ('openai','apiKey', DPAPI) — 화면에는 hasKey만 준다
// 생성 설정: gen_settings.json {model, imageModel, imageQuality}
// 점검 전용: BOKBOK_FAKE_GEN=1 이면 gen\fake_pipeline.js(OpenAI 호출 없음)를 쓴다
const ID_RE = /^[a-zA-Z0-9_-]{3,40}$/;
const OUT_ROOT = path.join(PROJECT, '원고함');
// 참고 이미지: <원고함>\_참고이미지\<blogId>\<파일>  (AI 그림을 비슷한 느낌으로 그릴 때 첨부)
const REF_ROOT = path.join(OUT_ROOT, '_참고이미지');
const PHOTO_ROOT = path.join(OUT_ROOT, '_사진함');     // 내 사진: 글에 그대로 들어갈 사진(블로그마다)
const REF_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const REF_MAX = 8 * 1024 * 1024, REF_PER_BLOG = 20, PHOTO_PER_BLOG = 200;
// hidden: 고정 이미지(히든) — 내 블로그 비공개 글에서 가져온 원장 소개·안내·지도 이미지. <사진함>\<blogId>\_hidden\
const refKind = k => (k === 'photos' ? 'photos' : k === 'hidden' ? 'hidden' : 'refs');
const refLimit = k => (refKind(k) === 'photos' ? PHOTO_PER_BLOG : refKind(k) === 'hidden' ? 30 : REF_PER_BLOG);
const refDir = (blogId, kind) => { if (!ID_RE.test(String(blogId || ''))) throw new Error('블로그 아이디 형식이 아님'); const k = refKind(kind); return k === 'hidden' ? path.join(PHOTO_ROOT, blogId, '_hidden') : path.join(k === 'photos' ? PHOTO_ROOT : REF_ROOT, blogId); };
const hiddenMod = (() => { try { return require(path.join(__dirname, 'gen', 'hidden.js')); } catch (e) { console.error('히든 이미지 모듈 불러오기 실패:', e.message); return null; } })();
// 계정의 히든 목록 중 파일이 실제로 있는 것만, 절대 경로와 함께
function accountHidden(a) {
  if (!hiddenMod || !a || !Array.isArray(a.hidden) || !a.hidden.length) return [];
  const d = refDir(a.blogId, 'hidden');
  return hiddenMod.normalize(a.hidden).map(h => ({ ...h, path: path.join(d, h.file) })).filter(h => fs.existsSync(h.path));
}
// 비공개 글에서 이미지 가져오기: naver_post\hidden.js 를 전용 크롬(로그인된 프로필)으로 돌린다
function fetchHidden(blogId, url) {
  return new Promise((resolve, reject) => {
    const out = refDir(blogId, 'hidden'); fs.mkdirSync(out, { recursive: true });
    const env = { ...process.env, BLOG_ID: blogId, BLOG_PROFILE: profileDirOf(blogId), ...netEnvOf(blogId), URL: url, OUT: out, LOGIN_MODE: 'keep' };
    const proc = spawn(process.execPath, [path.join(TOOL, 'hidden.js')], { cwd: TOOL, env });
    const items = [], lines = []; let err = '', buf = '';
    const onLine = l => {
      if (!l.trim()) return;
      if (l.startsWith('@@이미지 ')) { try { items.push(JSON.parse(l.slice(5))); } catch { } return; }
      if (l.startsWith('@@오류 ')) { err = l.slice(5).trim(); return; }
      if (l.startsWith('@@결과 ')) return;
      lines.push(scrub(l));
    };
    const feed = d => { buf += d; const p = buf.split(/\r?\n/); buf = p.pop(); p.forEach(onLine); };
    proc.stdout.on('data', feed); proc.stderr.on('data', feed);
    const timer = setTimeout(() => { try { proc.kill(); } catch { } reject(new Error('이미지 가져오기가 3분을 넘겨 중단했습니다')); }, 180000);
    proc.on('error', e => { clearTimeout(timer); reject(e); });
    proc.on('close', code => {
      clearTimeout(timer); if (buf) onLine(buf);
      if (err) return reject(new Error(err === '로그인 필요' ? '전용 크롬이 로그인돼 있지 않습니다. [로그인 창 열기]로 먼저 로그인해 주세요' : err));
      if (code && !items.length) return reject(new Error('이미지를 가져오지 못했습니다: ' + (lines.slice(-2).join(' / ') || `종료 코드 ${code}`)));
      resolve({ items, lines });
    });
  });
}
const refName = n => { const s = String(n || ''); if (!s || s.includes('\0') || /[\\/]/.test(s) || !REF_EXT[path.extname(s).toLowerCase()]) throw new Error('참고 이미지 이름이 올바르지 않습니다'); return s; };
function refList(blogId, kind) {
  const d = refDir(blogId, kind);
  let names = []; try { names = fs.readdirSync(d).filter(f => REF_EXT[path.extname(f).toLowerCase()]); } catch { }
  return names.map(f => { const st = fs.statSync(path.join(d, f)); return { name: f, size: st.size, addedAt: st.mtimeMs }; }).sort((a, b) => b.addedAt - a.addedAt);
}
function refSafeName(orig) {
  const ext = path.extname(orig).toLowerCase(), base = path.basename(orig, path.extname(orig)).replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40) || 'ref';
  return `${base}_${Date.now().toString(36)}${ext === '.jpeg' ? '.jpg' : ext}`;
}
function pickImages() {
  const ps = `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.OpenFileDialog; $d.Title = '참고 이미지 고르기'; $d.Filter = '이미지 (*.png;*.jpg;*.jpeg;*.webp)|*.png;*.jpg;*.jpeg;*.webp'; $d.Multiselect = $true; $null = $d.ShowDialog(); [Console]::OutputEncoding = [Text.Encoding]::UTF8; $d.FileNames -join "\`n"`;
  return new Promise(res => execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', ps], { encoding: 'utf8' }, (e, out) => res((out || '').split('\n').map(x => x.trim()).filter(Boolean))));
}
const GEN_DIR = path.join(__dirname, 'gen');
const FAKE_GEN = process.env.BOKBOK_FAKE_GEN === '1';
const GEN_DEFAULTS = { model: 'gpt-5', imageModel: 'gpt-image-1', imageQuality: 'medium' };
const genSettings = () => ({ ...GEN_DEFAULTS, ...read('gen_settings', {}) });
const FALLBACK_STYLES = [
  ['auto', '자동', '주제에 맞게 고름 (직전 글과 다른 것 우선)'],
  ['photo', '실사 사진', '자연광, 실제 장소·사물, 얼굴은 식별되지 않게'],
  ['character', '캐릭터', '둥근 2등신 캐릭터, 파스텔 색'],
  ['flat', '플랫 일러스트', '단순한 도형과 면 색'],
  ['watercolor', '수채화', '번지는 물감 느낌의 그림'],
  ['3d', '3D 렌더', '부드러운 클레이 질감'],
  ['minimal', '미니멀 정물', '여백 많은 배경에 사물 하나'],
];
const FALLBACK_LAYOUTS = [
  ['auto', '자동', '최근 글 3개와 다른 레이아웃 우선'],
  ['classic', '기본형', '인용구 소제목 → 사진 → 본문 반복, 끝에 Q&A 정리'],
  ['qa', '질문형', '소제목이 모두 질문(Q.)으로 이어짐'],
  ['list', '리스트형', '번호 소주제가 연속, 구분선 최소'],
  ['story', '경험담형', '처음 → 과정 → 깨달음 흐름, 소주제 적게'],
  ['compare', '비교형', 'A와 B를 나란히 비교, 비교 카드 포함'],
  ['howto', '방법형', 'STEP 단계별 설명, 순서 카드 포함'],
];
const DECOS = [['off', '안 씀', '기호·체크박스·번호 원 없이 글자와 선만'], ['auto', '적당히', '카드는 템플릿대로, 본문 기호는 가끔'], ['rich', '많이', '체크박스·번호 원·아이콘을 적극 사용']];

// gen 모듈은 필요할 때 불러온다 (없거나 오류여도 서버는 뜬다)
function genModule(name) {
  try { return require(path.join(GEN_DIR, name)); } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND' && String(e.message).includes(path.join(GEN_DIR, name))) return null;
    throw new Error(`원고 생성 모듈(gen\\${name}.js)을 불러오지 못했습니다: ${e.message}`);
  }
}
function pipeline() {
  const p = FAKE_GEN ? genModule('fake_pipeline') : genModule('pipeline');
  if (!p || typeof p.generate !== 'function') throw new HttpErr(503, '원고 생성 모듈(gen\\pipeline.js)이 아직 준비되지 않았습니다');
  return p;
}
// styles.js / layouts.js 의 내보내기 모양이 배열이든 객체든 [{key,label,desc}] 로 맞춘다
function normOptions(mod, names, fallback) {
  let src = null;
  if (mod) for (const n of names) if (mod[n] && typeof mod[n] === 'object') { src = mod[n]; break; }
  if (!src && mod && typeof mod === 'object' && !names.some(n => n in mod)) src = mod;
  const out = [];
  const add = (key, v) => {
    if (!key || typeof key !== 'string' || typeof v === 'function') return;
    const o = typeof v === 'string' ? { desc: v } : (v || {});
    out.push({ key, label: String(o.label || o.name || o.title || key), desc: String(o.desc || o.description || o.summary || o.hint || '') });
  };
  if (Array.isArray(src)) for (const v of src) add(String((v && (v.key || v.id || v.value)) || ''), v);
  else if (src) for (const [k, v] of Object.entries(src)) add(k, v);
  const fb = fallback.map(([key, label, desc]) => ({ key, label, desc }));
  if (!out.length) return fb;
  // 모듈에 설명이 비어 있으면 규격 설명으로 채우고, auto가 없으면 맨 앞에 붙인다
  for (const o of out) { const f = fb.find(x => x.key === o.key); if (f) { if (!o.desc) o.desc = f.desc; if (o.label === o.key) o.label = f.label; } }
  if (!out.find(o => o.key === 'auto')) out.unshift(fb[0]);
  return out;
}
function genOptions() {
  let st = null, ly = null;
  try { st = genModule('styles'); } catch { }
  try { ly = genModule('layouts'); } catch { }
  return {
    styles: normOptions(st, ['STYLES', 'styles', 'list', 'LIST'], FALLBACK_STYLES),
    layouts: normOptions(ly, ['LAYOUTS', 'layouts', 'list', 'LIST'], FALLBACK_LAYOUTS),
    decos: DECOS.map(([key, label, desc]) => ({ key, label, desc })),
    cardTemplates: CARD_TEMPLATES.map(([key, label, desc]) => ({ key, label, desc })),
    imageCount: { min: 2, max: 6, def: 4 }, aiCount: { min: 1, max: 2, def: 1 },
    ...detailOptions(),
    fake: FAKE_GEN,
  };
}
// 원고 세부 옵션(글자 수·말투·키워드 반복·강조·제목·Q&A) — gen\writer.js 정의를 그대로 쓴다
function detailOptions() {
  let w = null; try { w = genModule('writer'); } catch { }
  const list = (obj, fb) => obj ? Object.entries(obj).map(([key, v]) => ({ key, label: v.label, desc: v.desc })) : fb;
  return {
    imageModes: [{ key: 'ai', label: 'AI 그림', desc: '대표 이미지를 AI가 그리고 나머지는 글자 카드' }, { key: 'photos', label: '내 사진', desc: '사진함에서 고른 사진을 넣고 나머지는 글자 카드' }, { key: 'cards', label: '글자 카드만', desc: 'AI 없이 전부 글자 카드 이미지'}, { key: 'clinical', label: '임상 사진 (병원 증례)', desc: '임상 사진을 고른 순서 그대로 글 흐름이 잡히는 증례 글. 카드 없음 · 의료법 검수 · 부작용·주의사항 문단 필수' }],
    clinicalFields: (() => { try { return genModule('clinical').FIELDS; } catch { return []; } })(),
    clinicalFieldsByDept: Object.fromEntries(DEPT.list().map(d => [d.key, d.key === 'dental' ? (() => { try { return genModule('clinical').FIELDS; } catch { return d.fields; } })() : d.fields])),
    clinicalStages: (() => { try { return genModule('clinical').STAGES; } catch { return []; } })(),
    clinicalForms: (() => { try { return Object.values(genModule('clinical').FORMS).map(f => ({ key: f.key, label: f.label, desc: f.desc })); } catch { return [{ key: 'stage', label: '증례 순서형', desc: '' }]; } })(),
    useHiddens: [{ key: 'on', label: '사용', desc: '블로그 계정에 저장한 히든 이미지(원장 소개·안내·지도)를 정해진 자리에 넣습니다' }, { key: 'off', label: '사용 안 함', desc: '이 원고에는 히든 이미지를 넣지 않습니다' }],
    hiddenSlots: hiddenMod ? Object.entries(hiddenMod.SLOTS).map(([key, v]) => ({ key, label: v.label, desc: v.where })) : [],
    charTargets: [700, 1000, 1500, 2000, 2500, 3000], charRange: { min: (w && w.CHAR_MIN) || 500, max: (w && w.CHAR_MAX) || 5000, def: 1000 },
    charBases: [{ key: 'nospace', label: '공백 제외', desc: '네이버 글자 수 세기에서 흔히 쓰는 기준' }, { key: 'space', label: '공백 포함', desc: '띄어쓰기까지 센 글자 수' }],
    tones: list(w && w.TONES, [{ key: 'profile', label: '블로그 성격대로', desc: '' }]),
    kwRepeats: list(w && w.KW_REPEATS, [{ key: 'mid', label: '보통', desc: '본문 3~5번' }]),
    emphases: list(w && w.EMPHASES, [{ key: 'mid', label: '보통', desc: '' }]),
    titleModes: list(w && w.TITLE_MODES, [{ key: 'auto', label: '자동', desc: '' }]),
    qaCounts: [{ key: 'auto', label: '자동 (2~3개)', desc: '정리 섹션 질문·답' }, ...[1, 2, 3, 4, 5].map(n => ({ key: String(n), label: `${n}개`, desc: `정리 섹션에 Q&A ${n}개` })), { key: '0', label: '안 씀', desc: '짧은 요약으로 마무리' }],
  };
}
// 조합·요청에서 세부 옵션만 골라 검사
function cleanDetail(p, name) {
  const o = detailOptions(), has = (l, k) => o[l].some(x => x.key === k);
  const pick = (v, l, d, label) => { const k = v == null || v === '' ? d : String(v); if (!has(l, k)) throw new Error(`${name ? '[' + name + '] ' : ''}${label} 값이 올바르지 않습니다: ${k}`); return k; };
  const tm = pick(p.titleMode, 'titleModes', 'auto', '제목 형태');
  return {
    charTarget: intIn(p.charTarget, o.charRange.min, o.charRange.max, o.charRange.def),
    charBasis: pick(p.charBasis, 'charBases', 'nospace', '글자 수 기준'),
    tone: pick(p.tone, 'tones', 'profile', '말투'),
    kwRepeat: pick(p.kwRepeat, 'kwRepeats', 'mid', '키워드 반복'),
    emphasis: pick(p.emphasis, 'emphases', 'mid', '강조'),
    titleMode: tm,
    qaCount: pick(p.qaCount == null ? 'auto' : p.qaCount, 'qaCounts', 'auto', 'Q&A 개수'),
    imageNotes: cleanText(p.imageNotes, 500, '그림 참고'),
    imageMode: pick(p.imageMode, 'imageModes', 'ai', '이미지 방식'),
    clinicalForm: pick(p.clinicalForm, 'clinicalForms', 'stage', '임상 글 형태'),
    useHidden: pick(p.useHidden, 'useHiddens', 'on', '히든 이미지 사용'),
  };
}
// 키 같은 문자열은 로그·오류에 남기지 않는다
const scrub = s => redact(String(s ?? '')).replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-***');

// 원고함 안의 초안 폴더만 (rel = "blogId/폴더" 또는 절대경로)
function resolveDraftDir(rel) {
  const r = String(rel || '');
  if (!r || r.includes('\0')) throw new Error('초안 폴더를 지정하세요');
  const full = path.resolve(OUT_ROOT, r);
  let real, root;
  try { root = fs.realpathSync(OUT_ROOT); real = fs.realpathSync(full); } catch { throw new HttpErr(404, '초안 폴더가 없습니다'); }
  const blog = path.dirname(real);
  if (path.dirname(blog) !== root || !ID_RE.test(path.basename(blog)) || !fs.statSync(real).isDirectory()) throw new Error('원고함 안의 초안 폴더만 쓸 수 있습니다');
  if (!fs.existsSync(path.join(real, '원고.txt')) && !fs.existsSync(path.join(real, 'draft.json'))) throw new HttpErr(404, '초안 폴더가 아닙니다');
  return { dir: real, blogId: path.basename(blog), name: path.basename(real), rel: `${path.basename(blog)}/${path.basename(real)}` };
}
const IMG_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
function resolveDraftImg(dirRel, name) {
  const d = resolveDraftDir(dirRel), n = String(name || '');
  if (!n || n !== path.basename(n) || !IMG_EXT[path.extname(n).toLowerCase()]) throw new Error('초안 폴더 안의 png/jpg 파일만 볼 수 있습니다');
  let real; try { real = fs.realpathSync(path.join(d.dir, n)); } catch { throw new HttpErr(404, '이미지가 없습니다'); }
  if (path.dirname(real) !== d.dir || !fs.statSync(real).isFile()) throw new Error('초안 폴더 안의 png/jpg 파일만 볼 수 있습니다');
  return real;
}
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch { return null; } };
const imgUrl = (rel, f, v) => `/api/gen/img?dir=${encodeURIComponent(rel)}&file=${encodeURIComponent(f)}&v=${v || 0}`;
function draftImages(d, draft) {
  const list = draft && Array.isArray(draft.images) ? draft.images : null;
  const files = list ? list.map(x => x && x.file).filter(Boolean)
    : (() => { try { return fs.readdirSync(d.dir).filter(f => IMG_EXT[path.extname(f).toLowerCase()]).sort(); } catch { return []; } })();
  return files.map((f, i) => {
    let v = 0; try { v = Math.floor(fs.statSync(path.join(d.dir, f)).mtimeMs); } catch { }
    const meta = list ? list[i] || {} : {};
    return { index: i, file: f, url: imgUrl(d.rel, f, v), exists: !!v, kind: meta.kind || '', prompt: meta.kind === 'ai' ? String(meta.prompt || '') : '', template: meta.template || '', source: meta.source || '', slot: meta.slot || '' };
  });
}
function draftSummary(d, titles, hist) {
  const draft = readJson(path.join(d.dir, 'draft.json')) || {};
  const txtFile = path.join(d.dir, '원고.txt');
  const s = fs.existsSync(txtFile) ? summary(txtFile) : { ok: false, error: '원고.txt 없음' };
  let created = draft.createdAt || null;
  if (!created) try { created = fs.statSync(d.dir).birthtime.toISOString(); } catch { }
  const last = hist.find(h => h.file === txtFile && h.blogId === d.blogId) || null;
  return {
    dir: d.rel, name: d.name, file: txtFile, title: (s.ok && s.title) || draft.title || d.name, ok: !!s.ok, error: s.ok ? '' : s.error,
    layout: draft.layout || '', imageStyle: draft.imageStyle || '', deco: draft.deco || '', keyword: (draft.input && draft.input.keyword) || '',
    images: s.ok ? s.images : (Array.isArray(draft.images) ? draft.images.length : 0), chars: s.chars || 0,
    created, posted: !!(s.ok && titles.includes(s.title)), last,
  };
}
function blogProfile(blogId) {
  const a = accounts.find(x => x.blogId === blogId);
  if (!a) throw new Error('등록된 블로그 계정이 아닙니다');
  return { blogId, blogName: a.name || blogId, persona: a.persona || '', audience: a.audience || '', categories: Array.isArray(a.categories) ? a.categories : [], rules: a.rules || '', color: a.color || '', prompt: a.prompt || '',
    quoteStyle: a.quoteStyle || 'default', lineStyle: a.lineStyle || 'default' };   // 편집기 인용구·구분선 스타일 키(naver_post\styles.js)
}
// 인용구·구분선 스타일 이름표(naver_post\styles.js). 못 불러오면 기본만
const seStyles = (() => { try { return require(path.join(TOOL, 'styles.js')); } catch { return null; } })();
const styleKey = (kind, v) => { if (!seStyles) return 'default'; return kind === 'quote' ? seStyles.quoteKey(v) : seStyles.lineKey(v); };
async function openaiKey(required) {
  const k = secrets.hasSecret('openai', 'apiKey') ? await secrets.getSecret('openai', 'apiKey') : null;
  if (!k && required) throw new Error('OpenAI API 키가 없습니다. [입력 설정] → AI 설정에서 키를 저장하세요');
  return k;
}

// 생성 작업 (한 번에 하나). 취소는 log/step 콜백에서 오류를 던져 파이프라인을 멈춘다
let genJob = null;   // {kind, blogId, keyword, started, steps[], lines[], done, cancel, result, error}
class GenCancel extends Error { constructor() { super('취소했습니다'); this.cancelled = true; } }
const genBusy = () => !!(genJob && !genJob.done);
const genPub = j => j && { kind: j.kind, blogId: j.blogId, keyword: j.keyword, started: j.started, step: j.steps[j.steps.length - 1] || null, steps: j.steps, lines: j.lines.slice(-200), done: j.done, cancel: j.cancel, result: j.result, error: j.error };
function genCallbacks(j) {
  return {
    log: line => {
      if (j.cancel) throw new GenCancel();
      const l = scrub(line); j.lines.push(l); if (j.lines.length > 500) j.lines.shift(); emit('genlog', l);
    },
    step: (name, i, n) => {
      if (j.cancel) throw new GenCancel();
      const s = { name: String(name || ''), i: +i || 0, n: +n || 4 }; j.steps.push(s); emit('genstep', s);
    },
  };
}
function cleanText(v, max, label, multiline = true) {
  const s = String(v ?? '').replace(/\r/g, '').trim();
  if (s.length > max) throw new Error(`${label}은(는) ${max}자 이하로 입력하세요`);
  if (s.includes('\0') || (!multiline && /\n/.test(s))) throw new Error(`${label}에 쓸 수 없는 글자가 있습니다`);
  return s;
}
const CARD_TEMPLATES = [['points', '핵심 정리', '번호 붙은 핵심 3~5개'], ['compare', '비교', '두 가지를 나란히'], ['checklist', '체크리스트', '확인 항목 3~6개'], ['steps', '순서', '단계별 방법']];
// 템플릿 조합(계정별 presets) 한 개 검사
function cleanPreset(p, opts) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('조합 형식이 올바르지 않습니다');
  const name = cleanText(p.name, 30, '조합 이름', false);
  if (!name || name === '__rotate__') throw new Error('조합 이름을 입력하세요 (1~30자)');
  const pick = (v, list, label) => { const k = String(v || 'auto'); if (!list.some(o => o.key === k)) throw new Error(`[${name}] ${label} 값이 올바르지 않습니다: ${k}`); return k; };
  const imageCount = intIn(p.imageCount, 2, 6, 4);
  const cards = Array.isArray(p.cardTemplates) ? [...new Set(p.cardTemplates.map(String))] : CARD_TEMPLATES.map(c => c[0]);
  for (const c of cards) if (!CARD_TEMPLATES.some(x => x[0] === c)) throw new Error(`[${name}] 카드 종류 값이 올바르지 않습니다: ${c}`);
  if (!cards.length) throw new Error(`[${name}] 카드 종류를 하나 이상 고르세요`);
  const d = cleanDetail(p, name); if (d.titleMode === 'fixed') d.titleMode = 'auto';   // 조합에는 '직접 입력 제목'을 담지 않는다
  const aiCount = d.imageMode === 'cards' ? 0 : d.imageMode === 'photos' ? Math.min(imageCount, intIn(p.aiCount, 1, 6, 1)) : Math.min(imageCount, intIn(p.aiCount, 1, 2, 1));
  const note = cleanText(p.note, 160, '조합 메모', false);   // 자동 구성 이유(화면 표시용)
  return {
    name, layout: pick(p.layout, opts.layouts, '레이아웃'), imageStyle: pick(p.imageStyle, opts.styles, '이미지 스타일'),
    imageCount, aiCount, deco: pick(p.deco, opts.decos, '장식'), cardTemplates: cards, ...d, ...(note ? { note } : {}),
  };
}
// 기본 글 형태 템플릿 3개 자동 구성(gen\templates.js): 재료 = 이 블로그 글 제목·잘 된 글(노출 10위 안·반응 상위)·평균 사진 수·지난 초안 방식
function suggestPresets(blogId) {
  const T = genModule('templates');
  const profile = blogProfile(blogId);
  let titles = [], winners = [], avgImages = null, history = [], photosAvailable = false;
  try {
    const postsDb = insStore ? insStore.load(blogId, 'posts', { posts: {} }) : { posts: {} };
    const list = Object.values(postsDb.posts || {}).filter(p => p && p.title).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    titles = list.map(p => p.title);
    const ranksDb = insStore ? insStore.load(blogId, 'ranks', { keywords: {} }) : { keywords: {} };
    const top = new Set();
    for (const k of Object.values(ranksDb.keywords || {})) {
      const dates = Object.keys(k.history || {}).sort(); const h = dates.length ? k.history[dates[dates.length - 1]] : null;
      if (h && h.status === 'EXPOSED' && typeof h.rank === 'number' && h.rank <= 10) top.add(k.logNo);
    }
    const eng = p => { const ds = Object.keys(p.history || {}).sort(); const h = ds.length ? p.history[ds[ds.length - 1]] : {}; return (h.s || 0) + (h.c || 0); };
    const byEng = list.filter(p => eng(p) > 0).sort((a, b) => eng(b) - eng(a)).slice(0, 5);
    winners = [...new Set([...list.filter(p => top.has(p.logNo)), ...byEng].map(p => p.title))];
    const imgs = list.map(p => p.images).filter(n => typeof n === 'number' && n > 0);
    if (imgs.length) avgImages = imgs.reduce((s, n) => s + n, 0) / imgs.length;
  } catch { }
  try { const rep = analyzer ? analyzer.get(blogId) : null; if (rep) { if (!titles.length) titles = (rep.recent || []).map(p => p.title).filter(Boolean); if (avgImages == null && rep.content && rep.content.avgImages) avgImages = rep.content.avgImages; if (!winners.length && rep.engagement) winners = (rep.engagement.top || []).slice(0, 5).map(p => p.title).filter(Boolean); } } catch { }
  try {
    const base = path.join(OUT_ROOT, blogId);
    for (const n of fs.readdirSync(base, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)) { const d = readJson(path.join(base, n, 'draft.json')); if (d) history.push({ imageMode: d.imageMode || (d.input && d.input.imageMode) || '', layout: d.layout || '' }); }
  } catch { }
  try { photosAvailable = refList(blogId, 'photos').length > 0; } catch { }
  const r = T.suggest({ profile, titles, winners, avgImages, history, photosAvailable });
  const opts = genOptions();
  return { kind: r.kind, reasons: r.reasons, presets: r.presets.map(p => cleanPreset(p, opts)), data: { titles: titles.length, winners: winners.length, avgImages: avgImages == null ? null : Math.round(avgImages * 10) / 10, drafts: history.length } };
}
// 자동 구성 결과를 계정에 넣는다: 예전 "기본 N · " 조합은 바꾸고, 사용자가 직접 저장한 조합은 그대로 둔다
function applyDefaultPresets(a, s) {
  const mine = (Array.isArray(a.presets) ? a.presets : []).filter(p => !/^기본 \d · /.test(p.name));
  a.presets = [...s.presets, ...mine].slice(0, 20);
  write('accounts', accounts);
  return a.presets;
}
// 돌아가며 사용: 이 계정 초안(draft.json preset)에서 가장 오래 안 쓴 조합
function rotatePreset(blogId, presets) {
  const lastUse = {};
  const base = path.join(OUT_ROOT, blogId);
  let names = []; try { names = fs.readdirSync(base, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { }
  for (const n of names) {
    const d = readJson(path.join(base, n, 'draft.json'));
    const pn = d && (d.preset || (d.input && d.input.preset));
    if (!pn) continue;
    const t = Date.parse(d.createdAt) || 0;
    if (!(pn in lastUse) || lastUse[pn] < t) lastUse[pn] = t;
  }
  return presets.map((p, i) => ({ p, i, t: lastUse[p.name] ?? -1 })).sort((a, b) => a.t - b.t || a.i - b.i)[0].p;
}
const intIn = (v, lo, hi, d) => { const n = Number.isFinite(+v) && v !== '' && v != null ? Math.round(+v) : d; return Math.min(hi, Math.max(lo, n)); };

// ── 블로그 육성 데이터 (insight\, 규격: insight\METRICS.md) ─────
// 비밀 아닌 수집 설정: insight_settings.json {strictRobots, serp, serpTotal, maxExposureChecks, ownerStats}
// 비밀값(검색 API·검색광고 키): engines\secrets.js platform 'insight' (화면에는 hasValue만)
// 데이터: <DATA>\insight\<blogId>\ (엔진이 BOKBOK_DATA를 따른다)
// 자동 수집: 서버가 켜져 있는 동안 30분마다 계정을 하나씩 차례로, due()가 고른 종류만
let insight = null;
try { insight = require(path.join(__dirname, 'insight', 'index.js')); } catch (e) { console.error('insight 엔진 불러오기 실패:', e.message); }
const insStore = (() => { try { return require(path.join(__dirname, 'insight', 'lib', 'store.js')); } catch { return null; } })();
const insKw = (() => { try { return require(path.join(__dirname, 'insight', 'lib', 'keyword.js')); } catch { return null; } })();
const INS_TICK = Math.max(60000, +process.env.BOKBOK_INSIGHT_TICK_MS || 30 * 60000);
const INS_FIRST = Math.max(5000, +process.env.BOKBOK_INSIGHT_FIRST_MS || 120000);   // 서버 켠 뒤 첫 확인
const INS_SCHED = process.env.BOKBOK_INSIGHT_SCHED !== 'off';
let analyzer = null;
try { analyzer = require(path.join(__dirname, 'insight', 'analyze.js')); } catch (e) { console.error('블로그 분석 모듈 불러오기 실패:', e.message); }
const anaMod = () => { if (!analyzer) throw new HttpErr(503, '블로그 분석 모듈을 불러오지 못했습니다'); return analyzer; };
let anaJob = null;   // 한 번에 1건: { blogId, started, lines, done, error }
const insEngine = () => { if (!insight) throw new HttpErr(503, '블로그 데이터 엔진(insight)을 불러오지 못했습니다'); return insight; };
const insFields = () => insEngine().configFields;
function insSettings() {
  const saved = read('insight_settings', {}), out = {};
  for (const f of insight ? insight.configFields : []) if (!f.secret) out[f.key] = saved[f.key] !== undefined ? saved[f.key] : f.default;
  return out;
}
function insBlog(v) {
  const blogId = String(v || '');
  if (!ID_RE.test(blogId)) throw new Error('블로그 아이디 형식이 아님');
  if (!accounts.find(a => a.blogId === blogId)) throw new HttpErr(404, '등록된 블로그 계정이 아닙니다');
  return blogId;
}
const hasAll = keys => keys.every(k => secrets.hasSecret('insight', k));
// 지금 설정으로 실제로 모을 수 있는 종류 (키 없는 종류는 자동 수집에서 뺀다 — 헛돌기 방지)
function insEnabled(st = insSettings()) {
  return {
    blog: true,
    exposure: hasAll(['search_hub_id', 'search_hub_key']) || hasAll(['search_dev_id', 'search_dev_secret']) || !!st.serp,
    keywords: hasAll(['searchad_customer_id', 'searchad_access_license', 'searchad_secret_key']),
    owner: !!st.ownerStats,
  };
}
const insJobs = new Map();   // blogId -> {kinds, started, lines[], by:'manual'|'auto'}
const insLast = new Map();   // blogId -> 마지막 결과 {at, ok, ran, skipped, errors, by}
let insTickAt = INS_SCHED ? Date.now() + INS_FIRST : null, insTicking = false;
const blogBusy = blogId => !!(job && !job.done && job.blogId === blogId);   // 발행 중이면 크롬 프로필 사용 중

function insCollect(blogId, kinds, by) {
  if (insJobs.has(blogId)) throw new HttpErr(409, '이미 이 블로그 데이터를 모으는 중입니다');
  const st = insSettings();
  const en = insEnabled(st);
  let want = (kinds && kinds.length ? kinds : insight.KINDS).filter(k => insight.KINDS.includes(k) && en[k]);
  const notes = [];
  if (want.includes('owner') && blogBusy(blogId)) { want = want.filter(k => k !== 'owner'); notes.push('블로그 발행 중이라 주인 통계는 건너뜀(크롬 프로필 사용 중)'); }
  if (!want.length) throw new Error('지금 모을 수 있는 항목이 없습니다. [데이터 설정]에서 키나 옵션을 확인하세요');
  const j = { kinds: want, started: Date.now(), lines: [], by };
  insJobs.set(blogId, j);
  const log = line => {
    const l = scrub(line);
    j.lines.push(l); if (j.lines.length > 300) j.lines.shift();
    emit('inslog', { blogId, line: l });
  };
  log(`${by === 'auto' ? '자동' : '수동'} 수집 시작: ${want.join(', ')}`);
  notes.forEach(log);
  const p = (async () => {
    let r;
    try {
      r = await insight.collect({ blogId, kinds: want, settings: st, log });
      for (const s of r.skipped || []) log(`건너뜀 ${s.kind}: ${s.reason}`);
      for (const e of r.errors || []) log(`오류 ${e.kind || ''}: ${e.message}`);
      log(r.ok ? `완료 (${(r.ran || []).join(', ') || '없음'})` : `일부 실패 (${(r.ran || []).join(', ') || '없음'} 완료)`);
    } catch (e) {
      r = { ok: false, ran: [], skipped: [], errors: [{ message: scrub(e.message) }] };
      log('실패: ' + scrub(e.message));
    }
    const res = { at: Date.now(), ok: !!r.ok, ran: r.ran || [], skipped: r.skipped || [], errors: (r.errors || []).map(e => ({ kind: e.kind || '', message: scrub(e.message) })), by };
    insLast.set(blogId, res);
    insJobs.delete(blogId);
    emit('insdone', { blogId, ...res });
    return res;
  })();
  return { job: j, done: p };
}

// 자동 수집: 30분마다. 계정은 하나씩 차례로(동시에 두 블로그를 모으지 않음)
async function insTick() {
  insTickAt = Date.now() + INS_TICK;
  if (!insight || insTicking) return;
  insTicking = true;
  try {
    const st = insSettings(), en = insEnabled(st);
    for (const a of accounts.slice()) {
      if (!ID_RE.test(a.blogId) || insJobs.has(a.blogId)) continue;
      let d; try { d = insight.due(a.blogId, st); } catch { continue; }
      let kinds = (d.kinds || []).filter(k => en[k]);
      if (kinds.includes('owner') && blogBusy(a.blogId)) kinds = kinds.filter(k => k !== 'owner');   // 다음 차례에 다시
      if (!kinds.length) continue;
      try { await insCollect(a.blogId, kinds, 'auto').done; } catch (e) { console.error('자동 수집 실패', a.blogId, e.message); }
    }
  } finally { insTicking = false; }
}
if (INS_SCHED && insight) {
  setTimeout(() => { insTick(); setInterval(insTick, INS_TICK).unref(); }, INS_FIRST).unref();
}
// 다음 자동 수집 예정: 켜진 종류 중 하나라도 due가 되는 첫 차례
function insNext(blogId, st, en) {
  if (!INS_SCHED || !insTickAt) return null;
  for (let i = 0, t = insTickAt; i < 120; i++, t += INS_TICK) {
    let d; try { d = insight.due(blogId, st, t); } catch { return null; }
    if ((d.kinds || []).some(k => en[k])) return t;
  }
  return null;
}

// 대시보드 응답 보강: 글별 발행 시각·태그·주소·타깃 키워드·순위/반응 이력, 수집 상태
async function insDashboard(blogId) {
  const ins = insEngine(), st = insSettings(), en = insEnabled(st);
  const d = await ins.dashboard(blogId, { settings: st });
  const cfg = ins.getConfig(blogId);
  const postsDb = insStore ? insStore.load(blogId, 'posts', { posts: {} }) : { posts: {} };
  const ranksDb = insStore ? insStore.load(blogId, 'ranks', { keywords: {} }) : { keywords: {} };
  const state = insStore ? insStore.load(blogId, 'state', {}) : {};
  const cut = Date.now() - 120 * DAY;
  const rankBy = {};
  for (const k of Object.values(ranksDb.keywords || {})) {
    if (!k.logNo) continue;
    for (const [date, h] of Object.entries(k.history || {})) {
      if (Date.parse(date) < cut) continue;
      const m = rankBy[k.logNo] = rankBy[k.logNo] || {};
      const cur = m[date];
      if (!cur || (h.rank ?? 999) < (cur.rank ?? 999)) m[date] = { date, rank: h.rank ?? null, status: h.status, keyword: k.keyword };
    }
  }
  const posts = ((d.tables && d.tables.posts) || []).map(r => {
    const p = postsDb.posts[r.logNo] || {};
    const hist = Object.entries(p.history || {}).filter(([dt]) => Date.parse(dt) >= cut).sort().map(([date, h]) => ({ date, s: h.s ?? null, c: h.c ?? null }));
    return {
      ...r, addedAt: p.addedAt || null, tags: p.tags || [], searchYn: p.searchYn !== false, open: p.open !== false,
      url: `https://blog.naver.com/${blogId}/${r.logNo}`,
      targetKeywords: (cfg.keywords && cfg.keywords[r.logNo]) || null,
      autoKeyword: insKw ? insKw.primaryKeyword(r.title) : null,
      rankHist: Object.values(rankBy[r.logNo] || {}).sort((a, b) => a.date.localeCompare(b.date)),
      hist,
    };
  });
  const a = accounts.find(x => x.blogId === blogId) || {};
  const j = insJobs.get(blogId);
  return {
    ...d, tables: { ...d.tables, posts },
    account: { name: a.name || blogId, blogId },
    config: { keywords: cfg.keywords || {}, extraKeywords: cfg.extraKeywords || [], goals: cfg.goals || {}, adpost: cfg.adpost || {} },
    collect: {
      enabled: en, state, settings: st,
      running: j ? { kinds: j.kinds, started: j.started, by: j.by, lines: j.lines.slice(-200) } : null,
      last: insLast.get(blogId) || null,
      sched: INS_SCHED, tickMin: Math.round(INS_TICK / 60000), nextTickAt: insTickAt, nextAt: insNext(blogId, st, en),
      publishing: blogBusy(blogId),
    },
  };
}
function cleanNum(v, lo, hi, label) {
  if (v === '' || v == null) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`${label}은(는) ${lo}~${hi} 사이 숫자로 입력하세요`);
  return Math.round(n);
}

// ── HTTP ───────────────────────────────────────────
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const MAX_BODY = 1 << 20;
const body = req => new Promise(r => {
  const parts = []; let n = 0;
  req.on('data', d => { n += d.length; if (n <= MAX_BODY) parts.push(d); });
  req.on('end', () => { try { r(n > MAX_BODY ? {} : JSON.parse(Buffer.concat(parts).toString('utf8') || '{}') || {}); } catch { r({}); } });
});
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
class HttpErr extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const MIME = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml; charset=utf-8', '.png': 'image/png' };

// 정적 파일: static 폴더 안, 허용 확장자만
function serveStatic(res, rel) {
  let name; try { name = decodeURIComponent(rel); } catch { return send(res, 400, { error: '잘못된 경로입니다' }); }
  const full = path.resolve(STATIC, name), type = MIME[path.extname(full).toLowerCase()];
  if (!full.startsWith(STATIC + path.sep) || !type || name.includes('\0')) return send(res, 404, { error: '파일이 없습니다' });
  let data; try { if (!fs.statSync(full).isFile()) throw 0; data = fs.readFileSync(full); } catch { return send(res, 404, { error: '파일이 없습니다' }); }
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' }); res.end(data);
}

const OPEN_API = new Set(['/api/auth/me', '/api/auth/signup', '/api/auth/login', '/api/auth/logout']);

http.createServer(async (req, res) => {
  // 이 PC 주소로 들어온 요청만 받는다
  if (!HOSTS.has(String(req.headers.host || '').toLowerCase())) return send(res, 403, { error: '허용되지 않은 접속입니다' });
  const u = new URL(req.url, 'http://x'), P = u.pathname;
  try {
    // 정적 (세션 불필요)
    if (req.method === 'GET' && P === '/') {
      let html; try { html = fs.readFileSync(path.join(__dirname, 'ui.html')); } catch { return send(res, 404, { error: '화면 파일이 없습니다' }); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); return res.end(html);
    }
    if (req.method === 'GET' && P.startsWith('/static/')) return serveStatic(res, P.slice(8));
    // OAuth 돌아오는 주소 (시스템 브라우저 → 쿠키 없음). 대신 연결을 시작한 세션에 묶인 state로 확인
    const om = /^\/oauth\/([a-z]+)\/callback$/.exec(P);
    if (req.method === 'GET' && om && CHANNELS.includes(om[1])) {
      const p = om[1], q = Object.fromEntries(u.searchParams);
      const st = takeState(p, q.state);
      if (!st) return oauthPage(res, 400, false, '연결 요청을 확인할 수 없습니다(만료되었거나 다른 곳에서 시작됨). 앱에서 [연결하기]를 다시 눌러 주세요.');
      try {
        const e = engineOf(p);
        if (!isOAuth(e)) throw new Error('이 채널은 브라우저 연결을 쓰지 않습니다');
        const r = await e.authCallback(engineCtx(p, st), q);
        const acc = (r && r.account) || {};
        const all = read('engine_accounts', {});
        all[p] = { name: String(acc.name || ''), handle: String(acc.handle || ''), id: String(acc.id || ''), connectedAt: new Date().toISOString() };
        write('engine_accounts', all);
        emit('chconnected', { p });
        return oauthPage(res, 200, true, all[p].name ? `계정: ${all[p].name}` : '');
      } catch (e) {
        return oauthPage(res, 400, false, redact(e.message));
      }
    }
    if (P !== '/api/events' && !P.startsWith('/api/')) return send(res, 404, { error: '없는 경로입니다' });

    // 세션 확인 (인증 경로 제외)
    const internal = req.headers['x-bokbok-internal'] === INTERNAL_TOKEN && /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress || '');
    const me = internal ? { user: { name: 'queue', email: 'queue@local', createdAt: 0, prefs: {} }, internal: true } : auth(req);
    if (!OPEN_API.has(P) && !me) return send(res, 401, { error: '로그인이 필요합니다' });
    if (req.method === 'GET') { checkPerm(me, P, 'GET', u, null); ensureOwners(); checkOwner(me, u.searchParams.get('blogId'), P); }

    // 실시간 로그
    if (P === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': ok\n\n'); clients.add(res); req.on('close', () => clients.delete(res));
      return;
    }

    // ── GET ──
    if (req.method === 'GET') {
      if (P === '/api/auth/me') return me ? send(res, 200, { user: pubUser(me.user) }) : send(res, 401, { error: '로그인이 필요합니다' });
      if (P === '/api/app') return send(res, 200, { version: VERSION, dataDir: DATA, port: PORT, project: PROJECT });
      if (P === '/api/admin/accounts') {
        adminOnly(me);
        return send(res, 200, { accounts: accounts.map(a => ({ name: a.name || a.blogId, blogId: a.blogId, owner: a.owner || '' })), users: users().map(x => ({ email: x.email, name: x.name, role: roleOf(x) })) });
      }
      if (P === '/api/admin/users') {
        adminOnly(me);
        const sess = sessions();
        return send(res, 200, { users: users().map(u => adminUserRow(u, sess)).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))), settings: adminSettings(), me: me.user.email,
          platforms: PLATFORMS.map(([key, label]) => ({ key, label, levels: (key === 'net' ? LEVELS.slice(0, 3) : LEVELS).map(l => ({ key: l, label: LEVEL_LABEL[l] })) })) });
      }
      if (P === '/api/net') return send(res, 200, tether ? await netStatus(u.searchParams.get('refresh') === '1') : await publicIp(u.searchParams.get('refresh') === '1'));
      if (P === '/api/net/job') return send(res, 200, { job: netJob });
      if (P === '/api/medical/depts') return send(res, 200, { depts: DEPT.list() });
      if (P === '/api/queue') return send(res, 200, { items: Q.items.map(x => Q.pub(x)), summary: Q.summary(), state: Q.state });
      if (P === '/api/state') {
        const mine = visibleAccounts(me);
        const blogId = u.searchParams.get('blogId') || mine[0]?.blogId;
        const titles = blogId ? await blogTitles(blogId) : [];
        const hist = read('history', []);
        const ms = manuscriptFiles(blogId).map(m => {
          const s = summary(m.path);
          const last = hist.find(h => h.file === m.path && h.blogId === blogId);
          let reviewed = null, auto = false;
          if (m.draft) { const dj = readJson(path.join(path.dirname(m.path), 'draft.json')); if (dj) { reviewed = dj.reviewed || null; auto = !!(dj.input && dj.input.auto); } }
          const sr = readJson(path.join(path.dirname(m.path), 'save_result.json'));
          const save = sr && (!sr.manuscript || path.resolve(sr.manuscript).toLowerCase() === path.resolve(m.path).toLowerCase()) ? { status: sr.status, statusText: flowMod.STATUS_KO[sr.status] || sr.status, savedAt: sr.savedAt || null } : null;
          return { ...s, registered: m.registered, draft: m.draft, posted: !!(s.ok && titles.includes(s.title)), last, reviewed, auto, g2: flow.g2Status(m.path), save };
        });
        return send(res, 200, { accounts: mine, settings: blogId ? settingsFor(blogId) : settings(), defaults: settings(), blogSettings: Object.fromEntries(mine.map(a => [a.blogId, settingsFor(a.blogId)])), fixedIps: myIps(me), ipMaxBlogs: IP_MAX_BLOGS, manuscripts: ms, job: job && { blogId: job.blogId, file: job.file, mode: job.mode, progress: job.progress, done: job.done, result: job.result, lines: job.lines.slice(-200) } });
      }
      if (P === '/api/topics') {
        // 주제 조회: 이 계정의 발행 데이터로 "지금 이 주제를 써도 되나" 판정 + 축별 상태 (외부·AI 호출 없음)
        const blogId = insBlog(u.searchParams.get('blogId'));
        const advisor = require(path.join(__dirname, 'insight', 'advisor.js'));
        let posts = [], recs = [], generatedAt = null, note = '';
        try { const d = await insDashboard(blogId); posts = (d.tables && d.tables.posts) || []; recs = d.recommendations || []; generatedAt = d.generatedAt; }
        catch (e) { note = '대시보드 데이터가 아직 없습니다. [대시보드] → [지금 수집]을 한 번 눌러 주세요 (' + e.message + ')'; }
        const q = String(u.searchParams.get('q') || '').trim();
        const advice = q ? advisor.advise({ topic: q, posts, recs }) : null;
        return send(res, 200, { blogId, posts: posts.length, generatedAt, note, advice, overview: advisor.overview({ posts, recs }), axes: advisor.axes({ posts }) });
      }
      if (P === '/api/neighbors') {
        const my = u.searchParams.get('blogId') || '', all = u.searchParams.get('all') === '1';
        const mine = neighbors().filter(x => !my || x.myId === my);
        return send(res, 200, { items: all ? mine : mine.filter(x => x.status === 'candidate'), total: mine.length, scanning: nbScanning });
      }
      // ── 원고 흐름 (flow.js) ──
      if (P === '/api/flow/pending') {
        const items = flow.scan(flowFiles(me));
        return send(res, 200, { items, lastCheck: detectLast, pollMin: PUB_POLL_MS ? Math.round(PUB_POLL_MS / 60000) : 0, nextCheckAt: detectNext });
      }
      if (P === '/api/flow/lm/status') return send(res, 200, await flow.lmHealth());
      if (P === '/api/flow/lm/recs') {
        const blogId = String(u.searchParams.get('blogId') || ''); if (!ID_RE.test(blogId)) throw new Error('블로그 아이디 형식이 아님');
        return send(res, 200, await flow.recommendations(blogId, { limit: intIn(u.searchParams.get('limit'), 1, 10, 10), refresh: u.searchParams.get('refresh') === '1' }));
      }
      if (P === '/api/flow/formplan') {
        const blogId = String(u.searchParams.get('blogId') || ''); if (!ID_RE.test(blogId)) throw new Error('블로그 아이디 형식이 아님');
        return send(res, 200, await formPlanFor(blogId, intIn(u.searchParams.get('n'), 2, 10, 5)));
      }
      if (P === '/api/flow/override-log') return send(res, 200, { items: read('override_log', []).slice(0, 100) });
      if (P === '/api/history') {
        const blogId = u.searchParams.get('blogId');
        const h = read('history', []);   // 이미 최신순으로 쌓임
        return send(res, 200, { items: blogId ? h.filter(x => x.blogId === blogId) : h });
      }
      if (P === '/api/channels') { const p = chan(u.searchParams.get('p')); return send(res, 200, { items: read('channels', {})[p] || [] }); }
      if (P === '/api/channel-settings') { const p = chan(u.searchParams.get('p')); return send(res, 200, { settings: read('channel_settings', {})[p] || {} }); }
      // ── 채널 엔진 ──
      if (P === '/api/engine/info') {
        const p = chan(u.searchParams.get('p')), e = engineOf(p), cfg = engineConfig(p);
        const fields = e.configFields.map(f => f.secret
          ? { key: f.key, label: f.label, secret: true, required: !!f.required, hint: f.hint || '', hasValue: secrets.hasSecret(p, f.key) }
          : { key: f.key, label: f.label, secret: false, required: !!f.required, hint: f.hint || '' });
        const config = {}; for (const f of e.configFields) if (!f.secret && cfg[f.key] != null) config[f.key] = cfg[f.key];
        return send(res, 200, { p, label: e.label, configFields: fields, config, limits: e.limits, oauth: isOAuth(e), redirectUri: redirectUri(p), connected: isConnected(p), account: read('engine_accounts', {})[p] || null, quota: quota(p), busy: chJobs.has(p) });
      }
      if (P === '/api/channel-posts') {
        const p = chan(u.searchParams.get('p')), dir = postsDir(p), hist = chHistory();
        let names = []; try { names = fs.readdirSync(dir).filter(f => /\.json$/i.test(f)); } catch { }
        const items = names.map(f => {
          const full = path.join(dir, f), r = readPost(full);
          let mtime = null; try { mtime = fs.statSync(full).mtime.toISOString(); } catch { }
          const lastResult = hist.find(h => h.p === p && h.file === f && !h.dryRun) || null;
          if (r.error) return { file: f, title: '', platform: '', images: 0, imageUrls: 0, problems: [r.error], warnings: [], lastResult, mtime };
          const post = r.post, c = checkPost(p, post);
          return { file: f, title: String(post.title || ''), platform: String(post.platform || ''), images: Array.isArray(post.images) ? post.images.length : 0, imageUrls: Array.isArray(post.imageUrls) ? post.imageUrls.length : 0, ...c, lastResult, mtime };
        }).sort((a, b) => String(b.mtime).localeCompare(String(a.mtime)));
        return send(res, 200, { dir, items, connected: isConnected(p), quota: quota(p), busy: chJobs.has(p) });
      }
      if (P === '/api/channel-history') {
        const p = u.searchParams.get('p'), h = chHistory();
        return send(res, 200, { items: p ? h.filter(x => x.p === chan(p)) : h });
      }
      // ── GPT 원고 생성 ──
      if (P === '/api/gen/settings') return send(res, 200, { ...genSettings(), hasKey: secrets.hasSecret('openai', 'apiKey'), fake: FAKE_GEN });
      if (P === '/api/gen/options') return send(res, 200, genOptions());
      if (P === '/api/gen/job') return send(res, 200, { job: genPub(genJob) });
      if (P === '/api/gen/drafts') {
        const blogId = String(u.searchParams.get('blogId') || '');
        if (!ID_RE.test(blogId)) throw new Error('블로그 아이디 형식이 아님');
        const base = path.join(OUT_ROOT, blogId);
        let names = []; try { names = fs.readdirSync(base, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { }
        const titles = names.length ? await blogTitles(blogId) : [], hist = read('history', []);
        const items = [];
        for (const n of names) { try { items.push(draftSummary(resolveDraftDir(`${blogId}/${n}`), titles, hist)); } catch { } }
        items.sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')) || b.name.localeCompare(a.name));
        return send(res, 200, { items, busy: genBusy() });
      }
      if (P === '/api/gen/draft') {
        const d = resolveDraftDir(u.searchParams.get('dir'));
        const draft = readJson(path.join(d.dir, 'draft.json'));
        const txtFile = path.join(d.dir, '원고.txt');
        let txt = ''; try { txt = fs.readFileSync(txtFile, 'utf8').replace(/^﻿/, ''); } catch { }
        const titles = await blogTitles(d.blogId);
        return send(res, 200, { ...draftSummary(d, titles, read('history', [])), txt, draft, images: draftImages(d, draft) });
      }
      if (P === '/api/gen/refs') { const blogId = String(u.searchParams.get('blogId') || ''), k = u.searchParams.get('kind'); return send(res, 200, { items: refList(blogId, k), max: refLimit(k), kind: refKind(k) }); }
      if (P === '/api/gen/refimg') {
        const f = path.join(refDir(u.searchParams.get('blogId'), u.searchParams.get('kind')), refName(u.searchParams.get('name')));
        if (!fs.existsSync(f)) throw new HttpErr(404, '참고 이미지가 없습니다');
        res.writeHead(200, { 'Content-Type': REF_EXT[path.extname(f).toLowerCase()], 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
        return res.end(fs.readFileSync(f));
      }
      if (P === '/api/gen/img') {
        const f = resolveDraftImg(u.searchParams.get('dir'), u.searchParams.get('file'));
        res.writeHead(200, { 'Content-Type': IMG_EXT[path.extname(f).toLowerCase()], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
        return res.end(fs.readFileSync(f));
      }
      // ── 블로그 육성 데이터 ──
      if (P === '/api/insight/analyze/list') return send(res, 200, { items: anaMod().list(), job: anaJob });
      if (P === '/api/insight/analyze/job') return send(res, 200, { job: anaJob });
      if (P === '/api/insight/analyze/get') {
        const id = String(u.searchParams.get('blogId') || '');
        if (!ID_RE.test(id)) throw new Error('블로그 아이디 형식이 아님');
        const r = anaMod().get(id);
        if (!r) throw new HttpErr(404, '아직 분석한 적 없는 블로그입니다');
        return send(res, 200, { report: r, mine: !!accounts.find(a => a.blogId === id) });
      }
      if (P === '/api/insight/dashboard') return send(res, 200, await insDashboard(insBlog(u.searchParams.get('blogId'))));
      if (P === '/api/insight/trend') {
        const blogId = insBlog(u.searchParams.get('blogId')), metric = String(u.searchParams.get('metric') || '');
        if (!metric || metric.length > 80 || !/^[^\0\r\n]+$/.test(metric)) throw new Error('지표 이름이 올바르지 않습니다');
        return send(res, 200, { metric, items: insEngine().trend(blogId, metric, intIn(u.searchParams.get('days'), 1, 400, 30)) });
      }
      if (P === '/api/insight/config') {
        const c = insEngine().getConfig(insBlog(u.searchParams.get('blogId')));
        return send(res, 200, { config: { keywords: c.keywords || {}, extraKeywords: c.extraKeywords || [], goals: c.goals || {}, adpost: c.adpost || {} } });
      }
      if (P === '/api/insight/settings') {
        const st = insSettings();
        const fields = insFields().map(f => f.secret
          ? { key: f.key, label: f.label, secret: true, hint: f.hint || '', hasValue: secrets.hasSecret('insight', f.key) }
          : { key: f.key, label: f.label, type: f.type, default: f.default, hint: f.hint || '', value: st[f.key] });
        return send(res, 200, { fields, enabled: insEnabled(st), sched: INS_SCHED, tickMin: Math.round(INS_TICK / 60000), nextTickAt: insTickAt });
      }
      return send(res, 404, { error: '없는 경로입니다' });
    }
    if (req.method !== 'POST') return send(res, 404, { error: '없는 경로입니다' });
    const b = await body(req);
    checkPerm(me, P, 'POST', u, b);
    ensureOwners(); checkOwner(me, b && b.blogId, P);

    // ── 인증 ──
    if (P === '/api/auth/signup') {
      const name = String(b.name || '').trim(), email = normEmail(b.email), pw = String(b.password || '');
      if (name.length < 1 || name.length > 30) throw new Error('이름은 1~30자로 입력하세요');
      if (email.length > 254 || !(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /^[a-z0-9_.-]{3,30}$/.test(email))) throw new Error('아이디(영문·숫자 3~30자) 또는 이메일 형식으로 입력하세요');
      if (pw.length < 8) throw new Error('비밀번호는 8자 이상이어야 합니다');
      if (pw.length > 200) throw new Error('비밀번호가 너무 깁니다');
      const list = users(), AS = adminSettings();
      if (list.length && AS.signupMode === 'closed') throw new HttpErr(403, '지금은 가입을 받지 않습니다. 관리자에게 계정을 요청하세요');
      if (list.find(x => x.email === email)) throw new HttpErr(409, '이미 가입된 이메일입니다');
      const first = !list.length;   // 첫 가입자가 관리자, 그 뒤는 가입 방식에 따라 바로 사용 또는 승인 대기
      const nu = { name, email, createdAt: new Date().toISOString(), role: first ? 'admin' : 'user', status: first || AS.signupMode === 'open' ? 'active' : 'pending', perms: AS.defaultPerms, canSettings: AS.defaultCanSettings, prefs: { startView: 'home' } };
      await setPw(nu, pw);
      list.push(nu); saveUsers(list);
      if (nu.status === 'pending') return send(res, 200, { pending: true, message: '가입 신청이 접수되었습니다. 관리자가 승인하면 로그인할 수 있습니다' });
      nu.lastLoginAt = nu.createdAt; saveUsers(list);
      newSession(res, email, !!b.remember);
      return send(res, 200, { user: pubUser(nu) });
    }
    // ── 관리자: 가입자 관리 ──
    if (P.startsWith('/api/admin/users')) {
      adminOnly(me);
      const list = users(), email = normEmail(b.email), target = list.find(x => x.email === email);
      const admins = () => list.filter(x => roleOf(x) === 'admin');
      const dropSessions = em => write('sessions', sessions().filter(s => s.email !== em));
      if (P === '/api/admin/users/create') {
        const name = String(b.name || '').trim(), pw = String(b.password || '');
        if (name.length < 1 || name.length > 30) throw new Error('이름은 1~30자로 입력하세요');
        if (email.length > 254 || !(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /^[a-z0-9_.-]{3,30}$/.test(email))) throw new Error('아이디(영문·숫자 3~30자) 또는 이메일 형식으로 입력하세요');
        if (pw.length < 8 || pw.length > 200) throw new Error('비밀번호는 8~200자로 입력하세요');
        if (target) throw new HttpErr(409, '이미 있는 아이디입니다');
        const AS = adminSettings();
        const nu = { name, email, createdAt: new Date().toISOString(), role: b.role === 'admin' ? 'admin' : 'user', status: 'active', perms: normPerms(b.perms, AS.defaultPerms), canSettings: b.canSettings === true || (b.canSettings === undefined && AS.defaultCanSettings), prefs: { startView: 'home' } };
        await setPw(nu, pw); list.push(nu); saveUsers(list);
        return send(res, 200, { user: adminUserRow(nu, []) });
      }
      if (!target) throw new HttpErr(404, '그 아이디의 가입자가 없습니다');
      const self = target.email === me.user.email;
      if (P === '/api/admin/users/update') {
        if (b.name !== undefined) { const name = String(b.name || '').trim(); if (name.length < 1 || name.length > 30) throw new Error('이름은 1~30자로 입력하세요'); target.name = name; }
        if (b.role !== undefined) {
          const role = b.role === 'admin' ? 'admin' : 'user';
          if (role === 'user' && roleOf(target) === 'admin' && admins().length <= 1) throw new Error('마지막 관리자는 일반 사용자로 바꿀 수 없습니다');
          target.role = role;
        }
        if (b.status !== undefined) {
          const st = ['active', 'pending', 'disabled'].includes(b.status) ? b.status : 'active';
          if (self && st !== 'active') throw new Error('자기 자신은 정지할 수 없습니다');
          if (st !== 'active' && roleOf(target) === 'admin' && admins().filter(x => statusOf(x) === 'active').length <= 1) throw new Error('마지막 관리자는 정지할 수 없습니다');
          target.status = st; if (st !== 'active') dropSessions(target.email);
        }
        if (b.perms !== undefined) target.perms = normPerms(b.perms, adminSettings().defaultPerms);
        if (b.canSettings !== undefined) target.canSettings = b.canSettings === true;
        saveUsers(list);
        return send(res, 200, { user: adminUserRow(target, sessions()) });
      }
      if (P === '/api/admin/users/password') {
        const next = String(b.next || '');
        if (next.length < 8 || next.length > 200) throw new Error('새 비밀번호는 8~200자로 입력하세요');
        await setPw(target, next); saveUsers(list);
        write('sessions', sessions().filter(s => s.email !== target.email || (self && s.h === me.h)));   // 본인이면 이 창만 남긴다
        return send(res, 200, { ok: true });
      }
      if (P === '/api/admin/users/logout') {
        write('sessions', sessions().filter(s => s.email !== target.email || (self && s.h === me.h)));
        return send(res, 200, { ok: true, user: adminUserRow(target, sessions()) });
      }
      if (P === '/api/admin/users/delete') {
        if (self) throw new Error('자기 자신은 지울 수 없습니다');
        if (roleOf(target) === 'admin' && admins().length <= 1) throw new Error('마지막 관리자는 지울 수 없습니다');
        saveUsers(list.filter(x => x.email !== target.email)); dropSessions(target.email);
        return send(res, 200, { ok: true });
      }
      throw new HttpErr(404, '없는 관리자 기능입니다');
    }
    if (P === '/api/admin/accounts/owner') {
      adminOnly(me);
      const a = accounts.find(x => x.blogId === String(b.blogId || ''));
      if (!a) throw new HttpErr(404, '등록된 블로그 계정이 아닙니다');
      const owner = normEmail(b.owner);
      if (!users().some(x => x.email === owner)) throw new Error('그 아이디의 가입자가 없습니다');
      a.owner = owner; write('accounts', accounts);
      return send(res, 200, { ok: true, blogId: a.blogId, owner });
    }
    if (P === '/api/admin/settings') {
      adminOnly(me);
      const cur = adminSettings();
      if (b.signupMode !== undefined) { if (!['open', 'approve', 'closed'].includes(b.signupMode)) throw new Error('가입 방식 값이 올바르지 않습니다'); cur.signupMode = b.signupMode; }
      if (b.defaultPerms !== undefined) cur.defaultPerms = normPerms(b.defaultPerms, DEFAULT_PERMS);
      if (b.defaultCanSettings !== undefined) cur.defaultCanSettings = b.defaultCanSettings === true;
      write('admin_settings', cur);
      return send(res, 200, { settings: cur });
    }
    if (P === '/api/auth/login') {
      const email = normEmail(b.email), lock = lockedMsg(email);
      if (lock) throw new HttpErr(429, lock);
      const user = users().find(x => x.email === email);
      if (!(await checkPw(user, b.password))) { addFail(email); throw new HttpErr(401, '아이디 또는 비밀번호가 맞지 않습니다'); }
      fails.delete(email);
      if (statusOf(user) !== 'active') throw new HttpErr(403, STATUS_MSG[statusOf(user)]);
      { const list = users(), x = list.find(v => v.email === email); if (x) { x.lastLoginAt = new Date().toISOString(); saveUsers(list); } }
      newSession(res, email, !!b.remember);
      return send(res, 200, { user: pubUser(user) });
    }
    if (P === '/api/auth/logout') {
      if (me) write('sessions', sessions().filter(s => s.h !== me.h));
      clearCookie(res); return send(res, 200, { ok: true });
    }
    if (P === '/api/auth/profile') {
      const name = String(b.name || '').trim();
      if (name.length < 1 || name.length > 30) throw new Error('이름은 1~30자로 입력하세요');
      const list = users(), x = list.find(v => v.email === me.user.email); x.name = name; saveUsers(list);
      return send(res, 200, { user: pubUser(x) });
    }
    if (P === '/api/auth/password') {
      const next = String(b.next || '');
      if (!(await checkPw(me.user, b.current))) throw new Error('현재 비밀번호가 맞지 않습니다');
      if (next.length < 8) throw new Error('새 비밀번호는 8자 이상이어야 합니다');
      if (next.length > 200) throw new Error('비밀번호가 너무 깁니다');
      const list = users(), x = list.find(v => v.email === me.user.email); await setPw(x, next); saveUsers(list);
      write('sessions', sessions().filter(s => s.email !== x.email || s.h === me.h));   // 다른 세션 끊기
      return send(res, 200, { ok: true });
    }
    if (P === '/api/auth/prefs') {
      if (!['home', 'blog'].includes(b.startView)) throw new Error('시작 화면 값이 올바르지 않습니다');
      const list = users(), x = list.find(v => v.email === me.user.email);
      x.prefs = { ...(x.prefs || {}), startView: b.startView }; saveUsers(list);
      return send(res, 200, { user: pubUser(x) });
    }

    // ── 채널 ──
    if (P === '/api/channels') {
      const p = chan(b.p), name = String(b.name || '').trim(), handle = String(b.handle || '').trim(), memo = String(b.memo || '').trim();
      if (name.length < 1 || name.length > 40) throw new Error('이름은 1~40자로 입력하세요');
      if (handle.length < 1 || handle.length > 200) throw new Error('아이디(주소)는 1~200자로 입력하세요');
      if (memo.length > 200) throw new Error('메모는 200자 이하로 입력하세요');
      const all = read('channels', {}), list = all[p] || [];
      if (list.find(x => x.handle === handle)) throw new HttpErr(409, '이미 등록된 계정입니다');
      list.push({ name, handle, memo, addedAt: new Date().toISOString() }); all[p] = list; write('channels', all);
      return send(res, 200, { items: list });
    }
    if (P === '/api/channels/delete') {
      const p = chan(b.p), all = read('channels', {});
      all[p] = (all[p] || []).filter(x => x.handle !== String(b.handle || '').trim()); write('channels', all);
      return send(res, 200, { items: all[p] });
    }
    if (P === '/api/channel-settings') {
      const p = chan(b.p), st = b.settings;
      if (!st || typeof st !== 'object' || Array.isArray(st)) throw new Error('설정 형식이 올바르지 않습니다');
      for (const [k, v] of Object.entries(st)) if (!['string', 'number', 'boolean'].includes(typeof v) || (typeof v === 'number' && !Number.isFinite(v))) throw new Error(`설정 값 형식이 올바르지 않습니다: ${k}`);
      if (Buffer.byteLength(JSON.stringify(st)) > 4096) throw new Error('설정이 너무 큽니다 (4KB 이하)');
      const all = read('channel_settings', {}); all[p] = st; write('channel_settings', all);
      return send(res, 200, { settings: st });
    }

    // ── 채널 엔진 ──
    if (P === '/api/engine/config') {
      const p = chan(b.p), e = engineOf(p), vals = b.values || {};
      if (typeof vals !== 'object' || Array.isArray(vals)) throw new Error('설정 형식이 올바르지 않습니다');
      const clear = Array.isArray(b.clear) ? b.clear.map(String) : [];
      const byKey = Object.fromEntries(e.configFields.map(f => [f.key, f]));
      for (const k of [...Object.keys(vals), ...clear]) if (!byKey[k]) throw new Error(`알 수 없는 설정 항목: ${k}`);
      for (const k of clear) if (!byKey[k].secret) throw new Error(`비밀값이 아닌 항목은 지울 수 없습니다: ${k}`);
      for (const [k, v] of Object.entries(vals)) {
        if (typeof v !== 'string') throw new Error(`설정 값은 문자열이어야 합니다: ${byKey[k].label}`);
        if (v.length > (byKey[k].secret ? 4000 : 300)) throw new Error(`값이 너무 깁니다: ${byKey[k].label}`);
        if (/[\r\n\0]/.test(v)) throw new Error(`줄바꿈은 넣을 수 없습니다: ${byKey[k].label}`);
      }
      const all = read('engine_config', {}), cfg = { ...(all[p] || {}) };
      for (const [k, raw] of Object.entries(vals)) {
        const v = raw.trim();
        if (byKey[k].secret) { if (v) await secrets.setSecret(p, k, v); }   // 빈 값 = 기존 값 유지
        else if (v) cfg[k] = v; else delete cfg[k];
      }
      for (const k of clear) await secrets.delSecret(p, k);
      all[p] = cfg; write('engine_config', all);
      return send(res, 200, { ok: true, connected: isConnected(p) });
    }
    if (P === '/api/engine/connect') {
      const p = chan(b.p), e = engineOf(p);
      if (!isOAuth(e)) throw new Error('이 채널은 토큰을 직접 붙여 넣어 연결합니다');
      for (const f of e.configFields.filter(f => f.required)) {
        if (f.secret ? !secrets.hasSecret(p, f.key) : !String(engineConfig(p)[f.key] || '').trim()) throw new Error(`먼저 ${f.label}을(를) 저장하세요`);
      }
      return send(res, 200, { url: e.authUrl(engineCtx(p, newState(p, me.h))) });
    }
    if (P === '/api/engine/disconnect') {
      const p = chan(b.p);
      for (const k of TOKEN_KEYS) await secrets.delSecret(p, k);
      const all = read('engine_accounts', {}); delete all[p]; write('engine_accounts', all);
      return send(res, 200, { ok: true, connected: isConnected(p) });
    }
    if (P === '/api/engine/check') {
      const p = chan(b.p), e = engineOf(p);
      const r = await e.check(engineCtx(p));
      if (r && r.ok && r.name) {
        const all = read('engine_accounts', {});
        all[p] = { ...(all[p] || { handle: '', id: '', connectedAt: new Date().toISOString() }), name: String(r.name), checkedAt: new Date().toISOString() };
        write('engine_accounts', all);
      }
      return send(res, 200, { ok: !!(r && r.ok), name: (r && r.name) || '', detail: redact((r && r.detail) || '') });
    }
    if (P === '/api/engine/publish') {
      const p = chan(b.p), e = engineOf(p), dryRun = b.dryRun === true;
      const full = resolvePostFile(p, b.file), f = path.basename(full);
      const r = readPost(full);
      if (r.error) throw new Error(r.error);
      const post = r.post;
      if (post.platform !== p) throw new Error(`원고의 platform 값(${post.platform || '없음'})이 ${p} 이(가) 아닙니다`);
      const c = checkPost(p, post);
      if (c.problems.length) return send(res, 400, { error: '원고에 문제가 있어 진행할 수 없습니다', problems: c.problems });
      if (chJobs.has(p)) throw new HttpErr(409, '이 채널에서 이미 발행 중입니다');
      if (dryRun) {
        chJobs.set(p, { file: f, started: Date.now(), dryRun: true });
        try { return send(res, 200, { result: await e.publish(engineCtx(p), post, { dryRun: true }), warnings: c.warnings }); }
        finally { chJobs.delete(p); }
      }
      if (!isConnected(p)) throw new Error('연결되지 않았습니다. [연결] 화면에서 먼저 연결하세요');
      const q = quota(p);
      if (q.left !== null && q.left <= 0) throw new HttpErr(429, `24시간 발행 한도(${q.dailyMax}건)를 다 썼습니다`);
      if (q.nextAt) throw new HttpErr(429, `발행 간격 ${q.intervalMin}분 — ${new Date(q.nextAt).toLocaleTimeString('ko-KR')} 이후에 발행할 수 있습니다`);
      chJobs.set(p, { file: f, started: Date.now() });
      const title = String(post.title || '');
      (async () => {
        const rec = { at: new Date().toISOString(), p, file: f, title, dryRun: false };
        try {
          const out = await e.publish(engineCtx(p), post, { dryRun: false });
          Object.assign(rec, { ok: true, id: (out && out.id) || null, url: (out && out.url) || null });
        } catch (er) {
          Object.assign(rec, { ok: false, error: redact(er.message) });
        }
        rec.at = new Date().toISOString();
        try { write('channel_history', [rec, ...chHistory()].slice(0, 500)); } catch (er) { console.error('발행 기록 저장 실패:', er.message); }
        chJobs.delete(p);
        emit('chdone', rec.ok ? { p, file: f, result: { id: rec.id, url: rec.url } } : { p, file: f, error: rec.error });
      })();
      return send(res, 200, { started: true });
    }

    // ── GPT 원고 생성 ──
    if (P === '/api/gen/settings') {
      const cur = genSettings(), next = { ...cur };
      const model = v => { const s = String(v || '').trim(); if (!/^[A-Za-z0-9._:-]{1,60}$/.test(s)) throw new Error('모델 이름은 영문·숫자·.-_: 1~60자로 입력하세요'); return s; };
      if (b.model !== undefined) next.model = model(b.model);
      if (b.imageModel !== undefined) next.imageModel = model(b.imageModel);
      if (b.imageQuality !== undefined) { if (!['low', 'medium', 'high'].includes(b.imageQuality)) throw new Error('이미지 품질 값이 올바르지 않습니다'); next.imageQuality = b.imageQuality; }
      if (b.apiKey !== undefined && b.apiKey !== null && String(b.apiKey).trim()) {
        const k = String(b.apiKey).trim();
        if (k.length < 20 || k.length > 400 || /\s/.test(k)) throw new Error('API 키 형식이 아닙니다 (공백 없이 20자 이상)');
        await secrets.setSecret('openai', 'apiKey', k);
      }
      if (b.clearKey === true) await secrets.delSecret('openai', 'apiKey');
      write('gen_settings', { model: next.model, imageModel: next.imageModel, imageQuality: next.imageQuality });
      return send(res, 200, { ...genSettings(), hasKey: secrets.hasSecret('openai', 'apiKey'), fake: FAKE_GEN });
    }
    if (P === '/api/gen/start') {
      if (genBusy()) throw new HttpErr(409, '이미 원고를 만드는 중입니다. 끝난 뒤 다시 시도하세요');
      const blogId = String(b.blogId || '');
      if (!ID_RE.test(blogId)) throw new Error('블로그 아이디 형식이 아님');
      const profile = blogProfile(blogId), opts = genOptions();
      let chosen = null;
      if (b.auto) {
        // 자동 기획: 키워드·주제를 블로그 데이터로 고른 뒤 아래 일반 흐름으로 이어 간다
        const k0 = await openaiKey(!FAKE_GEN);
        const pl = await autoPlan(blogId, { apiKey: k0, n: 3 });
        const used = new Set(manuscriptFiles(blogId).map(m => { try { return String(summary(m.path).title || '').replace(/\s+/g, '').toLowerCase(); } catch { return ''; } }));
        chosen = pl.candidates.find(c => !used.has(String(c.title || '').replace(/\s+/g, '').toLowerCase())) || pl.candidates[0];
        Object.assign(b, { keyword: chosen.keyword, topic: chosen.topic || chosen.title, subKeywords: chosen.subKeywords.join(', '), category: chosen.category || b.category || '',
          titleMode: chosen.titleMode && chosen.titleMode !== 'auto' ? chosen.titleMode : (b.titleMode || 'auto'), layout: chosen.layout && chosen.layout !== 'auto' ? chosen.layout : (b.layout || 'auto'),
          notes: [b.notes, chosen.reason ? `기획 메모: ${chosen.reason}` : '', chosen.title ? `제목안: ${chosen.title}` : ''].filter(Boolean).join('\n') });
        if (b.preset === '__rotate__' && chosen.layout && chosen.layout !== 'auto') b.keepLayout = chosen.layout;
      }
      const keyword = cleanText(b.keyword, 60, '키워드', false);
      if (!keyword) throw new Error('키워드를 입력하세요');
      // 템플릿 조합: 이름 지정 또는 '돌아가며 사용'(__rotate__) → 조합 값으로 덮어쓴다
      const presets = (accounts.find(a => a.blogId === blogId) || {}).presets || [];
      let preset = null;
      if (b.preset === '__rotate__') {
        // 돌아가며 쓸 때 '내 사진' 조합은 사진을 고른 경우에만 후보에 넣는다
        const pool = presets.filter(p => (p.imageMode !== 'photos' && p.imageMode !== 'clinical') || (Array.isArray(b.photos) && b.photos.length));
        if (!pool.length) throw new Error(presets.length ? '돌아가며 쓸 조합이 없습니다 (내 사진 조합은 사진을 골라야 후보에 들어갑니다)' : '저장된 템플릿 조합이 없습니다');
        preset = rotatePreset(blogId, pool);
      }
      else if (b.preset) { preset = presets.find(p => p.name === String(b.preset)); if (!preset) throw new Error('템플릿 조합을 찾을 수 없습니다'); }
      const src = preset ? { ...b, ...preset, ...(b.keepLayout ? { layout: b.keepLayout } : {}) } : b;
      const c = cleanPreset({ ...src, name: preset ? preset.name : '직접 선택' }, opts);
      const input = {
        keyword, topic: cleanText(b.topic, 2000, '주제'), category: cleanText(b.category, 40, '카테고리', false), notes: cleanText(b.notes, 3000, '참고 메모'),
        imageCount: c.imageCount, aiCount: c.aiCount, imageStyle: c.imageStyle, layout: c.layout, deco: c.deco, cardTemplates: c.cardTemplates,
        preset: preset ? preset.name : '', length: '보통',
        charTarget: c.charTarget, charBasis: c.charBasis, tone: c.tone, kwRepeat: c.kwRepeat, emphasis: c.emphasis, qaCount: c.qaCount,
        titleMode: c.titleMode, subKeywords: cleanText(b.subKeywords, 200, '보조 키워드', false), imageNotes: c.imageNotes,
      };
      input.imageMode = c.imageMode;
      // 고정 이미지(히든): 계정에 저장된 것을 '사용'이면 자리와 함께 넘긴다
      input.useHidden = c.useHidden;
      if (c.useHidden !== 'off') { const hs = accountHidden(accounts.find(a => a.blogId === blogId)); if (hs.length) input.hidden = hs; }
      if (c.imageMode === 'ai' && Array.isArray(b.refs) && b.refs.length) {
        const d = refDir(blogId, 'refs');
        input.refs = [...new Set(b.refs.map(refName))].slice(0, 3).map(n => path.join(d, n)).filter(f => fs.existsSync(f));
        if (!input.refs.length) throw new Error('고른 참고 이미지를 찾을 수 없습니다. 다시 골라 주세요');
      }
      if (c.imageMode === 'photos' || c.imageMode === 'clinical') {
        const d = refDir(blogId, 'photos'), clin = c.imageMode === 'clinical';
        const names = [...new Set((Array.isArray(b.photos) ? b.photos : []).map(refName))].slice(0, clin ? 8 : input.imageCount).filter(n => fs.existsSync(path.join(d, n)));
        input.photos = names.map(n => path.join(d, n));
        if (!input.photos.length) throw new Error(clin ? '임상 사진 방식은 사진함에서 사진을 1장 이상 골라야 합니다' : '내 사진 방식은 사진함에서 사진을 1장 이상 골라야 합니다');
        input.aiCount = input.photos.length;
        if (clin) {
          // 임상 증례: 사진마다 단계·설명, 진료 분야, 증례 메모 (사진 이름 기준으로 맞춘다)
          const pn = b.photoNotes && typeof b.photoNotes === 'object' ? b.photoNotes : {};
          input.imageCount = input.photos.length;
          input.clinical = {
            form: c.clinicalForm, field: cleanText(b.field, 40, '진료 분야', false), caseNote: cleanText(b.caseNote, 1000, '증례 메모'),
            photoNotes: names.map(n => { const x = pn[n] && typeof pn[n] === 'object' ? pn[n] : {}; return { stage: String(x.stage || 'etc'), note: cleanText(x.note, 200, '사진 설명', false) }; }),
          };
        }
      }
      if (c.imageMode === 'cards') input.aiCount = 0;
      if (!preset && String(b.titleMode) === 'fixed') {
        input.titleMode = 'fixed'; input.fixedTitle = cleanText(b.fixedTitle, 60, '제목', false);
        if (!input.fixedTitle) throw new Error('제목 형태를 [직접 입력]으로 골랐으면 제목을 입력하세요');
      }
      const apiKey = await openaiKey(!FAKE_GEN);
      const pl = pipeline();
      // 글 끝 링크: 관련 내 글(내부 링크) + 홈페이지. 주소는 서버가 실제 글 목록에서 고른다
      try { input.links = await buildLinks(blogId, keyword, input.topic); } catch (e) { input.links = null; }
      // 최근 글과 다른 형태로: 다음 글 설계(brief)를 원고 프롬프트에 넣는다
      try { const fp = await formPlanFor(blogId, 5); if (fp.count) input.formBrief = fp.brief; } catch (e) { console.error('다음 글 설계:', e.message); }
      const j = genJob = { kind: 'generate', blogId, keyword, started: Date.now(), steps: [], lines: [], done: false, cancel: false, result: null, error: null, plan: chosen || null };
      if (!internal) { const acc = accounts.find(a => a.blogId === blogId) || {}; Q.track({ lane: 'generate', kind: 'generate', blogId, label: `${acc.name || blogId} · 원고 만들기 · ${keyword}`, payload: { blogId, keyword } }); }
      const cb = genCallbacks(j);
      if (chosen) cb.log(`자동 기획: ${chosen.keyword}${chosen.title ? ' — ' + chosen.title : ''}${chosen.reason ? ' (' + chosen.reason + ')' : ''}`);
      (async () => {
        try {
          if (preset) cb.log(`템플릿 조합: ${preset.name}`);
          const r = await pl.generate({ input, profile, settings: genSettings(), apiKey, outRoot: OUT_ROOT, log: cb.log, step: cb.step });
          let rel = null, title = (r && r.draft && r.draft.title) || '';
          try {
            const d = resolveDraftDir(r.dir); rel = d.rel;
            // 조합 이름·입력값을 draft.json에 남긴다 (돌아가며 사용 판단용)
            const dj = path.join(d.dir, 'draft.json'), dd = readJson(dj);
            if (dd && (dd.preset == null || !dd.input || !dd.createdAt)) { if (dd.preset == null) dd.preset = input.preset || null; if (!dd.input) dd.input = input; if (!dd.createdAt) dd.createdAt = new Date().toISOString(); fs.writeFileSync(dj, JSON.stringify(dd, null, 2)); }
          } catch { }
          j.result = { dir: rel, title };
        } catch (e) {
          j.error = e && e.cancelled ? '취소했습니다' : scrub((e && e.message) || e);
          j.cancelled = !!(e && e.cancelled) || j.cancel;
        }
        j.done = true;
        emit('gendone', { ok: !j.error, dir: j.result && j.result.dir, title: j.result && j.result.title, error: j.error, cancelled: !!j.cancelled });
      })();
      return send(res, 200, { started: true, preset: input.preset, plan: chosen ? { keyword: chosen.keyword, title: chosen.title } : null });
    }
    if (P === '/api/gen/cancel') {
      if (!genBusy()) return send(res, 200, { ok: true, running: false });
      genJob.cancel = true; genJob.lines.push('취소 요청 — 지금 단계가 끝나면 멈춥니다'); emit('genlog', '취소 요청 — 지금 단계가 끝나면 멈춥니다');
      return send(res, 200, { ok: true, running: true });
    }
    if (P === '/api/gen/save') {
      const d = resolveDraftDir(b.dir);
      if (typeof b.txt !== 'string' || !b.txt.trim()) throw new Error('원고 내용이 비어 있습니다');
      if (b.txt.length > 200000 || b.txt.includes('\0')) throw new Error('원고가 너무 깁니다');
      if (genBusy()) throw new HttpErr(409, '원고를 만드는 중에는 저장할 수 없습니다');
      const pl = pipeline();
      if (typeof pl.saveTxt !== 'function') throw new HttpErr(503, '원고 저장 기능이 아직 준비되지 않았습니다');
      await pl.saveTxt(d.dir, b.txt.replace(/\r\n/g, '\n'));
      return send(res, 200, { ok: true });
    }
    if (P === '/api/gen/plan') {
      const blogId = String(b.blogId || ''); if (!ID_RE.test(blogId)) throw new Error('블로그 아이디 형식이 아님');
      const apiKey = await openaiKey(!FAKE_GEN);
      const r = await autoPlan(blogId, { apiKey, n: intIn(b.n, 1, 5, 3) });
      return send(res, 200, { candidates: r.candidates, briefChars: r.brief.length });
    }
    if (P === '/api/gen/review') {
      const d = resolveDraftDir(b.dir), f = path.join(d.dir, 'draft.json');
      const draft = readJson(f) || {};
      draft.reviewed = b.reviewed ? { at: new Date().toISOString(), by: (me.user && me.user.name) || '' } : null;
      fs.writeFileSync(f, JSON.stringify(draft, null, 2));
      return send(res, 200, { ok: true, reviewed: draft.reviewed });
    }
    if (P === '/api/accounts/auto') {
      const a = accounts.find(x => x.blogId === String(b.blogId || '')); if (!a) throw new Error('등록된 블로그 계정이 아닙니다');
      const at = String(b.at || '09:00'); if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(at)) throw new Error('시각은 HH:MM 형식입니다');
      a.auto = { enabled: !!b.enabled, perDay: intIn(b.perDay, 1, 5, 1), at, lastDate: (a.auto && a.auto.lastDate) || null };
      write('accounts', accounts);
      return send(res, 200, { ok: true, auto: a.auto });
    }
    if (P === '/api/gen/refs/add') {
      const k = refKind(b.kind), d = refDir(b.blogId, k);
      if (refList(b.blogId, k).length >= refLimit(k)) throw new Error(`${k === 'photos' ? '사진함' : '참고 이미지'}은 블로그당 ${refLimit(k)}장까지입니다. 안 쓰는 것을 지워 주세요`);
      const m = /^data:(image\/(png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(b.dataUrl || '').slice(0, 12 * 1024 * 1024));
      if (!m) throw new Error('PNG·JPG·WebP 이미지만 올릴 수 있습니다');
      if ((k === 'photos' || k === 'hidden') && m[2] === 'webp') throw new Error('글에 넣을 사진은 PNG·JPG만 올릴 수 있습니다(WebP는 네이버 업로드가 불안정)');
      const buf = Buffer.from(m[3], 'base64');
      if (buf.length > REF_MAX) throw new Error('이미지는 8MB 이하여야 합니다');
      if (buf.length < 100) throw new Error('이미지가 비어 있습니다');
      const ext = m[2] === 'jpeg' ? '.jpg' : '.' + m[2];
      const name = refSafeName((String(b.name || 'ref').replace(/\.[^.]+$/, '') || 'ref') + ext);
      fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, name), buf);
      return send(res, 200, { ok: true, name, items: refList(b.blogId, k) });
    }
    if (P === '/api/gen/refs/pick') {
      const k = refKind(b.kind), d = refDir(b.blogId, k); const picked = await pickImages(); const added = [];
      for (const f of picked) {
        if (refList(b.blogId, k).length >= refLimit(k)) break;
        const ext = path.extname(f).toLowerCase();
        try { const st = fs.statSync(f); if (st.size > REF_MAX || !REF_EXT[ext] || (k === 'photos' && ext === '.webp')) continue; const name = refSafeName(path.basename(f)); fs.mkdirSync(d, { recursive: true }); fs.copyFileSync(f, path.join(d, name)); added.push(name); } catch { }
      }
      return send(res, 200, { ok: true, added, items: refList(b.blogId, k) });
    }
    if (P === '/api/gen/refs/delete') {
      const k = refKind(b.kind), f = path.join(refDir(b.blogId, k), refName(b.name));
      try { fs.unlinkSync(f); } catch { }
      if (k === 'hidden') { const a = accounts.find(x => x.blogId === String(b.blogId || '')); if (a && Array.isArray(a.hidden)) { a.hidden = a.hidden.filter(h => h.file !== b.name); write('accounts', accounts); } }
      return send(res, 200, { ok: true, items: refList(b.blogId, k), hidden: (accounts.find(x => x.blogId === String(b.blogId || '')) || {}).hidden || [] });
    }
    if (P === '/api/gen/regen') {
      const d = resolveDraftDir(b.dir);
      if (genBusy()) throw new HttpErr(409, '이미 작업 중입니다. 끝난 뒤 다시 시도하세요');
      const draft = readJson(path.join(d.dir, 'draft.json'));
      const imgs = (draft && Array.isArray(draft.images)) ? draft.images : [];
      const index = Number.isInteger(b.index) ? b.index : -1;
      if (index < 0 || index >= imgs.length) throw new Error('이미지 번호가 올바르지 않습니다');
      const prompt = b.prompt == null ? '' : cleanText(b.prompt, 2000, '이미지 설명');
      const pl = pipeline();
      if (typeof pl.regenImage !== 'function') throw new HttpErr(503, '이미지 다시 만들기 기능이 아직 준비되지 않았습니다');
      const apiKey = await openaiKey(imgs[index].kind === 'ai' && !FAKE_GEN);
      const j = genJob = { kind: 'regen', blogId: d.blogId, keyword: imgs[index].file, started: Date.now(), steps: [], lines: [], done: false, cancel: false, result: null, error: null };
      const cb = genCallbacks(j);
      try {
        await pl.regenImage({ dir: d.dir, index, prompt: prompt || undefined, apiKey, settings: genSettings(), profile: blogProfile(d.blogId), log: cb.log });
        j.result = { dir: d.rel };
      } catch (e) { j.error = scrub(e.message); throw new Error(j.error); }
      finally { j.done = true; }
      return send(res, 200, { ok: true, images: draftImages(d, readJson(path.join(d.dir, 'draft.json'))) });
    }
    if (P === '/api/gen/delete') {
      const d = resolveDraftDir(b.dir);
      if (genBusy()) throw new HttpErr(409, '작업 중에는 지울 수 없습니다');
      const trash = path.join(OUT_ROOT, '_휴지통');
      fs.mkdirSync(trash, { recursive: true });
      let to = path.join(trash, `${d.blogId}_${d.name}`), k = 1;
      while (fs.existsSync(to)) to = path.join(trash, `${d.blogId}_${d.name}_${++k}`);
      fs.renameSync(d.dir, to);
      return send(res, 200, { ok: true });
    }
    if (P === '/api/accounts/profile') {
      const a = accounts.find(x => x.blogId === String(b.blogId || ''));
      if (!a) throw new Error('등록된 블로그 계정이 아닙니다');
      const cats = (Array.isArray(b.categories) ? b.categories : String(b.categories || '').split('\n')).map(s => String(s).trim()).filter(Boolean);
      if (cats.length > 30) throw new Error('카테고리는 30개 이하로 입력하세요');
      for (const c of cats) if (c.length > 40 || /[\0\n]/.test(c)) throw new Error('카테고리 하나는 40자 이하로 입력하세요');
      const color = String(b.color || '').trim();
      if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error('대표 색은 #RRGGBB 형식이어야 합니다');
      const homepage = String(b.homepage || '').trim();
      if (homepage && !/^https?:\/\/[^\s"'<>]{3,200}$/.test(homepage)) throw new Error('홈페이지 주소는 http:// 또는 https:// 로 시작하는 주소여야 합니다');
      Object.assign(a, {
        persona: cleanText(b.persona, 300, '화자·말투'), audience: cleanText(b.audience, 200, '독자'),
        categories: [...new Set(cats)], rules: cleanText(b.rules, 1000, '추가 규칙'), color: color.toLowerCase(),
        homepage, homepageLabel: cleanText(b.homepageLabel, 30, '링크 문구', false),
        linkInternal: Math.max(0, Math.min(2, Number.isFinite(+b.linkInternal) ? Math.round(+b.linkInternal) : 2)),
        quoteStyle: styleKey('quote', b.quoteStyle === undefined ? a.quoteStyle : b.quoteStyle),   // 이름(세로선)·키(quotation_line) 둘 다 받아 키로 저장
        lineStyle: styleKey('line', b.lineStyle === undefined ? a.lineStyle : b.lineStyle),
      });
      // 네이버 로그인 아이디가 블로그 아이디와 다를 때(블로그 아이디를 따로 만든 계정): 전용 크롬 프로필은 로그인 아이디 폴더를 쓴다
      if (b.loginId !== undefined) { const lid = String(b.loginId || '').trim(); if (lid && !/^[a-zA-Z0-9_-]{2,40}$/.test(lid)) throw new Error('네이버 로그인 아이디 형식이 아닙니다'); a.loginId = lid; }
      if (b.dept !== undefined && a.kind !== 'general') { if (!DEPT.byKey(b.dept)) throw new Error('진료과를 골라 주세요'); a.dept = b.dept; a.kind = 'hospital'; }
      if (b.region !== undefined && a.kind !== 'general') a.region = cleanRegion(b.region);
      write('accounts', accounts);
      syncHospital(a, me);
      return send(res, 200, { account: a });
    }
    // ── 히든 이미지: 내 블로그 비공개 글의 이미지(+아래 규칙 문구) → 계정 슬롯 ──
    if (P === '/api/accounts/hidden/fetch') {
      const a = accounts.find(x => x.blogId === String(b.blogId || ''));
      if (!a) throw new Error('등록된 블로그 계정이 아닙니다');
      if (!hiddenMod) throw new HttpErr(503, '히든 이미지 모듈을 불러오지 못했습니다');
      const url = String(b.url || '').trim();
      const um = url.match(/^https?:\/\/(?:m\.)?blog\.naver\.com\/(?:([a-zA-Z0-9_-]+)\/(\d{6,})|PostView\.n(?:aver|hn)\?(?:[^#]*&)?blogId=([a-zA-Z0-9_-]+)&(?:[^#]*&)?logNo=(\d{6,}))/);
      const owner = um && (um[1] || um[3]);
      if (!um || String(owner).toLowerCase() !== a.blogId.toLowerCase()) throw new Error('이 계정 블로그(blog.naver.com/' + a.blogId + '/글번호)의 글 주소를 넣어 주세요');
      if (blogBusy(a.blogId)) throw new HttpErr(409, '이 블로그로 발행 작업이 돌고 있습니다. 끝난 뒤 가져오세요');
      const r = await fetchHidden(a.blogId, url);
      const before = hiddenMod.normalize(a.hidden);
      const added = r.items.map(it => ({ file: it.file, rule: it.rule || '', caption: it.rule || '', slot: hiddenMod.ruleToSlot(it.rule), label: '' }));
      a.hidden = hiddenMod.normalize([...before, ...added]);
      a.hiddenUrl = url; write('accounts', accounts);
      return send(res, 200, { ok: true, added: added.length, found: r.items.length, hidden: a.hidden, items: refList(a.blogId, 'hidden'), fetched: r.items });
    }
    if (P === '/api/accounts/hidden') {
      const a = accounts.find(x => x.blogId === String(b.blogId || ''));
      if (!a) throw new Error('등록된 블로그 계정이 아닙니다');
      if (!hiddenMod) throw new HttpErr(503, '히든 이미지 모듈을 불러오지 못했습니다');
      if (!Array.isArray(b.items)) throw new Error('히든 이미지 목록 형식이 올바르지 않습니다');
      const d = refDir(a.blogId, 'hidden');
      const list = hiddenMod.normalize(b.items.map(it => ({ ...it, slot: hiddenMod.SLOT_IDS.includes(it && it.slot) ? it.slot : undefined })));
      for (const h of list) { refName(h.file); if (!fs.existsSync(path.join(d, h.file))) throw new Error(`히든 이미지 파일이 없습니다: ${h.file}`); }
      a.hidden = list; write('accounts', accounts);
      return send(res, 200, { ok: true, hidden: a.hidden });
    }
    if (P === '/api/accounts/prompt') {
      // 원고 프롬프트: 이 블로그의 모든 원고(자동·직접) GPT 지시문에 그대로 붙는 글
      const a = accounts.find(x => x.blogId === String(b.blogId || ''));
      if (!a) throw new Error('등록된 블로그 계정이 아닙니다');
      a.prompt = cleanText(b.prompt, 4000, '원고 프롬프트');
      write('accounts', accounts);
      return send(res, 200, { blogId: a.blogId, prompt: a.prompt });
    }
    if (P === '/api/accounts/presets') {
      const a = accounts.find(x => x.blogId === String(b.blogId || ''));
      if (!a) throw new Error('등록된 블로그 계정이 아닙니다');
      if (!Array.isArray(b.presets)) throw new Error('조합 목록 형식이 올바르지 않습니다');
      if (b.presets.length > 20) throw new Error('템플릿 조합은 20개까지 저장할 수 있습니다');
      const opts = genOptions(), list = b.presets.map(p => cleanPreset(p, opts));
      if (new Set(list.map(p => p.name)).size !== list.length) throw new Error('같은 이름의 조합이 있습니다');
      a.presets = list; write('accounts', accounts);
      return send(res, 200, { presets: list });
    }
    if (P === '/api/accounts/presets/auto') {
      const a = accounts.find(x => x.blogId === String(b.blogId || ''));
      if (!a) throw new Error('등록된 블로그 계정이 아닙니다');
      const s = suggestPresets(a.blogId);
      return send(res, 200, { presets: applyDefaultPresets(a, s), made: s.presets.map(p => p.name), kind: s.kind, reasons: s.reasons, data: s.data });
    }

    // ── 블로그 육성 데이터 ──
    if (P === '/api/insight/analyze') {
      const A = anaMod();
      const blogId = A.parseBlogUrl(b.url);
      if (!blogId) throw new Error('네이버 블로그 주소나 아이디를 넣어 주세요 (예: blog.naver.com/아이디)');
      if (anaJob && !anaJob.done) throw new HttpErr(409, `지금 ${anaJob.blogId} 블로그를 분석하는 중입니다. 끝난 뒤 다시 시도하세요`);
      const pages = [1, 2, 3, 5, 10, 20].includes(+b.pages) ? +b.pages : 1;   // 1쪽 = 최근 글 30편
      const cached = A.get(blogId);
      if (cached && !b.refresh && (cached.pages || 1) >= pages && Date.now() - cached.fetchedAt < 6 * 3600000) return send(res, 200, { blogId, cached: true });
      const j = anaJob = { blogId, pages, started: Date.now(), lines: [], done: false, error: null };
      const log = line => { j.lines.push(scrub(String(line))); if (j.lines.length > 200) j.lines.shift(); emit('analog', { blogId, line: String(line) }); };
      (async () => {
        try { await A.analyze({ blogId, pages, settings: insSettings(), log }); }
        catch (e) { j.error = e.message || String(e); log('실패: ' + j.error); }
        finally { j.done = true; j.finished = Date.now(); emit('anadone', { blogId, ok: !j.error, error: j.error }); }
      })();
      return send(res, 200, { blogId, started: true });
    }
    if (P === '/api/insight/analyze/delete') {
      const id = String(b.blogId || ''); if (!ID_RE.test(id)) throw new Error('블로그 아이디 형식이 아님');
      anaMod().remove(id); return send(res, 200, { ok: true });
    }
    if (P === '/api/insight/collect') {
      const blogId = insBlog(b.blogId); insEngine();
      const kinds = b.kinds == null ? null : Array.isArray(b.kinds) ? b.kinds.map(String) : null;
      if (b.kinds != null && !kinds) throw new Error('수집 종류 형식이 올바르지 않습니다');
      if (kinds) for (const k of kinds) if (!insight.KINDS.includes(k)) throw new Error(`알 수 없는 수집 종류: ${k}`);
      const { job: j } = insCollect(blogId, kinds, 'manual');
      return send(res, 200, { started: true, kinds: j.kinds });
    }
    if (P === '/api/insight/config') {
      const blogId = insBlog(b.blogId), ins = insEngine(), patch = {};
      if (b.keywords !== undefined) {
        if (!b.keywords || typeof b.keywords !== 'object' || Array.isArray(b.keywords)) throw new Error('키워드 형식이 올바르지 않습니다');
        if (Object.keys(b.keywords).length > 500) throw new Error('한 번에 바꿀 글이 너무 많습니다');
        patch.keywords = {};
        for (const [logNo, list] of Object.entries(b.keywords)) {
          const arr = Array.isArray(list) ? list : list == null ? [] : [list];
          for (const s of arr) if (typeof s !== 'string' || /[\0\r\n]/.test(s) || s.trim().length > 40) throw new Error('키워드는 40자 이하 한 줄로 입력하세요');
          patch.keywords[logNo] = arr;
        }
      }
      if (b.extraKeywords !== undefined) {
        if (!Array.isArray(b.extraKeywords) || b.extraKeywords.length > 100) throw new Error('추가 키워드는 100개까지 넣을 수 있습니다');
        for (const s of b.extraKeywords) if (typeof s !== 'string' || /[\0\r\n]/.test(s) || s.trim().length > 40) throw new Error('추가 키워드는 하나에 40자 이하로 입력하세요');
        patch.extraKeywords = b.extraKeywords;
      }
      if (b.goals !== undefined) {
        const g = b.goals || {}, v = cleanNum(g.postsPer30, 1, 90, '30일 목표 글 수');
        patch.goals = v === undefined ? {} : { postsPer30: v };
      }
      if (b.adpost !== undefined) {
        const g = b.adpost || {}, out = {};
        const a1 = cleanNum(g.minDays, 1, 3650, '운영 기간 기준'), a2 = cleanNum(g.minPosts, 1, 10000, '게시글 기준'), a3 = cleanNum(g.minDailyVisitors, 1, 100000, '일 방문자 기준');
        if (a1 !== undefined) out.minDays = a1; if (a2 !== undefined) out.minPosts = a2; if (a3 !== undefined) out.minDailyVisitors = a3;
        patch.adpost = out;
      }
      const c = ins.setConfig(blogId, patch);
      return send(res, 200, { config: { keywords: c.keywords || {}, extraKeywords: c.extraKeywords || [], goals: c.goals || {}, adpost: c.adpost || {} } });
    }
    if (P === '/api/insight/settings') {
      const vals = b.values || {}, byKey = Object.fromEntries(insFields().map(f => [f.key, f]));
      if (typeof vals !== 'object' || Array.isArray(vals)) throw new Error('설정 형식이 올바르지 않습니다');
      const clear = Array.isArray(b.clear) ? b.clear.map(String) : [];
      for (const k of [...Object.keys(vals), ...clear]) if (!byKey[k]) throw new Error(`알 수 없는 설정 항목: ${k}`);
      for (const k of clear) if (!byKey[k].secret) throw new Error(`비밀값이 아닌 항목은 지울 수 없습니다: ${k}`);
      const saved = read('insight_settings', {}), next = { ...saved };
      for (const [k, v] of Object.entries(vals)) {
        const f = byKey[k];
        if (f.secret) {
          if (typeof v !== 'string' || v.length > 4000 || /[\r\n\0]/.test(v)) throw new Error(`값 형식이 올바르지 않습니다: ${f.label}`);
          if (v.trim()) await secrets.setSecret('insight', k, v.trim());   // 빈 값 = 기존 값 유지
        } else if (f.type === 'bool') {
          if (typeof v !== 'boolean') throw new Error(`켜기/끄기 값이어야 합니다: ${f.label}`);
          next[k] = v;
        } else if (f.type === 'number') {
          next[k] = cleanNum(v, 1, 200, f.label) ?? f.default;
        }
      }
      for (const k of clear) await secrets.delSecret('insight', k);
      write('insight_settings', next);
      return send(res, 200, { ok: true, enabled: insEnabled(insSettings()) });
    }

    // ── 블로그 (v1 그대로) ──
    if (P === '/api/accounts') {
      if (!/^[a-zA-Z0-9_-]{3,40}$/.test(b.blogId || '')) throw new Error('블로그 아이디 형식이 아님');
      const general = b.general === true && (me.internal || isAdmin(me));
      if (!general && !DEPT.byKey(b.dept)) throw new Error('진료과를 골라 주세요. 병의원 블로그만 등록할 수 있습니다(일반 블로그는 관리자 CMD)');
      const region = cleanRegion(b.region);
      if (!general && !region.sigungu && !region.area) throw new Error('지역(시·군·구 또는 동·역)을 입력해 주세요');
      let a = accounts.find(x => x.blogId === b.blogId);
      if (!a) { a = { name: b.name || b.blogId, blogId: b.blogId, owner: me.internal ? '' : me.user.email }; accounts.push(a); }
      if (general) Object.assign(a, { kind: 'general' }); else Object.assign(a, { kind: 'hospital', dept: b.dept, region });
      write('accounts', accounts);
      syncHospital(a, me);
      // 새 계정은 기본 글 형태 템플릿 3개를 바로 갖는다(데이터가 쌓이면 [기본 3개 다시 구성]으로 갱신)
      if (!Array.isArray(a.presets) || !a.presets.length) { try { applyDefaultPresets(a, suggestPresets(a.blogId)); } catch (e) { console.error('기본 템플릿 구성 실패', a.blogId, e.message); } }
      return send(res, 200, { ok: true, presets: a.presets || [] });
    }
    if (P === '/api/accounts/ips') {   // 고정 IP 목록 저장 (전체 교체)
      if (!Array.isArray(b.items) || b.items.length > 200) throw new Error('고정 IP 목록 형식이 아닙니다');
      const net = require('net'), seen = new Set();
      const list = b.items.map(it => {
        const ip = String(it.ip || '').trim();
        if (net.isIP(ip) !== 4) throw new Error(`출구 IP는 IPv4 형식이어야 합니다: ${ip || '(빈칸)'}`);
        const proxy = normProxy(it.proxy);
        if (!proxy) throw new Error(`${ip}: 프록시 주소:포트를 입력하세요`);
        const id = /^ip_[a-z0-9]{4,20}$/.test(it.id || '') ? it.id : 'ip_' + crypto.randomBytes(4).toString('hex');
        if (seen.has(id)) throw new Error('중복된 항목'); seen.add(id);
        return { id, label: String(it.label || '').trim().slice(0, 30), proxy, ip, owner: ipOwner(me) };
      });
      const others = fixedIps.filter(x => x.owner !== ipOwner(me));
      if (list.some(x => others.some(o => o.id === x.id))) throw new Error('다른 사용자의 고정 IP입니다');
      fixedIps = [...others, ...list]; write('fixed_ips', fixedIps);
      return send(res, 200, { fixedIps: myIps(me) });
    }
    if (P === '/api/accounts/ip') {   // 블로그 계정에 고정 IP 할당 (빈 값 = 할당 해제, 이 PC 인터넷 그대로)
      const a = accounts.find(x => x.blogId === String(b.blogId || ''));
      if (!a) throw new Error('등록된 블로그 계정이 아닙니다');
      const ipId = String(b.ipId || '');
      if (ipId) {
        const ip = myIps(me).find(x => x.id === ipId);
        if (!ip) throw new Error('내 고정 IP 목록에 없는 IP입니다');
        const others = ip.used.filter(id => id !== a.blogId);
        if (others.length >= IP_MAX_BLOGS) throw new Error(`이 고정 IP는 이미 블로그 ${IP_MAX_BLOGS}개(${others.join(', ')})에 할당돼 있습니다. 고정 IP 하나는 블로그 ${IP_MAX_BLOGS}개까지만 쓸 수 있습니다`);
      }
      a.ipId = ipId; write('accounts', accounts);
      return send(res, 200, { account: a, settings: settingsFor(a.blogId), fixedIps: myIps(me) });
    }
    if (P === '/api/accounts/settings') {   // 블로그별 입력 설정 저장 (reset: true = 전부 기본값으로)
      const a = accounts.find(x => x.blogId === String(b.blogId || ''));
      if (!a) throw new Error('등록된 블로그 계정이 아닙니다');
      a.settings = b.reset ? {} : cleanBlogSettings(b.settings || {});
      write('accounts', accounts);
      return send(res, 200, { account: a, settings: settingsFor(a.blogId) });
    }
    if (P === '/api/accounts/delete') { accounts = accounts.filter(a => a.blogId !== b.blogId); write('accounts', accounts); return send(res, 200, { ok: true }); }
    if (P === '/api/login') {
      if (b.fillOnce) {
        if (!accounts.some(a => a.blogId === b.blogId)) throw new Error('등록된 블로그를 선택하세요');
        const loginId = String(b.loginId || '').trim();
        if (!/^[a-zA-Z0-9_-]{2,40}$/.test(loginId) || typeof b.password !== 'string' || !b.password || b.password.length > 200) throw new Error('네이버 아이디와 비밀번호를 확인하세요');
        const child = spawn(process.execPath, [path.join(TOOL, 'login.js'), '--fill-once'], { cwd: TOOL, env: { ...process.env, BLOG_ID: b.blogId, BLOG_PROFILE: profileDirOf(b.blogId), ...netEnvOf(b.blogId), LOGIN_MODE: 'fresh' }, detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
        const ready = new Promise((resolve, reject) => {
          const timer = setTimeout(() => { if (child.connected) child.disconnect(); reject(new Error('로그인 창 준비 시간이 초과되었습니다')); }, 60000);
          const fail = () => { clearTimeout(timer); reject(new Error('로그인 창 준비에 실패했습니다')); };
          child.once('error', fail);
          child.once('exit', fail);
          child.once('message', m => { clearTimeout(timer); m && m.ok ? resolve() : fail(); });
        });
        child.send({ loginId, password: b.password }, () => {});
        b.password = '';
        child.unref();
        await ready;
        return send(res, 200, { ok: true, filled: true });
      }
      spawn(process.execPath, [path.join(TOOL, 'login.js')], { cwd: TOOL, env: { ...process.env, BLOG_ID: b.blogId, BLOG_PROFILE: profileDirOf(b.blogId), ...netEnvOf(b.blogId) }, detached: true, stdio: 'ignore' }).unref();
      return send(res, 200, { ok: true });
    }
    if (P === '/api/pick') {
      const picked = await pickFiles();
      const reg = read('manuscripts', []);
      write('manuscripts', [...new Set([...reg, ...picked])]);
      return send(res, 200, { added: picked.length });
    }
    if (P === '/api/unregister') { write('manuscripts', read('manuscripts', []).filter(f => f !== b.file)); return send(res, 200, { ok: true }); }
    if (P === '/api/settings') {
      const cur = settings();
      const n = (v, lo, hi, d) => Math.min(hi, Math.max(lo, Number.isFinite(+v) ? +v : d));
      const next = {
        tpm: n(b.tpm, 100, 3000, cur.tpm), jitter: n(b.jitter, 0, 80, cur.jitter),
        linePause: n(b.linePause, 0, 3000, cur.linePause), tagPause: n(b.tagPause, 300, 5000, cur.tagPause),
        typoN: Math.round(n(b.typoN, 0, 12, cur.typoN)), thinkN: Math.round(n(b.thinkN, 0, 12, cur.thinkN)),
        readN: Math.round(n(b.readN, 0, 5, cur.readN)), readSec: Math.round(n(b.readSec, 20, 180, cur.readSec)),
        clearCache: b.clearCache === undefined ? cur.clearCache !== false : !!b.clearCache,
        loginMode: ['fresh', 'keep'].includes(b.loginMode) ? b.loginMode : (cur.loginMode === 'keep' ? 'keep' : 'fresh'),
        mode: ['test', 'stop', 'save'].includes(b.mode) ? b.mode : cur.mode,
        scanDirs: Array.isArray(b.scanDirs) ? b.scanDirs.filter(Boolean) : cur.scanDirs,
      };
      write('settings', next); return send(res, 200, next);
    }
    if (P === '/api/flow/g2') {
      const blogId = String(b.blogId || ''), file = String(b.file || '');
      if (!accounts.some(a => a.blogId === blogId)) throw new Error('등록된 블로그를 선택하세요');
      return send(res, 200, { g2: flow.runG2(file, blogId) });
    }
    if (P === '/api/flow/pending/state') {
      const it = flow.scan(flowFiles(me)).find(x => x.id === String(b.id || ''));
      if (!it) throw new HttpErr(404, '그 저장 기록을 찾을 수 없습니다');
      flow.setState(it.id, String(b.state || ''), me.user && me.user.name);
      emitRaw('pending', { at: Date.now() });
      return send(res, 200, { ok: true });
    }
    if (P === '/api/flow/pending/open') {
      const it = flow.scan(flowFiles(me)).find(x => x.id === String(b.id || ''));
      if (!it || !it.blogId) throw new HttpErr(404, '그 저장 기록을 찾을 수 없습니다');
      return send(res, 200, await openDraftWindow(it.blogId));
    }
    if (P === '/api/flow/detect') {
      const r = await detectPublished(b.blogId ? String(b.blogId) : null, me);
      return send(res, 200, r);
    }
    if (P === '/api/flow/lm/reserve') {
      const blogId = String(b.blogId || ''); if (!ID_RE.test(blogId)) throw new Error('블로그 아이디 형식이 아님');
      return send(res, 200, await flow.reserve({ blogId, keyword: cleanText(b.keyword, 40, '키워드', false), intentClusterId: b.intentClusterId ? String(b.intentClusterId).slice(0, 80) : undefined, candidateId: b.candidateId ? String(b.candidateId).slice(0, 80) : undefined }));
    }
    if (P === '/api/flow/lm/fingerprints') {
      const blogId = String(b.blogId || ''); if (!ID_RE.test(blogId)) throw new Error('블로그 아이디 형식이 아님');
      return send(res, 200, await flow.syncFingerprints(blogId));
    }
    if (P === '/api/flow/lm/retry') {
      const items = flow.scan(flowFiles(me)).filter(x => x.state === 'published');
      return send(res, 200, { results: await flow.retryUnsent(items) });
    }
    if (P === '/api/run') {
      // 실행 = G2 품질검사 → PASS 일 때만 write.js (기본 SAVE=1). 판정이 PASS 가 아니면 409 + 결과. override:{reason} = 운영자 예외(SKIP_G2=1)
      if (job && !job.done) throw new HttpErr(409, '이미 실행 중입니다');
      const blogId = String(b.blogId || ''), file = String(b.file || '');
      if (!accounts.some(a => a.blogId === blogId)) throw new Error('등록된 블로그를 선택하세요');
      if (!file || !fs.existsSync(file)) throw new Error('원고 파일을 찾을 수 없습니다');
      const plan = flow.planRun({ file, blogId, mode: b.mode || settingsFor(blogId).mode, override: b.override && typeof b.override === 'object' ? b.override : null, by: me.user && me.user.name });
      if (!plan.ok) return send(res, plan.status, { error: plan.error, g2: plan.g2 });
      if (plan.override) console.log(`[override] ${blogId} ${file} · ${plan.override.verdict} · ${plan.override.reason}`);
      run(blogId, file, plan.mode, { direct: !internal, skipG2: plan.skipG2, override: plan.override });
      return send(res, 200, { ok: true, mode: plan.mode, g2: plan.g2, override: plan.override });
    }
    if (P === '/api/stop') { if (job && !job.done) job.proc.kill(); return send(res, 200, { ok: true }); }
    if (P === '/api/neighbors/scan') {
      // 발행 기록의 읽은 글 목록으로 이웃 후보 점수를 다시 매긴다 (앱 밖에서 발행한 기록을 넣었을 때 등)
      const blogId = String(b.blogId || ''); if (!accounts.find(a => a.blogId === blogId)) throw new Error('등록된 블로그 계정이 아닙니다');
      const items = Array.isArray(b.read) ? b.read : (read('history', []).find(h => h.blogId === blogId && h.read) || {}).read || [];
      if (!items.length) throw new Error('읽은 글 기록이 없습니다');
      neighborScan(blogId, items).catch(e => console.error('이웃 후보 점수:', e.message));
      return send(res, 200, { started: true, count: items.length });
    }
    if (P === '/api/neighbors/status' || P === '/api/neighbors/remove' || P === '/api/neighbors/open') {
      const list = neighbors();
      const it = list.find(x => x.id === String(b.id || ''));
      if (!it) throw new HttpErr(404, '없는 항목입니다');
      if (P === '/api/neighbors/remove') { write('neighbors', list.filter(x => x !== it)); return send(res, 200, { ok: true }); }
      if (P === '/api/neighbors/status') {
        if (!['candidate', 'done', 'skip'].includes(b.status)) throw new Error('상태 값이 올바르지 않음');
        it.status = b.status; it.statusAt = new Date().toISOString(); write('neighbors', list); return send(res, 200, it);
      }
      // 열기: 전용 크롬에서 상대 블로그를 열고 [이웃추가] 단추를 표시만 한다
      const r = await neighborOpen(it);
      it.openedAt = new Date().toISOString(); write('neighbors', list);
      return send(res, 200, { ok: r.where !== 'error', ...r });
    }
    if (P === '/api/queue/add') {
      const lane = String(b.lane || '');
      let it;
      if (lane === 'publish') {
        const blogId = String(b.blogId || ''); if (!ID_RE.test(blogId)) throw new Error('블로그 아이디 형식이 아님');
        const a = accounts.find(x => x.blogId === blogId); if (!a) throw new HttpErr(404, '등록된 블로그 계정이 아닙니다');
        const file = String(b.file || ''); if (!file || !fs.existsSync(file)) throw new Error('원고 파일을 찾을 수 없습니다');
        const mode = flow.normMode(['test', 'stop', 'save', 'manual'].includes(b.mode) ? b.mode : settingsFor(blogId).mode);
        const dup = Q.items.find(x => x.status === 'queued' && x.kind === 'publish' && x.payload.file === file && x.payload.blogId === blogId);
        if (dup) throw new Error('같은 원고가 이미 대기 중입니다');
        it = Q.add({ lane: 'publish', kind: 'publish', blogId, label: `${a.name || blogId} · ${path.basename(file).replace(/\.(txt|js)$/i, '')}`, payload: { blogId, file, mode } });
      } else if (lane === 'generate') {
        const blogId = String(b.blogId || ''); if (!ID_RE.test(blogId)) throw new Error('블로그 아이디 형식이 아님');
        const a = accounts.find(x => x.blogId === blogId); if (!a) throw new HttpErr(404, '등록된 블로그 계정이 아닙니다');
        const keyword = cleanText(b.keyword, 60, '키워드', false);
        if (!keyword && !b.auto) throw new Error('키워드를 입력하세요');
        const { lane: _l, ...payload } = b;
        it = Q.add({ lane: 'generate', kind: 'generate', blogId, label: `${a.name || blogId} · ${b.auto ? '자동 기획' : keyword}`, payload });
      } else if (lane === 'channel') {
        const p = chan(b.p); const e = engineOf(p);
        const full = resolvePostFile(p, b.file), f = path.basename(full);
        const r = readPost(full); if (r.error) throw new Error(r.error);
        const c = checkPost(p, r.post); if (c.problems.length) throw new Error('원고에 문제가 있습니다: ' + c.problems[0]);
        if (!isConnected(p)) throw new Error(`${e.label || p}이(가) 연결되지 않았습니다. [연결] 화면에서 먼저 연결하세요`);
        it = Q.add({ lane: 'channel:' + p, kind: 'channel', p, label: `${e.label || p} · ${String(r.post.title || f).slice(0, 40)}`, payload: { p, file: f, dryRun: false } });
      } else throw new Error('작업 종류(lane)가 올바르지 않습니다');
      return send(res, 200, { ok: true, item: Q.pub(it), summary: Q.summary() });
    }
    if (P === '/api/queue/remove') { const it = Q.remove(String(b.id || '')); return send(res, 200, { ok: true, item: Q.pub(it) }); }
    if (P === '/api/queue/move') { Q.move(String(b.id || ''), b.dir < 0 ? -1 : 1); return send(res, 200, { ok: true }); }
    if (P === '/api/queue/retry') {
      const it = Q.items.find(x => x.id === String(b.id || '')); if (!it) throw new HttpErr(404, '그 작업이 없습니다');
      if (it.status === 'running' || it.status === 'queued') throw new Error('이미 진행·대기 중입니다');
      const { id: _i, status: _s, createdAt: _c, startedAt: _st, finishedAt: _f, error: _e, result: _r, progress: _p, ...rest } = it;
      Q.items = Q.items.filter(x => x.id !== it.id);
      return send(res, 200, { ok: true, item: Q.pub(Q.add(rest)) });
    }
    if (P === '/api/queue/state') {
      if (b.paused !== undefined) Q.state.paused = !!b.paused;
      if (b.gapMin !== undefined) Q.state.gapMin = intIn(b.gapMin, 0, 600, 0);
      Q.changed(); if (!Q.state.paused) Q.tick();
      return send(res, 200, { ok: true, state: Q.state });
    }
    if (P === '/api/queue/clear') { Q.clear(); return send(res, 200, { ok: true }); }
    if (P === '/api/net/settings') {
      const T = tetherMod(), st = T.readState();
      if (b.hotspotName !== undefined) st.hotspotName = cleanText(b.hotspotName, 64, '핫스팟 이름', false);
      if (b.adbPath !== undefined) {
        const v = cleanText(b.adbPath, 260, 'adb 경로', false);
        if (v && !/adb\.exe$/i.test(v)) throw new Error('adb.exe 파일 경로를 넣어 주세요');
        if (v && !fs.existsSync(v)) throw new Error('그 위치에 adb.exe가 없습니다');
        st.adbPath = v;
      }
      if (b.tetherOnly !== undefined) st.tetherOnly = !!b.tetherOnly;
      if (b.avoidRegions !== undefined) {
        if (!Array.isArray(b.avoidRegions) || b.avoidRegions.length > 50) throw new Error('피할 지역 목록 형식이 올바르지 않습니다');
        st.avoidRegions = [...new Set(b.avoidRegions.map(x => cleanText(x, 80, '지역', false)).filter(Boolean))];
      }
      T.writeState(st); linkCache = null;
      return send(res, 200, await netStatus(false));
    }
    if (P === '/api/net/avoid') {
      const T = tetherMod(), st = T.readState(), key = cleanText(b.region, 80, '지역', false);
      if (!key) throw new Error('지역 값이 없습니다');
      const set = new Set(Array.isArray(st.avoidRegions) ? st.avoidRegions : []);
      if (b.on) set.add(key); else set.delete(key);
      st.avoidRegions = [...set]; T.writeState(st);
      return send(res, 200, await netStatus(false));
    }
    if (P === '/api/net/reroll') {
      const T = tetherMod();
      if (netJob && !netJob.done) throw new HttpErr(409, '이미 IP를 다시 받는 중입니다');
      const mode = b.mode === 'airplane' ? 'airplane' : 'data', tries = intIn(b.tries, 1, 10, 1);
      const j = netJob = { mode, tries, started: Date.now(), lines: [], done: false, error: null, result: null };
      const log = line => { j.lines.push(String(line)); if (j.lines.length > 200) j.lines.shift(); emit('netlog', { line: String(line) }); };
      (async () => {
        try {
          const r = await T.reroll({ settings: netSettings(), mode, tries, getIp: async () => (await publicIp(true)).ip, log });
          j.result = r; if (!r.ok) j.error = r.error;
        } catch (e) { j.error = e.message || String(e); log('실패: ' + j.error); }
        finally { j.done = true; j.finished = Date.now(); linkCache = null; let st = null; try { st = await netStatus(true); } catch { } emit('netdone', { ok: !j.error, error: j.error, ip: st && st.ip, light: st && st.light }); }
      })();
      return send(res, 200, { started: true });
    }
    if (P === '/api/open') { openPath(b.path); return send(res, 200, { ok: true }); }
    // ── 병원 블로그 지수(index_web 편입): 입장권·관리자 명령·병원 목록 ──
    if (P === '/api/idx/enter') {
      const host = String(req.headers.host || '').split(':')[0];
      return send(res, 200, await IDX.enter({ user: me.user.name || me.user.email, role: isAdmin(me) ? 'admin' : 'user', to: b.to || '/', theme: b.theme, host, dataDir: DATA }));
    }
    if (P === '/api/idx/hospitals') {
      const r = await IDX.hospitals({ dataDir: DATA, user: me.user.name || me.user.email, role: isAdmin(me) ? 'admin' : 'user', save: b.save, remove: b.remove });
      return send(res, 200, Object.assign(r, { accounts: visibleAccounts(me).map(a => ({ blogId: a.blogId, name: a.name || a.blogId })), admin: isAdmin(me) }));
    }
    if (P === '/api/idx/cmd') {
      if (!isAdmin(me)) return send(res, 403, { error: '관리자만 쓸 수 있습니다' });
      const line = String(b.line || '').slice(0, 300).trim(), w = line.split(/\s+/);
      if (w[0] === 'account') {
        const out = t => send(res, 200, { ok: true, out: Array.isArray(t) ? t.join('\n') : String(t) });
        if (w[1] === 'list') return out(accounts.map(a => `${a.blogId.padEnd(18)} ${a.kind === 'general' ? '일반' : '병원 · ' + ((DEPT.byKey(a.dept) || {}).label || '?')}  ${a.region ? [a.region.sigungu, a.region.area].filter(Boolean).join(' ') : ''}  ${a.name || ''}`));
        const a = accounts.find(x => x.blogId === w[2]);
        if (w[1] === 'general') {
          if (!/^[a-zA-Z0-9_-]{3,40}$/.test(w[2] || '')) return out('사용: account general <블로그아이디> [이름]');
          const x = a || (accounts.push({ name: w.slice(3).join(' ') || w[2], blogId: w[2], owner: me.user.email }), accounts[accounts.length - 1]);
          x.kind = 'general'; write('accounts', accounts);
          return out(`일반 블로그로 표시: ${x.blogId} (관리자 화면에만 보이고, 원고·발행은 관리자 명령으로)`);
        }
        if (w[1] === 'hospital') {
          if (!a) return out('먼저 계정을 등록하세요. 사용: account hospital <아이디> <진료과키> <시군구> [동·역]');
          if (!DEPT.byKey(w[3])) return out('진료과 키: ' + DEPT.list().map(d => d.key).join(', '));
          Object.assign(a, { kind: 'hospital', dept: w[3], region: cleanRegion({ sigungu: w[4], area: w[5] }) }); write('accounts', accounts); syncHospital(a, me);
          return out(`병원 블로그로 표시: ${a.blogId} · ${DEPT.byKey(a.dept).label}`);
        }
        return out(['account list                                  앱 블로그 계정 목록(병원/일반)', 'account general <아이디> [이름]               일반 블로그로 표시(관리자 전용)', 'account hospital <아이디> <진료과> <시군구> [동·역]   병원 블로그로 표시']);
      }
      const r = await IDX.cmd({ line, user: me.user.name || me.user.email, role: 'admin', dataDir: DATA });
      if (w[0] === 'help' && r && r.out) r.out += '\naccount list|general|hospital …              앱 블로그 계정(병원/일반) 관리';
      return send(res, 200, r);
    }
    if (P === '/api/quit') { send(res, 200, { ok: true }); setTimeout(() => { IDX.stop(); process.exit(0); }, 300); return; }
    send(res, 404, { error: '없는 경로입니다' });
  } catch (e) { if (!res.headersSent) send(res, e.code >= 400 && e.code < 500 ? e.code : 400, { error: e.message }); }
}).listen(PORT, '127.0.0.1', () => console.log(`bokbok ${VERSION} → http://127.0.0.1:${PORT}`));
