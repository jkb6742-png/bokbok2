// 블로그별 지문 이력: %LOCALAPPDATA%\bokbok\quality\<blogId>\history.json
// 본문 원문은 저장하지 않는다(해시·벡터·구조·제목·태그만).
// source: 'local'(이 앱에서 검사한 원고) | 'logmeter'(LOGMETER가 보낸 발행 글 구조·제목 지문)
const fs = require('fs'), path = require('path'), os = require('os');

function defaultRoot() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, 'bokbok', 'quality');
}

function safeId(blogId) {
  const id = String(blogId || '').trim();
  if (!/^[\p{L}\p{N}_.-]{1,64}$/u.test(id) || id === '.' || id === '..') throw new Error('블로그 ID 형식이 올바르지 않음: ' + blogId);
  return id;
}

class History {
  // opts.root: 테스트용 저장 위치 주입
  constructor(blogId, opts = {}) {
    this.blogId = safeId(blogId);
    this.root = opts.root || defaultRoot();
    this.file = path.join(this.root, this.blogId, 'history.json');
    this.data = null;
  }
  load() {
    if (this.data) return this.data;
    try { this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')); }
    catch (e) {
      if (e.code !== 'ENOENT') throw new Error('이력 파일을 읽을 수 없음: ' + this.file + ' (' + e.message + ')');
      this.data = { schemaVersion: '1.2', blogId: this.blogId, profile: {}, metaphorLexicon: [], entries: [] };
    }
    this.data.entries = this.data.entries || [];
    this.data.profile = this.data.profile || {};
    this.data.metaphorLexicon = this.data.metaphorLexicon || [];
    return this.data;
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.file);   // 원자적 교체
  }
  get profile() { return this.load().profile; }
  setProfile(p) { Object.assign(this.load().profile, p); this.save(); }
  get metaphorLexicon() { return this.load().metaphorLexicon; }
  addMetaphors(words) {
    const L = this.load().metaphorLexicon;
    for (const w of words) if (w && !L.includes(w)) L.push(w);
    this.save();
  }
  // 최근 순(최신이 앞) N편. excludeId: 같은 원고 재검사 시 자기 자신 제외
  recent(n = 50, excludeId = null) {
    return this.load().entries.filter(e => !excludeId || e.id !== excludeId)
      .slice().sort((a, b) => (b.seq || 0) - (a.seq || 0) || String(b.addedAt).localeCompare(String(a.addedAt))).slice(0, n);
  }
  // 지문 추가. 같은 id 가 있으면 교체(재검사)
  add(fp, meta = {}) {
    const d = this.load();
    const e = { ...fp, source: fp.source || meta.source || 'local', addedAt: meta.addedAt || fp.addedAt || new Date().toISOString() };
    e.seq = d.entries.reduce((m, x) => Math.max(m, x.seq || 0), 0) + 1;
    if (meta.publishedAt) e.publishedAt = meta.publishedAt;
    if (meta.url) e.url = meta.url;
    if (!e.id) e.id = e.url || e.bodySha256 || ('fp_' + Date.now());
    const i = d.entries.findIndex(x => x.id === e.id);
    if (i >= 0) d.entries[i] = e; else d.entries.push(e);
    this.save();
    return e;
  }
  // LOGMETER 등 외부 지문(구조·제목 위주, 일부 필드 없음 허용)
  addExternal(fp) {
    // LOGMETER 지문은 {title, titlePattern, structure, publishedAt, logNo} 만 받는다(본문 벡터 없음 → 제목·구조만 비교)
    if (!fp || (!fp.structure && !fp.titlePattern && !fp.title)) throw new Error('외부 지문에 structure 또는 title 이 필요함');
    const F = require('./fingerprint'), T = require('./thresholds');
    const e = {
      source: 'logmeter', schemaVersion: T.schemaVersion, ruleVersion: T.ruleVersion,
      fingerprintVersion: fp.fingerprintVersion || F.FINGERPRINT_VERSION,
      title: fp.title || null,
      titlePattern: fp.titlePattern || (fp.title ? F.titlePattern(fp.title) : null),
      structure: fp.structure || null,
      publishedAt: fp.publishedAt || null, logNo: fp.logNo || null,
      id: fp.logNo ? 'logmeter:' + fp.logNo : undefined,
    };
    return this.add(e, { addedAt: fp.publishedAt || undefined });
  }
}

module.exports = { History, defaultRoot };
