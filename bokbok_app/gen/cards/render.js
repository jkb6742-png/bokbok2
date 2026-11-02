// 범용 블로그 카드 렌더러 (points / compare / checklist / steps)
// renderCards(cards, { color, outDir, log, deco='auto', footer }) -> [{file, width, height}]
// validateCard(template, data) -> string[]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const chromeEnv = require('../../../chrome');   // _도구\chrome.js: puppeteer-core 모듈·크롬 경로 자동 탐색
const WIDTH = 860;
const SCALE = 2;
const TEMPLATES = ['points', 'compare', 'checklist', 'steps'];
const DECOS = ['off', 'auto', 'rich'];
const DEFAULT_COLOR = '#03C75A';

// ---------- 색 ----------
function parseHex(hex) {
  let s = String(hex || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}
const toHex = (rgb) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
const mix = (a, b, t) => a.map((v, i) => v * (1 - t) + b[i] * t); // t = b 비중
function lum(rgb) {
  const c = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];
const NEUTRAL_INK = [26, 29, 33];

// 강조색 하나로 카드 색 묶음을 만든다. 글자 대비는 WCAG 기준으로 보정.
function makePalette(color) {
  const acc = parseHex(color) || parseHex(DEFAULT_COLOR);
  const bg = mix(acc, WHITE, 0.955);
  const tint = mix(acc, WHITE, 0.93);
  const soft = mix(acc, WHITE, 0.84);
  const line = mix(mix(acc, [222, 226, 230], 0.85), WHITE, 0.15);
  const ink = mix(acc, NEUTRAL_INK, 0.93);
  const sub = mix(acc, [84, 90, 98], 0.9);
  const faint = mix(acc, [150, 156, 162], 0.88);
  const dark = mix(acc, [38, 42, 48], 0.9);
  // 진한 강조 글자: 배경·흰색 위 모두 4.5:1 이상 될 때까지 어둡게
  let deep = acc.slice();
  for (let i = 0; i < 40 && (contrast(deep, bg) < 4.5 || contrast(deep, WHITE) < 4.5); i++) deep = mix(deep, BLACK, 0.06);
  // 강조색 위 글자: 흰 글자가 3:1(굵은 큰 글자 기준) 넘으면 흰색, 아니면 강조색을 아주 어둡게 한 색
  let onFill;
  if (contrast(WHITE, acc) >= 3) onFill = WHITE;
  else {
    onFill = mix(acc, BLACK, 0.8);
    if (contrast(onFill, acc) < 4.5) onFill = [17, 17, 17];
  }
  return {
    acc: toHex(acc), fill: toHex(acc), 'on-fill': toHex(onFill), deep: toHex(deep),
    soft: toHex(soft), tint: toHex(tint), bg: toHex(bg), line: toHex(line),
    ink: toHex(ink), sub: toHex(sub), faint: toHex(faint), dark: toHex(dark),
  };
}

// ---------- 데이터 검사 ----------
const LIMITS = {
  title: 32, subtitle: 44,
  head: 28, body: 90,
  label: 14, compareItem: 40,
  check: 60,
};
const COUNTS = { points: [3, 5], compare: [2, 5], checklist: [3, 6], steps: [3, 5] };

const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const len = (s) => [...String(s).trim()].length;

// errors: 전부, hard: 렌더 불가(구조) 오류만
function check(template, data) {
  const errors = [];
  const hard = [];
  const H = (m) => { errors.push(m); hard.push(m); };
  const S = (m) => errors.push(m);
  if (!TEMPLATES.includes(template)) { H(`알 수 없는 카드 템플릿: ${template}`); return { errors, hard }; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) { H('카드 data가 객체가 아닙니다'); return { errors, hard }; }
  if (!isStr(data.title)) H('title(제목)이 비었습니다');
  else if (len(data.title) > LIMITS.title) S(`title이 ${LIMITS.title}자를 넘습니다(${len(data.title)}자)`);
  if (data.subtitle != null && typeof data.subtitle !== 'string') S('subtitle은 문자열이어야 합니다');
  else if (isStr(data.subtitle) && len(data.subtitle) > LIMITS.subtitle) S(`subtitle이 ${LIMITS.subtitle}자를 넘습니다`);
  const [min, max] = COUNTS[template];
  const countCheck = (arr, name) => {
    if (!Array.isArray(arr) || arr.length === 0) { H(`${name} 배열이 비었습니다`); return false; }
    if (arr.length < min || arr.length > max) S(`${name}는 ${min}~${max}개여야 합니다(현재 ${arr.length}개)`);
    return true;
  };
  const headBody = (arr, name) => {
    if (!countCheck(arr, name)) return;
    arr.forEach((it, i) => {
      const n = `${name}[${i + 1}]`;
      if (!it || typeof it !== 'object') { H(`${n}이 {head, body} 객체가 아닙니다`); return; }
      if (!isStr(it.head)) H(`${n}.head가 비었습니다`);
      else if (len(it.head) > LIMITS.head) S(`${n}.head가 ${LIMITS.head}자를 넘습니다(${len(it.head)}자)`);
      if (!isStr(it.body)) S(`${n}.body가 비었습니다`);
      else if (len(it.body) > LIMITS.body) S(`${n}.body가 ${LIMITS.body}자를 넘습니다(${len(it.body)}자)`);
    });
  };
  if (template === 'points') headBody(data.items, 'items');
  if (template === 'steps') headBody(data.steps, 'steps');
  if (template === 'checklist' && countCheck(data.items, 'items')) {
    data.items.forEach((t, i) => {
      if (!isStr(t)) H(`items[${i + 1}]가 빈 문장입니다`);
      else if (len(t) > LIMITS.check) S(`items[${i + 1}]가 ${LIMITS.check}자를 넘습니다(${len(t)}자)`);
    });
  }
  if (template === 'compare') {
    for (const side of ['left', 'right']) {
      const s = data[side];
      if (!s || typeof s !== 'object') { H(`${side}가 {label, items} 객체가 아닙니다`); continue; }
      if (!isStr(s.label)) H(`${side}.label이 비었습니다`);
      else if (len(s.label) > LIMITS.label) S(`${side}.label이 ${LIMITS.label}자를 넘습니다(${len(s.label)}자)`);
      if (countCheck(s.items, `${side}.items`)) {
        s.items.forEach((t, i) => {
          if (!isStr(t)) H(`${side}.items[${i + 1}]가 빈 문장입니다`);
          else if (len(t) > LIMITS.compareItem) S(`${side}.items[${i + 1}]가 ${LIMITS.compareItem}자를 넘습니다(${len(t)}자)`);
        });
      }
    }
  }
  return { errors, hard };
}
function validateCard(template, data) { return check(template, data).errors; }

// GPT가 준 값을 깨끗한 문자열로(제어문자 제거, 공백 정리). HTML로는 절대 해석하지 않는다(템플릿이 textContent 사용).
function clean(v) {
  if (v == null) return '';
  return String(v).replace(/[\u0000-\u0008\u000B-\u001F\u007F\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
}
function normalize(template, d) {
  const hb = (arr) => (arr || []).map((x) => ({ head: clean(x && x.head), body: clean(x && x.body) }));
  const out = { title: clean(d.title) };
  if (d.subtitle) out.subtitle = clean(d.subtitle);
  if (template === 'points') out.items = hb(d.items);
  if (template === 'steps') out.steps = hb(d.steps);
  if (template === 'checklist') out.items = (d.items || []).map(clean);
  if (template === 'compare') {
    for (const s of ['left', 'right']) out[s] = { label: clean(d[s].label), items: (d[s].items || []).map(clean).filter(Boolean) };
  }
  return out;
}

function safeFileName(file, i) {
  let f = path.basename(String(file || '')).replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim();
  if (!f) f = `card_${String(i + 1).padStart(2, '0')}.png`;
  if (!/\.png$/i.test(f)) f += '.png';
  return f;
}

// ---------- 렌더 ----------
async function renderCards(cards, opts = {}) {
  const { color, outDir, log = () => {}, deco = 'auto', footer } = opts;
  if (!Array.isArray(cards) || cards.length === 0) return [];
  if (!outDir) throw new Error('카드 저장 폴더(outDir)가 없습니다');
  if (!DECOS.includes(deco)) throw new Error(`장식 옵션은 off/auto/rich 중 하나여야 합니다: ${deco}`);
  if (color && !parseHex(color)) log(`강조색 형식이 맞지 않아 기본색(${DEFAULT_COLOR})을 씁니다: ${color}`);
  // 먼저 전부 검사 — 구조 오류가 있으면 브라우저를 띄우기 전에 멈춘다
  const jobs = cards.map((c, i) => {
    const r = check(c && c.template, c && c.data);
    const file = safeFileName(c && c.file, i);
    if (r.hard.length) throw new Error(`카드 데이터 오류(${file}): ${r.hard.join(', ')}`);
    if (r.errors.length) log(`카드 ${file} 주의: ${r.errors.join(', ')} — 글자 크기를 줄여 맞춥니다`);
    return { template: c.template, data: normalize(c.template, c.data), file };
  });
  fs.mkdirSync(outDir, { recursive: true });
  const palette = makePalette(color || DEFAULT_COLOR);
  const puppeteer = chromeEnv.puppeteer, CHROME = chromeEnv.CHROME;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bokbok-cards-'));
  let browser;
  const results = [];
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME, headless: 'new', userDataDir,
      args: ['--no-sandbox', '--font-render-hinting=none', '--disable-gpu', '--no-first-run', '--no-default-browser-check'],
    });
    const page = await browser.newPage();
    const pageErrs = [];
    page.on('pageerror', (e) => pageErrs.push(e.message));
    // 네트워크 차단: 로컬 file:// 만 허용
    await page.setRequestInterception(true);
    page.on('request', (req) => (req.url().startsWith('file:') || req.url().startsWith('data:') ? req.continue() : req.abort()));
    let loaded = null;
    for (const job of jobs) {
      await page.setViewport({ width: WIDTH, height: 400, deviceScaleFactor: SCALE });
      if (loaded !== job.template) {
        await page.goto(pathToFileURL(path.join(__dirname, job.template + '.html')).href, { waitUntil: 'load', timeout: 30000 });
        loaded = job.template;
      }
      pageErrs.length = 0;
      const info = await page.evaluate((p) => window.renderCard(p),
        { template: job.template, data: job.data, deco, footer: footer ? clean(footer) : '', palette });
      if (pageErrs.length) throw new Error(`카드 렌더 스크립트 오류(${job.file}): ${pageErrs.join(' / ')}`);
      if (info.overflow) log(`카드 ${job.file}: 가로 넘침 ${info.overflow}곳 감지`);
      const height = Math.max(200, info.height);
      await page.setViewport({ width: WIDTH, height, deviceScaleFactor: SCALE });
      const file = path.join(outDir, job.file);
      await page.screenshot({ path: file, clip: { x: 0, y: 0, width: WIDTH, height }, captureBeyondViewport: true });
      results.push({ file, width: WIDTH * SCALE, height: height * SCALE });
      log(`카드 렌더 ${job.file} (${job.template}, ${deco}) ${WIDTH * SCALE}x${height * SCALE}${info.shrunk ? `, 글자 축소 ${info.shrunk}곳` : ''}`);
    }
  } catch (e) {
    if (/Failed to launch|ENOENT|spawn/.test(e.message)) throw new Error(`카드 렌더용 크롬을 실행하지 못했습니다: ${e.message}`);
    throw e;
  } finally {
    if (browser) await browser.close().catch(() => {});
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) { /* 잠금 남으면 무시 */ }
  }
  return results;
}

module.exports = { renderCards, validateCard, makePalette, contrast, parseHex, TEMPLATES, DECOS, LIMITS, COUNTS };
