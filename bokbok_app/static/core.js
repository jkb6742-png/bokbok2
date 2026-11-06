/* bokbok v2 core: 공용 도우미, 라우터, 상단바, 사이드바, 홈, SSE */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const mods = {};   // key -> def
  const pages = {};  // key -> def
  const subs = [];   // SSE 구독자
  let es = null, esTimer = null;
  let cleanup = null, routeSeq = 0;
  let menuOpen = false;
  let modalDone = null;

  const BB = window.BB = {
    user: null,
    auth: null,
    params: [],
  };

  /* ---------- 도우미 ---------- */
  BB.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  BB.fname = p => String(p ?? '').split(/[\\/]/).pop();

  BB.toast = msg => {
    const t = $('toast'); if (!t) return;
    t.textContent = String(msg ?? '');
    t.classList.add('on');
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('on'), 2800);
  };

  BB.api = async (path, body) => {
    const opt = body !== undefined
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {};
    opt.credentials = 'same-origin';
    let r, j;
    try { r = await fetch(path, opt); }
    catch (e) { BB.toast('서버에 연결할 수 없습니다'); const er = new Error('서버에 연결할 수 없습니다'); er.status = 0; throw er; }
    try { j = await r.json(); } catch (e) { j = {}; }
    if (r.status === 401 && !path.startsWith('/api/auth/')) {
      BB.toast(j.error || '로그인이 필요합니다');
      BB.setUser(null);
      BB.go('#/login');
      const er = new Error(j.error || '로그인이 필요합니다'); er.status = 401; throw er;
    }
    if (!r.ok || (j && j.error)) {
      const msg = (j && j.error) || ('요청을 처리하지 못했습니다 (' + r.status + ')');
      BB.toast(msg);
      const er = new Error(msg); er.status = r.status; throw er;
    }
    return j;
  };

  BB.openP = p => BB.api('/api/open', { path: p }).catch(() => {});

  /* ---------- 테마 (다크 기본, localStorage bb.theme) ---------- */
  // ui.html <head>의 작은 스크립트가 첫 그리기 전에 data-theme을 먼저 붙인다. 여기서는 바꾸기·동기화만.
  BB.getTheme = () => document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  BB.setTheme = t => {
    t = t === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('bb.theme', t); } catch (e) { /* 저장 못 해도 이번 화면에는 적용 */ }
    const b = $('themebtn');
    if (b) { b.innerHTML = themeIcon(); b.title = themeTip(); b.setAttribute('aria-label', themeTip()); }
    try { window.dispatchEvent(new CustomEvent('bb-theme', { detail: t })); } catch (e) { }
    return t;
  };
  /* ---------- 화면 크기 (작업 화면 #content 확대, localStorage bb.scale: m 보통 / l 크게(기본) / xl 아주 크게) ---------- */
  BB.SCALES = [['m', '보통', '100%'], ['l', '크게', '120%'], ['xl', '아주 크게', '135%'], ['xxl', '최대', '150%']];
  BB.getScale = () => { const z = document.documentElement.getAttribute('data-scale'); return ['m', 'xl', 'xxl'].includes(z) ? z : 'l'; };
  BB.setScale = z => {
    z = ['m', 'xl', 'xxl'].includes(z) ? z : 'l';
    document.documentElement.setAttribute('data-scale', z);
    try { localStorage.setItem('bb.scale', z); } catch (e) { }
    try { window.dispatchEvent(new CustomEvent('bb-scale', { detail: z })); } catch (e) { }
    return z;
  };
  const SUN = '<svg viewBox="0 0 16 16" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"/></g></svg>';
  const MOON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" d="M13.2 10.1A5.6 5.6 0 0 1 5.9 2.8a5.6 5.6 0 1 0 7.3 7.3z"/></svg>';
  const themeIcon = () => BB.getTheme() === 'dark' ? SUN : MOON;   // 누르면 바뀔 테마를 보여 준다
  const themeTip = () => BB.getTheme() === 'dark' ? '라이트 테마로 바꾸기' : '다크 테마로 바꾸기';

  /* ---------- 로그 색 (.log 안 글자를 줄 단위로 상태색) ---------- */
  // 각 모듈은 .log에 textContent로 글을 넣는다. 줄마다 끝에 \n을 남긴 span으로 바꿔
  // textContent를 다시 읽고 이어 붙여도 원래 글이 그대로 유지되게 한다.
  const LOG_BAD = /(실패|오류|에러|중단|거절|\berror\b|\bfail|✗)/i;
  const LOG_WARN = /(경고|주의|재시도|대기|\bwarn|\bretry)/i;
  const LOG_OK = /(완료|통과|성공|발행됨|연결됨|저장했|\bok\b|\bdone\b|✓)/i;
  function paintLog(box) {
    if (![...box.childNodes].some(n => n.nodeType === 3)) return;   // 이미 칠한 상태
    const txt = box.textContent;
    const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 4;
    const keep = box.scrollTop;
    const frag = document.createDocumentFragment();
    const lines = txt.split('\n');
    lines.forEach((l, i) => {
      const s = document.createElement('span');
      s.className = LOG_BAD.test(l) ? 'l-bad' : LOG_WARN.test(l) ? 'l-warn' : LOG_OK.test(l) ? 'l-ok' : 'l-info';
      s.textContent = l + (i < lines.length - 1 ? '\n' : '');
      if (s.textContent) frag.appendChild(s);
    });
    box.textContent = '';
    box.appendChild(frag);
    box.scrollTop = atEnd ? box.scrollHeight : keep;
  }
  function watchLogs() {
    if (typeof MutationObserver === 'undefined') return;
    new MutationObserver(ms => {
      const seen = new Set();
      ms.forEach(m => {
        const t = m.target.nodeType === 3 ? m.target.parentNode : m.target;
        const box = t && t.closest ? (t.classList && t.classList.contains('log') ? t : t.closest('.log')) : null;
        if (box) seen.add(box);
        m.addedNodes && m.addedNodes.forEach(n => { if (n.nodeType === 1) n.querySelectorAll && n.querySelectorAll('.log').forEach(b => seen.add(b)); });
      });
      seen.forEach(b => { try { paintLog(b); } catch (e) { } });
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  /* ---------- 확인 모달 ---------- */
  function closeModal(v) {
    const m = $('modal'); if (!m || m.hidden) return;
    m.hidden = true;
    const f = modalDone; modalDone = null;
    if (f) f(v);
  }
  BB.confirm = (msg, okLabel) => new Promise(resolve => {
    const m = $('modal');
    if (!m) { resolve(window.confirm(msg)); return; }
    if (modalDone) closeModal(false);
    $('modal-msg').textContent = String(msg ?? '');
    $('modal-ok').textContent = okLabel || '확인';
    modalDone = resolve;
    m.hidden = false;
    $('modal-ok').focus();
  });

  /* ---------- 등록 ---------- */
  BB.mod = (key, def) => { mods[key] = Object.assign({ name: key, desc: '', order: 100, ready: false, nav: [] }, def, { key }); };
  BB.page = (key, def) => { pages[key] = Object.assign({ title: key }, def, { key }); };

  /* ---------- 이동 ---------- */
  BB.go = hash => {
    if (!hash.startsWith('#')) hash = '#' + hash;
    if (location.hash === hash) route(); else location.hash = hash;
  };
  BB.refresh = () => route();

  /* ---------- SSE ---------- */
  BB.onEvent = fn => { if (typeof fn === 'function') subs.push(fn); return () => { const i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); }; };

  function openES() {
    if (es || !BB.user || typeof EventSource === 'undefined') return;
    clearTimeout(esTimer);
    es = new EventSource('/api/events');
    es.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      subs.slice().forEach(fn => { try { fn(m); } catch (e) { console.error(e); } });
    };
    es.onerror = () => {
      closeES();
      if (BB.user) esTimer = setTimeout(openES, 3000);
    };
  }
  function closeES() { clearTimeout(esTimer); if (es) { es.onerror = null; es.close(); es = null; } }

  BB.setUser = user => {
    BB.user = user || null;
    if (BB.user) { openES(); startNet(); } else { closeES(); stopNet(); }
    renderTop();
    try { window.dispatchEvent(new CustomEvent('bb-user', { detail: BB.user })); } catch (e) { }
  };

  /* ---------- 공인 IP (상단바) ---------- */
  let net = null, netTimer = null;
  async function loadNet(refresh) {
    try {
      const r = await fetch('/api/net' + (refresh ? '?refresh=1' : ''));
      if (!r.ok) return;
      const n = await r.json();
      const before = net && net.ip;
      net = n;
      const el = $('ipbox');
      if (el) el.outerHTML = ipHtml(); else renderTop();
      if (n.ip && before && before !== n.ip) BB.toast(`공인 IP가 바뀌었습니다: ${before} → ${n.ip}`);
      else if (refresh) BB.toast(n.ip ? `공인 IP ${n.ip}` : 'IP를 확인하지 못했습니다');
    } catch (e) { /* 오프라인 */ }
  }
  function startNet() { if (netTimer) return; loadNet(false); netTimer = setInterval(() => loadNet(false), 5 * 60 * 1000); }
  BB.loadNet = loadNet;            // 네트워크 화면에서 다시 확인할 때
  BB.netState = () => net;
  function stopNet() { clearInterval(netTimer); netTimer = null; }
  function ipHtml() {
    const e = BB.esc;
    const ip = net ? (net.ip || '확인 실패') : '확인 중';
    const lt = net && net.light ? net.light : null;
    const color = lt ? lt.color : (net && !net.ip ? 'red' : 'none');
    const region = net && net.region && net.region.label ? net.region.label : '';
    const tip = lt ? `${lt.text} · ${lt.reason}${net.checkedAt ? ' · ' + new Date(net.checkedAt).toLocaleTimeString('ko-KR') + ' 확인' : ''} · 누르면 네트워크 화면` : '누르면 네트워크 화면';
    return `<button class="ipbox lt-${color}${net && net.changedAt && Date.now() - net.changedAt < 864e5 ? ' chg' : ''}" type="button" id="ipbox" data-act="ip" title="${e(tip)}"><i class="dot" aria-hidden="true"></i><span>IP</span><b>${e(ip)}</b>${region ? `<small>${e(region)}</small>` : ''}</button>`;
  }

  /* ---------- 상단바 ---------- */
  let crumbs = [];  // [[label, hash|null], ...]

  function initial(name) { const s = String(name || '').trim(); return s ? s[0].toUpperCase() : '?'; }

  function renderTop() {
    const top = $('top'); if (!top) return;
    const u = BB.user || {};
    const e = BB.esc;
    const cr = crumbs.map((c, i) => {
      const last = i === crumbs.length - 1;
      const item = last || !c[1]
        ? `<span class="cur">${e(c[0])}</span>`
        : `<button type="button" data-go="${e(c[1])}">${e(c[0])}</button>`;
      return (i ? '<span class="sep">/</span>' : '') + item;
    }).join('');
    top.innerHTML =
      `<button class="logo" type="button" data-go="#/home" title="전체 서비스"><i></i>bokbok</button>` +
      `<nav class="crumbs" aria-label="경로">${cr}</nav>` +
      (BB.user ? ipHtml() + '<button class="topbtn" type="button" id="reloadbtn" data-act="reload" title="화면 새로고침 (F5)" aria-label="새로고침"><svg viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" d="M13.3 8a5.3 5.3 0 1 1-1.55-3.75M13.3 2.6v2.9h-2.9"/></svg><span>새로고침</span></button>' : '') +
      `<button class="topbtn" type="button" id="themebtn" data-act="theme" title="${themeTip()}" aria-label="${themeTip()}">${themeIcon()}</button>` +
      `<span class="top-div" aria-hidden="true"></span>` +
      `<div class="umenu">` +
        `<button class="ubtn${menuOpen ? ' on' : ''}" type="button" id="ubtn" aria-haspopup="menu" aria-expanded="${menuOpen}">` +
          `<span class="ini">${e(initial(u.name))}</span><span class="nm">${e(u.name || '')}</span><span class="car">▾</span>` +
        `</button>` +
        `<div class="udrop" id="udrop" role="menu"${menuOpen ? '' : ' hidden'}>` +
          `<div class="who"><b>${e(u.name || '')}</b><span>${e(u.email || '')}</span></div>` +
          `<button type="button" data-act="jobs">작업 현황</button>` +
          `<button type="button" data-act="me">내 계정 정보</button>` +
          `<button type="button" data-act="prefs">환경설정</button>` +
          (u.role === 'admin' ? `<button type="button" data-act="users">사용자 관리</button>` : '') +
          `<hr>` +
          `<button type="button" data-act="logout">로그아웃</button>` +
          `<button type="button" data-act="quit">앱 종료</button>` +
        `</div>` +
      `</div>`;
  }

  function setMenu(open) {
    menuOpen = open;
    const d = $('udrop'), b = $('ubtn');
    if (d) d.hidden = !open;
    if (b) { b.classList.toggle('on', open); b.setAttribute('aria-expanded', String(open)); }
  }

  async function logout() {
    try { await BB.api('/api/auth/logout', {}); } catch (e) { /* 이미 끊긴 세션이어도 로그인 화면으로 */ }
    BB.setUser(null);
    BB.go('#/login');
  }

  async function quitApp() {
    if (!(await BB.confirm('bokbok을 종료할까요?', '종료'))) return;
    closeES();
    try { await fetch('/api/quit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch (e) { /* 서버가 먼저 꺼질 수 있음 */ }
    if (cleanup) { try { cleanup(); } catch (e) { } cleanup = null; }
    document.body.innerHTML = '<div class="bye">종료했습니다. 창을 닫아도 됩니다.</div>';
  }

  function onTopClick(ev) {
    const g = ev.target.closest('[data-go]');
    if (g) { setMenu(false); BB.go(g.getAttribute('data-go')); return; }
    if (ev.target.closest('#ubtn')) { setMenu(!menuOpen); return; }
    const a = ev.target.closest('[data-act]');
    if (!a) return;
    setMenu(false);
    const act = a.getAttribute('data-act');
    if (act === 'me') BB.go('#/me');
    else if (act === 'prefs') BB.go('#/prefs');
    else if (act === 'users') BB.go('#/users');
    else if (act === 'jobs') BB.go('#/jobs');
    else if (act === 'logout') logout();
    else if (act === 'quit') quitApp();
    else if (act === 'ip') { if (location.hash.startsWith('#/net')) loadNet(true); else BB.go('#/net'); }
    else if (act === 'reload') location.reload();
    else if (act === 'theme') BB.setTheme(BB.getTheme() === 'dark' ? 'light' : 'dark');
  }

  /* ---------- 사이드바 ---------- */
  function renderSide(def, page) {
    const side = $('side');
    side.innerHTML = '';
    const [grp, en] = metaOf(def);
    const nm = document.createElement('div');
    nm.className = 'side-name';
    nm.textContent = def.name;          // 묶음(NAVER)·영문 이름(BLOG)은 CSS가 data-*로 그린다
    nm.setAttribute('data-grp', grp);
    nm.setAttribute('data-en', en);
    // 로그인 정보: 서비스 이름 아래에 지금 로그인한 대표 아이디
    if (BB.user) {
      const me = document.createElement('div');
      me.className = 'side-user';
      me.innerHTML = '<span class="side-user-k">로그인</span><b></b><em></em>';
      me.querySelector('b').textContent = BB.user.name || BB.user.email || '';
      me.querySelector('em').textContent = (BB.user.email && BB.user.email !== BB.user.name ? BB.user.email : '') + (BB.user.role === 'admin' ? (BB.user.email && BB.user.email !== BB.user.name ? ' · ' : '') + '관리자' : '');
      nm.appendChild(me);
    }
    side.appendChild(nm);
    const top = document.createElement('div');
    top.className = 'side-top';
    side.appendChild(top);
    if (typeof def.sideTop === 'function') {
      try { def.sideTop(top); } catch (e) { console.error('[bokbok] sideTop 오류:', def.key, e); }
    }
    const lab = document.createElement('div');
    lab.className = 'side-label';
    lab.textContent = 'Menu';
    side.appendChild(lab);
    const nav = document.createElement('div');
    nav.className = 'side-nav';
    (def.nav || []).forEach(([p, label]) => {
      // '-' 로 시작하는 항목 = 메뉴 묶음 제목(누를 수 없음)
      if (String(p).charAt(0) === '-') { const g = document.createElement('div'); g.className = 'side-label side-grp'; g.textContent = label; nav.appendChild(g); return; }
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;   // 번호(01, 02…)는 CSS counter로 — 글자는 메뉴 이름 그대로
      if (p === page) { b.className = 'on'; b.setAttribute('aria-current', 'page'); }
      b.onclick = () => BB.go('#/' + def.key + '/' + p);
      nav.appendChild(b);
    });
    side.appendChild(nav);
    const back = document.createElement('div');
    back.className = 'side-back';
    back.innerHTML = '<button type="button">← 전체 서비스</button>';
    back.firstChild.onclick = () => BB.go('#/home');
    side.appendChild(back);
  }

  /* ---------- 홈 ---------- */
  // 서비스 메타: 묶음(영문) · 영문 이름 · 짧은 메타 줄 · 단색 아이콘(currentColor)
  const SVG = d => `<svg viewBox="0 0 48 48" aria-hidden="true">${d}</svg>`;
  const GROUPS = [
    ['NAVER', '네이버', '병원 블로그 지수와 블로그·카페 발행.', ['clinic', 'blog', 'cafe']],
    ['META', '메타', '페이스북 · 인스타그램 · 쓰레드에 게시합니다.', ['facebook', 'instagram', 'threads']],
    ['GLOBAL', '글로벌', '해외 커뮤니티와 SNS에 게시합니다.', ['reddit', 'twitter']],
  ];
  const LOOK = {
    clinic: { en: 'CLINIC INDEX', tags: ['병의원 전용', '지역 키워드', '의료법 검수'],
      icon: SVG('<g fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"><path d="M9 40V16l15-8 15 8v24z"/><path d="M24 17v12M18 23h12" stroke-linecap="round"/></g>') },
    blog: { en: 'BLOG', tags: ['사람 속도 입력', '전수검사'],
      icon: SVG('<path fill="currentColor" d="M12 9h8l8 12.4V9h8v30h-8l-8-12.4V39h-8z"/>') },
    cafe: { en: 'CAFE', tags: ['공식 API', '게시판 발행'],
      icon: SVG('<g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M10 20h22v8a10 10 0 0 1-10 10h-2a10 10 0 0 1-10-10z"/><path d="M32 22h3a4.5 4.5 0 0 1 0 9h-3.5"/><path d="M17 9c-1.5 2 1.5 3.5 0 6M23 9c-1.5 2 1.5 3.5 0 6M29 9c-1.5 2 1.5 3.5 0 6"/></g>') },
    instagram: { en: 'INSTAGRAM', tags: ['피드', '캐러셀'],
      icon: SVG('<g fill="none" stroke="currentColor" stroke-width="3.2"><rect x="9" y="9" width="30" height="30" rx="8.5"/><circle cx="24" cy="24" r="7"/></g><circle cx="32.5" cy="15.5" r="2.1" fill="currentColor"/>') },
    threads: { en: 'THREADS', tags: ['500자', '토큰 자동 연장'],
      icon: SVG('<path fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" d="M31.5 21.5c-.8-4.6-4-7-8.4-7-5.6 0-9.1 4.2-9.1 9.6 0 5.7 3.6 9.9 9.4 9.9 4.4 0 7.9-2.2 8.6-6.3.6-3.7-2.4-5.9-6.7-5.9-3.4 0-5.6 1.6-5.6 3.9 0 2.1 1.9 3.3 4.2 3.3 3.4 0 5.6-2.4 5.6-6.6V20c0-6.5-3.7-10-10.2-10C14.9 10 9.5 15.6 9.5 24.1 9.5 32.8 14.9 38 23.4 38c4.5 0 8-1.5 10.4-4"/>') },
    facebook: { en: 'FACEBOOK', tags: ['페이지 발행', '공식 API'],
      icon: SVG('<path fill="currentColor" d="M26.5 40V26.6h4.5l.7-5.3h-5.2V18c0-1.5.4-2.6 2.6-2.6h2.8v-4.7c-.5-.1-2.1-.2-4-.2-4 0-6.7 2.4-6.7 6.9v3.9H16.7v5.3h4.5V40z"/>') },
    twitter: { en: 'X', tags: ['짧은 글', '유료 API'],
      icon: SVG('<path fill="currentColor" d="M30.9 11h4.6l-10 11.5L37.3 38h-9.2l-7.2-9.4-8.3 9.4H8l10.7-12.2L7.5 11h9.4l6.5 8.6zm-1.6 24.3h2.5L15.6 13.6h-2.7z"/>') },
    reddit: { en: 'REDDIT', tags: ['공식 API', '사전 승인 필요'],
      icon: SVG('<g fill="currentColor"><ellipse cx="24" cy="28" rx="13" ry="9"/><circle cx="34" cy="13" r="3"/><circle cx="12.5" cy="22" r="3.2"/><circle cx="35.5" cy="22" r="3.2"/></g><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M24 19l2.5-8 7.5 2"/><g class="cut-f"><circle cx="19" cy="27" r="2.3"/><circle cx="29" cy="27" r="2.3"/></g><path class="cut-s" fill="none" stroke-width="1.8" stroke-linecap="round" d="M19.5 32c2.8 2 6.2 2 9 0"/>') },
  };
  // [묶음, 영문 이름] — 사이드바·경로·페이지 머리에서 같이 쓴다
  function metaOf(def) {
    const g = GROUPS.find(x => x[3].includes(def.key));
    const k = LOOK[def.key];
    return [g ? g[0] : 'TOOLS', k ? k.en : String(def.key || '').toUpperCase()];
  }
  const ARROW = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" d="M4.5 11.5l7-7M5.5 4.5h6v6"/></svg>';
  const CHEV = d => `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="${d}"/></svg>`;
  const pad2 = n => String(n).padStart(2, '0');

  BB.page('home', {
    title: '전체 서비스',
    render(el) {
      const list = Object.values(mods).filter(m => BB.canSee(m.key)).sort((a, b) => (a.order - b.order) || String(a.name).localeCompare(String(b.name)));
      const e = BB.esc;
      if (!list.length) { el.innerHTML = `<div class="page-h"><h1>전체 서비스</h1></div><div class="panel empty">${Object.keys(mods).length ? '사용 권한이 있는 서비스가 없습니다. 관리자에게 요청하세요.' : '등록된 서비스가 없습니다.'}</div>`; return; }
      // 섹션: NAVER / META / GLOBAL (+ 묶이지 않은 모듈은 TOOLS)
      const used = new Set(GROUPS.flatMap(g => g[3]));
      const sections = GROUPS.map(([en, kr, d, keys]) => [en, kr, d, keys.map(k => mods[k]).filter(m => m && BB.canSee(m.key))]);
      const rest = list.filter(m => !used.has(m.key));
      if (rest.length) sections.push(['TOOLS', '기타', '', rest]);
      const shown = sections.filter(s => s[3].length);

      let idx = 0;
      const card = m => {
        const k = LOOK[m.key] || { en: String(m.key).toUpperCase(), tags: [], icon: '' };
        idx++;
        const len = k.en.length, cls = len >= 9 ? 'l9' : len >= 7 ? 'l7' : '';
        return `<button class="svc" type="button" data-key="${e(m.key)}" title="${e(m.desc || '')}">` +
          `<div class="svc-top"><span class="svc-idx">${pad2(idx)}</span><span class="svc-ico">${k.icon}</span></div>` +
          `<div class="svc-name"><b class="${cls}">${e(k.en)}</b><span>${e(m.name)}</span></div>` +
          `<div class="svc-meta">${e(k.tags.join(' · '))}</div>` +
          `<div class="svc-foot"><span class="svc-st${m.ready ? ' on' : ''}" data-st="${e(m.key)}"><i></i><em>${m.ready ? '사용 가능' : '확인 중'}</em></span>` +
          `<span class="svc-arr">${ARROW}</span></div>` +
        `</button>`;
      };
      const now = new Date();
      const hour = now.getHours();
      const hello = hour < 12 ? '좋은 아침입니다' : hour < 18 ? '좋은 오후입니다' : '오늘도 수고하셨습니다';
      const day = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][now.getDay()];
      const today = `${now.getFullYear()}.${pad2(now.getMonth() + 1)}.${pad2(now.getDate())}`;
      el.innerHTML =
        `<section class="home-hero">` +
          `<div><div class="home-eb">bokbok / control room<span>v2</span></div>` +
          `<h1 class="home-display">Multi-channel<span>publishing</span></h1>` +
          `<p class="home-lede">${e(hello)}, ${e((BB.user && BB.user.name) || '')}님. 병의원 블로그를 진단하고, 원고를 만들어 블로그·카페·SNS로 올립니다.</p></div>` +
          `<div class="chrome-wrap" aria-hidden="true"><div class="chrome"><i></i></div></div>` +
        `</section>` +
        `<dl class="svc-sum">` +
          `<div><dt>Connected</dt><dd><b id="svc-count">-</b><small>/ ${pad2(list.length)}</small></dd></div>` +
          `<div><dt>Groups</dt><dd>${pad2(shown.length)}<small>${e(shown.map(s => s[0]).join(' · '))}</small></dd></div>` +
          `<div><dt>Today</dt><dd>${today}<small>${day}</small></dd></div>` +
        `</dl>` +
        shown.map(([en, kr, d, ms], si) =>
          `<section class="svc-sec"><div class="svc-h">` +
          `<div class="svc-eb">${pad2(si + 1)} / ${e(en)}</div>` +
          `<h2>${e(en)}<span>(${pad2(ms.length)})</span></h2>` +
          `<p>${e(kr)}${d ? ' — ' + e(d) : ''}</p>` +
          `<div class="svc-nav"><button type="button" class="svc-arrow" data-dir="-1" aria-label="${e(kr)} 이전">${CHEV('M10 3L5 8l5 5')}</button>` +
          `<button type="button" class="svc-arrow" data-dir="1" aria-label="${e(kr)} 다음">${CHEV('M6 3l5 5-5 5')}</button></div></div>` +
          `<div class="svc-track" tabindex="0">${ms.map(card).join('')}</div></section>`).join('');

      const syncs = [];
      el.querySelectorAll('.svc-sec').forEach(sec => {
        const track = sec.querySelector('.svc-track');
        const arrows = [...sec.querySelectorAll('.svc-arrow')];
        const sync = () => {
          const over = track.scrollWidth > track.clientWidth + 2;
          sec.classList.toggle('fits', !over);
          arrows[0].disabled = track.scrollLeft <= 2;
          arrows[1].disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
        };
        const step = dir => {
          const c = track.querySelector('.svc');
          track.scrollBy({ left: dir * (c ? c.offsetWidth : 300), behavior: 'smooth' });
        };
        arrows.forEach(a => { a.onclick = () => step(+a.getAttribute('data-dir')); });
        track.addEventListener('scroll', sync, { passive: true });
        track.addEventListener('wheel', ev => {   // 세로 휠 → 가로 이동 (넘칠 때만)
          if (Math.abs(ev.deltaY) > Math.abs(ev.deltaX) && track.scrollWidth > track.clientWidth + 2) {
            const atEnd = (ev.deltaY > 0 && track.scrollLeft + track.clientWidth >= track.scrollWidth - 2) || (ev.deltaY < 0 && track.scrollLeft <= 2);
            if (!atEnd) { ev.preventDefault(); track.scrollBy({ left: ev.deltaY }); }
          }
        }, { passive: false });
        track.addEventListener('keydown', ev => { if (ev.key === 'ArrowRight') step(1); if (ev.key === 'ArrowLeft') step(-1); });
        syncs.push(sync);
      });
      el.querySelectorAll('.svc').forEach(c => { c.onclick = () => BB.go('#/' + c.getAttribute('data-key')); });
      const sync = () => syncs.forEach(f => f());
      window.addEventListener('resize', sync);
      requestAnimationFrame(sync);

      // 채널 연결 상태
      let alive = true, connected = list.filter(m => m.ready).length;
      const setSt = (key, txt, cls) => {
        const s = alive && el.querySelector(`[data-st="${key}"]`);
        if (!s) return;
        s.querySelector('em').textContent = txt;
        s.className = 'svc-st' + (cls ? ' ' + cls : '');
      };
      const setCount = () => { const c = alive && el.querySelector('#svc-count'); if (c) c.textContent = connected; };
      setCount();
      list.filter(m => !m.ready).forEach(async m => {
        if (m.engine === false) { setSt(m.key, '준비 중', 'off'); return; }
        let txt = '준비 중', cls = 'off';
        try {
          const r = await fetch('/api/engine/info?p=' + encodeURIComponent(m.key));
          if (r.ok) { const j = await r.json(); if (j.connected) { txt = '연결됨'; cls = 'on'; connected++; setCount(); } else { txt = '연결 필요'; cls = 'need'; } }
        } catch (er) { /* 무시 */ }
        setSt(m.key, txt, cls);
      });
      return () => { alive = false; window.removeEventListener('resize', sync); };
    },
  });

  /* ---------- 라우터 ---------- */
  function runCleanup() {
    const f = cleanup; cleanup = null;
    if (typeof f === 'function') { try { f(); } catch (e) { console.error('[bokbok] cleanup 오류:', e); } }
  }

  function fail(el, where, err) {
    console.error('[bokbok] 화면 오류:', where, err);
    el.innerHTML = '<div class="panel empty">이 화면을 불러오지 못했습니다.<br><span class="muted">잠시 후 다시 시도하거나 앱을 다시 실행해 주세요.</span></div>';
  }

  // render 호출: 동기/비동기 모두 처리, 반환된 함수는 cleanup으로 보관
  function mount(el, where, fn) {
    const seq = routeSeq;
    let r;
    try { r = fn(); } catch (err) { fail(el, where, err); return; }
    const keep = f => {
      if (typeof f !== 'function') return;
      if (seq === routeSeq) cleanup = f;
      else { try { f(); } catch (e) { console.error(e); } }  // 이미 다른 화면으로 넘어감
    };
    if (r && typeof r.then === 'function') {
      r.then(keep, err => { if (seq === routeSeq) fail(el, where, err); else console.error(err); });
    } else keep(r);
  }

  function showShell(withSide) {
    $('auth').hidden = true; $('auth').innerHTML = '';
    $('top').hidden = false;
    $('body').hidden = false;
    $('body').classList.toggle('no-side', !withSide);
  }

  // 플랫폼 권한: 관리자는 전부, 그 밖에는 perms[key] 가 none 이 아닌 모듈만 보인다
  BB.canSee = key => { const u = BB.user; if (!u) return false; if (u.role === 'admin') return true; const p = u.perms || {}; return !(key in p) || p[key] !== 'none'; };
  BB.permOf = key => { const u = BB.user; if (!u) return 'none'; if (u.role === 'admin') return key === 'net' ? 'write' : 'publish'; return (u.perms || {})[key] || 'none'; };
  function startHash() {
    const v = BB.user && BB.user.prefs && BB.user.prefs.startView;
    return (v && v !== 'home' && mods[v] && BB.canSee(v)) ? '#/' + v : '#/home';
  }

  function route() {
    routeSeq++;
    runCleanup();
    setMenu(false);
    closeModal(false);

    const raw = (location.hash || '').replace(/^#\/?/, '');
    const parts = raw.split('/').filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch (e) { return s; } });
    const head = parts[0] || '';

    // 로그인/가입
    if (head === 'login' || head === 'signup') {
      if (BB.user) { location.replace(startHash()); return; }
      $('top').hidden = true; $('body').hidden = true;
      $('content').innerHTML = ''; $('side').innerHTML = '';
      const a = $('auth'); a.hidden = false; a.innerHTML = '';
      document.title = (head === 'login' ? '로그인' : '회원가입') + ' - bokbok';
      if (!BB.auth || typeof BB.auth.render !== 'function') { fail(a, 'auth', new Error('auth.js가 로드되지 않았습니다')); return; }
      mount(a, 'auth:' + head, () => BB.auth.render(head, a));
      return;
    }
    if (!BB.user) { location.replace('#/login'); return; }
    if (!head) { location.replace(startHash()); return; }

    const el = $('content');
    el.innerHTML = '';
    el.scrollTop = 0; window.scrollTo(0, 0);

    // 단독 페이지 (home, me, prefs ...)
    if (pages[head] && !mods[head]) {
      const pg = pages[head];
      if (pg.admin && !(BB.user && BB.user.role === 'admin')) { location.replace(startHash()); return; }
      BB.params = parts.slice(1);
      showShell(false);
      crumbs = head === 'home' ? [['Services', null]] : [['Services', '#/home'], [pg.title, null]];
      el.style.setProperty('--eyebrow', JSON.stringify(PAGE_EB[head] || String(head).toUpperCase()));
      renderTop();
      document.title = (head === 'home' ? '' : pg.title + ' - ') + 'bokbok';
      mount(el, 'page:' + head, () => pg.render(el));
      return;
    }

    // 모듈
    const def = mods[head];
    if (!def) { location.replace('#/home'); return; }
    if (!BB.canSee(head)) { BB.toast && BB.toast('이 서비스는 사용 권한이 없습니다. 관리자에게 요청하세요'); location.replace('#/home'); return; }
    const nav = def.nav || [];
    const first = nav.find(n => String(n[0]).charAt(0) !== '-');
    if (!parts[1] && first) { location.replace('#/' + head + '/' + first[0]); return; }
    const page = parts[1] || null;
    BB.params = parts.slice(2);
    const hit = nav.find(n => n[0] === page && String(n[0]).charAt(0) !== '-');
    showShell(true);
    renderSide(def, page);
    const [grp, en] = metaOf(def);
    crumbs = [['Services', '#/home'], [grp, '#/home'], [en, hit ? '#/' + head : null]];
    el.style.setProperty('--eyebrow', JSON.stringify(grp + ' ' + en + (page ? ' / ' + page : '')));
    if (hit) crumbs.push([hit[1], null]);
    renderTop();
    document.title = (hit ? hit[1] + ' - ' : '') + def.name + ' - bokbok';
    if (typeof def.render !== 'function') { fail(el, 'mod:' + head, new Error('render 없음')); return; }
    mount(el, 'mod:' + head + '/' + page, () => def.render(page, el));
  }

  const PAGE_EB = { me: 'ACCOUNT / PROFILE', prefs: 'SYSTEM / PREFERENCES', users: 'ADMIN / USERS' };

  /* ---------- 부팅 ---------- */
  let booted = false;
  BB.boot = async () => {
    if (booted) return; booted = true;

    $('top').addEventListener('click', onTopClick);
    watchLogs();
    document.addEventListener('click', ev => {
      if (menuOpen && !ev.target.closest('.umenu')) setMenu(false);
    });
    document.addEventListener('keydown', ev => {
      if (ev.key !== 'Escape' && ev.key !== 'Enter') return;
      const m = $('modal');
      if (m && !m.hidden) {
        if (ev.key === 'Enter' && document.activeElement === $('modal-no')) { ev.preventDefault(); closeModal(false); return; }
        ev.preventDefault();
        closeModal(ev.key === 'Enter');
        return;
      }
      if (ev.key === 'Escape' && menuOpen) { setMenu(false); const b = $('ubtn'); if (b) b.focus(); }
    });
    $('modal-ok').onclick = () => closeModal(true);
    $('modal-no').onclick = () => closeModal(false);
    $('modal').addEventListener('click', ev => { if (ev.target.id === 'modal') closeModal(false); });

    let user = null;
    try {
      const r = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (r.ok) { const j = await r.json(); user = j.user || null; }
    } catch (e) { BB.toast('서버에 연결할 수 없습니다'); }

    BB.setUser(user);
    window.addEventListener('hashchange', route);

    route();  // 로그인 여부·빈 hash·login/signup 리다이렉트는 route()가 처리
  };
})();
