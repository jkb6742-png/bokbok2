// SAVE 모드 도구: 임시저장 확인 · [저장] 클릭 · 저장 목록 대조 · save_result.json
//   이 파일은 어떤 경우에도 [발행] 단추(publish_btn · confirm_btn)를 누르지 않는다.
//   셀렉터(2026-11-05 probe_save.js로 실제 에디터에서 확인)
//     저장 단추      : button[data-click-area="tpb.save"]  (class save_btn__…, 글자 "저장")
//     저장 개수 단추 : button[data-click-area="tpb*s.count"] (aria-label "임시저장된 글 보기, N개") → 누르면 '임시저장 글' 목록 창
//     목록 창        : [role="region"][aria-label="임시저장 글 보기"] · 개수 strong[class^="article_count_current"]
//     목록 항목      : li > button[data-click-area="tpb*s.tlist"] (strong.title__… 제목 · span.date__… "2026.11.05 00:44") + span "작성중"
//     자동저장 표시  : span[class^="autosave_message"] (저장 안내 판정에서 제외)
//     불러오기 안내창: .se-popup-alert-confirm ("작성 중인 글이 있습니다 … 이어서 작성하시겠습니까?")
'use strict';
const fs = require('fs'), path = require('path');
const { sleep, pause } = require('./common');

const SAVE_BTN = 'button[data-click-area="tpb.save"], button[class^="save_btn__"]';
const COUNT_BTN = 'button[data-click-area="tpb*s.count"], button[class^="save_count_btn__"]';
const LIST_REGION = '[role="region"][aria-label="임시저장 글 보기"]';
const norm = s => String(s || '').replace(/[​ \s]+/g, ' ').trim();

// "작성 중인 글이 있습니다" 불러오기 안내창 문구 (없으면 '')
async function restoreDialog(f) {
  for (let t = 0; t < 6; t++) {   // 안내창이 늦게 뜰 수 있어 3초까지 본다
    const msg = await f.evaluate(() => {
      const a = document.querySelector('.se-popup-alert-confirm');
      if (!a || a.getBoundingClientRect().width === 0) return '';
      return (a.innerText || '').replace(/\s+/g, ' ').trim();
    }).catch(() => '');
    if (msg) return /작성\s*중인\s*글|이어서\s*작성/.test(msg) ? msg : '';
    await sleep(500);
  }
  return '';
}

// 안내창에서 [취소] = 이어쓰기 안 함 (DRAFT_POLICY=replace 일 때만 호출)
async function dismissRestore(f) {
  const b = await f.$('.se-popup-alert-confirm .se-popup-button-cancel');
  if (!b) throw new Error('불러오기 안내창의 [취소] 단추를 찾지 못함');
  await b.click(); await pause(1500);
}

async function draftCount(f) {
  return f.evaluate(sel => {
    const b = document.querySelector(sel);
    if (!b) return null;
    const m = (b.getAttribute('aria-label') || '').match(/(\d+)\s*개/) || (b.innerText || '').match(/(\d+)/);
    return m ? Number(m[1]) : null;
  }, COUNT_BTN).catch(() => null);
}

async function autosaveText(f) {
  return f.evaluate(() => (document.querySelector('span[class^="autosave_message"]') || {}).innerText || '').catch(() => '');
}

// 목록 창 닫기: 창 안의 닫기 단추 → 없으면 Escape
async function closeList(page, f) {
  for (let t = 0; t < 3; t++) {
    const open = await f.$(LIST_REGION);
    if (!open) return true;
    const closed = await f.evaluate(sel => {
      const region = document.querySelector(sel);
      const box = region && (region.closest('[class*="popup_container"]') || region.closest('[class*="layer_popup"]'));
      if (!box) return false;
      const b = [...box.querySelectorAll('button')].find(x => /close|닫기/i.test(x.className + ' ' + (x.getAttribute('aria-label') || '') + ' ' + (x.innerText || '')));
      if (!b) return false; b.click(); return true;
    }, LIST_REGION).catch(() => false);
    if (!closed) await page.keyboard.press('Escape').catch(() => { });
    await pause(700);
  }
  return !(await f.$(LIST_REGION));
}

