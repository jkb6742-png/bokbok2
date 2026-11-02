// 스마트에디터 ONE 조작 모음 (사람처럼 직접 타이핑)
const { sleep, pause } = require('./common');
const H = require('./humanize');

// 사람 타자 속도 (설정 화면에서 조정, 환경변수로 전달)
//   TPM 분당 타수(기본 800) · JITTER 글자마다 흔들림 %(기본 30) · LINE_PAUSE 줄바꿈 뒤 쉬는 ms(기본 300)
// 한글은 자모 키 수(겹모음·겹받침은 2타)로 센다.
const TPM = Number(process.env.TPM || 800);
const MS = 60000 / TPM;
const JITTER = Number(process.env.JITTER ?? 30) / 100;
const LINE_PAUSE = Number(process.env.LINE_PAUSE ?? 300);
function strokes(ch) {
  const c = ch.charCodeAt(0) - 0xac00;
  if (c < 0 || c > 11171) return 1;
  const jung = Math.floor((c % 588) / 28), jong = c % 28;
  return 1 + ([9, 10, 11, 14, 15, 16, 19].includes(jung) ? 2 : 1) + (jong ? ([3, 5, 6, 9, 10, 11, 12, 13, 14, 15, 18].includes(jong) ? 2 : 1) : 0);
}
// 글자는 sendCharacter(문자 입력)로만 넣는다. 키 누름이 아니라서
// Ctrl이 눌린 채 남아 있어도 단축키(Ctrl+V 붙여넣기 등)가 절대 발동하지 않는다.
async function releaseMods(page) {
  for (const k of ['Control', 'Shift', 'Alt', 'Meta']) await page.keyboard.up(k).catch(() => {});
}
// 글자 하나 치는 데 걸리는 시간: 평균은 분당 TPM타, 글자마다 ±JITTER 흔들림
const delay = ch => strokes(ch) * MS * (1 - JITTER + Math.random() * 2 * JITTER);
async function human(page, text) {
  await releaseMods(page);
  if (process.env.FAST) { for (const ch of text) { await page.keyboard.sendCharacter(ch); await sleep(8); } return; }
  const chars = [...text];
  const io = { type: c => page.keyboard.sendCharacter(c), press: k => page.keyboard.press(k), delay };
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i], next = chars[i + 1];
    // 사람 습관(humanize): 가끔 오타를 내고 고치거나, 문장 끝에서 잠깐 멈춘다. 최종 글자는 그대로.
    if (H.wantTypo(ch, chars.length)) { i += await H.typo(ch, next, io); continue; }
    await page.keyboard.sendCharacter(ch);
    await sleep(delay(ch));
    if (H.wantThink(ch, next)) await H.think();
  }
}

