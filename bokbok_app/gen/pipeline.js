// 원고 생성 전체 흐름: 원고 작성 → 대표(AI) 이미지 → 카드 렌더 → 원고.txt 저장
// 결과 폴더: <outRoot>\<blogId>\<YYYYMMDD_HHmm>_<키워드>\  (draft.json · 원고.txt · png)
const fs = require('fs'), path = require('path');
const openai = require('./openai');
const writer = require('./writer');
const styles = require('./styles');
const manuscript = require('../../naver_post/manuscript');

let _renderer = null; // null = cards/render.js 를 처음 쓸 때 불러옴
function _setRenderer(fn) { _renderer = fn; }
function renderer() {
  if (!_renderer) {
    try { _renderer = require('./cards/render').renderCards; }
    catch (e) { throw new Error(`카드 렌더 모듈을 불러오지 못했습니다(gen\\cards\\render.js): ${e.message}`); }
  }
  return _renderer;
}

const HISTORY_N = 10;
const pad = n => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
const slug = s => String(s || '').replace(/[^0-9A-Za-z가-힣]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || '원고';

// 같은 계정 최근 draft.json 기록(최신이 앞)
function readHistory(outRoot, blogId, n = HISTORY_N) {
  const base = path.join(outRoot, blogId);
  let names = [];
  try { names = fs.readdirSync(base, { withFileTypes: true }).filter(x => x.isDirectory() && !x.name.startsWith('_')).map(x => x.name); } catch { return []; }
  const out = [];
  for (const name of names) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(base, name, 'draft.json'), 'utf8'));
      out.push({ dir: path.join(base, name), name, title: d.title, layout: d.layout, imageStyle: d.imageStyle, deco: d.deco, variant: d.variant, preset: d.preset || null, createdAt: d.createdAt || '' });
    } catch { }
  }
  out.sort((a, b) => (b.createdAt || b.name).localeCompare(a.createdAt || a.name));
  return out.slice(0, n);
}

function writeDraft(dir, draft) { fs.writeFileSync(path.join(dir, 'draft.json'), JSON.stringify(draft, null, 2)); }
function readDraft(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'draft.json'), 'utf8')); }
  catch (e) { throw new Error(`draft.json을 읽을 수 없습니다: ${e.message}`); }
}

function makeDir(outRoot, blogId, keyword) {
  const base = path.join(outRoot, blogId);
  fs.mkdirSync(base, { recursive: true });
  const name = `${stamp()}_${slug(keyword)}`;
  let dir = path.join(base, name);
  for (let i = 2; fs.existsSync(dir); i++) dir = path.join(base, `${name}_${i}`);
  fs.mkdirSync(dir);
  return dir;
}

// 원고 .txt 검사 후 저장: manuscript.js load()로 다시 읽혀야 통과
function saveTxt(dir, txt) {
  if (typeof txt !== 'string' || !txt.trim()) throw new Error('원고 내용이 비어 있습니다');
  const tmp = path.join(dir, `원고.__검사__${process.pid}.txt`);
  fs.writeFileSync(tmp, txt.replace(/\r\n/g, '\n'));
  let S;
  try { S = manuscript.load(tmp); }
  catch (e) { fs.rmSync(tmp, { force: true }); throw new Error(`원고 형식 오류: ${e.message}`); }
  const file = path.join(dir, '원고.txt');
  fs.renameSync(tmp, file);
  return { file, title: S.title, blocks: S.blocks.length, images: S.images.length };
}