// 저장 목록을 열어 항목을 읽고 닫는다. 항목은 목록 창 안의 글줄(li 또는 article 영역의 자식) 글자.
async function readList(page, f) {
  const btn = await f.$(COUNT_BTN);
  if (!btn) throw new Error('저장 개수 단추를 찾지 못함');
  const label = await btn.evaluate(b => (b.className + ' ' + (b.innerText || '') + ' ' + (b.getAttribute('aria-label') || '')));
  if (/publish|발행/.test(label)) throw new Error('저장 개수 단추 대신 발행 계열 단추가 잡힘 — 중단');
  await btn.click();
  let region = null;
  for (let t = 0; t < 20 && !region; t++) { await sleep(300); region = await f.$(LIST_REGION); }
  if (!region) throw new Error('임시저장 글 목록 창이 열리지 않음');
  await sleep(1200);   // 목록 항목이 비동기로 채워지는 시간
  const data = await f.evaluate(sel => {
    const r = document.querySelector(sel);
    const txt = el => (el.innerText || '').replace(/​/g, '').replace(/[ \t]+/g, ' ').trim();
    const cnt = r.querySelector('strong[class^="article_count_current"]');
    const area = r.querySelector('div[class^="article__"]') || r;
    let rows = [...area.querySelectorAll('li')];
    if (!rows.length) rows = [...area.children].filter(x => !/no_list/.test(x.className));
    return {
      count: cnt ? Number(cnt.innerText.replace(/\D/g, '')) : null,
      empty: !!r.querySelector('[class^="no_list"]'),
      items: rows.map(li => ({ text: txt(li), lines: txt(li).split('\n').map(s => s.trim()).filter(Boolean), cls: li.className.toString().slice(0, 60) })).filter(x => x.text),
      html: r.outerHTML.slice(0, 3000),
    };
  }, LIST_REGION);
  await closeList(page, f);
  return data;
}

// 목록 항목 글자에서 저장 시각 읽기 → Date (없으면 null)
function parseItemTime(text, now = new Date()) {
  let m = text.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\s*(?:(오전|오후)\s*)?(\d{1,2}):(\d{2})/);
  if (m) { let h = +m[5]; if (m[4] === '오후' && h < 12) h += 12; if (m[4] === '오전' && h === 12) h = 0; return new Date(+m[1], +m[2] - 1, +m[3], h, +m[6]); }
  m = text.match(/(?:(오전|오후)\s*)?(\d{1,2}):(\d{2})/);
  if (m) { let h = +m[2]; if (m[1] === '오후' && h < 12) h += 12; if (m[1] === '오전' && h === 12) h = 0; return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, +m[3]); }
  if (/방금|초\s*전|1분\s*전/.test(text)) return now;
  m = text.match(/(\d+)\s*분\s*전/); if (m) return new Date(now - m[1] * 60000);
  return null;
}

// 제목이 항목 글자에 들어 있는지 (목록이 긴 제목을 …로 자를 수 있어 앞 20자 일치도 허용하되 표시)
function titleMatch(item, title) {
  const t = norm(title), x = norm(item.text);
  if (x.includes(t)) return 'full';
  const cut = item.lines.map(l => norm(l).replace(/(\.\.\.|…)$/, '')).find(l => l.length >= 20 && t.startsWith(l));
  return cut ? 'prefix' : '';
}

