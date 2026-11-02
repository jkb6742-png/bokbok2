// 카드 템플릿 공통 도우미. 데이터는 전부 textContent로만 넣는다(HTML 해석 안 함).
// 각 템플릿 HTML은 window.build(app, data, opts) 를 정의한다.
(function () {
  const ICONS = {
    points: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1.1 1.3 1.1 2.2h5c0-.9.5-1.7 1.1-2.2A6 6 0 0 0 12 3z"/></svg>',
    compare: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4 3 8l4 4"/><path d="M3 8h13"/><path d="m17 12 4 4-4 4"/><path d="M21 16H8"/></svg>',
    checklist: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="m8.5 12.5 2.2 2.2 4.8-4.8"/></svg>',
    steps: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  };

  function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = String(text);
    return e;
  }
  function svg(name) { // 고정 문자열만 사용
    const t = document.createElement('template');
    t.innerHTML = ICONS[name] || '';
    return t.content.firstElementChild;
  }
  // fit: "기본px,최소px,최대줄" — 줄 수가 넘으면 글자 크기를 1px씩 줄인다(잘림 없음)
  function fitAttr(el, base, min, lines) {
    el.style.fontSize = base + 'px';
    el.dataset.fit = [base, min, lines].join(',');
    return el;
  }
  function header(data, opts, icon) {
    const box = h('div', 'hd');
    if (opts.deco === 'rich') { const ic = h('div', 'ic'); ic.appendChild(svg(icon)); box.appendChild(ic); }
    box.appendChild(fitAttr(h('h1', null, data.title), 42, 32, 2));
    if (data.subtitle) box.appendChild(fitAttr(h('div', 'sub', data.subtitle), 20, 17, 2));
    box.appendChild(h('div', 'bar'));
    return box;
  }
  function pad2(n) { return String(n).padStart(2, '0'); }

  function lineCount(el) {
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
    return Math.round(el.getBoundingClientRect().height / lh);
  }
  function runFits() {
    const shrunk = [];
    document.querySelectorAll('[data-fit]').forEach((el) => {
      const [base, min, lines] = el.dataset.fit.split(',').map(Number);
      let size = base;
      el.style.fontSize = size + 'px';
      while (lineCount(el) > lines && size > min) { size -= 1; el.style.fontSize = size + 'px'; }
      if (size !== base) shrunk.push(size);
    });
    // 같은 묶음(data-fit-group)은 가장 작은 크기로 맞춘다
    const groups = {};
    document.querySelectorAll('[data-fit-group]').forEach((el) => {
      const g = el.dataset.fitGroup; const s = parseFloat(el.style.fontSize);
      groups[g] = Math.min(groups[g] || 999, s);
    });
    document.querySelectorAll('[data-fit-group]').forEach((el) => { el.style.fontSize = groups[el.dataset.fitGroup] + 'px'; });
    return shrunk.length;
  }

  window.Card = { h, svg, header, fitAttr, pad2 };

  window.renderCard = async function (p) {
    const root = document.documentElement.style;
    for (const [k, v] of Object.entries(p.palette || {})) root.setProperty('--' + k, v);
    document.body.dataset.deco = p.deco;
    document.body.dataset.template = p.template;
    document.querySelectorAll('.blob').forEach((b) => b.remove());
    if (p.deco === 'rich') for (const c of ['a', 'b', 'c']) document.body.insertBefore(h('div', 'blob bl-' + c), document.body.firstChild);
    const app = document.getElementById('app');
    app.textContent = '';
    window.__afterFit = null;
    window.build(app, p.data, p);
    if (p.footer) app.appendChild(h('div', 'ft', p.footer));
    await document.fonts.ready;
    const shrunk = runFits();
    if (typeof window.__afterFit === 'function') window.__afterFit();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    // 잘림 검사: 어떤 요소도 body 밖으로 나가지 않아야 한다
    const bodyR = document.body.getBoundingClientRect();
    let overflow = 0;
    document.querySelectorAll('#app *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.right > bodyR.right + 0.5 || r.left < bodyR.left - 0.5) overflow++;
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible') overflow++;
    });
    return { height: Math.ceil(document.body.getBoundingClientRect().height), shrunk, overflow,
      font: getComputedStyle(document.body).fontFamily };
  };
})();