const cardJobs = (draft, idx) => idx.map(i => ({ template: draft.images[i].template, data: draft.images[i].data, file: draft.images[i].file }));
const cardOpts = (draft, profile, dir, log) => ({ color: profile.color, outDir: dir, log, deco: draft.deco, footer: profile.blogName || '' });
const imageArgs = settings => ({ model: settings.imageModel || 'gpt-image-1', quality: settings.imageQuality || 'medium' });
// 참고 이미지 읽기(input.refs = 절대 경로 배열, 없거나 못 읽으면 건너뜀)
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
function loadRefs(input, log) {
  const out = [];
  for (const f of Array.isArray(input && input.refs) ? input.refs.slice(0, 4) : []) {
    try { out.push({ buf: fs.readFileSync(f), name: path.basename(f), type: MIME[path.extname(f).toLowerCase()] || 'image/png' }); }
    catch { log && log(`참고 이미지를 읽지 못해 건너뜀: ${path.basename(String(f))}`); }
  }
  return out;
}
const makeImage = (apiKey, settings, prompt, refs, log) => refs.length
  ? openai.imageEdit({ apiKey, ...imageArgs(settings), prompt, refs, log })
  : openai.image({ apiKey, ...imageArgs(settings), prompt, log });

async function generate({ input = {}, profile = {}, settings = {}, apiKey, outRoot, log = () => {}, step = () => {}, rand } = {}) {
  if (!outRoot) throw new Error('원고함 폴더(outRoot)가 없습니다');
  const blogId = profile.blogId || input.blogId;
  if (!blogId) throw new Error('블로그 계정(blogId)이 없습니다');
  const N = 4;
  const history = readHistory(outRoot, blogId);

  step('원고 작성', 1, N);
  let draft;
  try {
    draft = await writer.write({ apiKey, model: settings.model || 'gpt-5', input, profile, log, history, rand, reasoningEffort: settings.reasoningEffort || 'low' });
  } catch (e) {
    // 검사 실패 원고는 _실패 폴더에 남겨 둔다(기록·재시도 판단용, 반복 방지 기록에는 안 들어감)
    if (e.draft) {
      try {
        const fdir = path.join(outRoot, blogId, '_실패');
        fs.mkdirSync(fdir, { recursive: true });
        fs.writeFileSync(path.join(fdir, `${stamp()}_${slug(input.keyword)}.json`), JSON.stringify({ problems: e.problems, draft: e.draft }, null, 2));
      } catch { }
    }
    throw new Error(e.message.startsWith('원고') || e.message.startsWith('OpenAI') || e.message.startsWith('API') ? e.message : `원고 작성 실패: ${e.message}`);
  }
  const dir = makeDir(outRoot, blogId, input.keyword);
  writeDraft(dir, draft);
  log(`초안 저장: ${dir}`);

  const mode = draft.imageMode || input.imageMode || 'ai';
  step(mode === 'photos' ? '내 사진 넣기' : mode === 'clinical' ? '임상 사진 넣기' : mode === 'cards' ? '이미지 준비' : '대표 이미지 생성', 2, N);
  const aiIdx = draft.images.map((im, i) => im.kind === 'ai' ? i : -1).filter(i => i >= 0);
  if (mode === 'photos' || mode === 'clinical') {
    // 내 사진·임상 사진: OpenAI 호출 없이 고른 사진을 순서대로 복사 (확장자 유지)
    const photos = Array.isArray(input.photos) ? input.photos : [];
    aiIdx.forEach((i, k) => {
      const im = draft.images[i], src = photos[k];
      if (!src || !fs.existsSync(src)) throw new Error(`${k + 1}번째 사진 파일을 찾을 수 없습니다 — 원고는 ${dir}에 저장됨`);
      const ext = path.extname(src).toLowerCase() === '.jpeg' ? '.jpg' : path.extname(src).toLowerCase();
      im.file = `${String(i + 1).padStart(2, '0')}_사진${ext}`; im.kind = 'photo'; im.source = path.basename(src);
      fs.copyFileSync(src, path.join(dir, im.file));
      log(`내 사진 ${im.file} ← ${path.basename(src)}`);
    });
    writeDraft(dir, draft);
  }
  // 고정 이미지(히든): 계정 히든 폴더의 파일을 그대로 복사(AI 호출 없음)
  draft.images.forEach((im, i) => {
    if (im.kind !== 'hidden') return;
    const src = im.src || (Array.isArray(input.hidden) ? (input.hidden.find(h => h.file === im.source) || {}).path : '');
    if (!src || !fs.existsSync(src)) throw new Error(`고정 이미지 파일을 찾을 수 없습니다(${im.source || i + 1}) — 블로그 계정 → 히든 이미지에서 다시 가져오세요. 원고는 ${dir}에 저장됨`);
    fs.copyFileSync(src, path.join(dir, im.file));
    delete im.src;
    log(`고정 이미지 ${im.file} ← ${im.source} (${im.slot})`);
  });
  if (draft.images.some(im => im.kind === 'hidden')) writeDraft(dir, draft);
  const refs = mode === 'ai' ? loadRefs(input, log) : [];
  if (refs.length) log(`참고 이미지 ${refs.length}장을 따라 그립니다`);
  for (const i of (mode === 'ai' ? aiIdx : [])) {
    const im = draft.images[i];
    try {
      const buf = await makeImage(apiKey, settings, im.prompt, refs, log);
      fs.writeFileSync(path.join(dir, im.file), buf);
      log(`AI 이미지 ${im.file} 저장`);
    } catch (e) {
      throw new Error(`대표 이미지 생성 실패(${im.file}): ${e.message} — 원고는 ${dir}에 저장됨`);
    }
  }

  step('카드 렌더', 3, N);
  const cardIdx = draft.images.map((im, i) => im.kind === 'card' ? i : -1).filter(i => i >= 0);
  if (cardIdx.length) {
    try {
      const res = await renderer()(cardJobs(draft, cardIdx), cardOpts(draft, profile, dir, log));
      (res || []).forEach((r, k) => { const im = draft.images[cardIdx[k]]; if (im && r) { im.width = r.width; im.height = r.height; } });
      writeDraft(dir, draft);
    } catch (e) {
      throw new Error(`카드 렌더 실패: ${e.message} — 원고는 ${dir}에 저장됨`);
    }
  }

  step('원고 저장', 4, N);
  const txt = writer.toTxt(draft, dir, profile);
  saveTxt(dir, txt);
  log('원고.txt 저장 완료');
  return { dir, txt, draft };
}