// 한 줄을 꾸밈 조각으로 나눈다: **굵게**(안에 [[형광펜|#색]] 가능) · [[형광펜|#색]] · 일반 글자
//   → [{text}, {text, hl:'#fff8b2'}, {bold:true, parts:[{text}, {text, hl}]}]
function tokens(line) {
  const HL = /^\[\[([^|\]]+)\|(#[0-9a-f]{6})\]\]$/i;
  const inner = s => s.split(/(\[\[[^\]]+\]\])/).filter(Boolean).map(x => { const m = x.match(HL); return m ? { text: m[1], hl: m[2].toLowerCase() } : { text: x }; });
  return line.split(/(\*\*[^*]+\*\*)/).filter(Boolean).flatMap(x => {
    const bo = x.match(/^\*\*([^*]+)\*\*$/);
    return bo ? [{ bold: true, parts: inner(bo[1]) }] : inner(x);
  });
}

class Editor {
  constructor(page, f) { this.page = page; this.f = f; }

  async click(sel) {
    const el = await this.f.$(sel);
    if (!el) throw new Error('없음: ' + sel);
    await el.click(); await pause(500);
  }

  // 문서 맨 끝에 빈 본문 줄 추가하고 커서 이동
  async newLine() {
    // '본문 추가' 버튼은 마우스를 올려야 보여서 DOM 클릭으로 누른다
    const last = () => this.f.$$eval('.se-content .se-component', a => a.length);
    const n = await last();
    await this.f.$eval('.se-canvas-bottom-button', b => b.click());
    await pause(500);
    // 새로 생긴 마지막 본문 줄에 커서
    const p = await this.f.$$('.se-content .se-component:last-child .se-text-paragraph');
    if (p.length) await p[p.length - 1].click();
    await pause(400);
    return (await last()) > n;
  }

  async key(k, n = 1) { for (let i = 0; i < n; i++) { await this.page.keyboard.press(k); await sleep(90 + Math.random() * 80); } }
  async combo(mod, k) {
    try { await this.page.keyboard.down(mod); await this.page.keyboard.press(k); }
    finally { await this.page.keyboard.up(mod); }
    await sleep(150);
  }

  async isActive(sel) { return this.f.$eval(sel, b => b.classList.contains('se-is-selected') || b.classList.contains('se-is-activated') || b.getAttribute('aria-pressed') === 'true').catch(() => false); }

  // 가운데 정렬 · 글자 크기 · 굵게
  // 현재 상태를 보고 다른 것만 바꾼다
  async style({ size = 'fs19', bold = true, align = 'center' } = {}) {
    if (!await this.f.$(`.se-toolbar-item-align .se-align-${align}-toolbar-button`)) {
      await this.click('.se-toolbar-item-align .se-property-toolbar-drop-down-button');
      await this.click(`.se-toolbar-item-align button[data-value="${align}"]`);
    }
    const cur = await this.f.$eval('.se-font-size-code-toolbar-button', b => b.innerText.trim().split('\n')[0]);
    if ('fs' + cur !== size) {
      // 글자 크기 목록이 늦게 열리거나(링크 카드 뒤) 첫 클릭이 먹지 않을 때가 있어 목록이 보일 때까지 기다리고 한 번 더 누른다
      const opt = `.se-toolbar-item-font-size-code button[data-value="${size}"]`;
      let el = null;
      for (let t = 0; t < 3 && !el; t++) {
        if (t) { await this.lastLine().catch(() => { }); await pause(400); }
        await this.click('.se-font-size-code-toolbar-button');
        el = await this.f.waitForSelector(opt, { visible: true, timeout: 3000 }).catch(() => null);
      }
      if (!el) throw new Error('없음: ' + opt);
      await el.click(); await pause(500);
    }
    const on = await this.f.$eval('.se-bold-toolbar-button', b => b.classList.contains('se-is-selected'));
    if (on !== bold) await this.click('.se-bold-toolbar-button');
  }

  async highlight(color) {
    await this.click('.se-background-color-toolbar-button');
    const sel = `.se-toolbar-item-background-color .se-color-palette[data-color="${color}"]`;
    if (await this.f.$(sel)) return this.click(sel);
    console.log('  팔레트에 없는 색', color, '→ #c2f4db');
    await this.click('.se-toolbar-item-background-color .se-color-palette[data-color="#c2f4db"]');
  }

  // 줄 단위로 타이핑
  //   '## 소주제'  → 19 · 굵게      그 외 설명 줄 → 16 · 보통
  //   **강조**     → 그 부분만 굵게   [[INFJ|#bdfbfa]] → 형광펜   '' → 빈 줄
  //   줄 앞 '1. ' 같은 번호는 에디터가 자동 목록으로 바꾸면 바로 되돌려 글자 그대로 둔다
  async text(lines, { size = 'fs16', sub = 'fs19', align = 'center' } = {}) {
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      const isSub = line.startsWith('## ');
      if (isSub) line = line.slice(3);
      if (line) await this.style({ size: isSub ? sub : size, bold: isSub, align });
      const num = line.match(/^\d+\. /);
      if (num) {
        const ol = () => this.f.$$eval('.se-content ol', a => a.length);
        const before = await ol();
        await human(this.page, num[0]);
        await pause(500);
        if (await ol() > before) { await this.combo('Control', 'z'); await pause(500); }
        line = line.slice(num[0].length);
      }
      // 형광펜 한 단어: 치고 → 방금 친 글자 선택 → 형광펜 → 줄 끝으로 → 이어지는 글자엔 형광펜 끔 (굵게 상태는 그대로 유지된다)
      const hl = async (word, color) => {
        await human(this.page, word);
        try { await this.page.keyboard.down('Shift'); await this.key('ArrowLeft', [...word].length); }
        finally { await this.page.keyboard.up('Shift'); }
        await this.highlight(color);
        await this.key('End');
        await this.click('.se-background-color-toolbar-button');
        await this.click('.se-toolbar-item-background-color .se-color-palette-no-color');
      };
      for (const p of tokens(line)) {
        if (p.bold) {
          // 굵게 안에 형광펜이 있어도 된다: **[[진단|#fff8b2]] → 식립** → 굵게 켜고 안쪽을 차례로
          await this.click('.se-bold-toolbar-button');
          for (const q of p.parts) { if (q.hl) await hl(q.text, q.hl); else await human(this.page, q.text); }
          await this.click('.se-bold-toolbar-button');
        } else if (p.hl) await hl(p.text, p.hl);
        else await human(this.page, p.text);
      }
      if (i < lines.length - 1) { await this.key('Enter'); await pause(LINE_PAUSE); }
    }
    await pause(800);
  }

  // 스타일 있는 삽입(인용구·구분선 공용): 툴바 기본 단추는 마지막에 쓴 스타일을 기억한다(data-value).
  //   원하는 스타일이면 그 단추를, 아니면 옆의 '선택' 단추로 옵션 레이어를 열어 옵션(누르면 그 스타일로 바로 삽입)을 누른다.
  //   item: 'quotation' | 'horizontal-line', style: 편집기 키(default, quotation_line, line1 …), null이면 지금 스타일 그대로
  async insertStyled(item, style) {
    const box = `.se-toolbar-item-insert-${item}`;
    const main = `${box} .se-document-toolbar-icon-select-button`;
    const cur = await this.f.$eval(main, b => b.getAttribute('data-value')).catch(() => null);
    if (cur === null) throw new Error('없음: ' + main);
    if (!style || cur === style) { await this.click(main); return cur || style; }
    await this.click(`${box} .se-document-toolbar-select-option-button`);
    const opt = `.se-toolbar-option-insert-${item}-${style}-button`;
    const el = await this.f.waitForSelector(opt, { visible: true, timeout: 5000 }).catch(() => null);
    if (!el) { await this.page.keyboard.press('Escape').catch(() => { }); throw new Error(`스타일 옵션 없음: ${opt}`); }
    await el.click(); await pause(500);
    return style;
  }
  // 마지막으로 들어간 컴포넌트의 스타일 클래스(se-l-*) 확인
  async lastStyle(type) {
    return this.f.$$eval(`.se-content .se-component.se-${type}`, a => { const c = a[a.length - 1]; return c ? ([...c.classList].find(x => x.startsWith('se-l-')) || '').slice(5) : null; });
  }

  // 인용구는 현재 컴포넌트 바로 뒤에 들어가고 커서가 인용구 안에 남는다. style: styles.js 키(없으면 따옴표)
  async quote(text, style = 'default') {
    await this.insertStyled('quotation', style || 'default');
    await pause(600);
    const got = await this.lastStyle('quotation');
    if (got && got !== (style || 'default')) console.log(`  인용구 스타일 다름: 원함 ${style} / 들어감 ${got}`);
    const on = await this.f.$eval('.se-bold-toolbar-button', b => b.classList.contains('se-is-selected')).catch(() => true);
    if (!on) await this.click('.se-bold-toolbar-button');
    await human(this.page, text);
    await pause(600);
  }

  // 인용구 바로 아래에 본문을 쓰려면: 구분선을 넣어 본문 줄을 만든 뒤 구분선만 지운다 (스타일은 아무거나)
  async afterQuote() {
    await this.line(null);
    const lines = await this.f.$$('.se-content .se-component.se-horizontalLine');
    await lines[lines.length - 1].click(); await pause(400);
    await this.key('Delete'); await pause(500);
    await this.lastLine();
  }

  async lastLine() {
    const p = await this.f.$$('.se-content .se-component:last-child .se-text-paragraph');
    await p[p.length - 1].evaluate(x => x.scrollIntoView({ block: 'center' })); await pause(300);
    await p[p.length - 1].click(); await pause(300);
    await this.key('End');
  }

  // 구분선. style: styles.js 키(default, line1 …). null = 지금 툴바에 잡힌 스타일 그대로(임시 구분선용)
  async line(style = 'default') { await this.insertStyled('horizontal-line', style); await pause(600); }

  async image(file) {
    const before = await this.f.$$eval('.se-component.se-image', a => a.length);
    const btn = await this.f.$('.se-image-toolbar-button');
    const [chooser] = await Promise.all([this.page.waitForFileChooser({ timeout: 10000 }), btn.click()]);
    await chooser.accept([file]);
    for (let t = 0; t < 60; t++) { if (await this.f.$$eval('.se-component.se-image', a => a.length) > before) break; await sleep(500); }
    await pause(1500);
  }

  // 블로그 링크 카드
  //   1) 툴바 링크 단추 → 팝업에 주소 → 확인 (예전 방식. 2026-11-02 현재 편집기에서 팝업이 열리지 않는다)
  //   2) 안 열리면: 마지막 본문 끝에 새 줄을 만들고 주소를 친 뒤 Enter → 편집기가 링크 카드로 자동 변환 → 남은 주소 글자 줄만 지운다
  async link(url) {
    let inp = null;
    for (let t = 0; t < 2 && !inp; t++) {
      if (t) { await this.page.bringToFront().catch(() => { }); await this.tidy(); await this.lastLine().catch(() => { }); await pause(600); }
      let btn = await this.f.$('.se-oglink-toolbar-button');
      if (!btn) throw new Error('없음: .se-oglink-toolbar-button');
      // 창이 좁으면 링크 단추가 툴바 '더보기'(additional) 안으로 들어가 보이지 않는다 → 더보기를 열고 다시 찾는다
      if (!(await btn.boundingBox())) {
        const more = await this.f.$('.se-toolbar-item-additional-button button, .se-toolbar-item-additional-button');
        if (more) { await more.click().catch(() => { }); await pause(500); btn = await this.f.$('.se-oglink-toolbar-button') || btn; console.log('  링크 단추가 더보기 안에 있어 더보기를 엶'); }
      }
      if (t === 1) await btn.evaluate(b => b.click()); else await btn.click();   // 마우스 클릭이 안 먹으면 DOM 클릭
      await pause(500);
      inp = await this.f.waitForSelector('.se-popup-oglink-input, .se-popup-oglink input[type="text"]', { visible: true, timeout: 5000 }).catch(() => null);
      if (!inp) console.log(`  링크 팝업 없음 (${t + 1}/2)`);
    }
    if (!inp) { console.log('  링크 팝업 대신 주소 입력 → 자동 카드 변환'); return this.linkByTyping(url); }
    await inp.click(); await human(this.page, url);
    await this.key('Enter'); await pause(3500);
    await this.click('.se-popup-button-confirm'); await pause(2000);
  }
  // 주소를 치고 Enter → 편집기가 그 자리를 나눠 링크 카드를 넣는다(주소 글자는 앞 본문 끝 줄에 남는다 → 그 줄만 지운다)
  async linkByTyping(url) {
    const ogN = () => this.f.$$eval('.se-content .se-component.se-oglink', a => a.length);
    await this.lastLine();
    await this.key('Enter'); await pause(300);          // 같은 본문 칸 안의 새 빈 줄
    const n0 = await ogN();
    await human(this.page, url); await pause(400);
    await this.key('Enter');
    let ok = false;
    for (let t = 0; t < 24; t++) { await sleep(500); if (await ogN() > n0) { ok = true; break; } }
    if (!ok) throw new Error('링크 카드가 만들어지지 않았습니다 (주소 입력 뒤 자동 변환 없음)');
    await pause(1500);
    // 카드 바로 앞 본문 칸의 마지막 줄(주소 글자) 지우기: 줄 끝 → Shift+Home 선택 → Backspace(글자) → Backspace(빈 줄 합치기)
    const prevPs = await this.f.$$('.se-content .se-component.se-oglink:last-of-type');   // 자리만 확인용
    const target = await this.f.evaluateHandle(() => { const og = [...document.querySelectorAll('.se-content .se-component.se-oglink')].pop(); const prev = og && og.previousElementSibling; const ps = prev ? prev.querySelectorAll('.se-text-paragraph') : []; return ps[ps.length - 1] || null; });
    const el = target.asElement();
    if (el) {
      const had = await el.evaluate(x => (x.innerText || '').trim());
      if (had.includes(url)) {
        await el.evaluate(x => x.scrollIntoView({ block: 'center' })); await pause(200);
        await el.click(); await this.key('End');
        try { await this.page.keyboard.down('Shift'); await this.page.keyboard.press('Home'); } finally { await this.page.keyboard.up('Shift'); }
        await this.key('Backspace'); await pause(300);
        const left = await el.evaluate(x => (x.innerText || '').replace(/​/g, '').trim()).catch(() => '');
        if (!left) { await this.key('Backspace'); await pause(300); }   // 빈 줄을 앞 줄에 합친다
        const after = await this.f.evaluate(() => { const og = [...document.querySelectorAll('.se-content .se-component.se-oglink')].pop(); const prev = og && og.previousElementSibling; return prev ? (prev.innerText || '').replace(/\s+/g, ' ').trim().slice(-40) : ''; });
        console.log(`  주소 줄 정리 → 카드 앞 본문 끝: "${after}"`);
      }
    }
    void prevPs;
    await pause(800);
  }

  // 글감 검색바·라이브러리 패널이 클릭을 가로막지 않게 닫기
  async tidy() {
    for (const s of ['.se-popup-button-cancel', '.se-help-panel-close-button', '.se-sidebar-close-button', '.se-flayer-unified-fold-button']) {
      const b = await this.f.$(s); if (b) { await b.click().catch(() => {}); await pause(500); }
    }
  }

  async title(text) {
    await this.click('.se-title-text .se-text-paragraph, .se-title-text');
    await human(this.page, text);
    await pause();
  }
}

module.exports = { Editor, human, strokes, releaseMods, tokens };