// [저장] 클릭 → 저장 신호(안내 문구·자동저장 표시·개수) 기다림
async function clickSave(page, f, log = console.log) {
  const btn = await f.$(SAVE_BTN);
  if (!btn) throw new Error('[저장] 단추를 찾지 못함');
  const info = await btn.evaluate(b => ({ cls: b.className.toString(), area: b.getAttribute('data-click-area'), text: (b.innerText || '').trim() }));
  // 안전장치: 글자가 정확히 '저장'이고 발행 계열이 아닐 때만 누른다
  if (info.text !== '저장' || /publish|confirm/i.test(info.cls) || /publish/.test(info.area || '')) throw new Error(`[저장] 단추 확인 실패 (${info.cls} · ${info.text}) — 누르지 않음`);
  const beforeAuto = await autosaveText(f);
  const requestedAt = new Date();
  await btn.click();
  log(`[저장] 클릭 (${info.area || info.cls})`);
  // 저장 안내(토스트 등) 문구를 3초 간격으로 최대 15초 살핀다
  let toast = '', auto = beforeAuto;
  for (let t = 0; t < 30; t++) {
    await sleep(500);
    const s = await f.evaluate(() => {
      const vis = el => el.getBoundingClientRect().width > 0;
      const hit = [...document.querySelectorAll('[class*="toast"], [class*="alert"], [class*="message"], [role="alert"], [role="status"]')].filter(vis).filter(e => !/autosave_message/.test(e.className) && !e.closest('[class*="autosave_message"]')).map(e => (e.innerText || '').replace(/\s+/g, ' ').trim()).find(x => /저장/.test(x) && x.length < 80);
      return hit || '';
    }).catch(() => '');
    if (s && !toast) toast = s;
    auto = await autosaveText(f);
    if (toast && t >= 4) break;
  }
  return { requestedAt, toast, autosaveBefore: beforeAuto, autosaveAfter: auto };
}

