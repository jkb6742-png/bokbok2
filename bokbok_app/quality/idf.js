// 3-gram IDF 기준표: 비교 대상이 2~3편뿐이면 IDF가 성립하지 않아(모든 공통 조사·어미가 높은 가중치)
// 로컬 원고 묶음으로 문서빈도(df) 기준표를 만들어 두고, 이력 문서를 더해 IDF를 계산한다.
// 기준표에는 3-gram 해시와 문서 수만 있고 본문은 없다.
const fs = require('fs'), path = require('path');
const BASE_FILE = path.join(__dirname, 'idf_base.json');

function loadBase(file = BASE_FILE) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// files: 원고 경로 목록 → 기준표 저장
function buildBase(files, out = BASE_FILE) {
  const N = require('./normalize'), FP = require('./fingerprint');
  const df = {}, docs = [], skipped = [];
  for (const f of files) {
    let fp;
    try { fp = FP.build(N.loadManuscript(f)); } catch (e) { skipped.push({ file: f, error: e.message }); continue; }
    if (docs.includes(fp.bodySha256)) continue;
    docs.push(fp.bodySha256);
    for (const k in fp.tf3) df[k] = (df[k] || 0) + 1;
  }
  const base = { fingerprintVersion: FP.FINGERPRINT_VERSION, builtAt: new Date().toISOString(), n: docs.length, docs, df };
  fs.writeFileSync(out, JSON.stringify(base));
  return { n: docs.length, skipped, file: out };
}

// 기준표 + 비교 문서들(이미 기준표에 든 문서는 중복 계산하지 않음) → idf
// idf = ln(N / df) : 모든 문서에 나오는 3-gram은 0
function idfFor(base, items) {
  const df = Object.create(null);
  let n = 0;
  if (base) { Object.assign(df, base.df); n = base.n; }
  const known = new Set(base ? base.docs : []);
  for (const it of items) {
    if (it.sha && known.has(it.sha)) continue;
    if (it.sha) known.add(it.sha);
    n++;
    for (const k in it.tf) df[k] = (df[k] || 0) + 1;
  }
  const idf = Object.create(null);
  for (const k in df) idf[k] = Math.log(n / df[k]);
  return { idf, n, hasBase: !!base };
}

// 원고함·원고데이터에서 기준 원고 찾기(_로 시작하는 보관·탈락 폴더 제외)
function findCorpus(root) {
  const out = [];
  const box = path.join(root, '원고함');
  if (fs.existsSync(box)) for (const blog of fs.readdirSync(box)) {
    const bd = path.join(box, blog);
    if (blog.startsWith('_') || !fs.statSync(bd).isDirectory()) continue;
    for (const d of fs.readdirSync(bd)) {
      const f = path.join(bd, d, '원고.txt');
      if (!d.startsWith('_') && fs.existsSync(f)) out.push(f);
    }
  }
  const data = path.join(root, '_도구', '원고데이터');
  if (fs.existsSync(data)) for (const f of fs.readdirSync(data)) if (/_layout\.js$/.test(f)) out.push(path.join(data, f));
  return out;
}

module.exports = { loadBase, buildBase, idfFor, findCorpus, BASE_FILE };