// 사진 한 장 다시 만들기: ai = 다시 생성(prompt를 주면 그 장면으로), card = draft.json 데이터로 다시 렌더
async function regenImage({ dir, index, prompt, apiKey, settings = {}, profile = {}, log = () => {} } = {}) {
  const draft = readDraft(dir);
  const i = Number(index);
  const im = draft.images && draft.images[i];
  if (!im) throw new Error(`${i + 1}번 사진이 원고에 없습니다`);
  if (im.kind === 'photo') throw new Error('내 사진은 다시 생성할 수 없습니다. 원고 폴더에서 파일을 바꾸거나 다른 사진으로 다시 만들어 주세요');
  if (im.kind === 'hidden') throw new Error('고정 이미지(히든)는 다시 생성하지 않습니다. 블로그 계정 → 히든 이미지에서 바꿔 주세요');
  if (im.kind === 'ai') {
    if (prompt && String(prompt).trim()) {
      im.scene = String(prompt).trim();
      im.prompt = styles.buildImagePrompt(im.scene, draft.imageStyle, { color: profile.color, role: i === 0 ? 'header' : 'body' });
    }
    const buf = await makeImage(apiKey, settings, im.prompt, loadRefs(draft.input, log), log);
    fs.writeFileSync(path.join(dir, im.file), buf);
  } else {
    const res = await renderer()(cardJobs(draft, [i]), cardOpts(draft, profile, dir, log));
    if (res && res[0]) { im.width = res[0].width; im.height = res[0].height; }
  }
  im.regeneratedAt = new Date().toISOString();
  writeDraft(dir, draft);
  log(`${im.file} 다시 만듦`);
  return { file: im.file, image: im, draft };
}

module.exports = { generate, regenImage, saveTxt, readHistory, readDraft, slug, stamp, _setRenderer };
