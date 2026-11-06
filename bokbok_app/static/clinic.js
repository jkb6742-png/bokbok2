/* bokbok: 병원 블로그 지수(index_web 편입, 2026-11-05)
 * 왼쪽 메뉴 = 카테고리, 화면 안 = 탭. 지수 화면은 같은 PC의 지수 서버(3610)를 iframe 으로 띄운다(입장권으로 로그인 이어짐).
 * 병의원 전용: 등록한 병원 블로그만 본다. 일반 블로그는 관리자 CMD 로만.
 */
(function () {
  'use strict';
  const BB = window.BB; if (!BB) return;
  const esc = BB.esc;
  const LS = 'bb.clinic.blog';
  const getSel = () => { try { return localStorage.getItem(LS) || ''; } catch (e) { return ''; } };
  const setSel = v => { try { localStorage.setItem(LS, v); } catch (e) { } };
  let H = null;           // { list, depts, accounts, admin, general }
  let entered = false;    // 이 창에서 입장권을 한 번 썼는지(그 뒤로는 지수 세션 쿠키로 바로 연다)
  let frameHost = null;

  async function loadH(force, extra) {
    if (H && !force && !extra) return H;
    H = await BB.api('/api/idx/hospitals', extra || {});
    return H;
  }
  const cur = () => { const id = getSel(); return (H && H.list.find(h => h.blogId === id)) || (H && H.list[0]) || null; };

  // 카테고리 → 지수 화면 첫 탭(주소 끝)
  const VIEW = { summary: '', cindex: '/cindex', grow: '/grow', region: '/region', plan: '/recommend', search: '/exposure', medlaw: '/medlaw', content: '/content', ops: '/overview' };
  const TOOL = { keywords: '#/keywords', rank: '#/rank' };

  function sideTop(top) {
    const paint = () => {
      const list = (H && H.list) || [], c = cur();
      top.innerHTML = list.length
        ? `<label class="cl-pick"><span>병원 블로그</span><select id="clPick">${list.map(h => `<option value="${esc(h.blogId)}"${c && c.blogId === h.blogId ? ' selected' : ''}>${esc(h.name || h.blogId)} · ${esc(h.deptLabel)}</option>`).join('')}</select></label>${c ? `<div class="cl-meta">${esc(c.regionText)}</div>` : ''}`
        : `<div class="cl-meta">등록된 병원 블로그가 없습니다</div>`;
      const s = top.querySelector('#clPick');
      if (s) s.onchange = () => { setSel(s.value); BB.refresh(); };
    };
    paint();
    loadH().then(paint).catch(() => { top.innerHTML = '<div class="cl-meta">지수 서버에 연결하지 못했습니다</div>'; });
  }

  function emptyCard(el, msg) {
    el.innerHTML = `<div class="page-h"><h1>병원 블로그 지수</h1></div><div class="panel empty"><p>${esc(msg)}</p><p><button class="btn pri" type="button" data-go="#/clinic/hospitals">병원 블로그 등록하기</button></p></div>`;
    el.querySelector('[data-go]').onclick = e => BB.go(e.target.dataset.go);
  }

  async function frame(el, hash) {
    el.innerHTML = `<div class="cl-frame-wrap"><div class="cl-loading">지수 화면을 여는 중…</div></div>`;
    const wrap = el.firstChild;
    const theme = BB.getTheme ? BB.getTheme() : 'dark';
    let src;
    try {
      if (!entered || !frameHost) {
        const r = await BB.api('/api/idx/enter', { to: hash.replace(/^#/, ''), theme });
        src = r.url; entered = true; frameHost = new URL(r.url).origin;
      } else src = `${frameHost}/?embed=1&theme=${theme}${hash}`;
    } catch (e) { wrap.innerHTML = `<div class="panel empty">지수 서버를 열지 못했습니다: ${esc(e.message)}</div>`; return; }
    const f = document.createElement('iframe');
    f.className = 'cl-frame'; f.title = '병원 블로그 지수'; f.src = src;
    f.setAttribute('referrerpolicy', 'no-referrer');
    f.onload = () => { const l = wrap.querySelector('.cl-loading'); if (l) l.remove(); };
    wrap.appendChild(f);
    // 테마 바꾸면 iframe 에도 알린다
    const mo = new MutationObserver(() => { try { f.contentWindow.postMessage({ type: 'bb-theme', theme: BB.getTheme() }, frameHost); } catch (e) { } });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }

  /* ---------- 병원 블로그 등록 ---------- */
  function pageHospitals(el) {
    let msg = '';
    const paint = () => {
      const d = H || { list: [], depts: [], accounts: [] };
      const deptOpt = d.depts.map(x => `<option value="${esc(x.key)}">${esc(x.label)}</option>`).join('');
      const acc = (d.accounts || []).filter(a => !d.list.some(h => h.blogId === a.blogId));
      el.innerHTML = `
        <div class="page-h"><h1>병원 블로그 등록</h1><p class="sub">병원 블로그 지수는 등록한 병의원 블로그만 분석합니다. 진료과와 지역은 지역별 현황·추천 키워드·의료법 검수 기준이 됩니다.</p></div>
        <section class="panel">
          <h2 class="cl-h2">등록된 병원 <em>${d.list.length}</em></h2>
          ${d.list.length ? `<table class="cl-t"><thead><tr><th>병원</th><th>블로그</th><th>진료과</th><th>지역</th><th>등록</th><th></th></tr></thead><tbody>${d.list.map(h => `
            <tr><td><b>${esc(h.name || '-')}</b></td><td class="mono">${esc(h.blogId)}</td><td>${esc(h.deptLabel)}</td><td>${esc(h.regionText)}</td><td class="mono">${esc(String(h.at || '').slice(0, 10))}</td>
            <td class="act"><button class="btn sm" type="button" data-open="${esc(h.blogId)}">지수 보기</button> <button class="btn sm" type="button" data-edit="${esc(h.blogId)}">수정</button>${d.admin ? ` <button class="btn sm" type="button" data-del="${esc(h.blogId)}">해제</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">아직 없습니다. 아래에서 등록하세요.</p>'}
        </section>
        <section class="panel">
          <h2 class="cl-h2">새로 등록 · 수정</h2>
          ${acc.length ? `<div class="cl-acc">앱에 연결된 블로그: ${acc.map(a => `<button type="button" class="chip" data-acc="${esc(a.blogId)}" data-nm="${esc(a.name)}">${esc(a.name)}</button>`).join('')}</div>` : ''}
          <form class="cl-form" id="clForm" autocomplete="off">
            <label><span>블로그 아이디·주소</span><input name="blogId" required placeholder="예: ethinkdent11 또는 blog.naver.com/…"></label>
            <label><span>병원 이름</span><input name="name" placeholder="예: 평촌이생각치과"></label>
            <label><span>진료과</span><select name="dept" required><option value="">고르세요</option>${deptOpt}</select></label>
            <label><span>시·도</span><input name="sido" placeholder="예: 경기"></label>
            <label><span>시·군·구</span><input name="sigungu" placeholder="예: 안양시 동안구"></label>
            <label><span>동·역(상권)</span><input name="area" placeholder="예: 평촌역"></label>
            <div class="cl-fa"><button class="btn pri" type="submit">저장</button><span class="cl-msg">${msg}</span></div>
          </form>
          <p class="muted">일반(병의원이 아닌) 블로그는 등록하지 않습니다. 관리자가 [관리자 CMD]에서 명령으로만 분석합니다.</p>
        </section>`;
      const f = el.querySelector('#clForm');
      f.onsubmit = async ev => {
        ev.preventDefault();
        const v = Object.fromEntries(new FormData(f));
        const id = String(v.blogId || '').trim().replace(/^https?:\/\//, '').replace(/^(m\.)?blog\.naver\.com\//, '').split(/[/?#]/)[0];
        try {
          await loadH(true, { save: { blogId: id, name: v.name, dept: v.dept, region: { sido: v.sido, sigungu: v.sigungu, area: v.area } } });
          setSel(id.toLowerCase()); msg = `<span class="ok">저장했습니다: ${esc(id)}</span>`; paint();
        } catch (e) { msg = `<span class="bad">${esc(e.message)}</span>`; paint(); }
      };
      el.querySelectorAll('[data-acc]').forEach(b => b.onclick = () => { f.blogId.value = b.dataset.acc; f.name.value = b.dataset.nm; });
      el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { setSel(b.dataset.open); BB.go('#/clinic/summary'); });
      el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
        const h = d.list.find(x => x.blogId === b.dataset.edit); if (!h) return;
        f.blogId.value = h.blogId; f.name.value = h.name || ''; f.dept.value = h.dept; f.sido.value = (h.region || {}).sido || ''; f.sigungu.value = (h.region || {}).sigungu || ''; f.area.value = (h.region || {}).area || '';
        f.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
        if (!(await BB.confirm(`${b.dataset.del} 를 병원 블로그 등록에서 해제할까요? 분석 기록은 지우지 않습니다.`, '해제'))) return;
        try { await loadH(true, { remove: b.dataset.del }); msg = '해제했습니다'; } catch (e) { msg = esc(e.message); } paint();
      });
    };
    el.innerHTML = '<div class="panel empty">불러오는 중…</div>';
    loadH(true).then(paint).catch(e => { el.innerHTML = `<div class="panel empty">지수 서버에 연결하지 못했습니다: ${esc(e.message)}</div>`; });
  }

  /* ---------- 관리자 CMD ---------- */
  const cmdLog = [];
  function pageCmd(el) {
    if (!(BB.user && BB.user.role === 'admin')) { el.innerHTML = '<div class="panel empty">관리자만 쓸 수 있습니다.</div>'; return; }
    const hist = []; let hi = 0;
    el.innerHTML = `
      <div class="page-h"><h1>관리자 CMD</h1><p class="sub">일반 블로그 분석과 병원 등록부 관리는 여기서 명령으로만 합니다. <code>help</code> 로 명령 목록을 봅니다. 같은 명령은 서버 PC에서 <code>node index_web/cli.js …</code> 로도 됩니다.</p></div>
      <section class="cl-term"><pre id="clOut"></pre><form id="clCmd" autocomplete="off"><span>&gt;</span><input name="line" spellcheck="false" placeholder="예: general run 블로그아이디"><button class="btn sm" type="submit">실행</button></form></section>`;
    const out = el.querySelector('#clOut'), f = el.querySelector('#clCmd');
    const show = () => { out.textContent = cmdLog.join('\n') || '명령을 입력하세요. help'; out.scrollTop = out.scrollHeight; };
    show();
    f.onsubmit = async ev => {
      ev.preventDefault();
      const line = f.line.value.trim(); if (!line) return;
      hist.push(line); hi = hist.length; f.line.value = '';
      cmdLog.push('> ' + line); show();
      try { const r = await BB.api('/api/idx/cmd', { line }); cmdLog.push(r.out || ''); } catch (e) { cmdLog.push('오류: ' + e.message); }
      if (cmdLog.length > 400) cmdLog.splice(0, cmdLog.length - 400);
      show(); loadH(true).catch(() => { });
    };
    f.line.addEventListener('keydown', e => {
      if (e.key === 'ArrowUp' && hi > 0) { hi--; f.line.value = hist[hi]; e.preventDefault(); }
      if (e.key === 'ArrowDown') { hi = Math.min(hist.length, hi + 1); f.line.value = hist[hi] || ''; e.preventDefault(); }
    });
    f.line.focus();
  }

  async function render(page, el) {
    if (page === 'hospitals') return pageHospitals(el);
    if (page === 'cmd') return pageCmd(el);
    if (TOOL[page]) return frame(el, TOOL[page]);
    try { await loadH(); } catch (e) { el.innerHTML = `<div class="panel empty">지수 서버에 연결하지 못했습니다: ${esc(e.message)}</div>`; return; }
    const c = cur();
    if (!c) return emptyCard(el, '먼저 병원 블로그를 등록해 주세요. 병의원 블로그만 분석합니다.');
    return frame(el, '#/blog/' + encodeURIComponent(c.blogId) + (VIEW[page] || ''));
  }

  BB.mod('clinic', {
    name: '병원 블로그 지수',
    desc: '병의원 블로그 전용 진단·지수·지역별 키워드·의료법 검수. 등록한 병원 블로그만 분석합니다.',
    order: 0,
    ready: true,
    nav: [['-diag', '블로그 진단'], ['summary', '진단 요약'], ['cindex', '병원 지수'], ['grow', '육성 단계'],
      ['-region', '지역 현황'], ['region', '지역별 현황'],
      ['-kw', '키워드·순위'], ['plan', '추천 키워드'], ['search', '검색·순위'],
      ['-content', '콘텐츠·검수'], ['medlaw', '의료법 검수'], ['content', '콘텐츠 분석'],
      ['-ops', '운영'], ['ops', '운영 지표'],
      ['-tools', '도구'], ['keywords', '키워드 분석'], ['rank', '순위 모니터링'],
      ['-set', '관리'], ['hospitals', '병원 블로그 등록'], ['cmd', '관리자 CMD']],
    sideTop,
    render,
  });
})();