function writeResult(file, obj) {
  try { fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8'); console.log('결과 파일:', file); }
  catch (e) { console.log('결과 파일 저장 실패:', e.message); }
}

// 8. 내용 확인: 저장 목록에서 같은 제목 항목(1건)을 눌러 그 저장본을 편집기에 다시 불러오고 제목·첫 문단을 읽는다.
//   방금 저장한 내용 그대로라 편집기 내용이 바뀌어도 잃는 것이 없다. 삭제 단추·발행 단추는 건드리지 않는다.
//   불러오기 확인창이 뜨면 문구가 '불러오기/덮어쓰기/작성 중' 계열일 때만 [확인], '삭제' 문구면 [취소] 후 실패.
async function loadDraftFromList(page, f, title, log = console.log) {
  const btn = await f.$(COUNT_BTN);
  if (!btn) return { ok: false, reason: '저장 개수 단추 없음' };
  await btn.click();
  let region = null;
  for (let t = 0; t < 20 && !region; t++) { await sleep(300); region = await f.$(LIST_REGION); }
  if (!region) return { ok: false, reason: '목록 창이 열리지 않음' };
  await sleep(1200);
  const pick = await f.evaluate((sel, title) => {
    const n = s => String(s || '').replace(/[\u200b\u00a0\s]+/g, ' ').trim();
    const r = document.querySelector(sel); const want = n(title); const head = want.slice(0, 20);
    const all = [...r.querySelectorAll('*')].filter(e => e.getBoundingClientRect().width > 0 && n(e.innerText).includes(head));
    const leaves = all.filter(e => ![...e.children].some(c => n(c.innerText).includes(head)));
    const ok = leaves.filter(e => !e.closest('button[class*="delete"], button[aria-label*="삭제"]') && !/삭제|delete|remove/i.test(e.className + ' ' + (e.getAttribute('aria-label') || '')));
    if (ok.length !== 1) return { n: ok.length };
    // 실제 항목 단추(button[data-click-area="tpb*s.tlist"], 2026-11-05 확인)가 있으면 그것을 누른다
    const el = ok[0].closest('button[data-click-area="tpb*s.tlist"]') || ok[0]; el.setAttribute('data-bokbok-pick', '1');
    return { n: 1, tag: el.tagName, cls: el.className.toString().slice(0, 60), text: n(el.innerText).slice(0, 100) };
  }, LIST_REGION, title);
  if (pick.n !== 1) { await closeList(page, f); return { ok: false, reason: `목록에서 누를 제목 항목이 ${pick.n}개` }; }
  log(`  저장본 다시 열기: ${pick.tag}.${pick.cls} "${pick.text.slice(0, 40)}"`);
  await (await f.$('[data-bokbok-pick="1"]')).click();
  // 확인창 처리 (최대 6초)
  let popupText = '';
  for (let t = 0; t < 12; t++) {
    await sleep(500);
    const pop = await f.evaluate(() => {
      const vis = el => el && el.getBoundingClientRect().width > 0;
      const a = document.querySelector('.se-popup-alert-confirm, .se-popup-alert');
      if (vis(a)) return { kind: 'se', text: (a.innerText || '').replace(/\s+/g, ' ').trim() };
      const lp = [...document.querySelectorAll('[class*="layer_popup"], [role="alertdialog"], [role="dialog"]')].filter(vis).find(e => !e.querySelector('[aria-label="임시저장 글 보기"]') && /확인|취소/.test(e.innerText || ''));
      return lp ? { kind: 'layer', text: (lp.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200) } : null;
    }).catch(() => null);
    if (!pop) { if (!(await f.$(LIST_REGION))) break; continue; }
    popupText = pop.text;
    if (/삭제/.test(pop.text) || !/불러|덮어|작성\s*중|사라|변경|이어|열/.test(pop.text)) {
      await f.evaluate(() => { const b = [...document.querySelectorAll('.se-popup-button-cancel, button')].find(x => x.getBoundingClientRect().width > 0 && /취소/.test(x.innerText || '')); b && b.click(); });
      await closeList(page, f);
      return { ok: false, reason: `예상과 다른 확인창이라 취소함: "${pop.text.slice(0, 80)}"` };
    }
    log(`  확인창 "${pop.text.slice(0, 60)}" → [확인]`);
    const clicked = await f.evaluate(kind => {
      const vis = el => el.getBoundingClientRect().width > 0;
      const b = kind === 'se' ? document.querySelector('.se-popup-alert-confirm .se-popup-button-confirm, .se-popup-alert .se-popup-button-confirm')
        : [...document.querySelectorAll('[class*="layer_popup"] button, [role="alertdialog"] button, [role="dialog"] button')].find(x => vis(x) && /^확인$/.test((x.innerText || '').trim()));
      if (!b || /publish/i.test(b.className)) return false; b.click(); return true;
    }, pop.kind);
    if (!clicked) { await closeList(page, f); return { ok: false, reason: '확인창의 [확인] 단추를 찾지 못함' }; }
    await sleep(1000);
  }
  for (let t = 0; t < 20; t++) { await sleep(500); if (!(await f.$(LIST_REGION)) && await f.$('.se-title-text')) break; }
  if (await f.$(LIST_REGION)) await closeList(page, f);
  await sleep(1500);
  const got = await f.evaluate(() => {
    const clean = s => String(s || '').replace(/\u200b/g, '').replace(/\u00a0/g, ' ').trim();
    const title = clean((document.querySelector('.se-title-text') || {}).innerText);
    const firstText = [...document.querySelectorAll('.se-content .se-component.se-text .se-text-paragraph')].map(p => clean(p.innerText)).find(Boolean) || '';
    return { title, firstText, components: document.querySelectorAll('.se-content .se-component').length };
  });
  return { ok: true, popupText, ...got };
}

// G2 승인 확인: 원고 옆 quality.json 의 판정 PASS + approvedHash == 원고 파일 바이트 SHA-256
function g2Gate(manuscriptFile) {
  const crypto = require('crypto');
  const sha = crypto.createHash('sha256').update(fs.readFileSync(manuscriptFile)).digest('hex');
  const qf = path.join(path.dirname(manuscriptFile), 'quality.json');
  if (!fs.existsSync(qf)) {
    if (process.env.SKIP_G2 === '1') return { ok: true, skipped: true, sha, file: null, message: '경고: quality.json 이 없어 G2 승인 확인을 건너뜀 (SKIP_G2=1)' };
    return { ok: false, sha, file: qf, message: `G2 품질 승인 파일(quality.json)이 원고 옆에 없습니다. 품질 검사를 먼저 통과시키거나, 시험용이면 SKIP_G2=1 로 실행하세요. (${qf})` };
  }
  let q;
  try { q = JSON.parse(fs.readFileSync(qf, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { return { ok: false, sha, file: qf, message: `quality.json 을 읽지 못했습니다: ${e.message}` }; }
  const verdict = String(q.verdict ?? q.status ?? (q.quality && (q.quality.verdict ?? q.quality.status)) ?? '').toUpperCase();
  const approved = String(q.approvedHash ?? q.approvedManuscriptSha256 ?? (q.quality && (q.quality.approvedHash ?? q.quality.approvedManuscriptSha256)) ?? '').toLowerCase().replace(/^sha256:/, '');
  if (verdict !== 'PASS') return { ok: false, sha, file: qf, verdict, message: `G2 품질 판정이 PASS가 아닙니다 (판정: ${verdict || '없음'}). 저장·입력하지 않습니다.` };
  if (approved !== sha) return { ok: false, sha, file: qf, verdict, approved, message: `원고가 G2 승인 뒤 바뀌었습니다 (승인 해시 ${approved.slice(0, 12) || '없음'}… / 현재 ${sha.slice(0, 12)}…). 품질 검사를 다시 받으세요.` };
  return { ok: true, sha, file: qf, verdict, message: `G2 승인 확인 (PASS · 해시 ${sha.slice(0, 12)}…)` };
}

// 서식 표시를 뺀 글자 (inspect.js 와 같은 규칙)
const plainLine = l => String(l).replace(/^### |^## |^#s /, '').replace(/\*\*([^*]+?)\*\*/g, '$1').replace(/__([^_]+?)__/g, '$1').replace(/\{\{([^|}]+)\|#[0-9a-f]{6}\}\}/gi, '$1').replace(/\[\[([^|\]]+)\|#[0-9a-f]{6}\]\]/gi, '$1');

// 사람 손 입력용 꾸러미 (INPUT_MODE=MANUAL_EDITOR)
function manualPackage(S, linkUrl) {
  const out = [];
  out.push('# 수동 입력 꾸러미 (INPUT_MODE=MANUAL_EDITOR)', `# 만든 시각: ${new Date().toLocaleString('ko-KR')}`, `# 원고: ${S.file}`, '# 표시: [인용구] [구분선] [사진] [링크] [표] [본문] [해시태그] = 편집기 블록 하나. 본문 줄의 "## " = 소주제(19·굵게), "#s " = 15 크기, 나머지 16·가운데. **굵게** 표시는 그대로 둠.', '');
  out.push(`제목: ${S.title}`, `카테고리: ${S.category || ''}`, `태그(${S.tags.length}): ${S.tags.join(', ')}`, '');
  const ST = require('./styles');
  out.push(`인용구 스타일: ${ST.quoteLabel(S.quoteStyle)} · 구분선 스타일: ${ST.lineLabel(S.lineStyle)}`, '', '----- 본문 -----');
  S.blocks.forEach((b, i) => {
    const n = String(i + 1).padStart(2, '0');
    if (b.quote) out.push(`[${n} 인용구] ${b.quote}`);
    else if (b.line) out.push(`[${n} 구분선]`);
    else if (b.img !== undefined) out.push(`[${n} 사진] ${path.basename(S.images[b.img])}`);
    else if (b.link) out.push(`[${n} 링크] ${linkUrl(b.link)}`);
    else if (b.table) { out.push(`[${n} 표] ${b.table.length}행 × ${b.table[0].length}열 (첫 줄 머리글 굵게, 가운데)`); b.table.forEach(r => out.push('  ' + r.map(plainLine).join(' | '))); }
    else if (b.hashtags) out.push(`[${n} 해시태그] ${S.tags.map(t => '#' + t).join(' ')}`);
    else if (b.text) { out.push(`[${n} 본문]`); b.text.forEach(l => out.push(l)); }
    out.push('');
  });
  out.push('----- 사진 파일 -----');
  S.images.forEach((f, i) => out.push(`${i + 1}. ${f}`));
  return out.join('\r\n');
}

module.exports = { g2Gate, plainLine, manualPackage, loadDraftFromList, restoreDialog, dismissRestore, draftCount, readList, closeList, clickSave, parseItemTime, titleMatch, writeResult, autosaveText, SAVE_BTN, COUNT_BTN, LIST_REGION };
