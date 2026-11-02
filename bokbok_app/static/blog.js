// bokbok v2 — 블로그 발행 모듈 (작업자 D)
// v1(_backup_20261101/ui.html)의 블로그 기능을 모듈 화면으로 옮김.
// 원고 만들기(GPT 생성·미리보기·편집)·블로그 성격·AI 설정은 작업자 M (규격: gen/GEN_SPEC.md)
(function () {
  'use strict';
  if (!window.BB || typeof BB.mod !== 'function') return;

  const MODE_TXT = { test: '시험 입력', stop: '입력 후 멈춤', publish: '검사 통과 시 발행' };
  const MODE_LONG = { test: '시험 입력 (빠르게, 발행 안 함)', stop: '입력 후 멈춤 (검사까지)', publish: '검사 통과 시 발행' };
  const FIELDS = [
    ['tpm', '타자 속도 (분당 타수)', 200, 2000, 50, v => v + '타'],
    ['jitter', '글자마다 흔들림', 0, 60, 5, v => '±' + v + '%'],
    ['linePause', '줄 바꿈 뒤 쉬기', 0, 2000, 50, v => (v / 1000).toFixed(2) + '초'],
    ['tagPause', '태그 입력 간격', 300, 3000, 100, v => (v / 1000).toFixed(1) + '초'],
    ['typoN', '오타 내고 고치기', 0, 12, 1, v => v ? `원고 1편당 ${v}회` : '안 함', '잘못 친 글자를 지우고 다시 칩니다(한 글자 더 치고 알아채기·같은 글자 두 번 치기 포함). 글 내용은 바뀌지 않습니다.'],
    ['thinkN', '문장 끝에서 생각하며 멈추기', 0, 12, 1, v => v ? `원고 1편당 ${v}회` : '안 함', '문장이 끝나는 자리에서 1.5~4초 멈춥니다.'],
    ['readN', '발행 뒤 다른 사람 글 읽기', 0, 5, 1, v => v ? `${v}편` : '안 함', '발행이 끝나면 글의 키워드로 블로그 검색을 해서 다른 사람 글을 스크롤하며 읽습니다. 읽기만 하고 공감·댓글·이웃 신청은 하지 않습니다. 읽은 글은 발행 기록에 남습니다.'],
    ['readSec', '글 1편 읽는 시간', 20, 180, 10, v => `약 ${v}초 (±30%)`],
  ];
  const FIELD_GROUPS = { tpm: '타자', typoN: '사람 습관', readN: '발행 뒤 읽기' };
  const ID_RE = /^[a-zA-Z0-9_-]{3,40}$/;

  const esc = s => BB.esc(s == null ? '' : String(s));
  const fname = p => (BB.fname ? BB.fname(String(p || '')) : String(p || '').split(/[\\/]/).pop());
  const openP = p => { if (p) BB.openP(p); };
  const lsGet = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } };
  const pad = n => String(n).padStart(2, '0');
  const fmtAt = at => { const d = new Date(at); if (isNaN(d)) return ''; return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

  // ── 공유 상태 ─────────────────────────────────────
  let S = null;                 // /api/state 응답
  let acc = lsGet('bb.acc');    // 현재 블로그 아이디
  let sel = null;               // 선택한 원고 파일 경로
  let mode = null;              // 이번 실행 방식
  let histAll = false;          // 발행 기록: 모든 계정
  let sideEl = null;            // sideTop 영역
  let view = null;              // { page, el, token, inner }
  let pending = null;

  const curAcc = () => (S && S.accounts.find(a => a.blogId === acc)) || null;
  function askNaverLogin(account) {
    return new Promise(resolve => {
      const dialog = document.createElement('dialog');
      dialog.className = 'panel';
      dialog.style.cssText = 'max-width:440px;width:calc(100% - 40px);padding:24px;color:var(--text);background:var(--surface-1,#101010)';
      dialog.innerHTML = `<form autocomplete="off"><h2>네이버 로그인 자동 입력</h2>
        <p class="hint">새 시크릿 창에 입력합니다. 비밀번호는 저장하지 않습니다. 입력 후 로그인 버튼은 직접 눌러 주세요.</p>
        <div class="field"><label for="bb-naver-id">네이버 로그인 아이디</label><input class="inp" id="bb-naver-id" autocomplete="off" required maxlength="40"></div>
        <div class="field"><label for="bb-naver-pw">네이버 비밀번호</label><input class="inp" id="bb-naver-pw" type="password" autocomplete="off" required maxlength="200"></div>
        <div class="row"><button class="btn pri" type="submit">시크릿 창에 입력</button><button class="btn" type="button" data-manual>직접 입력</button><button class="btn" type="button" data-cancel>취소</button></div></form>`;
      document.body.appendChild(dialog);
      const id = dialog.querySelector('#bb-naver-id'), pw = dialog.querySelector('#bb-naver-pw');
      id.value = account.blogId;
      const finish = value => { pw.value = ''; dialog.close(); dialog.remove(); resolve(value); };
      dialog.querySelector('form').addEventListener('submit', e => { e.preventDefault(); finish({ loginId: id.value.trim(), password: pw.value, fillOnce: true }); });
      dialog.querySelector('[data-manual]').onclick = () => finish({});
      dialog.querySelector('[data-cancel]').onclick = () => finish(null);
      dialog.addEventListener('cancel', e => { e.preventDefault(); finish(null); });
      dialog.showModal();
      pw.focus();
    });
  }
  const setAcc = id => { acc = id || ''; lsSet('bb.acc', acc); };

  function loadState() {
    if (pending) return pending;
    const ask = acc;
    pending = BB.api('/api/state?blogId=' + encodeURIComponent(ask)).then(async st => {
      S = st;
      if (!S.accounts.find(a => a.blogId === acc)) {
        setAcc(S.accounts[0] ? S.accounts[0].blogId : '');
        sel = null;
        // 지운 계정 기준으로 받은 상태면 고친 계정으로 한 번 더 받는다
        if (ask && acc) S = await BB.api('/api/state?blogId=' + encodeURIComponent(acc));
      }
      if (!mode) mode = S.settings.mode;
      fillSide();
      return S;
    }).finally(() => { pending = null; });
    return pending;
  }

  // ── 사이드바 위: 계정 선택 ─────────────────────────
  function fillSide() {
    if (!sideEl || !document.body.contains(sideEl)) return;
    const list = S ? S.accounts : [];
    sideEl.innerHTML = `<div class="field"><label>블로그 계정</label><select class="inp" data-r="acc">${list.length
      ? list.map(a => `<option value="${esc(a.blogId)}"${a.blogId === acc ? ' selected' : ''}>${esc(a.name)} · ${esc(a.blogId)}</option>`).join('')
      : '<option value="">계정 없음</option>'}</select></div>`;
    const s = sideEl.querySelector('select');
    s.disabled = !list.length;
    s.onchange = () => { setAcc(s.value); sel = null; rerender(); };
  }
  function sideTop(el) {
    sideEl = el;
    fillSide();
    if (!S) loadState().catch(() => { });
  }

  // ── 렌더 / 다시 그리기 ─────────────────────────────
  function mountPage(page, el) {
    el.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'stack';
    el.appendChild(root);
    const fn = PAGES[page] || PAGES.posts;
    return fn(root) || null;
  }
  function render(page, el) {
    const token = {};
    view = { page, el, token, inner: mountPage(page, el) };
    return () => {
      if (!view || view.token !== token) return;
      if (typeof view.inner === 'function') view.inner();
      view = null;
    };
  }
  function rerender() {
    if (!view) return;
    if (typeof view.inner === 'function') view.inner();
    view.inner = mountPage(view.page, view.el);
  }

  // ── 원고·발행 ─────────────────────────────────────
  function pagePosts(root) {
    const ctx = { alive: true };
    let lastPublished = '';
    root.innerHTML = `
      <div data-r="top"><div class="empty">불러오는 중</div></div>
      <div class="panel" data-r="runp">
        <div class="row">
          <div class="grow" data-r="selTitle">원고를 고르세요</div>
          <div class="seg" data-r="modes">${Object.keys(MODE_TXT).map(m => `<button type="button" data-m="${m}">${MODE_TXT[m]}</button>`).join('')}</div>
          <button type="button" class="btn pri" data-act="run" disabled>실행</button>
          <button type="button" class="btn" data-act="queue" disabled title="지금 실행하지 않고 작업 큐 뒤에 붙입니다. 다른 블로그 작업이 끝나면 차례로 돌아갑니다">큐에 추가</button>
          <button type="button" class="btn" data-act="stop" hidden>중지</button>
        </div>
        <div class="prog"><i data-r="prog"></i></div>
        <div class="sub" data-r="status">대기</div>
        <div class="log" data-r="log"></div>
      </div>`;
    const $ = r => root.querySelector(`[data-r="${r}"]`);
    const logEl = $('log');

    function setProg(p) {
      const bar = $('prog');
      if (!p) { bar.style.width = '0'; return; }
      const [a, b] = String(p).split('/').map(Number);
      bar.style.width = b ? Math.min(100, a / b * 100) + '%' : '0';
    }
    function doneStatus(r) {
      r = r || { pass: false, fails: ['중단됨'] };
      lastPublished = r.published || '';
      $('status').innerHTML = r.published
        ? '<span class="ok">발행 완료</span> · <button type="button" class="link" data-act="openDone">글 열기</button>'
        : r.pass ? '<span class="ok">전수검사 통과</span> · 발행은 하지 않음'
          : `<span class="bad">전수검사 실패 ${(r.fails && r.fails.length) || ''}건</span> · 발행하지 않음`;
    }

    function statusCell(m, i) {
      let st;
      const last = m.last;
      if (!m.ok) st = `<span class="bad">원고 오류</span><div class="muted mono">${esc(m.error)}</div>`;
      else if (m.posted) st = '<span class="ok">발행됨</span>';
      else if (last && last.pass === false) st = `<span class="bad">검사 실패</span><div class="muted mono">${esc((last.fails || [])[0] || '')}</div>`;
      else if (last && last.pass) st = `<span class="muted">검사 통과${last.published ? '' : ' · 미발행'}</span>`;
      else st = '<span class="muted">미발행</span>';
      if (last && last.report) st += ` <button type="button" class="link" data-act="report" data-index="${i}">검사표</button>`;
      return st;
    }

    function paint() {
      if (!ctx.alive || !S) return;
      const a = curAcc();
      const top = $('top');
      if (!a) {
        top.innerHTML = `<div class="page-h"><h1>계정을 추가하세요</h1><div class="sub">글을 올릴 네이버 블로그 계정이 없습니다.</div></div>
          <div class="panel"><div class="empty">[블로그 계정] 메뉴에서 계정을 추가한 뒤 원고를 발행할 수 있습니다. <button type="button" class="link" data-act="goAccounts">블로그 계정으로 이동</button></div></div>`;
      } else {
        const ms = S.manuscripts || [];
        top.innerHTML = `
          <div class="page-h"><div class="row"><div class="grow"><h1>${esc(a.name)}</h1>
            <div class="sub">blog.naver.com/${esc(a.blogId)}</div></div>
            <button type="button" class="btn" data-act="openBlog">블로그 열기</button></div></div>
          <div class="row">
            <button type="button" class="btn" data-act="pick">원고 등록</button>
            <button type="button" class="btn" data-act="goWrite">원고 만들기</button>
            <button type="button" class="btn" data-act="refresh">새로고침</button>
            <div class="grow"></div>
            <span class="sub">분당 ${esc(S.settings.tpm)}타 · 기본 ${esc(MODE_TXT[S.settings.mode] || '')}</span>
          </div>
          <div class="panel">
            <div class="panel-h"><b>원고 ${ms.length}건</b></div>
            ${ms.length ? `<table class="tbl"><thead><tr><th>원고</th><th>카테고리</th><th class="num">본문</th><th class="num">사진</th><th>검토</th><th>상태</th></tr></thead><tbody>
            ${ms.map((m, i) => `<tr class="click${sel === m.file ? ' sel' : ''}" data-act="sel" data-index="${i}">
              <td>${esc(m.title || fname(m.file))}<div class="muted mono">${esc(m.draft ? '원고함/' + m.draft + '/원고.txt' : fname(m.file))}${m.registered ? ` · 직접 등록 <button type="button" class="link" data-act="unreg" data-index="${i}">빼기</button>` : ''}</div></td>
              <td>${esc(m.category || '')}</td>
              <td class="num">${m.chars ? esc(Number(m.chars).toLocaleString()) + '자' : ''}</td>
              <td class="num">${m.images != null ? esc(m.images) : ''}</td>
              <td>${m.draft ? `${m.reviewed ? '<span class="st ok">검토 완료</span>' : m.posted ? '' : '<span class="st warn">검토 전</span>'} <button type="button" class="link" data-act="preview" data-index="${i}">미리보기</button>` : '<span class="muted">직접 등록</span>'}</td>
              <td>${statusCell(m, i)}</td></tr>`).join('')}
            </tbody></table>`
            : '<div class="empty">원고가 없습니다. [원고 등록]으로 .txt 원고를 추가하거나 원고함 폴더에 넣으세요.</div>'}
          </div>`;
      }
      // 실행 영역
      const ms = S.manuscripts || [];
      const cur = ms.find(m => m.file === sel);
      $('selTitle').textContent = cur ? (cur.title || fname(cur.file)) : '원고를 고르세요';
      [...$('modes').children].forEach(b => b.classList.toggle('on', b.dataset.m === mode));
      const running = !!(S.job && !S.job.done);
      const runBtn = root.querySelector('[data-act="run"]'), stopBtn = root.querySelector('[data-act="stop"]'), qBtn = root.querySelector('[data-act="queue"]');
      if (qBtn) qBtn.disabled = !(ms.find(x => x.file === sel) && ms.find(x => x.file === sel).ok !== false);
      runBtn.disabled = !cur || !cur.ok || running || !a;
      runBtn.hidden = running;
      stopBtn.hidden = !running;
    }

    function restoreJob() {
      const j = S && S.job;
      if (!j || logEl.textContent) return;
      logEl.textContent = (j.lines || []).join('\n');
      logEl.scrollTop = logEl.scrollHeight;
      setProg(j.progress);
      if (!j.done) $('status').textContent = `실행 중 · ${MODE_TXT[j.mode] || j.mode} · ${fname(j.file)} · ${j.blogId}`;
      else if (j.result) doneStatus(j.result);
    }

    const reload = () => loadState().then(() => { paint(); }).catch(() => { });

    root.addEventListener('click', async e => {
      const segB = e.target.closest('[data-m]');
      if (segB && root.contains(segB)) { mode = segB.dataset.m; paint(); return; }
      const t = e.target.closest('[data-act]');
      if (!t || !root.contains(t)) return;
      const act = t.dataset.act, i = +t.dataset.index;
      const ms = (S && S.manuscripts) || [];
      const a = curAcc();
      try {
        if (act === 'sel') { if (ms[i]) { sel = ms[i].file; paint(); } }
        else if (act === 'report') { e.stopPropagation(); if (ms[i] && ms[i].last) openP(ms[i].last.report); }
        else if (act === 'unreg') {
          e.stopPropagation();
          if (!ms[i]) return;
          await BB.api('/api/unregister', { file: ms[i].file });
          if (sel === ms[i].file) sel = null;
          reload();
        }
        else if (act === 'openBlog') { if (a) openP('https://blog.naver.com/' + a.blogId); }
        else if (act === 'goAccounts') BB.go('#/blog/accounts');
        else if (act === 'pick') {
          BB.toast('파일 선택 창을 여는 중…');
          const r = await BB.api('/api/pick', {});
          BB.toast(r.added ? `${r.added}개 등록했습니다` : '선택한 파일이 없습니다');
          reload();
        }
        else if (act === 'goWrite') BB.go('#/blog/write');
        else if (act === 'preview') { e.stopPropagation(); const m = ms[i]; if (m && m.draft) BB.go('#/blog/write/' + m.draft.split('/').map(encodeURIComponent).join('/')); }
        else if (act === 'refresh') reload();
        else if (act === 'run') {
          const m = ms.find(x => x.file === sel);
          if (!m || !a) return;
          if (mode === 'publish' && !(await BB.confirm(`[${m.title}]\n${a.name} (${a.blogId}) 블로그에 입력하고, 전수검사를 모두 통과하면 발행합니다.${m.draft && !m.reviewed ? '\n\n⚠ 아직 검토 전 원고입니다. [미리보기]에서 글과 사진을 확인한 뒤 발행하는 것을 권합니다.' : ''} 진행할까요?`))) return;
          if (!ctx.alive) return;
          logEl.textContent = ''; setProg(''); lastPublished = '';
          if (BB.jobs && BB.jobs.autoPip) BB.jobs.autoPip();   // 설정이 켜져 있으면 항상 위 미니창을 띄운다 (크롬이 글을 치는 동안 현황을 보게)
          await BB.api('/api/run', { blogId: a.blogId, file: m.file, mode });
          $('status').textContent = `실행 중 · ${MODE_TXT[mode]} · 분당 ${S.settings.tpm}타`;
          reload();
        }
        else if (act === 'queue') {
          const m = ms.find(x => x.file === sel);
          if (!m || !a) return;
          await BB.jobs.add({ lane: 'publish', blogId: a.blogId, file: m.file, mode });
        }
        else if (act === 'stop') { await BB.api('/api/stop', {}); }
        else if (act === 'openDone') openP(lastPublished);
      } catch (err) { /* BB.api가 이미 알림 */ }
    });

    const onEv = ev => {
      if (!ctx.alive || !ev) return;
      const { type, data } = ev;
      if (type === 'log') { logEl.textContent += (logEl.textContent ? '\n' : '') + data; logEl.scrollTop = logEl.scrollHeight; }
      else if (type === 'progress') setProg(data);
      else if (type === 'done') { doneStatus(data); reload(); }
    };
    const off = typeof BB.onEvent === 'function' ? BB.onEvent(onEv) : null;

    const handed = lsGet('bb.handSel');
    if (handed) { lsSet('bb.handSel', ''); sel = handed; }
    loadState().then(() => {
      if (!ctx.alive) return; paint(); restoreJob();
      const row = root.querySelector('tr.sel'); if (row && handed) row.scrollIntoView({ block: 'center' });
    }).catch(() => {
      if (ctx.alive) $('top').innerHTML = '<div class="panel"><div class="empty">상태를 불러오지 못했습니다. [새로고침]을 눌러 다시 시도하세요. <button type="button" class="link" data-act="refresh">새로고침</button></div></div>';
    });

    return () => { ctx.alive = false; if (typeof off === 'function') off(); };
  }

  // ── 원고 만들기 (GPT) ─────────────────────────────
  const GEN_STEPS = ['원고 작성', '대표 이미지 생성', '카드 렌더', '원고 저장'];
  let genOpts = null;            // /api/gen/options
  const loadOpts = () => genOpts ? Promise.resolve(genOpts) : BB.api('/api/gen/options').then(o => (genOpts = o));
  const optLabel = (list, k) => { const o = ((genOpts && genOpts[list]) || []).find(x => x.key === k); return o ? o.label : (k || ''); };
  const choiceKey = id => 'bb.gen.' + id;
  const loadChoice = id => { try { return JSON.parse(lsGet(choiceKey(id)) || '{}') || {}; } catch (e) { return {}; } };
  const saveChoice = (id, v) => lsSet(choiceKey(id), JSON.stringify(v));
  const draftHash = rel => '#/blog/write/' + String(rel).split('/').map(encodeURIComponent).join('/');
  const imgUrl = (rel, f) => `/api/gen/img?dir=${encodeURIComponent(rel)}&file=${encodeURIComponent(f)}`;
  const statusTxt = d => !d.ok ? `<span class="bad">원고 오류</span>` : d.posted ? '<span class="ok">발행됨</span>'
    : d.last && d.last.pass === false ? '<span class="bad">검사 실패</span>' : '<span class="muted">미발행</span>';
  const presetSummary = p => p.imageMode === 'clinical'
    ? ['임상 사진 · ' + optLabel('clinicalForms', p.clinicalForm || 'stage'), '사진 순서대로 · 카드 없음', p.charTarget ? `${p.charTarget}자` : '', '제목 ' + optLabel('titleModes', p.titleMode || 'auto'), p.tone && p.tone !== 'profile' ? optLabel('tones', p.tone) : ''].filter(Boolean).join(' · ')
    : [optLabel('layouts', p.layout), optLabel('imageModes', p.imageMode || 'ai'), p.imageMode === 'ai' ? optLabel('styles', p.imageStyle) : '', `사진 ${p.imageCount}(${p.imageMode === 'cards' ? '카드만' : (p.imageMode === 'photos' ? '내 사진' : 'AI') + ' ' + p.aiCount})`, '장식 ' + optLabel('decos', p.deco),
      '카드 ' + (p.cardTemplates || []).map(c => optLabel('cardTemplates', c)).join('·'),
      p.charTarget ? `${p.charTarget}자` : '', '제목 ' + optLabel('titleModes', p.titleMode || 'auto'), p.tone && p.tone !== 'profile' ? optLabel('tones', p.tone) : '', p.imageNotes ? '그림 참고' : ''].filter(Boolean).join(' · ');
  const DETAIL_KEYS = ['charTarget', 'charBasis', 'tone', 'kwRepeat', 'emphasis', 'titleMode', 'qaCount', 'imageNotes', 'imageMode', 'clinicalForm', 'useHidden'];
  const hiddenOf = a => (a && Array.isArray(a.hidden)) ? a.hidden : [];
  const NUM_KEYS = ['imageCount', 'aiCount', 'charTarget'];
  // 본문 분량 세기: 원고.txt에서 머리말·명령 줄을 빼고 꾸밈 표시를 벗긴 글자
  function txtStats(txt, kw) {
    const raw = String(txt || '').replace(/^\uFEFF/, '').replace(/\r/g, '');
    const cut = raw.search(/\n\s*\n/), rest = cut < 0 ? '' : raw.slice(cut);
    const lines = [];
    let subs = 0;
    for (const l0 of rest.split('\n')) {
      const l = l0.trim();
      if (!l || l === '---' || /^\[(사진|링크|해시태그)\]/.test(l)) continue;
      if (l.startsWith('## ')) subs++;
      lines.push(l.replace(/^> /, '').replace(/^## /, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[\[([^\]|]+)\|#[0-9a-fA-F]{6}\]\]/g, '$1'));
    }
    const all = lines.join('\n'), body = lines.slice(1).join('\n');
    let kc = 0;
    if (kw) { const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*'), 'gi'); kc = (body.match(re) || []).length; }
    const ns = [...all.replace(/\s+/g, '')].length;
    return { chars: ns, charsWithSpace: [...all.replace(/\n/g, '')].length, lines: lines.length, subs, kw: kc, minutes: Math.max(1, Math.round(ns / 500)) };
  }

  function pageWrite(root) {
    const rel = (BB.params || []).filter(Boolean).join('/');
    return rel ? pageDraft(root, rel) : pageWriteMain(root);
  }

  function pageWriteMain(root) {
    const ctx = { alive: true };
    let gs = null, job = null, drafts = [], ch = null, manage = false, refList = [], photoList = [];
    root.innerHTML = `
      <div class="page-h"><h1>원고 만들기</h1><div class="sub" data-r="wsub"></div></div>
      <div data-r="nokey" hidden></div>
      <div class="seg wtab" data-r="wtab">
        <button type="button" data-tab="auto">자동 원고<small>블로그 데이터로 주제 선정 → 원고까지 자동</small></button>
        <button type="button" data-tab="custom">직접 만들기<small>키워드·사진·임상 증례를 내가 정해서</small></button></div>
      <div class="panel" data-r="autop"></div>
      <div class="panel" data-r="formp"><div class="empty">불러오는 중</div></div>
      <div class="panel" data-r="jobp" hidden>
        <div class="panel-h"><b data-r="jobTitle">원고 만드는 중</b><button type="button" class="btn" data-act="cancel">취소</button></div>
        <ol class="gsteps" data-r="steps"></ol>
        <div class="prog"><i data-r="prog"></i></div>
        <div class="sub" data-r="jobStatus"></div>
        <div class="log" data-r="log"></div>
      </div>
      <div class="panel" data-r="drafts"><div class="empty">불러오는 중</div></div>`;
    const $ = r => root.querySelector(`[data-r="${r}"]`);
    const running = () => !!(job && !job.done);

    // 두 갈래: 자동 원고(블로그 데이터로 주제까지 자동) · 직접 만들기(키워드·사진·임상 증례를 내가 정함)
    const WSUB = { auto: '블로그의 기존 글·반응·검색 데이터를 보고 GPT가 주제를 고르고 원고·이미지까지 만듭니다. 만든 원고는 원고·발행에 "검토 전"으로 쌓입니다.', custom: '키워드·주제·사진을 내가 정해서 만듭니다. 임상 사진을 올린 순서대로 증례 글을 쓰는 치과 모드도 여기 있습니다.' };
    let wtab = lsGet('bb.writeTab') === 'auto' ? 'auto' : 'custom';
    function applyTab() {
      $('autop').hidden = wtab !== 'auto'; $('formp').hidden = wtab !== 'custom';
      $('wsub').textContent = WSUB[wtab];
      $('wtab').querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === wtab));
    }
    $('wtab').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (!b) return; wtab = b.dataset.tab; lsSet('bb.writeTab', wtab); applyTab(); });
    applyTab();

    function defaults(a) {
      const o = genOpts, saved = loadChoice(a.blogId);
      const keys = l => (o[l] || []).map(x => x.key);
      const pick = (v, l, d) => keys(l).includes(v) ? v : d;
      const ic = Math.min(6, Math.max(2, +saved.imageCount || 4));
      return {
        imageCount: ic, aiCount: Math.min(ic, Math.max(1, +saved.aiCount || 1)),
        imageStyle: pick(saved.imageStyle, 'styles', 'auto'), layout: pick(saved.layout, 'layouts', 'auto'), deco: pick(saved.deco, 'decos', 'auto'),
        cardTemplates: Array.isArray(saved.cardTemplates) && saved.cardTemplates.length ? saved.cardTemplates.filter(c => keys('cardTemplates').includes(c)) : keys('cardTemplates'),
        preset: typeof saved.preset === 'string' ? saved.preset : '', category: typeof saved.category === 'string' ? saved.category : '',
        charTarget: Math.min((o.charRange || {}).max || 5000, Math.max((o.charRange || {}).min || 500, +saved.charTarget || 1000)),
        charBasis: pick(saved.charBasis, 'charBases', 'nospace'), tone: pick(saved.tone, 'tones', 'profile'),
        kwRepeat: pick(saved.kwRepeat, 'kwRepeats', 'mid'), emphasis: pick(saved.emphasis, 'emphases', 'mid'),
        titleMode: pick(saved.titleMode, 'titleModes', 'auto'), qaCount: pick(saved.qaCount, 'qaCounts', 'auto'),
        imageNotes: typeof saved.imageNotes === 'string' ? saved.imageNotes.slice(0, 500) : '', fixedTitle: typeof saved.fixedTitle === 'string' ? saved.fixedTitle : '',
        refs: Array.isArray(saved.refs) ? saved.refs.filter(x => typeof x === 'string').slice(0, 3) : [],
        imageMode: pick(saved.imageMode, 'imageModes', 'clinical'), photos: Array.isArray(saved.photos) ? saved.photos.filter(x => typeof x === 'string').slice(0, 8) : [],
        clinicalForm: pick(saved.clinicalForm, 'clinicalForms', 'stage'),
        useHidden: pick(saved.useHidden, 'useHiddens', 'on'),
        field: typeof saved.field === 'string' ? saved.field : '', caseNote: typeof saved.caseNote === 'string' ? saved.caseNote.slice(0, 1000) : '',
        photoNotes: saved.photoNotes && typeof saved.photoNotes === 'object' ? saved.photoNotes : {},
      };
    }
    const presetsOf = a => (a && Array.isArray(a.presets)) ? a.presets : [];
    const remember = () => { const a = curAcc(); if (a && ch) saveChoice(a.blogId, ch); };

    // ── 자동 기획: 글 내용 없이 블로그 데이터로 주제를 고른다 ──
    let cands = null, planning = false, autoN = 2;
    function paintAuto() {
      const a = curAcc(), box = $('autop'); if (!box) return;
      if (!a) { box.innerHTML = ''; return; }
      const au = a.auto || {};
      box.innerHTML = `<div class="panel-h"><b>자동 기획</b><span class="sub">글 내용을 넣지 않아도 기존 글·반응·검색 데이터를 읽고 SEO·AI 검색·애드포스트에 맞는 주제를 골라 원고를 만듭니다</span></div>
        <div class="auto-row">
          <button type="button" class="btn" data-act="plan"${planning ? ' disabled' : ''}>${planning ? '주제 고르는 중…' : '주제 추천 받기'}</button>
          <div class="row" style="gap:6px;align-items:center"><select class="inp" data-r="autoN" style="width:auto;height:34px">${[1, 2, 3, 5].map(n => `<option value="${n}"${n === autoN ? ' selected' : ''}>${n}편</option>`).join('')}</select>
            <button type="button" class="btn pri" data-act="autoQueue">자동 원고 예약</button><span class="hint">주제 선정→원고→이미지까지 알아서 만들어 원고·발행에 "검토 전"으로 쌓입니다</span></div>
          <div class="grow"></div>
          <form class="row auto-sched" data-r="sched" style="gap:8px;align-items:center">
            <label class="row" style="align-items:center;gap:6px"><input type="checkbox" name="enabled"${au.enabled ? ' checked' : ''}> <span>매일 자동</span></label>
            <select class="inp" name="perDay" style="width:auto;height:34px">${[1, 2, 3, 5].map(n => `<option value="${n}"${(+au.perDay || 1) === n ? ' selected' : ''}>${n}편</option>`).join('')}</select>
            <input class="inp mono" type="time" name="at" value="${esc(au.at || '09:00')}" style="width:110px;height:34px">
            <button type="submit" class="btn sm">일정 저장</button>
            ${au.enabled ? `<span class="hint">${au.lastDate ? '마지막 등록 ' + esc(au.lastDate) : '아직 실행 안 됨'} · 앱이 켜져 있을 때만 돌아갑니다</span>` : ''}
          </form>
        </div>
        ${cands ? `<div class="cands">${cands.map((c, i) => `<div class="cand"><div class="cand-h"><span class="mono">${pad(i + 1)}</span><b>${esc(c.title || c.keyword)}</b></div>
            <div class="cand-k">키워드 <b>${esc(c.keyword)}</b>${c.subKeywords.length ? ' · 보조 ' + esc(c.subKeywords.join(', ')) : ''}${c.category ? ' · ' + esc(c.category) : ''}</div>
            <p>${esc(c.topic)}</p><div class="cand-r">${esc(c.reason)}</div>
            <div class="row"><button type="button" class="btn sm pri" data-act="useCand" data-index="${i}">이 주제로 채우기</button><button type="button" class="btn sm" data-act="queueCand" data-index="${i}">바로 예약</button>
              <span class="muted">${esc(optLabel('layouts', c.layout))} · 제목 ${esc(optLabel('titleModes', c.titleMode))}</span></div></div>`).join('')}</div>` : ''}`;
    }
    function fillCand(c) {
      const f = $('form'); if (!f || !ch) return;
      f.elements.keyword.value = c.keyword; f.elements.subKeywords.value = c.subKeywords.join(', '); f.elements.topic.value = c.topic || '';
      f.elements.notes.value = [c.reason ? '기획 메모: ' + c.reason : '', c.title ? '제목안: ' + c.title : ''].filter(Boolean).join('\n');
      if (c.category) { ch.category = c.category; const cs = $('catSel'); if (cs) { cs.value = c.category; if (cs.value !== c.category) { cs.value = '__custom__'; $('catInp').hidden = false; $('catInp').value = c.category; } } else if ($('catInp')) $('catInp').value = c.category; }
      if (c.layout && c.layout !== 'auto') ch.layout = c.layout;
      if (c.titleMode && c.titleMode !== 'auto') ch.titleMode = c.titleMode;
      touched(); paintChoices(); f.elements.keyword.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    function candBody(c, a) {
      return Object.assign(buildBody($('form'), a) || {}, { keyword: c.keyword, subKeywords: c.subKeywords.join(', '), topic: c.topic || '', category: c.category || ch.category || '',
        notes: [c.reason ? '기획 메모: ' + c.reason : '', c.title ? '제목안: ' + c.title : ''].filter(Boolean).join('\n'), layout: c.layout && c.layout !== 'auto' ? c.layout : ch.layout, titleMode: c.titleMode && c.titleMode !== 'auto' ? c.titleMode : ch.titleMode });
    }
    function paintNoKey() {
      $('nokey').hidden = !(gs && !gs.hasKey);
      $('nokey').innerHTML = gs && !gs.hasKey ? `<div class="panel"><div class="panel-h"><b>OpenAI API 키가 필요합니다</b></div>
        <div class="row"><div class="grow muted">원고와 이미지를 만들려면 [입력 설정] → AI 설정에서 API 키를 저장하세요. 키는 이 PC에만 암호화해 저장합니다.</div>
        <button type="button" class="btn pri" data-act="goKey">AI 설정으로 이동</button></div></div>` : '';
    }

    // ── 설정 폼 (2026-11-01 개편): 왼쪽 행(이름 | 조작) + 오른쪽 고정 요약·만들기 ──
    const optsOf = l => (genOpts && genOpts[l]) || [];
    const descOf = (l, k) => ((optsOf(l).find(x => x.key === k) || {}).desc || '');
    const selOpt = (k, l, cur, lab) => `<select class="inp" data-k="${k}">${optsOf(l).map(x => `<option value="${esc(x.key)}"${String(x.key) === String(cur) ? ' selected' : ''}>${esc(lab ? lab(x) : x.label)}</option>`).join('')}</select>`;
    const row = (label, help, ctl, cls) => `<div class="gr${cls ? ' ' + cls : ''}"><div class="gr-l"><b>${label}</b>${help ? `<span>${help}</span>` : ''}</div><div class="gr-c">${ctl}</div></div>`;
    const charRange = () => genOpts.charRange || { min: 500, max: 5000 };
    const perLine = () => ch.charBasis === 'space' ? 15.5 : 12.5;
    const readMin = () => Math.max(1, Math.round((ch.charBasis === 'space' ? ch.charTarget * 0.8 : ch.charTarget) / 500));
    const cardN = () => ch.imageCount - Math.min(ch.aiCount, ch.imageCount);

    function paintChoices() {
      const box = root.querySelector('[data-r="choices"]');
      if (!box || !ch) return;
      const o = genOpts, r = charRange();
      box.innerHTML = `
        <section class="gs"><div class="gs-h"><span>02</span>글 구성</div>
          ${row('글자 수', '본문 분량 목표', `
            <div class="gr-len">
              <input type="range" class="rng" data-k="charTarget" min="${r.min}" max="${r.max}" step="100" value="${ch.charTarget}" list="bb-g-ticks">
              <datalist id="bb-g-ticks">${(o.charTargets || []).map(v => `<option value="${v}"></option>`).join('')}</datalist>
              <div class="num-in"><input type="number" class="inp mono" data-k="charTarget" min="${r.min}" max="${r.max}" step="100" value="${ch.charTarget}"><span>자</span></div>
              ${selOpt('charBasis', 'charBases', ch.charBasis)}
            </div>
            <div class="rng-ticks">${[r.min, 1000, 2000, 3000, 4000, r.max].map(v => `<button type="button" data-tick="${v}">${v.toLocaleString()}</button>`).join('')}</div>
            <div class="hint" data-h="char"></div>`)}
          ${row('말투', '', `${selOpt('tone', 'tones', ch.tone)}<div class="hint" data-d="tone">${esc(descOf('tones', ch.tone))}</div>`)}
          ${row('제목', '', `${selOpt('titleMode', 'titleModes', ch.titleMode)}<div class="hint" data-d="titleMode">${esc(descOf('titleModes', ch.titleMode))}</div>
            <input class="inp" data-k="fixedTitle" maxlength="60" placeholder="제목을 그대로 적어 주세요 (키워드를 앞쪽에)"${ch.titleMode === 'fixed' ? '' : ' hidden'} value="${esc(ch.fixedTitle || '')}">`)}
          ${row('세부', '키워드·강조·정리', `<div class="gr-3">
            <label><span>키워드 반복</span>${selOpt('kwRepeat', 'kwRepeats', ch.kwRepeat, x => `${x.label} · ${x.desc}`)}</label>
            <label><span>굵게·형광펜</span>${selOpt('emphasis', 'emphases', ch.emphasis, x => `${x.label} · ${x.desc}`)}</label>
            <label><span>정리 Q&amp;A</span>${selOpt('qaCount', 'qaCounts', ch.qaCount)}</label></div>`)}
        </section>
        <section class="gs"><div class="gs-h"><span>03</span>이미지</div>
          ${row('이미지 방식', 'AI를 쓸지 말지', `${selOpt('imageMode', 'imageModes', ch.imageMode)}<div class="hint" data-d="imageMode">${esc(descOf('imageModes', ch.imageMode))}</div>`)}
          ${ch.imageMode === 'clinical' ? row('진료 분야', '치과 증례', `<select class="inp" data-k="field"><option value="">선택</option>${(o.clinicalFields || []).map(f => `<option value="${esc(f)}"${ch.field === f ? ' selected' : ''}>${esc(f)}</option>`).join('')}</select>
            <div class="hint">${ch.field === '소아치과' ? '<b>소아 사진은 얼굴이 보이지 않게(입안만 남기고 코·턱·볼 블러) 올려 주세요.</b> ' : ''}환자 식별 정보 금지 · 효과 보장·과장 금지 · 부작용·주의사항 문단 필수 — 원고 검사에서 자동으로 막습니다.</div>`) : ''}
          ${ch.imageMode === 'clinical' ? row('글 형태', '3종을 돌아가며', `${selOpt('clinicalForm', 'clinicalForms', ch.clinicalForm || 'stage')}<div class="hint" data-d="clinicalForm">${esc(descOf('clinicalForms', ch.clinicalForm || 'stage'))}</div>`) : ''}
          ${ch.imageMode === 'clinical' ? row('증례 메모', '사실만 짧게', `<textarea class="inp" data-k="caseNote" rows="3" maxlength="1000" placeholder="예: 40대 남성, 하악 우측 제1대구치 상실 상태로 내원. 골이식 후 임플란트 식립, 3개월 뒤 보철 완료">${esc(ch.caseNote || '')}</textarea>
            <div class="hint">이름·정확한 나이·날짜는 적지 않습니다. 비워 두면 사진 설명과 분야만으로 씁니다.</div>`) : ''}
          ${ch.imageMode === 'clinical' ? '' : row('장수', '본문 사진 전체', `
            <div class="gr-len">
              <input type="range" class="rng" data-k="imageCount" min="2" max="6" step="1" value="${ch.imageCount}">
              <div class="num-in sm"><input type="number" class="inp mono" data-k="imageCount" min="2" max="6" value="${ch.imageCount}"><span>장</span></div>
              ${ch.imageMode === 'ai' ? `<select class="inp" data-k="aiCount">${[1, 2].filter(n => n <= ch.imageCount).map(n => `<option value="${n}"${n === ch.aiCount ? ' selected' : ''}>AI 그림 ${n}장</option>`).join('')}</select>` : ''}
            </div>
            <div class="img-split" data-h="split"></div>`)}
          ${ch.imageMode === 'photos' ? row('내 사진', '글에 그대로 들어감', galleryHtml('photos')) : ''}
          ${ch.imageMode === 'clinical' ? row('임상 사진', '고른 순서 = 글 순서', galleryHtml('photos') + photoNotesHtml()) : ''}
          ${ch.imageMode === 'ai' ? row('그림 스타일', 'AI 그림에 적용', `${selOpt('imageStyle', 'styles', ch.imageStyle)}<div class="hint" data-d="imageStyle">${esc(descOf('styles', ch.imageStyle))}</div>`) : ''}
          ${ch.imageMode === 'ai' ? row('그림 참고', '원하는 느낌·피할 것', `<textarea class="inp" data-k="imageNotes" rows="3" maxlength="500" placeholder="예: 따뜻한 카페 분위기, 파스텔 톤, 창가 자연광 / 사람 얼굴은 보이지 않게, 어두운 색 피하기">${esc(ch.imageNotes || '')}</textarea>
            <div class="hint">AI 그림을 그릴 때 장면 묘사에 그대로 반영합니다. 템플릿 조합에 함께 저장됩니다.</div>`) : ''}
          ${ch.imageMode === 'ai' ? row('참고 이미지', '이 느낌으로 그려 줘', galleryHtml('refs')) : ''}
          ${ch.imageMode === 'clinical' ? '' : row('카드 종류', '글자 카드 템플릿', `<div class="chips">${o.cardTemplates.map(c => `<label class="chip"><input type="checkbox" data-card="${esc(c.key)}"${ch.cardTemplates.includes(c.key) ? ' checked' : ''}><b>${esc(c.label)}</b><span>${esc(c.desc)}</span></label>`).join('')}</div>`)}
          ${row('히든 이미지', '원장 소개·안내·지도', `${selOpt('useHidden', 'useHiddens', ch.useHidden || 'on')}<div class="hint" data-h="hidden">${hiddenOf(curAcc()).length ? `이 계정에 저장된 히든 이미지 ${hiddenOf(curAcc()).length}장: ${esc(hiddenOf(curAcc()).map(h => optLabel('hiddenSlots', h.slot) + (h.label ? '(' + h.label + ')' : '')).join(' · '))}` : '저장된 히든 이미지가 없습니다. [블로그 계정] → 블로그 성격 → 히든 이미지에서 비공개 글 주소로 가져오세요.'}</div>`)}
        </section>
        ${ch.imageMode === 'clinical' ? '' : `<section class="gs"><div class="gs-h"><span>04</span>레이아웃</div>
          ${row('글 짜임', '', `${selOpt('layout', 'layouts', ch.layout)}<div class="hint" data-d="layout">${esc(descOf('layouts', ch.layout))}</div>`)}
          ${row('장식', '체크·번호·기호', `${selOpt('deco', 'decos', ch.deco)}<div class="hint" data-d="deco">${esc(descOf('decos', ch.deco))}</div>`)}
        </section>`}`;
      refreshChoices();
    }
    // 임상 사진: 고른 순서대로 단계·설명 적기 (사진 이름 기준으로 저장)
    function photoNotesHtml() {
      const sel = (ch.photos || []); if (!sel.length) return '';
      const st = genOpts.clinicalStages || [];
      ch.photoNotes = ch.photoNotes || {};
      return `<div class="pnotes">${sel.map((n, i) => { const x = ch.photoNotes[n] || {}; return `<div class="pnote"><i class="mono">${pad(i + 1)}</i>
        <select class="inp" data-pn="${esc(n)}" data-pnk="stage">${st.map(s => `<option value="${esc(s.key)}"${(x.stage || 'etc') === s.key ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}</select>
        <input class="inp grow" type="text" maxlength="200" data-pn="${esc(n)}" data-pnk="note" value="${esc(x.note || '')}" placeholder="이 사진에서 보이는 것 (예: 초진 파노라마, 우측 하악 구치부 결손)"><span class="muted mono">${esc(n)}</span></div>`; }).join('')}
        <div class="hint">글은 이 순서대로 "소주제 → 설명 → 사진 → 사진 설명"이 이어집니다. 단계와 한 줄 설명을 적어 두면 그 내용대로 씁니다.</div></div>`;
    }

    // 그림 보관함 2종: refs(참고 이미지, AI 그림의 분위기용, 최대 3장 선택) · photos(내 사진, 글에 그대로, 최대 이미지 장수만큼 선택)
    const GAL = { refs: { list: () => refList, sel: () => (ch.refs = ch.refs || []), max: () => 3, accept: 'image/png,image/jpeg,image/webp', word: '참고 이미지', hint: n => `올려 둔 그림 중 최대 3장을 골라 두면 AI가 그 분위기·색감·화풍을 따라 새 장면을 그립니다(그림 자체를 베끼지 않음). 블로그마다 따로 보관 · ${n}/${genOpts.refMax || 20}장` },
      photos: { list: () => photoList, sel: () => (ch.photos = ch.photos || []), max: () => ch.imageMode === 'clinical' ? 8 : ch.imageCount, accept: 'image/png,image/jpeg', word: '사진', hint: n => ch.imageMode === 'clinical' ? `고른 순서가 곧 글의 순서입니다(초진 → 치료 중 → 결과). 최대 8장 · 카드 없음 · PNG·JPG · 블로그마다 따로 보관 · ${n}/${genOpts.photoMax || 200}장` : `고른 순서대로 글에 들어갑니다. 최대 ${ch.imageCount}장(이미지 장수) · 나머지 자리는 글자 카드 · PNG·JPG · 블로그마다 따로 보관 · ${n}/${genOpts.photoMax || 200}장` } };
    const refUrl = (id, n, kind) => `/api/gen/refimg?blogId=${encodeURIComponent(id)}&name=${encodeURIComponent(n)}&kind=${kind}`;
    function galleryHtml(kind) {
      const a = curAcc(); if (!a) return '';
      const g = GAL[kind], list = g.list();
      const sel = g.sel().filter(n => list.some(r => r.name === n)); if (kind === 'refs') ch.refs = sel; else ch.photos = sel;
      return `<div class="refs">${list.map(r => { const on = sel.includes(r.name); return `<label class="ref${on ? ' on' : ''}" title="${esc(r.name)}"><input type="checkbox" data-gal="${kind}" data-ref="${esc(r.name)}"${on ? ' checked' : ''}><img alt="" src="${esc(refUrl(a.blogId, r.name, kind))}" loading="lazy"><i>${on ? sel.indexOf(r.name) + 1 : ''}</i><button type="button" data-gal="${kind}" data-refdel="${esc(r.name)}" title="지우기">×</button></label>`; }).join('')}
          <label class="ref add" title="8MB 이하"><input type="file" accept="${g.accept}" multiple data-r="refFile" data-gal="${kind}" hidden><span>+</span><small>업로드</small></label></div>
        <div class="row" style="gap:8px;align-items:center"><button type="button" class="btn sm" data-act="refPick" data-gal="${kind}">파일 고르기</button>
          <span class="hint">${esc(g.hint(list.length))}</span></div>${kind === 'photos' && !sel.length ? '<div class="hint bad">사진을 1장 이상 골라야 만들 수 있습니다</div>' : ''}`;
    }
    async function loadRefs() {
      const a = curAcc(); if (!a) { refList = []; photoList = []; return; }
      const get = async kind => { try { const r = await BB.api(`/api/gen/refs?blogId=${encodeURIComponent(a.blogId)}&kind=${kind}`); if (kind === 'refs') { refList = r.items || []; genOpts.refMax = r.max; } else { photoList = r.items || []; genOpts.photoMax = r.max; } } catch (e) { } };
      await Promise.all([get('refs'), get('photos')]);
    }
    async function uploadRefs(files, kind) {
      const a = curAcc(); if (!a) return;
      const g = GAL[kind] || GAL.refs;
      let n = 0;
      for (const f of Array.from(files || [])) {
        if (!new RegExp('^(' + g.accept.replace(/,/g, '|') + ')$').test(f.type)) { BB.toast(`${f.name}: ${kind === 'photos' ? 'PNG·JPG만' : 'PNG·JPG·WebP만'} 올릴 수 있습니다`); continue; }
        if (f.size > 8 * 1024 * 1024) { BB.toast(`${f.name}: 8MB 이하만`); continue; }
        const dataUrl = await new Promise((ok, no) => { const rd = new FileReader(); rd.onload = () => ok(rd.result); rd.onerror = no; rd.readAsDataURL(f); });
        try { const r = await BB.api('/api/gen/refs/add', { blogId: a.blogId, name: f.name, dataUrl, kind }); if (kind === 'photos') photoList = r.items || photoList; else refList = r.items || refList; const sel = g.sel(); if (sel.length < g.max()) sel.push(r.name); n++; } catch (e) { }
      }
      if (n) { BB.toast(`${g.word} ${n}장을 올렸습니다`); touched(); paintChoices(); }
    }
    // 다시 그리지 않고 글자·요약만 갱신(슬라이더를 끄는 중에도 매끄럽게)
    function refreshChoices() {
      const q = s => root.querySelector(s);
      const h = q('[data-h="char"]');
      if (h) h.innerHTML = `본문 약 <b class="mono">${ch.charTarget.toLocaleString()}자</b> · 약 ${Math.round(ch.charTarget / perLine())}줄 · 읽는 시간 ${readMin()}분 · 목표에서 15% 넘게 벗어나면 한 번 더 고쳐 씁니다`;
      const sp = q('[data-h="split"]');
      if (sp) { const slots = aiSlots(); sp.innerHTML = Array.from({ length: ch.imageCount }, (_, i) => {
        const ai = slots.includes(i);
        return `<span class="${ai ? 'ai' : ''}"><i class="mono">${pad(i + 1)}</i>${ai ? (ch.imageMode === 'photos' ? '내 사진' : ch.imageMode === 'clinical' ? '임상 사진' : i === 0 ? '대표 AI' : 'AI') : '카드'}</span>`;
      }).join(''); }
      root.querySelectorAll('[data-d]').forEach(el => { const k = el.dataset.d, l = { tone: 'tones', titleMode: 'titleModes', imageStyle: 'styles', layout: 'layouts', deco: 'decos', imageMode: 'imageModes', clinicalForm: 'clinicalForms', useHidden: 'useHiddens' }[k]; el.textContent = descOf(l, ch[k] || (k === 'clinicalForm' ? 'stage' : k === 'useHidden' ? 'on' : ch[k])); });
      const ft = q('[data-k="fixedTitle"]'); if (ft) ft.hidden = ch.titleMode !== 'fixed';
      paintSummary();
    }

    // 현재 방식에서 AI/사진이 들어갈 자리 (writer.spreadSlots 와 같은 규칙)
    function aiSlots() {
      if (ch.imageMode === 'clinical') return Array.from({ length: (ch.photos || []).length }, (_, i) => i);
      const n = ch.imageCount, k = ch.imageMode === 'cards' ? 0 : ch.imageMode === 'photos' ? Math.min(n, (ch.photos || []).length) : Math.min(ch.aiCount, 2);
      if (k <= 0) return []; if (k >= n) return Array.from({ length: n }, (_, i) => i); if (k === 2) return [0, Math.floor(n / 2)];
      return [...new Set(Array.from({ length: k }, (_, i) => Math.floor(i * n / k)))];
    }
    function paintSummary() {
      const box = root.querySelector('[data-r="summary"]');
      if (!box || !ch) return;
      const rot = ch.preset === '__rotate__';
      const L = (l, k) => optLabel(l, k);
      const items = [
        ['분량', `${ch.charTarget.toLocaleString()}자 <em>${esc(L('charBases', ch.charBasis))} · ${readMin()}분</em>`],
        ['말투', esc(L('tones', ch.tone))],
        ['제목', esc(L('titleModes', ch.titleMode)) + (ch.titleMode === 'fixed' && ch.fixedTitle ? ` <em>${esc(ch.fixedTitle)}</em>` : '')],
        ['키워드', esc(descOf('kwRepeats', ch.kwRepeat))],
        ['강조', esc(L('emphases', ch.emphasis))],
        ['Q&A', esc(L('qaCounts', ch.qaCount))],
        ch.imageMode === 'clinical' ? ['이미지', `임상 사진 ${(ch.photos || []).length}장 <em>${esc(ch.field || '분야 미선택')} · 카드 없음</em>`] : ['이미지', `${ch.imageCount}장 <em>${ch.imageMode === 'cards' ? '전부 글자 카드' : ch.imageMode === 'photos' ? `내 사진 ${aiSlots().length} · 카드 ${ch.imageCount - aiSlots().length}` : `AI ${aiSlots().length} · 카드 ${ch.imageCount - aiSlots().length}`}</em>`],
        ch.imageMode === 'ai' ? ['스타일', esc(L('styles', ch.imageStyle)) + ((ch.refs && ch.refs.length) || ch.imageNotes ? ` <em>${[(ch.refs && ch.refs.length) ? '참고 이미지 ' + ch.refs.length + '장' : '', ch.imageNotes ? '참고 메모' : ''].filter(Boolean).join(' · ')}</em>` : '')] : ['방식', esc(L('imageModes', ch.imageMode))],
        ch.imageMode === 'clinical' ? ['글 형태', esc(L('clinicalForms', ch.clinicalForm || 'stage')) + ' <em>사진 순서대로 · 부작용·주의사항 · Q&A</em>'] : ['레이아웃', esc(L('layouts', ch.layout)) + ` <em>장식 ${esc(L('decos', ch.deco))}</em>`],
        ['히든', (ch.useHidden || 'on') === 'off' ? '사용 안 함' : (hiddenOf(curAcc()).length ? `+히든 ${hiddenOf(curAcc()).length}장 <em>${esc(hiddenOf(curAcc()).map(h => optLabel('hiddenSlots', h.slot)).join(' · '))}</em>` : '사용 <em>저장된 이미지 없음</em>')],
      ];
      box.innerHTML = rot ? '<div class="gen-rot">만들 때마다 저장된 조합 중 가장 오래 안 쓴 것을 골라 씁니다. 왼쪽 설정은 쓰지 않습니다.</div>'
        : `<dl class="gen-sum">${items.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
      root.querySelector('[data-r="choices"]') && root.querySelector('[data-r="choices"]').classList.toggle('dim', rot);
    }

    function paintPresets() {
      const a = curAcc(), box = root.querySelector('[data-r="presetBox"]');
      if (!box || !a) return;
      const ps = presetsOf(a);
      if (ch.preset && ch.preset !== '__rotate__' && !ps.find(p => p.name === ch.preset)) ch.preset = '';
      if (ch.preset === '__rotate__' && !ps.length) ch.preset = '';
      box.innerHTML = `
        <select class="inp" data-r="preset">
          <option value="">직접 설정</option>
          ${ps.map(p => `<option value="${esc(p.name)}"${p.name === ch.preset ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
          <option value="__rotate__"${ch.preset === '__rotate__' ? ' selected' : ''}${ps.length ? '' : ' disabled'}>돌아가며 사용</option>
        </select>
        <div class="gen-psave"><input class="inp" data-r="pname" maxlength="30" placeholder="지금 설정을 조합으로 저장"><button type="button" class="btn" data-act="savePreset">저장</button></div>
        <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap"><button type="button" class="btn sm" data-act="autoPresets">${ps.some(p => /^기본 \d · /.test(p.name)) ? '기본 3개 다시 구성' : '블로그 분석으로 기본 3개 구성'}</button>
          <span class="hint">이 블로그 글 제목·노출·반응·사진 수를 읽어 글 형태 템플릿 3개를 만들고 "돌아가며 사용"으로 둡니다</span></div>
        <button type="button" class="link" data-act="managePresets">${manage ? '관리 닫기' : `조합 관리 (${ps.length})`}</button>
        ${manage ? (ps.length ? `<div class="gen-plist">${ps.map((p, i) => `<div class="gen-pi"><input class="inp" data-pn="${i}" maxlength="30" value="${esc(p.name)}">
            <div class="muted">${esc(presetSummary(p))}</div>${p.note ? `<div class="hint">${esc(p.note)}</div>` : ''}
            <div class="row"><button type="button" class="btn sm" data-act="renamePreset" data-index="${i}">이름 저장</button>
            <button type="button" class="btn sm danger" data-act="delPreset" data-index="${i}">삭제</button></div></div>`).join('')}</div>` : '<div class="muted">저장된 조합이 없습니다.</div>') : ''}`;
      paintSummary();
    }

    function paintForm() {
      const a = curAcc(), fp = $('formp');
      if (!a) { fp.innerHTML = '<div class="empty">블로그 계정이 없습니다. <button type="button" class="link" data-act="goAccounts">블로그 계정 추가</button></div>'; return; }
      if (!ch || ch.blogId !== a.blogId) ch = Object.assign(defaults(a), { blogId: a.blogId });
      const cats = Array.isArray(a.categories) ? a.categories : [];
      const custom = !cats.length || (ch.category && !cats.includes(ch.category));
      fp.innerHTML = `<form class="gen-layout" data-r="form" autocomplete="off">
        <div class="gen-main">
          <section class="gs first"><div class="gs-h"><span>00</span>원고 프롬프트 <small class="muted">이 블로그의 모든 원고(자동·직접)에 그대로 들어가는 지시문</small></div>
            ${row('프롬프트', '치과·글 스타일 지시', `<textarea class="inp mono" data-r="gprompt" rows="7" maxlength="4000" placeholder="예:
- 우리 치과는 안양 평촌의 OO치과. 원장 1인, 보존·보철 중심.
- 말투: 환자에게 설명하듯 차분한 존댓말. 과장 없이.
- 글마다 '치료 전 상담에서 확인하는 것' 문단을 넣을 것.
- 피할 것: 가격 언급, 타 치과 비교, '최신 장비' 같은 표현.">${esc(a.prompt || '')}</textarea>
            <div class="row" style="gap:8px;align-items:center;margin-top:6px"><button type="button" class="btn sm" data-act="savePrompt">프롬프트 저장</button><span class="hint">블로그별로 저장되고 GPT 지시문에 그대로 붙습니다. 의료광고 금지 표현·환자 식별 금지 같은 기본 규칙보다 앞서지는 않습니다. 최대 4,000자.</span></div>`)}
          </section>
          <section class="gs"><div class="gs-h"><span>01</span>글 내용</div>
            ${row('키워드', '제목 앞쪽·본문에 들어감', `<input class="inp big" id="bb-g-kw" name="keyword" maxlength="60" required placeholder="예: 임플란트 골이식">`)}
            ${row('보조 키워드', '쉼표로, 최대 5개', `<input class="inp" id="bb-g-sub" name="subKeywords" maxlength="200" placeholder="예: INFJ 남자, INFJ 이별"><div class="hint">본문에 1~2번씩, 태그에도 넣습니다</div>`)}
            ${row('카테고리', '', `${cats.length ? `<select class="inp" id="bb-g-cat" data-r="catSel">${cats.map(c => `<option value="${esc(c)}"${c === ch.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}<option value="__custom__"${custom ? ' selected' : ''}>직접 입력</option></select>` : ''}
              <input class="inp" name="category" data-r="catInp" maxlength="40" placeholder="카테고리 이름" value="${esc(custom ? ch.category : '')}"${custom ? '' : ' hidden'}>
              ${cats.length ? '' : '<div class="hint">[블로그 계정] → 블로그 성격에 카테고리 목록을 넣으면 여기서 고를 수 있습니다</div>'}`)}
            ${row('주제', '무엇을 쓸지', `<textarea class="inp" id="bb-g-topic" name="topic" rows="3" maxlength="2000" placeholder="어떤 내용을 쓸지 한두 문장으로"></textarea>`)}
            ${row('참고 메모', '꼭 넣을 것·피할 것', `<textarea class="inp" id="bb-g-notes" name="notes" rows="3" maxlength="3000" placeholder="경험담, 꼭 넣을 내용, 피할 표현 등 (선택)"></textarea>`)}
          </section>
          <div data-r="choices"></div>
        </div>
        <aside class="gen-side">
          <div class="gen-card">
            <div class="gen-card-h">템플릿 조합</div>
            <div data-r="presetBox" class="stack"></div>
          </div>
          <div class="gen-card">
            <div class="gen-card-h">이번 원고</div>
            <div data-r="summary"></div>
            <button type="submit" class="btn pri gen-go" data-r="go">원고 만들기</button>
            <button type="button" class="btn gen-go2" data-act="enqueue" title="지금 만들지 않고 작업 큐에 넣습니다">예약 추가</button>
            <div class="sub" data-r="goHint"></div>
            <button type="button" class="link" data-act="resetChoices">기본값으로 되돌리기</button>
          </div>
        </aside>
      </form>`;
      paintChoices(); paintPresets(); paintGo(); paintAuto();
      // 주제 조회에서 [이 주제로 원고 만들기]로 넘어온 키워드
      const tk = lsGet('bb.topicKw'); if (tk) { lsSet('bb.topicKw', ''); const f0 = fp.querySelector('form'); if (f0 && f0.elements.keyword) { f0.elements.keyword.value = tk; wtab = 'custom'; lsSet('bb.writeTab', 'custom'); applyTab(); } }
      loadRefs().then(() => { if (ctx.alive && curAcc() && ch) paintChoices(); });
    }
    function paintGo() {
      const b = $('go'); if (!b) return;
      const noKey = !!(gs && !gs.hasKey);
      b.disabled = running() || noKey;
      $('goHint').textContent = running() ? '다른 원고를 만드는 중입니다' : noKey ? 'API 키를 먼저 저장하세요' : `글 ${gs ? gs.model : ''} · 이미지 ${gs ? gs.imageModel + ' ' + gs.imageQuality : ''}`;
    }

    function paintJob() {
      const p = $('jobp');
      if (!job) { p.hidden = true; return; }
      p.hidden = false;
      const lastStep = job.steps && job.steps.length ? job.steps[job.steps.length - 1] : null;
      let at = lastStep ? GEN_STEPS.indexOf(lastStep.name) : -1;
      if (at < 0 && lastStep && lastStep.n) at = Math.max(0, Math.min(GEN_STEPS.length - 1, (lastStep.i || 1) - 1));
      $('steps').innerHTML = GEN_STEPS.map((n, i) => {
        const cls = job.done && !job.error ? 'done' : i < at ? 'done' : i === at ? (job.done ? 'stop' : 'on') : '';
        return `<li class="${cls}"><i>${i + 1}</i>${esc(n)}</li>`;
      }).join('');
      $('prog').style.width = (job.done && !job.error ? 100 : Math.max(0, at) / GEN_STEPS.length * 100 + (at >= 0 && !job.done ? 100 / GEN_STEPS.length / 2 : 0)) + '%';
      $('jobTitle').textContent = job.kind === 'regen' ? '이미지 다시 만드는 중' : `원고 만들기 · ${job.keyword || ''}`;
      root.querySelector('[data-act="cancel"]').hidden = !!job.done || job.kind === 'regen';
      const st = $('jobStatus');
      if (!job.done) st.innerHTML = job.cancel ? '<span class="muted">취소 요청함 · 지금 단계가 끝나면 멈춥니다</span>' : `<span class="muted">${esc(lastStep ? lastStep.name : '준비')} 중</span>`;
      else if (job.error) st.innerHTML = `<span class="bad">${esc(job.cancelled ? '취소했습니다' : '실패')}</span>${job.cancelled ? '' : ' · ' + esc(job.error)}`;
      else st.innerHTML = `<span class="ok">완료</span> · ${esc(job.title || '')}${job.dir ? ` <button type="button" class="link" data-act="openNew">미리보기 열기</button>` : ''}`;
      const lg = $('log'); lg.textContent = (job.lines || []).join('\n'); lg.scrollTop = lg.scrollHeight;
    }

    function paintDrafts() {
      const a = curAcc(), box = $('drafts');
      if (!a) { box.innerHTML = ''; box.hidden = true; return; }
      box.hidden = false;
      box.innerHTML = `<div class="panel-h"><b>만든 원고 ${drafts.length}건</b><button type="button" class="btn sm" data-act="reloadDrafts">새로고침</button></div>
        ${drafts.length ? `<table class="tbl"><thead><tr><th>제목</th><th class="num">글자 수</th><th>레이아웃</th><th>이미지 스타일</th><th>만든 때</th><th>상태</th><th></th></tr></thead><tbody>
        ${drafts.map((d, i) => `<tr class="click" data-act="openDraft" data-index="${i}"><td>${esc(d.title)}<div class="muted mono">${esc(d.name)}</div></td>
          <td class="num">${d.chars ? Number(d.chars).toLocaleString() : '-'}</td><td>${esc(optLabel('layouts', d.layout))}</td><td>${esc(optLabel('styles', d.imageStyle))}</td>
          <td class="mono">${esc(fmtAt(d.created))}</td><td>${statusTxt(d)}</td>
          <td class="num"><div class="row"><button type="button" class="btn sm" data-act="openDraft" data-index="${i}">보기</button>
            <button type="button" class="btn sm" data-act="useDraft" data-index="${i}"${d.ok ? '' : ' disabled'}>입력하기</button></div></td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">아직 만든 원고가 없습니다.</div>'}`;
    }

    async function loadDrafts() {
      const a = curAcc();
      if (!a) { drafts = []; return paintDrafts(); }
      try { const r = await BB.api('/api/gen/drafts?blogId=' + encodeURIComponent(a.blogId)); if (ctx.alive) { drafts = r.items || []; paintDrafts(); } }
      catch (e) { if (ctx.alive) $('drafts').innerHTML = '<div class="empty">원고 목록을 불러오지 못했습니다.</div>'; }
    }

    async function savePresets(list, msg) {
      const a = curAcc(); if (!a) return;
      const r = await BB.api('/api/accounts/presets', { blogId: a.blogId, presets: list });
      a.presets = r.presets;
      if (msg) BB.toast(msg);
      paintPresets();
    }
    function applyPreset(name) {
      ch.preset = name;
      const p = presetsOf(curAcc()).find(x => x.name === name);
      if (p) { Object.assign(ch, { layout: p.layout, imageStyle: p.imageStyle, imageCount: p.imageCount, aiCount: p.aiCount, deco: p.deco, cardTemplates: [...p.cardTemplates] }); DETAIL_KEYS.forEach(k => { if (p[k] != null) ch[k] = p[k]; }); }
      remember(); paintPresets(); paintChoices();
    }
    // 직접 바꾸면 조합 선택은 '직접 선택'으로
    function touched() { if (ch.preset) { ch.preset = ''; paintPresets(); } remember(); }

    root.addEventListener('click', async e => {
      const tk = e.target.closest('[data-tick]');
      if (tk && root.contains(tk)) { ch.charTarget = +tk.dataset.tick; syncK('charTarget'); touched(); refreshChoices(); return; }
      const t = e.target.closest('[data-act],[data-refdel]');
      if (!t || !root.contains(t)) return;
      const act = t.dataset.act, i = +t.dataset.index;
      try {
        if (act === 'plan') {
          const a = curAcc(); if (!a) return;
          if (gs && !gs.hasKey && !(gs.fake)) return BB.toast('주제 추천은 OpenAI 키가 있어야 합니다. 입력 설정 → AI 설정');
          planning = true; paintAuto();
          try { const r = await BB.api('/api/gen/plan', { blogId: a.blogId, n: 3 }); cands = r.candidates || []; }
          finally { planning = false; paintAuto(); }
        }
        else if (act === 'useCand') { if (cands && cands[i]) fillCand(cands[i]); }
        else if (act === 'queueCand') { const a = curAcc(); if (!a || !cands || !cands[i]) return; const body = candBody(cands[i], a); if (!body.keyword) return; await BB.jobs.add(Object.assign({ lane: 'generate' }, body)); }
        else if (act === 'autoQueue') {
          const a = curAcc(); if (!a || !ch) return;
          const n = +($('autoN') && $('autoN').value) || 1;
          const base = { blogId: a.blogId, auto: true, preset: ch.preset, imageCount: ch.imageCount, aiCount: ch.aiCount, imageStyle: ch.imageStyle, layout: ch.layout, deco: ch.deco, cardTemplates: ch.cardTemplates,
            charTarget: ch.charTarget, charBasis: ch.charBasis, tone: ch.tone, kwRepeat: ch.kwRepeat, emphasis: ch.emphasis, qaCount: ch.qaCount, titleMode: ch.titleMode, imageMode: ch.imageMode === 'photos' ? 'cards' : ch.imageMode, imageNotes: ch.imageNotes || '', refs: (ch.refs || []).slice(0, 3) };
          for (let k = 0; k < n; k++) await BB.api('/api/queue/add', Object.assign({ lane: 'generate' }, base));
          BB.jobs.refresh(); BB.toast(`자동 원고 ${n}편을 예약했습니다. 작업 현황에서 진행을 볼 수 있습니다`);
        }
        else if (act === 'refPick') { const a = curAcc(); if (!a) return; const kind = t.dataset.gal || 'refs', g = GAL[kind]; const r = await BB.api('/api/gen/refs/pick', { blogId: a.blogId, kind }); if (kind === 'photos') photoList = r.items || photoList; else refList = r.items || refList; if (r.added && r.added.length) { const sel = g.sel(); for (const n of r.added) if (sel.length < g.max()) sel.push(n); BB.toast(`${g.word} ${r.added.length}장을 넣었습니다`); touched(); } paintChoices(); }
        else if (t.dataset.refdel) { e.preventDefault(); const a = curAcc(); const kind = t.dataset.gal || 'refs'; if (!a || !(await BB.confirm(`이 ${GAL[kind].word}을 보관함에서 지울까요?`))) return; const r = await BB.api('/api/gen/refs/delete', { blogId: a.blogId, name: t.dataset.refdel, kind }); if (kind === 'photos') { photoList = r.items || []; ch.photos = (ch.photos || []).filter(x => x !== t.dataset.refdel); } else { refList = r.items || []; ch.refs = (ch.refs || []).filter(x => x !== t.dataset.refdel); } remember(); paintChoices(); }
        else if (act === 'resetChoices') { const a = curAcc(); if (!a) return; lsSet(choiceKey(a.blogId), '{}'); ch = Object.assign(defaults(a), { blogId: a.blogId, category: ch.category }); paintChoices(); paintPresets(); BB.toast('기본값으로 되돌렸습니다'); }
        else if (act === 'enqueue') {
          const f = $('form'), a = curAcc(); if (!f || !a || !ch) return;
          const body = buildBody(f, a); if (!body) return;
          await BB.jobs.add(Object.assign({ lane: 'generate' }, body));
          f.elements.keyword.value = ''; f.elements.topic.value = ''; f.elements.keyword.focus();
        }
        else if (act === 'goKey') { lsSet('bb.focusAi', '1'); BB.go('#/blog/settings'); }
        else if (act === 'goAccounts') BB.go('#/blog/accounts');
        else if (act === 'reloadDrafts') loadDrafts();
        else if (act === 'openDraft') { if (drafts[i]) BB.go(draftHash(drafts[i].dir)); }
        else if (act === 'useDraft') { e.stopPropagation(); if (drafts[i]) { sel = drafts[i].file; lsSet('bb.handSel', sel); BB.go('#/blog/posts'); } }
        else if (act === 'openNew') { if (job && job.dir) BB.go(draftHash(job.dir)); }
        else if (act === 'cancel') { await BB.api('/api/gen/cancel', {}); if (job) { job.cancel = true; paintJob(); } }
        else if (act === 'managePresets') { manage = !manage; paintPresets(); }
        else if (act === 'autoPresets') {
          const a = curAcc(); if (!a) return;
          t.disabled = true; t.textContent = '블로그 데이터 읽는 중…';
          try {
            const r = await BB.api('/api/accounts/presets/auto', { blogId: a.blogId });
            a.presets = r.presets || [];
            ch.preset = '__rotate__'; manage = true; remember(); paintPresets();
            const d = r.data || {};
            BB.toast(`${r.kind === 'clinical' ? '치과 블로그' : '일반 블로그'}로 보고 기본 템플릿 ${(r.made || []).length}개를 구성했습니다 (글 ${d.titles || 0}편 · 잘 된 글 ${d.winners || 0}편 참고). "돌아가며 사용"으로 두었습니다`);
          } catch (err) { paintPresets(); }
        }
        else if (act === 'savePrompt') {
          const a = curAcc(), ta = root.querySelector('[data-r="gprompt"]'); if (!a || !ta) return;
          try { const r = await BB.api('/api/accounts/prompt', { blogId: a.blogId, prompt: ta.value }); a.prompt = r.prompt || ''; BB.toast(a.prompt ? '원고 프롬프트를 저장했습니다' : '원고 프롬프트를 비웠습니다'); } catch (err) { }
        }
        else if (act === 'savePreset') {
          const a = curAcc(), inp = $('pname'), name = inp.value.trim();
          if (!name) { inp.focus(); return BB.toast('조합 이름을 입력하세요'); }
          const ps = presetsOf(a).slice();
          if (!ch.cardTemplates.length && ch.imageMode !== 'clinical') return BB.toast('카드 종류를 하나 이상 고르세요');
          const p = { name, layout: ch.layout, imageStyle: ch.imageStyle, imageCount: ch.imageCount, aiCount: ch.aiCount, deco: ch.deco, cardTemplates: ch.cardTemplates.slice() };
          DETAIL_KEYS.forEach(k => { p[k] = ch[k]; });
          if (p.titleMode === 'fixed') p.titleMode = 'auto';
          const at = ps.findIndex(x => x.name === name);
          if (at >= 0) { if (!(await BB.confirm(`[${name}] 조합을 지금 선택으로 바꿀까요?`))) return; ps[at] = p; } else ps.push(p);
          await savePresets(ps, '조합을 저장했습니다');
          ch.preset = name; remember(); paintPresets();
        }
        else if (act === 'renamePreset') {
          const ps = presetsOf(curAcc()).slice(), inp = root.querySelector(`[data-pn="${i}"]`);
          if (!ps[i] || !inp) return;
          const old = ps[i].name, name = inp.value.trim();
          if (!name || name === old) return;
          ps[i] = { ...ps[i], name };
          await savePresets(ps, '이름을 바꿨습니다');
          if (ch.preset === old) { ch.preset = name; remember(); paintPresets(); }
        }
        else if (act === 'delPreset') {
          const ps = presetsOf(curAcc()).slice();
          if (!ps[i] || !(await BB.confirm(`[${ps[i].name}] 조합을 지울까요?`))) return;
          ps.splice(i, 1);
          await savePresets(ps, '조합을 지웠습니다');
        }
      } catch (err) { }
    });
    root.addEventListener('change', e => {
      const t = e.target;
      if (!ch) return;
      if (t.dataset.r === 'preset') applyPreset(t.value);
      else if (t.dataset.r === 'catSel') { const inp = $('catInp'), custom = t.value === '__custom__'; if (inp) inp.hidden = !custom; ch.category = custom ? (inp ? inp.value.trim() : '') : t.value; remember(); if (custom && inp) inp.focus(); }
      else if (t.dataset.r === 'catInp') { ch.category = t.value.trim(); remember(); }
      else if (t.dataset.r === 'autoN') { autoN = +t.value || 1; }
      else if (t.dataset.k) { setK(t.dataset.k, t.value); }
      else if (t.dataset.r === 'refFile') { uploadRefs(t.files, t.dataset.gal || 'refs'); t.value = ''; }
      else if (t.dataset.ref != null) {
        const kind = t.dataset.gal || 'refs', g = GAL[kind], n = t.dataset.ref, set = g.sel().filter(x => x !== n);
        if (t.checked) { if (set.length >= g.max()) { t.checked = false; return BB.toast(`${g.word}은 ${g.max()}장까지 고를 수 있습니다`); } set.push(n); }
        if (kind === 'refs') ch.refs = set; else ch.photos = set;
        touched(); paintChoices();
      }
      else if (t.dataset.card != null) {
        const set = new Set(ch.cardTemplates);
        if (t.checked) set.add(t.dataset.card); else set.delete(t.dataset.card);
        ch.cardTemplates = genOpts.cardTemplates.map(c => c.key).filter(k => set.has(k));
        touched();
      }
    });
    // data-k 조작 공통: 값 반영 → 같은 키의 다른 조작(슬라이더↔숫자) 맞추기 → 요약 갱신
    function setK(k, v, live) {
      if (k === 'fixedTitle' || k === 'imageNotes' || k === 'caseNote') { ch[k] = String(v).slice(0, k === 'imageNotes' ? 500 : k === 'caseNote' ? 1000 : 60); if (!live) remember(); paintSummary(); return; }
      if (k === 'field') { ch.field = String(v); remember(); paintChoices(); return; }
      if (NUM_KEYS.includes(k)) {
        const r = k === 'charTarget' ? charRange() : k === 'imageCount' ? { min: 2, max: 6 } : { min: 1, max: 2 };
        let n = Math.round(+v); if (!Number.isFinite(n)) return;
        if (k === 'charTarget') n = Math.round(n / 100) * 100;
        ch[k] = Math.min(r.max, Math.max(r.min, n));
      } else ch[k] = v;
      if (ch.aiCount > ch.imageCount) ch.aiCount = ch.imageCount;
      syncK(k);
      if (live) { refreshChoices(); return; }
      touched();
      if (k === 'imageCount' || k === 'imageMode') { if (k === 'imageCount' && ch.photos) ch.photos = ch.photos.slice(0, ch.imageCount); paintChoices(); } else refreshChoices();
    }
    function syncK(k) { root.querySelectorAll(`[data-k="${k}"]`).forEach(el => { if (String(el.value) !== String(ch[k])) el.value = ch[k]; }); }
    root.addEventListener('input', e => {
      const t = e.target; if (!ch || !t.dataset) return;
      if (t.dataset.pn) { ch.photoNotes = ch.photoNotes || {}; const x = ch.photoNotes[t.dataset.pn] || (ch.photoNotes[t.dataset.pn] = {}); x[t.dataset.pnk] = t.value; remember(); return; }
      if (!t.dataset.k) return;
      if (t.type === 'range') setK(t.dataset.k, t.value, true);
      else if (t.tagName === 'TEXTAREA' || t.type === 'text') setK(t.dataset.k, t.value, true);
    });
    function buildBody(f, a) {
      const keyword = f.elements.keyword.value.trim();
      if (!keyword) { f.elements.keyword.focus(); BB.toast('키워드를 입력하세요'); return null; }
      if (!ch.cardTemplates.length && ch.preset !== '__rotate__' && ch.imageMode !== 'clinical') { BB.toast('카드 종류를 하나 이상 고르세요'); return null; }
      const catSel = $('catSel');
      const category = catSel && catSel.value !== '__custom__' ? catSel.value : $('catInp').value.trim();
      ch.category = category; remember();
      const body = { blogId: a.blogId, keyword, topic: f.elements.topic.value, category, notes: f.elements.notes.value,
        imageCount: ch.imageCount, aiCount: ch.aiCount, imageStyle: ch.imageStyle, layout: ch.layout, deco: ch.deco, cardTemplates: ch.cardTemplates, preset: ch.preset,
        charTarget: ch.charTarget, charBasis: ch.charBasis, tone: ch.tone, kwRepeat: ch.kwRepeat, emphasis: ch.emphasis, qaCount: ch.qaCount, titleMode: ch.titleMode,
        subKeywords: f.elements.subKeywords.value, imageNotes: ch.imageNotes || '', fixedTitle: ch.titleMode === 'fixed' ? (ch.fixedTitle || '').trim() : '', refs: (ch.refs || []).slice(0, 3),
        imageMode: ch.imageMode, photos: (ch.photos || []).slice(0, ch.imageMode === 'clinical' ? 8 : ch.imageCount) };
      body.useHidden = ch.useHidden || 'on';
      if (ch.imageMode === 'clinical') { body.field = ch.field || ''; body.caseNote = ch.caseNote || ''; body.clinicalForm = ch.clinicalForm || 'stage'; body.photoNotes = {}; for (const n of body.photos) body.photoNotes[n] = ch.photoNotes && ch.photoNotes[n] ? ch.photoNotes[n] : { stage: 'etc', note: '' }; }
      if ((ch.imageMode === 'photos' || ch.imageMode === 'clinical') && !body.photos.length && ch.preset !== '__rotate__') { BB.toast(ch.imageMode === 'clinical' ? '임상 사진을 1장 이상 골라 주세요' : '내 사진 방식은 사진을 1장 이상 골라야 합니다'); return null; }
      if (ch.titleMode === 'fixed' && !body.fixedTitle && ch.preset !== '__rotate__') { const ft = root.querySelector('[data-k="fixedTitle"]'); if (ft) ft.focus(); BB.toast('제목을 입력하세요'); return null; }
      return body;
    }
    root.addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target, a = curAcc();
      if (f.dataset.r === 'sched') {
        if (!a) return;
        try { const r = await BB.api('/api/accounts/auto', { blogId: a.blogId, enabled: f.elements.enabled.checked, perDay: +f.elements.perDay.value, at: f.elements.at.value }); a.auto = r.auto; BB.toast(r.auto.enabled ? `매일 ${r.auto.at}에 자동 원고 ${r.auto.perDay}편을 등록합니다` : '자동 일정을 껐습니다'); paintAuto(); } catch (err) { }
        return;
      }
      if (!a || !ch || running()) return;
      const keyword = f.elements.keyword.value.trim();
      if (!keyword) { f.elements.keyword.focus(); return BB.toast('키워드를 입력하세요'); }
      if (!ch.cardTemplates.length && ch.preset !== '__rotate__') return BB.toast('카드 종류를 하나 이상 고르세요');
      const catSel = $('catSel');
      const category = catSel && catSel.value !== '__custom__' ? catSel.value : $('catInp').value.trim();
      ch.category = category; remember();
      const body = { blogId: a.blogId, keyword, topic: f.elements.topic.value, category, notes: f.elements.notes.value,
        imageCount: ch.imageCount, aiCount: ch.aiCount, imageStyle: ch.imageStyle, layout: ch.layout, deco: ch.deco, cardTemplates: ch.cardTemplates, preset: ch.preset,
        charTarget: ch.charTarget, charBasis: ch.charBasis, tone: ch.tone, kwRepeat: ch.kwRepeat, emphasis: ch.emphasis, qaCount: ch.qaCount, titleMode: ch.titleMode,
        subKeywords: f.elements.subKeywords.value, imageNotes: ch.imageNotes || '', fixedTitle: ch.titleMode === 'fixed' ? (ch.fixedTitle || '').trim() : '' };
      if (ch.titleMode === 'fixed' && !body.fixedTitle && ch.preset !== '__rotate__') { const ft = root.querySelector('[data-k="fixedTitle"]'); if (ft) ft.focus(); return BB.toast('제목을 입력하세요'); }
      try {
        job = { kind: 'generate', keyword, steps: [], lines: [], done: false };
        paintJob(); paintGo();
        const r = await BB.api('/api/gen/start', body);
        if (r.preset && job) { job.preset = r.preset; }
        $('jobp').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } catch (err) { job = null; paintJob(); paintGo(); }
    });

    const onEv = ev => {
      if (!ctx.alive || !ev) return;
      const { type, data } = ev;
      if (type === 'genstep') { if (!job || job.done) job = { kind: 'generate', steps: [], lines: [], done: false }; job.steps.push(data); paintJob(); }
      else if (type === 'genlog') { if (!job) job = { kind: 'generate', steps: [], lines: [], done: false }; job.lines.push(data); paintJob(); }
      else if (type === 'gendone') {
        if (!job) job = { kind: 'generate', steps: [], lines: [] };
        Object.assign(job, { done: true, error: data.error || null, cancelled: !!data.cancelled, dir: data.dir, title: data.title });
        paintJob(); paintGo(); loadDrafts();
        BB.toast(data.ok ? '원고를 만들었습니다' : data.cancelled ? '취소했습니다' : '원고를 만들지 못했습니다');
      }
    };
    const off = typeof BB.onEvent === 'function' ? BB.onEvent(onEv) : null;

    Promise.all([loadState(), loadOpts(), BB.api('/api/gen/settings'), BB.api('/api/gen/job')]).then(([, , s, j]) => {
      if (!ctx.alive) return;
      gs = s;
      const jj = j && j.job;
      if (jj && !jj.done && jj.kind === 'generate') {   // 진행 중인 작업만 이어서 보여 준다
        job = { ...jj, dir: jj.result && jj.result.dir, title: jj.result && jj.result.title };
      }
      paintNoKey(); paintForm(); paintJob(); loadDrafts();
    }).catch(() => { if (ctx.alive) $('formp').innerHTML = '<div class="empty">화면을 불러오지 못했습니다. 다시 열어 주세요.</div>'; });

    return () => { ctx.alive = false; if (typeof off === 'function') off(); };
  }

  // 미리보기: .txt 원고를 블로그처럼 보여 준다 (가운데 정렬, 인용구, ## 19pt, **굵게**, [[형광펜|#색]])
  function inlineFmt(s) {
    return esc(s)
      .replace(/\[\[(.+?)\|(#[0-9a-fA-F]{6})\]\]/g, (m, t, c) => `<span class="bp-hl" style="background:${c}">${t}</span>`)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  }
  function renderPreview(txt, rel, imgMap) {
    const raw = String(txt || '').replace(/^﻿/, '').replace(/\r/g, '');
    const cut = raw.search(/\n\s*\n/);
    const head = cut < 0 ? raw : raw.slice(0, cut), rest = cut < 0 ? '' : raw.slice(cut).replace(/^\n+/, '');
    const meta = {};
    head.split('\n').forEach(l => { const m = l.match(/^\s*([^:：]+)[:：]\s*(.*)$/); if (m) meta[m[1].trim()] = m[2].trim(); });
    const tags = (meta['태그'] || '').split(/[,，\s]+/).map(t => t.replace(/^#/, '')).filter(Boolean);
    const out = [`<div class="bp-cat">${esc(meta['카테고리'] || '')}</div><h2 class="bp-title">${esc(meta['제목'] || '(제목 없음)')}</h2><hr class="bp-hr">`];
    let blank = 0;
    for (const l of rest.split('\n')) {
      const t = l.trim();
      if (!t) { blank++; if (blank === 1) out.push('<div class="bp-gap"></div>'); continue; }
      blank = 0;
      if (t.startsWith('> ')) out.push(`<blockquote class="bp-quote">${inlineFmt(t.slice(2).trim())}</blockquote>`);
      else if (t === '---') out.push('<hr class="bp-hr">');
      else if (/^\[사진\]/.test(t)) {
        const f = t.replace(/^\[사진\]\s*/, '').split(/[\\/]/).pop();
        out.push(`<figure class="bp-img"><img alt="${esc(f)}" src="${esc(imgMap[f] || imgUrl(rel, f))}"><figcaption class="muted mono">${esc(f)}</figcaption></figure>`);
      }
      else if (/^\[링크\]/.test(t)) { const u = t.replace(/^\[링크\]\s*/, ''); out.push(`<div class="bp-ph">링크 자리${u ? ' · ' + esc(u) : ' · 입력할 때 넣습니다'}</div>`); }
      else if (t === '[해시태그]') out.push(`<div class="bp-tags">${tags.length ? tags.map(x => '#' + esc(x)).join(' ') : '<span class="muted">해시태그 자리 (태그 없음)</span>'}</div>`);
      else if (t.startsWith('## ')) out.push(`<div class="bp-h">${inlineFmt(t.slice(3))}</div>`);
      else out.push(`<p>${inlineFmt(t)}</p>`);
    }
    return out.join('');
  }

  function pageDraft(root, rel) {
    const ctx = { alive: true };
    let D = null, editing = false, busy = -1;
    function statsHtml(txt) {
      const dr = D.draft || {}, kw = D.keyword || (dr.input && dr.input.keyword) || '';
      const st = txtStats(txt == null ? D.txt : txt, kw), t = dr.charTarget, basis = dr.charBasis === 'space' ? 'charsWithSpace' : 'chars';
      const off = t ? Math.round((st[basis] - t) / t * 100) : null;
      const pct = off == null ? '' : (off >= 0 ? '+' : '') + off + '%';
      const cell = (k, val, sub) => `<div><dt>${k}</dt><dd class="mono">${val}${sub ? `<span class="muted"> ${sub}</span>` : ''}</dd></div>`;
      const warn = Array.isArray(dr.warnings) ? dr.warnings : [];
      return `<div class="panel" data-r="stats"><div class="panel-h"><b>원고 분량</b><span class="sub">${t ? `목표 ${Number(t).toLocaleString()}자(${dr.charBasis === 'space' ? '공백 포함' : '공백 제외'})` : '목표 미지정(예전 원고)'}</span></div>
        <dl class="gen-stats">
          ${cell('공백 제외', st.chars.toLocaleString() + '자', basis === 'chars' ? pct : '')}
          ${cell('공백 포함', st.charsWithSpace.toLocaleString() + '자', basis === 'charsWithSpace' ? pct : '')}
          ${cell('본문 줄', st.lines + '줄')}${cell('소주제', st.subs + '개')}
          ${cell('키워드', st.kw + '번', kw ? esc(kw) : '')}${cell('읽는 시간', '약 ' + st.minutes + '분')}
        </dl>
        ${warn.length ? `<ul class="gen-warn">${warn.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}</div>`;
    }
    root.innerHTML = `<div class="row"><button type="button" class="link" data-act="back">← 원고 목록</button></div><div data-r="body"><div class="empty">불러오는 중</div></div>`;
    const body = root.querySelector('[data-r="body"]');

    function paint() {
      if (!ctx.alive || !D) return;
      const imgMap = {}; (D.images || []).forEach(m => { imgMap[m.file] = m.url; });
      body.innerHTML = `<div class="stack">
        <div class="page-h"><h1>${esc(D.title)}</h1>
          <div class="sub">${[D.layout && '레이아웃 ' + optLabel('layouts', D.layout), D.imageStyle && '이미지 ' + optLabel('styles', D.imageStyle), D.deco && '장식 ' + optLabel('decos', D.deco), D.draft && D.draft.preset ? '조합 ' + D.draft.preset : '', D.draft && D.draft.input && D.draft.input.auto ? '자동 기획' : '', fmtAt(D.created)].filter(Boolean).map(esc).join(' · ')} · ${statusTxt(D)}${D.draft && D.draft.reviewed ? ' · <span class="st ok">검토 완료 ' + esc(fmtAt(D.draft.reviewed.at)) + '</span>' : ' · <span class="st warn">검토 전</span>'}</div>
          ${D.ok ? '' : `<div class="bad">${esc(D.error)}</div>`}</div>
        <div class="row">
          <button type="button" class="btn pri" data-act="use"${D.ok ? '' : ' disabled'}>이 원고로 입력하기</button>
          <button type="button" class="btn${D.draft && D.draft.reviewed ? '' : ' ok-btn'}" data-act="review">${D.draft && D.draft.reviewed ? '검토 취소' : '검토 완료 표시'}</button>
          <button type="button" class="btn" data-act="edit">${editing ? '편집 닫기' : '원고 편집'}</button>
          <button type="button" class="btn" data-act="folder">폴더 열기</button>
          <div class="grow"></div>
          <button type="button" class="btn danger" data-act="del">삭제</button>
        </div>
        <div class="panel" data-r="edit"${editing ? '' : ' hidden'}>
          <div class="panel-h"><b>원고.txt 편집</b><span class="sub">저장할 때 입력 엔진 형식으로 검사합니다</span></div>
          <textarea class="inp mono gen-edit" data-r="txt" spellcheck="false"></textarea>
          <div class="row" style="margin-top:12px"><button type="button" class="btn pri" data-act="save">저장</button><button type="button" class="btn" data-act="revert">되돌리기</button></div>
        </div>
        ${statsHtml()}
        <div class="panel">
          <div class="panel-h"><b>이미지 ${(D.images || []).length}장</b></div>
          ${(D.images || []).length ? `<div class="imgstrip">${D.images.map((m, i) => `<div class="thumb">
            <img alt="${esc(m.file)}" src="${esc(m.url)}">
            <div class="row"><span class="grow mono">${esc(m.file)}</span><span class="muted">${m.kind === 'ai' ? 'AI 이미지' : m.kind === 'photo' ? '내 사진' + (m.source ? ' · ' + esc(m.source) : '') : m.kind === 'hidden' ? '히든 이미지 · ' + esc(optLabel('hiddenSlots', m.slot)) : m.kind === 'card' ? '카드 ' + esc(optLabel('cardTemplates', m.template)) : ''}</span></div>
            ${m.kind === 'ai' ? `<textarea class="inp" data-prompt="${i}" rows="2" maxlength="2000" placeholder="새 설명 (비우면 기존 설명)">${esc(m.prompt)}</textarea>` : ''}
            ${m.kind === 'photo' || m.kind === 'hidden' ? '' : `<button type="button" class="btn sm" data-act="regen" data-index="${i}"${busy >= 0 ? ' disabled' : ''}>${busy === i ? '만드는 중' : '다시 생성'}</button>`}
          </div>`).join('')}</div>` : '<div class="empty">이미지가 없습니다.</div>'}
        </div>
        <div class="panel"><div class="panel-h"><b>미리보기</b><span class="sub">실제 블로그 글자 크기·간격과는 조금 다를 수 있습니다</span></div>
          <div class="bp">${renderPreview(D.txt, D.dir, imgMap)}</div></div>
      </div>`;
      const ta = body.querySelector('[data-r="txt"]');
      if (ta) {
        ta.value = D.txt || '';
        ta.addEventListener('input', () => { const box = body.querySelector('[data-r="stats"]'); if (box) box.outerHTML = statsHtml(ta.value); });
      }
    }
    async function load() {
      try {
        await loadOpts();
        const r = await BB.api('/api/gen/draft?dir=' + encodeURIComponent(rel));
        if (!ctx.alive) return;
        D = r; paint();
      } catch (e) { if (ctx.alive) body.innerHTML = '<div class="panel"><div class="empty">원고를 불러오지 못했습니다. 지워졌거나 옮겨졌을 수 있습니다.</div></div>'; }
    }

    root.addEventListener('click', async e => {
      const t = e.target.closest('[data-act]');
      if (!t || !root.contains(t)) return;
      const act = t.dataset.act;
      if (act === 'back') return BB.go('#/blog/write');
      if (!D) return;
      try {
        if (act === 'use') { sel = D.file; lsSet('bb.handSel', D.file); BB.go('#/blog/posts'); }
        else if (act === 'edit') { editing = !editing; paint(); if (editing) body.querySelector('[data-r="txt"]').focus(); }
        else if (act === 'revert') body.querySelector('[data-r="txt"]').value = D.txt || '';
        else if (act === 'review') { await BB.api('/api/gen/review', { dir: D.dir, reviewed: !(D.draft && D.draft.reviewed) }); BB.toast(D.draft && D.draft.reviewed ? '검토 표시를 지웠습니다' : '검토 완료로 표시했습니다. 원고·발행에서 발행하세요'); await load(); }
        else if (act === 'folder') openP(D.file.replace(/[\\/][^\\/]+$/, ''));
        else if (act === 'save') {
          const v = body.querySelector('[data-r="txt"]').value;
          await BB.api('/api/gen/save', { dir: D.dir, txt: v });
          BB.toast('저장했습니다');
          editing = false; await load();
        }
        else if (act === 'regen') {
          const i = +t.dataset.index, m = D.images[i];
          if (!m || busy >= 0) return;
          const pr = body.querySelector(`[data-prompt="${i}"]`);
          const prompt = pr && pr.value.trim() && pr.value.trim() !== m.prompt ? pr.value.trim() : undefined;
          busy = i; paint();
          try {
            const r = await BB.api('/api/gen/regen', { dir: D.dir, index: i, prompt });
            if (r.images) D.images = r.images;
            BB.toast('이미지를 다시 만들었습니다');
          } finally { busy = -1; if (ctx.alive) paint(); }
        }
        else if (act === 'del') {
          if (!(await BB.confirm(`[${D.title}] 원고를 지울까요?\n원고함\\_휴지통 폴더로 옮깁니다.`))) return;
          await BB.api('/api/gen/delete', { dir: D.dir });
          BB.toast('휴지통으로 옮겼습니다');
          BB.go('#/blog/write');
        }
      } catch (err) { }
    });
    load();
    return () => { ctx.alive = false; };
  }

  // ── 블로그 계정 ───────────────────────────────────
  function pageAccounts(root) {
    const ctx = { alive: true };
    root.innerHTML = `
      <div class="page-h"><h1>블로그 계정</h1>
        <div class="sub">로그인은 처음 한 번 [로그인 창 열기]에서 직접 하고 "로그인 상태 유지"를 체크하세요. 비밀번호는 이 앱에 저장하지 않습니다.</div></div>
      <div class="panel" data-r="list"><div class="empty">불러오는 중</div></div>
      <div class="panel" data-r="prof" hidden></div>
      <div class="panel">
        <div class="panel-h"><b>계정 추가</b></div>
        <form class="form" data-r="add" autocomplete="off">
          <div class="field"><label>이름</label><input class="inp" name="name" maxlength="40" placeholder="예: 디어스치과 블로그"></div>
          <div class="field"><label>블로그 아이디</label><input class="inp mono" name="blogId" required pattern="^[a-zA-Z0-9_\\-]{3,40}$" placeholder="예: jsrjkb6742">
            <div class="hint">blog.naver.com/ 뒤 부분 (영문·숫자·_·- 3~40자)</div></div>
          <div class="row"><button type="submit" class="btn pri">추가</button></div>
        </form>
      </div>`;
    const $ = r => root.querySelector(`[data-r="${r}"]`);

    function paint() {
      if (!ctx.alive || !S) return;
      const list = S.accounts;
      $('list').innerHTML = list.length ? `<table class="tbl"><thead><tr><th>이름</th><th>아이디</th><th></th></tr></thead><tbody>
        ${list.map((a, i) => `<tr${a.blogId === acc ? ' class="sel"' : ''}><td>${esc(a.name)}</td><td class="mono">${esc(a.blogId)}</td>
          <td class="num"><div class="row">
            <button type="button" class="btn sm" data-act="prof" data-index="${i}">블로그 성격</button>
            <button type="button" class="btn sm" data-act="login" data-index="${i}">로그인 창 열기</button>
            <button type="button" class="btn sm" data-act="open" data-index="${i}">블로그 열기</button>
            <button type="button" class="btn sm danger" data-act="del" data-index="${i}">삭제</button></div></td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">등록된 블로그 계정이 없습니다. 아래에서 추가하세요.</div>';
      paintProfile();
    }
    // 블로그 성격: GPT가 원고를 쓸 때 따르는 화자·독자·카테고리·규칙·대표 색 (선택한 계정)
    // 편집기 인용구·구분선 스타일(naver_post\styles.js 와 같은 키)
    const SE_QUOTE_STYLES = [['default', '따옴표 (인용구 1)'], ['quotation_line', '세로선 (인용구 2)'], ['quotation_bubble', '말풍선 (인용구 3)'], ['quotation_underline', '밑줄 (인용구 4)'], ['quotation_postit', '포스트잇 (인용구 5)'], ['quotation_corner', '프레임 (인용구 6)']];
    const SE_LINE_STYLES = [['default', '구분선 1 (기본)'], ...[1, 2, 3, 4, 5, 6, 7].map(n => [`line${n}`, `구분선 ${n + 1}`])];
    function paintProfile() {
      const box = $('prof'), a = curAcc();
      box.hidden = !a;
      if (!a) return;
      const color = /^#[0-9a-f]{6}$/i.test(a.color || '') ? a.color : '#0051c3';
      box.innerHTML = `<div class="panel-h"><b>블로그 성격 · ${esc(a.name)}</b><span class="sub">GPT가 원고를 쓸 때 이 내용을 따릅니다</span></div>
        <form class="form" data-r="pform" autocomplete="off">
          <div class="field"><label for="bb-p-persona">화자·말투</label><textarea class="inp" id="bb-p-persona" name="persona" rows="2" maxlength="300" placeholder="예: MBTI를 좋아하는 20대 직장인, 친구에게 말하듯 편한 존댓말">${esc(a.persona || '')}</textarea></div>
          <div class="field"><label for="bb-p-aud">독자</label><input class="inp" id="bb-p-aud" name="audience" maxlength="200" placeholder="예: MBTI에 관심 있는 20~30대" value="${esc(a.audience || '')}"></div>
          <div class="field"><label for="bb-p-cats">카테고리 목록</label><textarea class="inp" id="bb-p-cats" name="categories" rows="4" placeholder="한 줄에 하나">${esc((a.categories || []).join('\n'))}</textarea>
            <div class="hint">한 줄에 하나 (최대 30개). 원고 만들기에서 고를 수 있습니다.</div></div>
          <div class="field"><label for="bb-p-rules">추가 규칙</label><textarea class="inp" id="bb-p-rules" name="rules" rows="3" maxlength="1000" placeholder="예: 특정 유형을 깎아내리지 않는다">${esc(a.rules || '')}</textarea></div>
          <div class="field"><label for="bb-p-home">홈페이지 주소</label><input class="inp mono" id="bb-p-home" name="homepage" maxlength="200" placeholder="예: https://www.example-dental.com" value="${esc(a.homepage || '')}">
            <div class="hint">넣어 두면 모든 원고 끝에 블로그 홈 대신 이 주소가 링크 카드로 들어갑니다. 비우면 블로그 홈 링크.</div></div>
          <div class="row" style="gap:12px;align-items:flex-start">
            <div class="field grow"><label for="bb-p-homel">홈페이지 링크 문구</label><input class="inp" id="bb-p-homel" name="homepageLabel" maxlength="30" placeholder="예: 치과 홈페이지 바로가기" value="${esc(a.homepageLabel || '')}"></div>
            <div class="field"><label for="bb-p-linkn">관련 글 내부 링크</label><select class="inp" id="bb-p-linkn" name="linkInternal">${[0, 1, 2].map(n => `<option value="${n}"${(a.linkInternal == null ? 2 : +a.linkInternal) === n ? ' selected' : ''}>${n ? n + '개' : '안 넣음'}</option>`).join('')}</select>
              <div class="hint">원고 끝 "함께 보면 좋은 글"에 이 블로그의 관련 글 링크를 넣습니다(대시보드 데이터·공개 글 목록에서 주제가 겹치는 글).</div></div>
          </div>
          <div class="row" style="gap:12px;align-items:flex-start">
            <div class="field"><label for="bb-p-qs">인용구 스타일</label><select class="inp" id="bb-p-qs" name="quoteStyle">${SE_QUOTE_STYLES.map(([k, l]) => `<option value="${k}"${(a.quoteStyle || 'default') === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
              <div class="hint">편집기 인용구 모양. 따옴표(인용구 1)·세로선(인용구 2)·말풍선(3)·밑줄(4)·포스트잇(5)·프레임(6)</div></div>
            <div class="field"><label for="bb-p-ls">구분선 스타일</label><select class="inp" id="bb-p-ls" name="lineStyle">${SE_LINE_STYLES.map(([k, l]) => `<option value="${k}"${(a.lineStyle || 'default') === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
              <div class="hint">편집기 구분선 모양(구분선 1~8). 만들어지는 원고 머리말에 들어가고 전수검사에서 확인합니다</div></div>
          </div>
          <div class="field"><label for="bb-p-color">대표 색</label><div class="row"><input type="color" id="bb-p-color" name="color" value="${esc(color)}"><span class="mono" data-r="colorTxt">${esc(color)}</span></div>
            <div class="hint">카드 이미지 색 톤에 씁니다</div></div>
          <div class="row"><button type="submit" class="btn pri">저장</button></div>
        </form>
        <div class="panel" data-r="hiddenBox"><div class="panel-h"><b>히든 이미지</b><span class="sub">내 블로그 비공개 글에 넣어 둔 원장 소개·치과 안내·지도 이미지를 가져와 모든 원고의 정해진 자리에 넣습니다</span></div>
          <div class="field"><label for="bb-h-url">비공개 글 주소</label>
            <div class="row"><input class="inp mono grow" id="bb-h-url" maxlength="300" placeholder="https://blog.naver.com/${esc(a.blogId)}/글번호" value="${esc(a.hiddenUrl || '')}"><button type="button" class="btn" data-act="hiddenFetch">이미지 가져오기</button></div>
            <div class="hint">비공개 글에서 이미지 바로 아래에 자리 문구를 적어 두면 자동으로 자리를 잡습니다: <b>맨처음</b>(원장 소개 자리) · <b>중간</b> · <b>맨마지막</b>(글 끝 안내) · <b>지도</b>(위치 안내). 전용 크롬이 로그인돼 있어야 합니다.</div></div>
          <div data-r="hiddenList"></div>
        </div>`;
      paintHidden();
      const f = box.querySelector('form');
      f.elements.color.addEventListener('input', () => { box.querySelector('[data-r="colorTxt"]').textContent = f.elements.color.value; });
      f.addEventListener('submit', async e => {
        e.preventDefault();
        try {
          const r = await BB.api('/api/accounts/profile', {
            blogId: a.blogId, persona: f.elements.persona.value, audience: f.elements.audience.value,
            categories: f.elements.categories.value.split('\n').map(x => x.trim()).filter(Boolean), rules: f.elements.rules.value, color: f.elements.color.value,
            homepage: f.elements.homepage.value.trim(), homepageLabel: f.elements.homepageLabel.value.trim(), linkInternal: +f.elements.linkInternal.value,
            quoteStyle: f.elements.quoteStyle.value, lineStyle: f.elements.lineStyle.value,
          });
          Object.assign(a, r.account);
          BB.toast('블로그 성격을 저장했습니다');
        } catch (err) { }
      });
    }

    const reload = () => loadState().then(paint).catch(() => { });
    // 히든 이미지 목록: 슬롯·캡션 편집 (저장은 [히든 이미지 저장])
    const hiddenImg = (a, name) => `/api/gen/refimg?blogId=${encodeURIComponent(a.blogId)}&kind=hidden&name=${encodeURIComponent(name)}`;
    function paintHidden() {
      const a = curAcc(), box = root.querySelector('[data-r="hiddenList"]');
      if (!a || !box) return;
      const list = hiddenOf(a);
      const draw = () => {
        const slots = (genOpts && genOpts.hiddenSlots) || [];
        box.innerHTML = list.length ? `<div class="hid-grid">${list.map((h, i) => `<div class="hid-item"><img src="${hiddenImg(a, h.file)}" alt="">
            <div class="hid-body"><div class="muted mono" style="font-size:11px">${esc(h.file)}${h.rule ? ' · 글 아래 문구: ' + esc(h.rule) : ''}</div>
              <select class="inp" data-hk="slot" data-hi="${i}">${slots.map(s => `<option value="${esc(s.key)}"${s.key === h.slot ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}</select>
              <input class="inp" data-hk="label" data-hi="${i}" maxlength="30" placeholder="직접 지정일 때 자리 이름" value="${esc(h.label || '')}"${h.slot === 'custom' ? '' : ' hidden'}>
              <input class="inp" data-hk="caption" data-hi="${i}" maxlength="120" placeholder="이 이미지 설명(원고에서 이 자리를 받는 문장에 참고)" value="${esc(h.caption || '')}">
              <div class="row"><button type="button" class="btn sm danger" data-act="hiddenDel" data-hi="${i}">빼기</button></div></div></div>`).join('')}</div>
          <div class="row" style="margin-top:10px"><button type="button" class="btn pri" data-act="hiddenSave">히든 이미지 저장</button><span class="hint">자리: ${slots.map(s => `${esc(s.label)} = ${esc(s.desc)}`).join(' / ')}</span></div>`
          : '<div class="muted">가져온 히든 이미지가 없습니다.</div>';
      };
      if (!genOpts) loadOpts().then(draw).catch(draw); else draw();
    }
    function readHidden() {
      const a = curAcc(); if (!a) return [];
      return hiddenOf(a).map((h, i) => {
        const g = k => { const el = root.querySelector(`[data-hk="${k}"][data-hi="${i}"]`); return el ? el.value : h[k]; };
        return { file: h.file, rule: h.rule || '', slot: g('slot'), label: g('label'), caption: g('caption') };
      });
    }

    root.addEventListener('change', e => {
      const t = e.target;
      if (t.dataset && t.dataset.hk === 'slot') { const lab = root.querySelector(`[data-hk="label"][data-hi="${t.dataset.hi}"]`); if (lab) lab.hidden = t.value !== 'custom'; }
    });
    root.addEventListener('click', async e => {
      const t = e.target.closest('[data-act]');
      if (!t || !root.contains(t) || !S) return;
      // 히든 이미지 단추(선택한 계정 기준)
      if (['hiddenFetch', 'hiddenSave', 'hiddenDel'].includes(t.dataset.act)) {
        const a0 = curAcc(); if (!a0) return;
        try {
          if (t.dataset.act === 'hiddenFetch') {
            const url = (root.querySelector('#bb-h-url') || {}).value || '';
            if (!/^https?:\/\/(m\.)?blog\.naver\.com\//.test(url.trim())) return BB.toast('비공개 글 주소(blog.naver.com/아이디/글번호)를 넣어 주세요');
            t.disabled = true; t.textContent = '가져오는 중… (전용 크롬)';
            try { const r = await BB.api('/api/accounts/hidden/fetch', { blogId: a0.blogId, url: url.trim() }); a0.hidden = r.hidden || []; a0.hiddenUrl = url.trim(); BB.toast(`이미지 ${r.added}장을 가져왔습니다(글에서 ${r.found}장 발견). 자리를 확인하고 저장하세요`); }
            finally { t.disabled = false; t.textContent = '이미지 가져오기'; }
            paintHidden();
          } else if (t.dataset.act === 'hiddenSave') {
            const r = await BB.api('/api/accounts/hidden', { blogId: a0.blogId, items: readHidden() }); a0.hidden = r.hidden || []; BB.toast('히든 이미지를 저장했습니다'); paintHidden();
          } else if (t.dataset.act === 'hiddenDel') {
            const h = hiddenOf(a0)[+t.dataset.hi]; if (!h || !(await BB.confirm(`[${h.file}] 이미지를 히든 목록에서 빼고 파일도 지울까요?`))) return;
            const r = await BB.api('/api/gen/refs/delete', { blogId: a0.blogId, kind: 'hidden', name: h.file }); a0.hidden = r.hidden || hiddenOf(a0).filter(x => x.file !== h.file); BB.toast('뺐습니다'); paintHidden();
          }
        } catch (err) { }
        return;
      }
      const a = S.accounts[+t.dataset.index];
      if (!a) return;
      try {
        if (t.dataset.act === 'prof') { setAcc(a.blogId); fillSide(); paint(); $('prof').scrollIntoView({ block: 'start', behavior: 'smooth' }); }
        else if (t.dataset.act === 'login') {
          const credentials = await askNaverLogin(a);
          if (!credentials) return;
          t.disabled = true;
          try {
            const filled = !!credentials.fillOnce;
            const request = BB.api('/api/login', { blogId: a.blogId, ...credentials });
            credentials.password = '';
            await request;
            BB.toast(filled ? '시크릿 창에 입력했습니다. 로그인 버튼은 직접 눌러 주세요.' : '로그인 창을 열었습니다. 직접 로그인 후 창을 닫으세요.');
          } finally { credentials.password = ''; t.disabled = false; }
        } else if (t.dataset.act === 'open') openP('https://blog.naver.com/' + a.blogId);
        else if (t.dataset.act === 'del') {
          if (!(await BB.confirm(`[${a.name}] 계정을 목록에서 뺄까요? 블로그는 그대로 남습니다.`))) return;
          await BB.api('/api/accounts/delete', { blogId: a.blogId });
          if (acc === a.blogId) { setAcc(''); sel = null; }
          BB.toast('계정을 뺐습니다');
          reload();
        }
      } catch (err) { }
    });

    const form = $('add');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const name = form.elements.name.value.trim(), blogId = form.elements.blogId.value.trim();
      if (!ID_RE.test(blogId)) return BB.toast('블로그 아이디는 blog.naver.com/ 뒤 부분(영문·숫자·_·- 3~40자)입니다');
      try {
        await BB.api('/api/accounts', { name: name || blogId, blogId });
        setAcc(blogId); sel = null;
        form.reset();
        BB.toast('계정을 추가했습니다. [로그인 창 열기]로 한 번 로그인하세요.');
        reload();
      } catch (err) { }
    });

    loadState().then(paint).catch(() => { });
    return () => { ctx.alive = false; };
  }

  // ── 주제 조회: 이 계정의 발행 데이터로 "지금 이 주제를 써도 되나" 판정 + 한눈에 보기 + 축별 상태 ──
  const AX_ST = { hot: ['최근에 씀', 'warn'], saturated: ['포화', 'warn'], weak: ['반응 약함', 'bad'], stale: ['오래 쉼', 'info'], strong: ['잘 되는 축', 'ok'], ok: ['보통', 'mute'], cannibal: ['내 글끼리 경쟁', 'bad'] };
  const VD_CLS = { avoid: 'bad', wait: 'warn', ok: 'mute', good: 'ok' };
  const CK_ICON = { good: '✓', bad: '✗', warn: '△', none: '–' };
  function pageTopics(root) {
    const ctx = { alive: true };
    let data = null, q = lsGet('bb.topicQ') || '', showHelp = lsGet('bb.topicHelp') !== 'off';
    root.innerHTML = `
      <div class="page-h"><h1>주제 조회</h1><div class="sub">쓰려는 주제를 넣으면, 이 블로그가 지금까지 올린 글의 반응·검색 노출·키워드 데이터를 보고 "지금 써도 되는지"를 점검표로 알려 줍니다. 밑에는 지금 쓰기 좋은 주제와 피할 축이 한눈에 나옵니다.</div></div>
      <form class="row" data-r="qf"><input class="inp big grow" name="q" maxlength="60" placeholder="쓰려는 주제나 키워드 (예: 임플란트 골이식, INTP 연애)" value="${esc(q)}"><button type="submit" class="btn pri">점검</button></form>
      <div class="panel tp-help" data-r="help"></div>
      <div class="panel" data-r="adv" hidden></div>
      <div class="panel" data-r="ov"><div class="empty">불러오는 중</div></div>
      <div class="panel" data-r="axes"></div>`;
    const $ = r => root.querySelector(`[data-r="${r}"]`);
    const goWrite = kw => { lsSet('bb.topicKw', kw); location.hash = '#/blog/write'; };
    const kwBtn = (kw, cls = 'btn sm') => `<button type="button" class="${cls}" data-act="write" data-kw="${esc(kw)}">원고 만들기</button>`;
    function paintHelp() {
      $('help').innerHTML = `<div class="panel-h"><b>읽는 법</b><button type="button" class="link" data-act="help">${showHelp ? '접기' : '펼치기'}</button></div>
        ${showHelp ? `<div class="tp-help-g">
          <div><b>점수</b><p>50점에서 시작해 항목마다 더하고 뺍니다. 25점 이하 <span class="st bad">지금은 피하기</span> · 45점 이하 <span class="st warn">조금 미루기</span> · 65점 이하 <span class="st mute">써도 됨</span> · 그 위 <span class="st ok">지금 쓰기 좋음</span></p></div>
          <div><b>빼는 요인</b><p>같은 키워드 글이 이미 10위 안에 노출 중(−30) · 같은 축 글을 14일 안에 올림(−25) · 최근 60일 같은 축 4편 이상(−15) · 그 축 글 점수 평균 30점 미만(−15) · 내 글끼리 키워드 경쟁(−15)</p></div>
          <div><b>더하는 요인</b><p>그 축 글 점수 평균 60점 이상(+20) · 검색량 있는데 내 글 없는 키워드(+20) · 검색량 대비 순위 낮은 키워드(+10) · 120일 넘게 쉰 반응 좋던 축(+15)</p></div>
          <div><b>글 점수</b><p>대시보드가 글마다 매긴 0~100점. 공감·댓글·공유(발행 7일 미만은 환산)와 검색 순위를 합친 값으로, 이 블로그 글끼리의 상대 평가입니다.</p></div>
          <div><b>축</b><p>키워드 첫 낱말로 묶은 주제 묶음(예: "INTP 연애"·"INTP 직업"은 INTP 축). 축 이름은 그 축에서 가장 많이 쓴 키워드입니다.</p></div>
        </div>` : ''}`;
    }
    function checkRow(c) {
      return `<div class="tp-ck ${c.state}"><i>${CK_ICON[c.state] || '–'}</i><b>${esc(c.label)}</b><span>${esc(c.text)}</span><em class="mono">${c.delta > 0 ? '+' + c.delta : c.delta < 0 ? c.delta : '0'}</em></div>`;
    }
    function paintAdvice() {
      const box = $('adv'); const a = data && data.advice;
      if (!a) { box.hidden = true; return; }
      box.hidden = false;
      box.innerHTML = `<div class="tp-vd ${VD_CLS[a.verdict]}">
          <div class="tp-vd-l"><div class="muted">"${esc(a.topic)}" 점검 결과</div><div class="tp-vd-big"><span class="st ${VD_CLS[a.verdict]}">${esc(a.verdictLabel)}</span><b class="mono">${esc(a.score)}</b><small>/100</small></div><p>${esc(a.conclusion)}</p></div>
          <div class="tp-vd-r">${kwBtn(a.topic, 'btn pri')}</div></div>
        <div class="panel-h" style="margin-top:14px"><b>점검 항목 ${a.checks.length}개</b><span class="sub">50점에서 시작 · 오른쪽 숫자가 더하고 뺀 점수</span></div>
        <div class="tp-cks">${a.checks.map(checkRow).join('')}</div>
        ${a.tips.length ? `<div class="panel-h" style="margin-top:14px"><b>이런 각도로 쓰면 겹치지 않습니다</b><span class="sub">관련 글 제목에 아직 없는 세부 각도</span></div><div class="chips">${a.tips.map(t => `<button type="button" class="chip alt" data-act="write" data-kw="${esc(t)}"><b>${esc(t)}</b><span>이 키워드로 원고 만들기</span></button>`).join('')}</div>` : ''}
        ${a.related.length ? `<div class="panel-h" style="margin-top:14px"><b>이 주제와 관련 있는 내 글 ${a.related.length}편</b><span class="sub">점수 = 반응·노출 0~100 · 순위 = 검색 순위(검색 API 있을 때)</span></div><table class="tbl"><thead><tr><th>제목</th><th>올린 날</th><th>점수</th><th>순위</th><th>반응</th></tr></thead><tbody>
          ${a.related.map(p => `<tr><td>${p.same ? '<span class="st warn">같은 키워드</span> ' : ''}${esc(p.title)}</td><td class="mono">${esc(p.date || '')}${p.ago != null ? ` <span class="muted">(${p.ago}일 전)</span>` : ''}</td><td class="num">${esc(p.score ?? '-')}</td><td class="num">${p.rank != null ? p.rank + '위' : '-'}</td><td class="num">공감 ${esc(p.sympathy ?? '-')} · 댓글 ${esc(p.comments ?? '-')}</td></tr>`).join('')}</tbody></table>` : ''}
        ${a.alternatives.length ? `<div class="panel-h" style="margin-top:14px"><b>대신 쓸 만한 주제</b><span class="sub">데이터 추천 키워드 · 오래 쉰 좋은 축 · 잘 되는 축의 빈 각도</span></div><div class="chips">${a.alternatives.map(x => `<button type="button" class="chip alt" data-act="write" data-kw="${esc(x.keyword)}"><b>${esc(x.keyword)}</b><span>${esc(x.why)}</span></button>`).join('')}</div>` : ''}`;
    }
    function paintOverview() {
      const box = $('ov'); if (!data) return;
      const o = data.overview || { good: [], avoid: [], boost: [] };
      if (!data.posts) { box.innerHTML = `<div class="empty">${esc(data.note || '아직 글 데이터가 없습니다. [대시보드] → [지금 수집]을 한 번 눌러 주세요.')}</div>`; return; }
      const col = (title, sub, items, render) => `<div class="tp-col"><div class="tp-col-h"><b>${title}</b><span>${sub}</span></div>${items.length ? items.map(render).join('') : '<div class="muted">해당 없음</div>'}</div>`;
      box.innerHTML = `<div class="panel-h"><b>한눈에</b><span class="sub">글 ${data.posts}편 기준${data.generatedAt ? ' · 수집 ' + fmtAt(data.generatedAt) : ''}</span></div>
        <div class="tp-grid">
          ${col('지금 쓰기 좋은 주제', '검색 데이터·내 글 성과가 밀어주는 것', o.good, x => `<div class="tp-item"><div><b>${esc(x.keyword)}</b><div class="muted">${esc(x.why)}</div></div>${kwBtn(x.keyword)}</div>`)}
          ${col('잠시 피할 축', '최근에 썼거나, 몰렸거나, 반응이 약했던 것', o.avoid, x => { const st = AX_ST[x.status] || AX_ST.ok; return `<div class="tp-item"><div><b>${esc(x.keyword)}</b> <span class="st ${st[1]}">${st[0]}</span><div class="muted">${esc(x.why)}</div></div></div>`; })}
          ${col('보강할 글', '11~30위라 조금만 손보면 1쪽에 드는 글', o.boost, x => `<div class="tp-item"><div><b>${esc(x.title || x.keyword)}</b>${x.rank != null ? ` <span class="st info">${x.rank}위</span>` : ''}<div class="muted">${esc(x.why)}</div></div>${x.keyword ? kwBtn(x.keyword) : ''}</div>`)}
        </div>`;
    }
    function paintAxes() {
      const box = $('axes'); if (!data || !data.posts) { box.innerHTML = ''; return; }
      const ax = data.axes || [];
      box.innerHTML = `<div class="panel-h"><b>내 글의 주제 축 ${ax.length}개</b><span class="sub">축 이름을 누르면 그 주제로 점검 · 점수 = 글 점수 평균(0~100)</span></div>
        <table class="tbl tp-ax"><thead><tr><th>주제 축</th><th>글</th><th>마지막 글</th><th>최근 60일</th><th>점수 평균</th><th>상태</th><th>대표 글</th><th>아직 안 쓴 각도</th><th></th></tr></thead><tbody>
          ${ax.map(x => { const st = AX_ST[x.status] || AX_ST.ok; return `<tr>
            <td><button type="button" class="link" data-act="q" data-kw="${esc(x.label)}"><b>${esc(x.label)}</b></button><div class="muted mono">${esc(x.axis)} 축${x.keywords.length > 1 ? ' · 키워드 ' + x.keywords.length + '개' : ''}</div></td>
            <td class="num">${esc(x.posts)}편</td>
            <td class="mono">${esc(x.last || '-')}${x.lastAgo != null ? `<div class="muted">${x.lastAgo}일 전</div>` : ''}</td>
            <td class="num">${esc(x.recent60)}편</td>
            <td class="num">${x.avgScore != null ? x.avgScore : '-'}</td>
            <td><span class="st ${st[1]}">${st[0]}</span><div class="muted">${esc(x.hint)}</div></td>
            <td>${x.top.map(p => `<div class="tp-top"><span>${esc(p.title)}</span><span class="mono muted">${esc(p.date || '')} · ${esc(p.score ?? '-')}점${p.rank != null ? ' · ' + p.rank + '위' : ''}</span></div>`).join('')}</td>
            <td>${x.missingAngles.length ? x.missingAngles.map(an => `<button type="button" class="link" data-act="write" data-kw="${esc(x.label + ' ' + an)}">${esc(an)}</button>`).join(' · ') : '<span class="muted">-</span>'}</td>
            <td class="num">${kwBtn(x.label)}</td></tr>`; }).join('')}</tbody></table>`;
    }
    async function load() {
      if (!acc) { $('ov').innerHTML = '<div class="empty">블로그 계정을 고르세요.</div>'; return; }
      try { data = await BB.api(`/api/topics?blogId=${encodeURIComponent(acc)}${q ? '&q=' + encodeURIComponent(q) : ''}`); if (!ctx.alive) return; paintAdvice(); paintOverview(); paintAxes(); }
      catch (err) { if (ctx.alive) $('ov').innerHTML = '<div class="empty">조회하지 못했습니다.</div>'; }
    }
    paintHelp();
    $('qf').addEventListener('submit', e => { e.preventDefault(); q = $('qf').elements.q.value.trim(); lsSet('bb.topicQ', q); load(); if (q) $('adv').scrollIntoView({ block: 'start', behavior: 'smooth' }); });
    root.addEventListener('click', e => {
      const t = e.target.closest('[data-act]'); if (!t || !root.contains(t)) return;
      if (t.dataset.act === 'write') goWrite(t.dataset.kw);
      if (t.dataset.act === 'help') { showHelp = !showHelp; lsSet('bb.topicHelp', showHelp ? 'on' : 'off'); paintHelp(); }
      if (t.dataset.act === 'q') { q = t.dataset.kw; $('qf').elements.q.value = q; lsSet('bb.topicQ', q); load(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    });
    loadState().then(load).catch(() => { });
    return () => { ctx.alive = false; };
  }

  // ── 이웃 후보: 발행 뒤 읽은 블로그를 공개 정보로 점수 매긴 목록. 신청 단추는 사람이 직접 누른다 ──
  const NB_ST = { candidate: ['후보', 'info'], done: ['신청함', 'ok'], skip: ['건너뜀', 'mute'] };
  function pageNeighbors(root) {
    const ctx = { alive: true };
    let items = [], total = 0, all = false, busy = '';
    root.innerHTML = `
      <div class="page-h"><h1>이웃 후보</h1><div class="sub">발행 뒤 읽은 다른 사람 블로그를 공개 정보(최근 글·활동·주제·광고성·반응)로 점수 매겨 모아 둡니다. 신청은 창에서 직접 누릅니다.</div></div>
      <div class="row"><label class="row"><input type="checkbox" data-r="all"> 신청함·건너뜀도 보기</label>
        <div class="grow"></div><span class="muted" data-r="cnt"></span><button type="button" class="btn" data-act="refresh">새로고침</button></div>
      <div class="panel" data-r="list"><div class="empty">불러오는 중</div></div>`;
    const $ = r => root.querySelector(`[data-r="${r}"]`);
    const scoreCls = s => s >= 70 ? 'ok' : s >= 55 ? 'info' : 'mute';
    function paint() {
      if (!ctx.alive) return;
      $('cnt').textContent = total ? `전체 ${total}곳 · 보이는 ${items.length}곳` : '';
      $('list').innerHTML = items.length ? `<table class="tbl"><thead><tr><th>점수</th><th>블로그</th><th>이유</th><th>읽은 글</th><th>상태</th><th></th></tr></thead><tbody>
        ${items.map(n => { const st = NB_ST[n.status] || NB_ST.candidate, s = n.stats || {}; return `<tr>
          <td class="num"><span class="st ${scoreCls(n.score)}">${esc(n.score)}점</span>${n.good ? '' : '<div class="muted mono">보류</div>'}</td>
          <td><b>${esc(n.name || n.blogId)}</b><div class="muted mono">${esc(n.blogId)} · 글 ${esc(s.posts ?? '?')} · 이웃 ${esc(s.subs ?? '?')} · 30일 ${esc(s.last30 ?? '?')}편</div></td>
          <td>${(n.reasons || []).map(r => `<div>${esc(r)}</div>`).join('')}</td>
          <td><button type="button" class="link" data-act="url" data-url="${esc(n.post && n.post.url)}">${esc((n.post && n.post.title) || '열기')}</button><div class="muted mono">${esc(n.post && n.post.keyword)} · ${esc(fmtAt(n.at))}${n.reads > 1 ? ` · ${n.reads}번 읽음` : ''}</div></td>
          <td><span class="st ${st[1]}">${st[0]}</span>${n.openedAt ? `<div class="muted mono">창 연 때 ${esc(fmtAt(n.openedAt))}</div>` : ''}</td>
          <td class="num"><div class="row">
            <button type="button" class="btn pri sm" data-act="open" data-id="${esc(n.id)}"${busy === n.id ? ' disabled' : ''}>${busy === n.id ? '여는 중' : '이웃 추가 창 열기'}</button>
            ${n.status !== 'done' ? `<button type="button" class="btn sm" data-act="done" data-id="${esc(n.id)}">신청함</button>` : ''}
            ${n.status !== 'skip' ? `<button type="button" class="btn sm" data-act="skip" data-id="${esc(n.id)}">건너뜀</button>` : `<button type="button" class="btn sm" data-act="cand" data-id="${esc(n.id)}">후보로</button>`}
            <button type="button" class="btn sm danger" data-act="remove" data-id="${esc(n.id)}">삭제</button></div></td></tr>`; }).join('')}
        </tbody></table>` : `<div class="empty">${all ? '기록이 없습니다.' : '아직 후보가 없습니다. 입력 설정의 "발행 뒤 다른 사람 글 읽기"가 켜져 있으면 발행할 때마다 읽은 블로그가 점수와 함께 쌓입니다.'}</div>`;
    }
    async function load() {
      try {
        if (!S) await loadState();
        const r = await BB.api(`/api/neighbors?blogId=${encodeURIComponent(acc || '')}${all ? '&all=1' : ''}`);
        items = (r && r.items) || []; total = (r && r.total) || 0; paint();
      } catch (err) { if (ctx.alive) $('list').innerHTML = '<div class="empty">목록을 불러오지 못했습니다.</div>'; }
    }
    $('all').addEventListener('change', e => { all = e.target.checked; load(); });
    root.addEventListener('click', async e => {
      const t = e.target.closest('[data-act]');
      if (!t || !root.contains(t)) return;
      const act = t.dataset.act, id = t.dataset.id;
      if (act === 'refresh') return load();
      if (act === 'url') return openP(t.dataset.url);
      try {
        if (act === 'open') {
          busy = id; paint();
          const r = await BB.api('/api/neighbors/open', { id });
          busy = '';
          if (r.where === 'login') BB.toast('전용 크롬의 로그인이 풀려 있습니다. 먼저 로그인해 주세요');
          else if (r.where === 'error') BB.toast('창을 열지 못했습니다: ' + (r.error || ''));
          else BB.toast('전용 크롬에 블로그를 열고 [이웃추가] 단추를 표시했습니다. 신청은 직접 눌러 주세요');
          return load();
        }
        if (act === 'done' || act === 'skip' || act === 'cand') { await BB.api('/api/neighbors/status', { id, status: act === 'cand' ? 'candidate' : act }); return load(); }
        if (act === 'remove') { if (!(await BB.confirm('이 후보를 목록에서 지울까요?'))) return; await BB.api('/api/neighbors/remove', { id }); return load(); }
      } catch (err) { busy = ''; paint(); }
    });
    load();
    return () => { ctx.alive = false; };
  }

  // ── 발행 기록 ─────────────────────────────────────
  function resultCell(h) {
    if (h.published) return '<span class="ok">발행</span>';
    if (h.pass) return '<span class="ok">통과</span><span class="muted"> · 미발행</span>';
    if (h.fails && h.fails.length) return `<span class="bad">실패 ${h.fails.length}건</span><div class="muted mono">${esc(h.fails[0])}</div>`;
    return '<span class="muted">중단</span>';
  }
  function pageHistory(root) {
    const ctx = { alive: true };
    let items = [];
    root.innerHTML = `
      <div class="page-h"><h1>발행 기록</h1><div class="sub">실행할 때마다 결과가 쌓입니다. 최근 것부터 보여 줍니다.</div></div>
      <div class="row"><label class="row"><input type="checkbox" data-r="all"${histAll ? ' checked' : ''}> 모든 계정</label>
        <div class="grow"></div><button type="button" class="btn" data-act="refresh">새로고침</button></div>
      <div class="panel" data-r="list"><div class="empty">불러오는 중</div></div>`;
    const $ = r => root.querySelector(`[data-r="${r}"]`);
    const accName = id => { const a = S && S.accounts.find(x => x.blogId === id); return a ? a.name : id; };

    function paint() {
      if (!ctx.alive) return;
      $('list').innerHTML = items.length ? `<table class="tbl"><thead><tr><th>일시</th><th>계정</th><th>원고 파일</th><th>방식</th><th>결과</th><th></th></tr></thead><tbody>
        ${items.map((h, i) => `<tr><td class="mono">${esc(fmtAt(h.at))}</td>
          <td>${esc(accName(h.blogId))}<div class="muted mono">${esc(h.blogId)}</div></td>
          <td class="mono">${esc(fname(h.file))}</td>
          <td>${esc(MODE_TXT[h.mode] || h.mode || '')}</td>
          <td>${resultCell(h)}</td>
          <td class="num">${h.report ? `<button type="button" class="link" data-act="report" data-index="${i}">검사표</button>` : ''}
            ${h.published ? ` <button type="button" class="link" data-act="post" data-index="${i}">글 열기</button>` : ''}
            ${h.read && h.read.length ? ` <button type="button" class="link" data-act="read" data-index="${i}">읽은 글 ${h.read.length}</button>` : ''}</td></tr>
          ${h.read && h.read.length ? `<tr class="sub" data-read="${i}" hidden><td colspan="6"><div class="muted" style="margin-bottom:4px">발행 뒤 읽은 다른 사람 글 (읽기만 했습니다 · 이웃 신청·댓글은 직접)</div>
            ${h.read.map(r => `<div class="row" style="gap:8px"><span class="mono">${esc(r.blogId)}</span><span>${esc(r.title || '')}</span><span class="muted">${esc(r.keyword || '')} · ${esc(r.sec)}초</span><button type="button" class="link" data-act="url" data-url="${esc(r.url)}">열기</button></div>`).join('')}</td></tr>` : ''}`).join('')}
        </tbody></table>` : '<div class="empty">기록이 없습니다.</div>';
    }
    async function load() {
      try {
        if (!S) await loadState();
        const q = histAll || !acc ? '' : '?blogId=' + encodeURIComponent(acc);
        const r = await BB.api('/api/history' + q);
        items = (r && r.items) || [];
        paint();
      } catch (err) { if (ctx.alive) $('list').innerHTML = '<div class="empty">기록을 불러오지 못했습니다.</div>'; }
    }

    $('all').addEventListener('change', e => { histAll = e.target.checked; load(); });
    root.addEventListener('click', e => {
      const t = e.target.closest('[data-act]');
      if (!t || !root.contains(t)) return;
      if (t.dataset.act === 'refresh') return load();
      if (t.dataset.act === 'url') return openP(t.dataset.url);
      const h = items[+t.dataset.index];
      if (!h) return;
      if (t.dataset.act === 'report') openP(h.report);
      if (t.dataset.act === 'post') openP(h.published);
      if (t.dataset.act === 'read') { const tr = root.querySelector(`[data-read="${t.dataset.index}"]`); if (tr) tr.hidden = !tr.hidden; }
    });
    load();
    return () => { ctx.alive = false; };
  }

  // ── 입력 설정 ─────────────────────────────────────
  function pageSettings(root) {
    const ctx = { alive: true };
    root.innerHTML = `
      <div class="page-h"><h1>입력 설정</h1><div class="sub">모든 계정에 같이 적용됩니다.</div></div>
      <div class="panel" data-r="body"><div class="empty">불러오는 중</div></div>
      <div class="panel" id="bb-ai" data-r="ai"><div class="empty">불러오는 중</div></div>`;
    const body = root.querySelector('[data-r="body"]'), aiBox = root.querySelector('[data-r="ai"]');
    // AI 설정: 키는 저장만 하고 다시 받지 않는다 (서버는 hasKey만 준다)
    const COST = { low: '약 $0.02', medium: '약 $0.06', high: '약 $0.25' };
    const Q_TXT = { low: '낮음', medium: '보통', high: '높음' };
    function paintAi(g) {
      if (!ctx.alive) return;
      aiBox.innerHTML = `<div class="panel-h"><b>AI 설정</b><span class="sub">원고 만들기에 쓰는 OpenAI 설정</span></div>
        <form class="form" autocomplete="off">
          <div class="field"><label for="bb-ai-key">API 키</label>
            <div class="row"><input class="inp grow mono" type="password" id="bb-ai-key" name="apiKey" autocomplete="new-password" spellcheck="false" placeholder="${g.hasKey ? '저장됨 (바꾸려면 새 키 입력)' : 'sk-로 시작하는 키'}">
              ${g.hasKey ? '<button type="button" class="btn danger" data-act="clearKey">지우기</button>' : ''}</div>
            <div class="hint">${g.hasKey ? '<span class="ok">저장됨</span> · ' : ''}이 PC의 Windows 계정으로 암호화해 저장합니다. 저장한 키는 화면에 다시 보이지 않습니다.</div></div>
          <div class="field"><label for="bb-ai-model">글 모델</label><input class="inp mono" id="bb-ai-model" name="model" maxlength="60" value="${esc(g.model)}"></div>
          <div class="field"><label for="bb-ai-img">이미지 모델</label><input class="inp mono" id="bb-ai-img" name="imageModel" maxlength="60" value="${esc(g.imageModel)}"></div>
          <div class="field"><label>이미지 품질</label><div class="seg" data-r="q">${['low', 'medium', 'high'].map(q => `<button type="button" data-q="${q}" class="${g.imageQuality === q ? 'on' : ''}">${Q_TXT[q]}</button>`).join('')}</div>
            <div class="hint" data-r="cost"></div></div>
          <div class="row"><button type="submit" class="btn pri">저장</button></div>
        </form>`;
      const f = aiBox.querySelector('form');
      let q = g.imageQuality;
      const cost = () => { aiBox.querySelector('[data-r="cost"]').textContent = `AI 이미지 1장(1536x1024) ${COST[q] || ''} 정도. 원고 1편 = AI 이미지 1~2장 + 글 작성 비용 (OpenAI 요금 기준, 바뀔 수 있음)`; };
      cost();
      aiBox.querySelector('[data-r="q"]').addEventListener('click', e => {
        const b = e.target.closest('[data-q]'); if (!b) return;
        q = b.dataset.q; [...b.parentElement.children].forEach(x => x.classList.toggle('on', x === b)); cost();
      });
      const clr = aiBox.querySelector('[data-act="clearKey"]');
      if (clr) clr.addEventListener('click', async () => {
        if (!(await BB.confirm('저장한 OpenAI API 키를 지울까요?'))) return;
        try { paintAi(await BB.api('/api/gen/settings', { clearKey: true })); BB.toast('키를 지웠습니다'); } catch (err) { }
      });
      f.addEventListener('submit', async e => {
        e.preventDefault();
        const b = { model: f.elements.model.value.trim(), imageModel: f.elements.imageModel.value.trim(), imageQuality: q };
        const k = f.elements.apiKey.value.trim(); if (k) b.apiKey = k;
        try { const r = await BB.api('/api/gen/settings', b); f.elements.apiKey.value = ''; paintAi(r); BB.toast('AI 설정을 저장했습니다'); } catch (err) { }
      });
    }
    BB.api('/api/gen/settings').then(g => {
      paintAi(g);
      if (lsGet('bb.focusAi')) { lsSet('bb.focusAi', ''); aiBox.scrollIntoView({ block: 'start' }); const k = aiBox.querySelector('input[name="apiKey"]'); if (k) k.focus(); }
    }).catch(() => { if (ctx.alive) aiBox.innerHTML = '<div class="empty">AI 설정을 불러오지 못했습니다.</div>'; });


    function paint() {
      if (!ctx.alive || !S) return;
      const st = S.settings;
      body.innerHTML = `<form class="form" autocomplete="off">
        ${FIELDS.map(([k, label, lo, hi, step, f, hint]) => `${FIELD_GROUPS[k] ? `<div class="panel-h"><b>${FIELD_GROUPS[k]}</b></div>` : ''}<div class="field"><label for="bb-s-${k}">${label}</label>
          <div class="row"><input class="grow" type="range" id="bb-s-${k}" name="${k}" min="${lo}" max="${hi}" step="${step}" value="${esc(st[k] ?? lo)}">
          <output class="mono" data-o="${k}">${esc(f(st[k] ?? lo))}</output></div>${hint ? `<div class="hint">${hint}</div>` : ''}</div>`).join('')}
        <div class="panel-h"><b>로그인</b></div>
        <div class="field"><label for="bb-s-login">네이버 로그인 방식</label><select class="inp" id="bb-s-login" name="loginMode">
          <option value="fresh"${st.loginMode !== 'keep' ? ' selected' : ''}>매번 새 시크릿 창에서 직접 로그인 (끝나면 창·임시 프로필 삭제)</option>
          <option value="keep"${st.loginMode === 'keep' ? ' selected' : ''}>계정별 전용 크롬에 로그인 유지</option></select>
          <div class="hint">시크릿 방식: 실행하면 깨끗한 시크릿 창에 네이버 로그인 화면이 열리고 <b>아이디·비밀번호 입력과 IP보안 해제는 사용자가 직접</b> 합니다(앱은 비밀번호를 다루지 않음). 로그인되면 이어서 글을 쓰고, 끝나면 창을 닫고 임시 프로필을 지워 쿠키·캐시·기록이 남지 않습니다. 최대 10분 기다립니다.</div></div>
        <div class="field"><label class="row" style="gap:8px;align-items:center"><input type="checkbox" name="clearCache"${st.clearCache === false ? '' : ' checked'}> 발행 뒤 캐시 비우기 (로그인 유지 방식일 때)</label>
          <div class="hint">전용 크롬에 로그인을 유지하는 방식에서, 발행·읽기가 끝나면 그 계정 크롬의 캐시만 비웁니다. 쿠키는 그대로라 로그인은 풀리지 않습니다.</div></div>
        <div class="panel-h"><b>실행</b></div>
        <div class="field"><label for="bb-s-mode">기본 실행 방식</label><select class="inp" id="bb-s-mode" name="mode">
          ${Object.keys(MODE_LONG).map(m => `<option value="${m}"${st.mode === m ? ' selected' : ''}>${MODE_LONG[m]}</option>`).join('')}</select></div>
        <div class="field"><label for="bb-s-dirs">원고 자동 찾기 폴더</label>
          <textarea class="inp mono" id="bb-s-dirs" name="scanDirs" rows="4">${esc((st.scanDirs || []).join('\n'))}</textarea>
          <div class="hint">한 줄에 하나. 이 폴더 안의 *_layout.js · *.txt 파일을 원고로 찾습니다.</div></div>
        <div class="row"><button type="submit" class="btn pri">저장</button><button type="button" class="btn" data-act="reset">되돌리기</button></div>
      </form>`;
      const form = body.querySelector('form');
      FIELDS.forEach(([k, , , , , f]) => {
        const inp = form.elements[k], out = form.querySelector(`[data-o="${k}"]`);
        inp.addEventListener('input', () => { out.textContent = f(+inp.value); });
      });
      form.querySelector('[data-act="reset"]').addEventListener('click', paint);
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const b = { mode: form.elements.mode.value, loginMode: form.elements.loginMode.value, clearCache: !!form.elements.clearCache.checked, scanDirs: form.elements.scanDirs.value.split('\n').map(s => s.trim()).filter(Boolean) };
        FIELDS.forEach(([k]) => { b[k] = +form.elements[k].value; });
        try {
          await BB.api('/api/settings', b);
          mode = b.mode;
          BB.toast('저장했습니다');
          await loadState();
          paint();
        } catch (err) { }
      });
    }
    loadState().then(paint).catch(() => { });
    return () => { ctx.alive = false; };
  }

  // ── 블로그 육성: 대시보드 · 데이터 설정 (작업자 P, 엔진 insight\ — 지표 정의 insight\METRICS.md) ──
  const DAYMS = 86400000;
  const KIND_TXT = { blog: '블로그 공개 정보', exposure: '검색 노출', keywords: '키워드 검색량', owner: '주인 통계' };
  const KIND_EN = { blog: 'BLOG', exposure: 'EXPOSURE', keywords: 'KEYWORDS', owner: 'OWNER' };
  const ST_TXT = { EXPOSED: '노출', OUT_OF_RANGE: '100위 밖', MISSING: '색인 누락', NOT_FOUND: '1쪽 밖', PENDING: '판정 보류', UNCHECKED: '확인 전' };
  const ST_CLS = { EXPOSED: 'ok', OUT_OF_RANGE: 'warn', MISSING: 'bad', NOT_FOUND: 'warn', PENDING: 'mute', UNCHECKED: 'none' };
  const KPI_EN = { totalPosts: 'Posts', posts30: 'Posts 30d', consistencyScore: 'Consistency', visitors: 'Visitors / day', subscriberCount: 'Neighbors', exposureRate: 'Exposure', top10: 'Top 10', avgRank: 'Avg rank', smartBlock: 'Smart block', aiCited: 'AI briefing', estSearchTraffic: 'Search traffic', readinessScore: 'AdPost ready' };
  const DASH_TABS = [['overview', '개요'], ['posts', '글별 성과'], ['keywords', '키워드·노출'], ['cats', '카테고리·시간대'], ['owner', '유입']];
  const LEVEL = [['high', '높음', 'bad'], ['mid', '중간', 'warn'], ['low', '낮음', 'mute']];
  const nf = (n, d = 0) => n == null || !Number.isFinite(+n) ? '—' : Number(n).toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: 0 });
  const fmtDT = ms => { if (!ms) return ''; const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const md = ymd => String(ymd || '').slice(5).replace('-', '.');
  function relT(ms) {
    const s = (Date.now() - ms) / 1000;
    if (s < 0) return relF(ms);
    if (s < 60) return '방금'; if (s < 3600) return Math.floor(s / 60) + '분 전'; if (s < 86400) return Math.floor(s / 3600) + '시간 전';
    const d = s / 86400; if (d < 14) return Math.floor(d) + '일 전'; if (d < 60) return Math.floor(d / 7) + '주 전'; if (d < 365) return Math.floor(d / 30) + '개월 전';
    return Math.floor(d / 365) + '년 전';
  }
  function relF(ms) { const s = (ms - Date.now()) / 1000; if (s < 60) return '곧'; if (s < 3600) return Math.ceil(s / 60) + '분 뒤'; if (s < 86400) return Math.floor(s / 3600) + '시간 ' + Math.floor(s % 3600 / 60) + '분 뒤'; return Math.floor(s / 86400) + '일 뒤'; }
  const postMs = r => r.addedAt || (r.date ? Date.parse(r.date + 'T00:00:00+09:00') : 0);
  const stTag = s => `<span class="st ${ST_CLS[s] || 'none'}">${esc(ST_TXT[s] || s || '확인 전')}</span>`;
  const goSet = '<button type="button" class="link" data-go="#/blog/insight-settings">데이터 설정</button>';
  const eb = (n, en) => `<div class="d-eb">${pad(n)} / ${esc(en)}</div>`;

  // ── 차트: 손으로 그리는 인라인 SVG (색은 CSS 변수 → 테마 따라감) ──
  function niceStep(r) { const p = Math.pow(10, Math.floor(Math.log10(r || 1))); const m = r / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; }
  function scale(vals, o) {
    let lo = o.yMin != null ? Math.min(o.yMin, ...vals) : Math.min(...vals), hi = o.yMax != null ? Math.max(o.yMax, ...vals) : Math.max(...vals);
    if (o.floor0 && lo > 0) lo = 0;
    if (lo === hi) { hi = hi + (o.int ? 2 : 1); lo = Math.max(o.floor0 || o.yMin != null ? (o.yMin ?? 0) : -Infinity, lo - (o.int ? 2 : 1)); }
    let st = niceStep((hi - lo) / (o.ticks || 3)); if (o.int) st = Math.max(1, Math.round(st));
    lo = Math.floor(lo / st) * st; hi = Math.ceil(hi / st) * st;
    const ticks = []; for (let v = lo; v <= hi + st / 1e6; v += st) ticks.push(+v.toFixed(6));
    if (o.yMin != null && lo < o.yMin) { lo = o.yMin; ticks[0] = o.yMin; }
    return { lo, hi, ticks };
  }
  function tipAt(box, tip, x, html) {
    tip.innerHTML = html; tip.hidden = false;
    const bw = box.clientWidth, tw = tip.offsetWidth;
    tip.style.left = Math.max(0, Math.min(bw - tw, x + 12 + tw > bw ? x - tw - 12 : x + 12)) + 'px';
  }
  // o: {series:[{label, pts:[{d, v, note}], primary, dash}], h, invert, unit, fmt, yMin, floor0, int, endLabels, empty, mini}
  function drawLine(box, o) {
    const dates = [...new Set(o.series.flatMap(s => s.pts.filter(p => p.v != null).map(p => p.d)))].sort();
    if (!dates.length) { box.innerHTML = `<div class="ch-empty">${o.empty || '기록이 아직 없습니다'}</div>`; return; }
    const W = Math.max(200, box.clientWidth), H = o.h || 170, mini = !!o.mini;
    const L = mini ? 30 : 40, R = o.endLabels ? 104 : (mini ? 8 : 14), T = 10, B = mini ? 20 : 24, pw = W - L - R, ph = H - T - B;
    const vals = o.series.flatMap(s => s.pts.map(p => p.v)).filter(v => v != null);
    const sc = scale(vals, o);
    const X = i => dates.length === 1 ? L + pw / 2 : L + i * pw / (dates.length - 1);
    const Y = v => { const t = (v - sc.lo) / ((sc.hi - sc.lo) || 1); return T + (o.invert ? t : 1 - t) * ph; };
    const fmt = o.fmt || (v => nf(v, 1));
    let g = '';
    for (const t of sc.ticks) g += `<line class="ch-grid" x1="${L}" x2="${W - R}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}"/><text class="ch-yl" x="${L - 8}" y="${(Y(t) + 3.5).toFixed(1)}" text-anchor="end">${esc(fmt(t))}</text>`;
    const xi = dates.length <= 2 ? dates.map((_, i) => i) : [0, Math.round((dates.length - 1) / 2), dates.length - 1];
    for (const i of [...new Set(xi)]) g += `<text class="ch-xl" x="${X(i).toFixed(1)}" y="${H - 6}" text-anchor="${dates.length === 1 ? 'middle' : i === 0 ? 'start' : i === dates.length - 1 ? 'end' : 'middle'}">${esc(md(dates[i]))}</text>`;
    let lines = '';
    const ends = [];
    o.series.forEach((s, si) => {
      const m = Object.fromEntries(s.pts.map(p => [p.d, p]));
      let d = '', pen = false, last = null;
      dates.forEach((dt, i) => {
        const p = m[dt];
        if (!p || p.v == null) { pen = false; return; }
        d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(p.v).toFixed(1)}`; pen = true; last = [i, p.v];
      });
      const cls = s.primary ? 'p' : 'n' + Math.min(si, 4);
      lines += `<path class="ch-s ${cls}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''} d="${d}"/>`;
      // 점이 하나뿐인 구간도 보이게
      dates.forEach((dt, i) => { const p = m[dt]; const prev = m[dates[i - 1]], next = m[dates[i + 1]]; if (p && p.v != null && !(prev && prev.v != null) && !(next && next.v != null)) lines += `<circle class="ch-dot ${cls}" cx="${X(i).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="2.2"/>`; });
      if (o.endLabels && last) ends.push({ cls, x: X(last[0]) + 8, y: Y(last[1]) + 3.5, t: String(s.label).length > 8 ? String(s.label).slice(0, 8) + '…' : String(s.label) });
    });
    ends.sort((a, b) => a.y - b.y).forEach((e, i, a) => { if (i && e.y - a[i - 1].y < 13) e.y = a[i - 1].y + 13; });
    for (const e of ends) lines += `<text class="ch-el ${e.cls}" x="${e.x.toFixed(1)}" y="${e.y.toFixed(1)}">${esc(e.t)}</text>`;
    box.innerHTML = `<svg class="ch-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label || '')}">${g}${lines}<line class="ch-guide" x1="0" x2="0" y1="${T}" y2="${T + ph}" visibility="hidden"/><g class="ch-hl"></g><rect class="ch-hit" x="${L}" y="0" width="${pw}" height="${H}"/></svg><div class="ch-tip" hidden></div>`;
    const svg = box.querySelector('svg'), tip = box.querySelector('.ch-tip'), guide = svg.querySelector('.ch-guide'), hl = svg.querySelector('.ch-hl');
    const maps = o.series.map(s => Object.fromEntries(s.pts.map(p => [p.d, p])));
    const move = ev => {
      const r = svg.getBoundingClientRect(), x = (ev.clientX - r.left) * (svg.clientWidth / (r.width || 1));
      const i = dates.length === 1 ? 0 : Math.max(0, Math.min(dates.length - 1, Math.round((x - L) / (pw / (dates.length - 1)))));
      const cx = X(i);
      guide.setAttribute('x1', cx); guide.setAttribute('x2', cx); guide.setAttribute('visibility', 'visible');
      let dots = '', rows = '';
      o.series.forEach((s, si) => {
        const p = maps[si][dates[i]]; const cls = s.primary ? 'p' : 'n' + Math.min(si, 4);
        if (p && p.v != null) dots += `<circle class="ch-dot ${cls}" cx="${cx}" cy="${Y(p.v)}" r="3"/>`;
        rows += `<div class="ch-tr"><i class="${cls}"></i><span>${esc(s.label)}</span><b>${p && p.v != null ? esc(fmt(p.v)) + esc(o.unit || '') : '—'}</b></div>${p && p.note ? `<div class="ch-tn">${esc(p.note)}</div>` : ''}`;
      });
      hl.innerHTML = dots;
      tipAt(box, tip, cx, `<div class="ch-td">${esc(dates[i])}</div>${rows}`);
    };
    const leave = () => { tip.hidden = true; guide.setAttribute('visibility', 'hidden'); hl.innerHTML = ''; };
    svg.addEventListener('mousemove', move); svg.addEventListener('mouseleave', leave);
  }
  // 막대: o = {pts:[{label, v, tip, on}], h, goal, goalLabel, unit}
  function drawBars(box, o) {
    if (!o.pts.length) { box.innerHTML = `<div class="ch-empty">${o.empty || '기록이 아직 없습니다'}</div>`; return; }
    const W = Math.max(200, box.clientWidth), H = o.h || 170, L = 28, R = 8, T = 12, B = 24, pw = W - L - R, ph = H - T - B;
    const sc = scale(o.pts.map(p => p.v).concat(o.goal ? [o.goal] : []), { yMin: 0, int: true, ticks: 3 });
    const Y = v => T + (1 - v / (sc.hi || 1)) * ph, n = o.pts.length, bw = pw / n, w = Math.max(3, Math.min(28, bw * 0.62));
    let g = '';
    for (const t of sc.ticks) g += `<line class="ch-grid" x1="${L}" x2="${W - R}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}"/><text class="ch-yl" x="${L - 7}" y="${(Y(t) + 3.5).toFixed(1)}" text-anchor="end">${nf(t)}</text>`;
    o.pts.forEach((p, i) => {
      const x = L + i * bw + (bw - w) / 2, y = Y(p.v);
      g += `<rect class="ch-bar${p.on ? ' on' : ''}" data-i="${i}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(0, T + ph - y).toFixed(1)}"/>`;
      if (i === 0 || i === n - 1 || i === Math.floor(n / 2)) g += `<text class="ch-xl" x="${(x + w / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(p.label)}</text>`;
    });
    if (o.goal) g += `<line class="ch-goal" x1="${L}" x2="${W - R}" y1="${Y(o.goal).toFixed(1)}" y2="${Y(o.goal).toFixed(1)}"/><text class="ch-gl" x="${W - R}" y="${(Y(o.goal) - 5).toFixed(1)}" text-anchor="end">${esc(o.goalLabel || '')}</text>`;
    box.innerHTML = `<svg class="ch-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${g}<rect class="ch-hit" x="${L}" y="0" width="${pw}" height="${H}"/></svg><div class="ch-tip" hidden></div>`;
    const svg = box.querySelector('svg'), tip = box.querySelector('.ch-tip'), bars = [...svg.querySelectorAll('.ch-bar')];
    svg.addEventListener('mousemove', ev => {
      const r = svg.getBoundingClientRect(), i = Math.max(0, Math.min(n - 1, Math.floor(((ev.clientX - r.left) * (svg.clientWidth / (r.width || 1)) - L) / bw)));
      bars.forEach((b, k) => b.classList.toggle('hv', k === i));
      tipAt(box, tip, L + i * bw + bw / 2, o.pts[i].tip);
    });
    svg.addEventListener('mouseleave', () => { tip.hidden = true; bars.forEach(b => b.classList.remove('hv')); });
  }

  // ── 대시보드 상태 (모듈 안에서 유지) ──
  let DD = null;                                              // {blogId, data}
  let dashTab = lsGet('bb.dash.tab') || 'overview';
  const pf = { cat: '', st: '', period: 'all', q: '', sort: 'date', dir: -1 };   // 글별 표 필터·정렬
  const openRows = new Set();

  function pageDash(root) {
    const ctx = { alive: true };
    root.classList.add('dash');
    root.innerHTML = `<div data-r="head"></div><div data-r="tabs"></div><div data-r="view"><div class="empty">불러오는 중</div></div>`;
    const $ = r => root.querySelector(`[data-r="${r}"]`);
    let charts = [], logLines = [], showLog = false, busy = false;
    const D = () => DD && DD.data;
    const chart = (id, fn) => { charts.push([id, fn]); return `<div class="ch" data-ch="${esc(id)}"></div>`; };
    function drawAll() {
      for (const [id, fn] of charts) { const el = root.querySelector(`[data-ch="${CSS.escape(id)}"]`); if (el) { try { fn(el); } catch (e) { console.error(e); } } }
    }

    async function load(quiet) {
      const a = curAcc();
      if (!a) { paint(); return; }
      try {
        const d = await BB.api('/api/insight/dashboard?blogId=' + encodeURIComponent(a.blogId));
        if (!ctx.alive) return;
        DD = { blogId: a.blogId, data: d };
        const run = d.collect && d.collect.running;
        busy = !!run;
        if (run && !logLines.length) { logLines = run.lines.slice(); showLog = true; }
        paint();
      } catch (e) {
        if (ctx.alive && !quiet) $('view').innerHTML = `<div class="empty">대시보드를 불러오지 못했습니다. ${esc(e.message || '')}</div>`;
      }
    }

    // ── 머리: 계정·수집 상태·지금 수집 ──
    function paintHead() {
      const a = curAcc(), d = D();
      if (!a) { $('head').innerHTML = `<div class="page-h"><h1>계정을 추가하세요</h1><div class="sub">대시보드를 볼 네이버 블로그 계정이 없습니다. <button type="button" class="link" data-go="#/blog/accounts">블로그 계정으로 이동</button></div></div>`; return; }
      const c = (d && d.collect) || { enabled: {}, state: {} }, p = (d && d.profile) || {};
      const runs = ['blog', 'exposure', 'keywords', 'owner'].map(k => {
        const s = c.state && c.state[k], en = c.enabled && c.enabled[k];
        const lr = d && d.lastRuns && d.lastRuns[k];
        let body;
        if (!en) body = k === 'owner' ? `<span class="st none">꺼짐</span><em>${goSet}에서 켜기</em>` : `<span class="st none">키 필요</span><em>${goSet}</em>`;
        else if (!s) body = `<span class="st mute">아직 안 모음</span><em>[지금 수집]</em>`;
        else body = `<span class="st ${s.ok ? 'ok' : 'bad'}">${s.ok ? (lr && lr.partial ? '일부' : '정상') : '실패'}</span><b class="mono" title="${esc(lr && lr.error ? lr.error : '')}">${esc(fmtDT(s.at))}</b><em>${esc(relT(s.at))}</em>`;
        const now = busy && c.running && c.running.kinds.includes(k);
        return `<div class="run${now ? ' now' : ''}"><dt>${KIND_EN[k]}<span>${esc(KIND_TXT[k])}</span></dt><dd>${now ? '<span class="st info">수집 중</span>' : body}</dd></div>`;
      }).join('');
      const nx = c.sched ? (c.nextAt ? `<b class="mono">${esc(fmtDT(c.nextAt))}</b><em>${esc(relF(c.nextAt))} · ${c.tickMin}분마다 확인</em>` : `<em>예정 없음</em>`) : '<span class="st none">꺼짐</span>';
      $('head').innerHTML = `<div class="page-h dash-h"><div class="row">
          <div class="grow"><h1>${esc(p.blogName || a.name)}</h1>
            <div class="sub"><span class="mono">blog.naver.com/${esc(a.blogId)}</span>${p.directory ? ' · ' + esc(p.directory) : ''}${p.nickName ? ' · ' + esc(p.nickName) : ''}${d && d.today ? ' · 기준일 <span class="mono">' + esc(d.today) + '</span>' : ''}</div></div>
          <button type="button" class="btn" data-act="openBlog">블로그 열기</button>
          <button type="button" class="btn pri" data-act="collect"${busy ? ' disabled' : ''}>${busy ? '수집 중' : '지금 수집'}</button></div></div>
        <dl class="runs">${runs}<div class="run nx"><dt>NEXT<span>다음 자동 수집</span></dt><dd>${nx}</dd></div></dl>
        <div class="runlog"${showLog ? '' : ' hidden'}><div class="row"><span class="d-cap grow">수집 기록${c.last && !busy ? ` · 마지막 ${esc(fmtDT(c.last.at))} ${c.last.ok ? '정상' : '일부 실패'}` : ''}</span><button type="button" class="link" data-act="hideLog">닫기</button></div><div class="log" data-r="log"></div></div>`;
      const lg = $('log'); if (lg) { lg.textContent = logLines.join('\n'); lg.scrollTop = lg.scrollHeight; }
      root.querySelectorAll('[data-act="collect"]').forEach(x => { x.disabled = busy; });
    }

    function paintTabs() {
      const d = D();
      if (!d || !curAcc()) { $('tabs').innerHTML = ''; return; }
      const n = d.tables.posts.length;
      $('tabs').innerHTML = `<div class="dtabs" role="tablist">${DASH_TABS.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" class="${k === dashTab ? 'on' : ''}" aria-selected="${k === dashTab}">${esc(l)}${k === 'posts' ? `<span>${n}</span>` : ''}</button>`).join('')}</div>`;
    }

    function paint() {
      if (!ctx.alive) return;
      paintHead(); paintTabs();
      charts = [];
      const d = D(), v = $('view');
      if (!curAcc()) { v.innerHTML = ''; return; }
      if (!d) { v.innerHTML = '<div class="empty">불러오는 중</div>'; return; }
      if (!d.profile && !d.tables.posts.length) {
        v.innerHTML = `<div class="d-onboard"><div class="d-eb">00 / START</div><h2>아직 모은 데이터가 없습니다</h2>
          <p>[지금 수집]을 누르면 블로그 공개 정보(전체 글 목록 · 글별 공감·댓글·사진 수 · 이웃 수 · 누적 방문자 · RSS 발행 시각)를 모읍니다. 1~2분 걸리고, 그 뒤로는 앱이 켜져 있는 동안 하루 한 번 자동으로 모읍니다.</p>
          <p class="dim">검색 순위·키워드 검색량·유입 검색어는 ${goSet}에서 API 키를 넣거나 옵션을 켜면 열립니다.</p>
          <div class="row"><button type="button" class="btn pri" data-act="collect"${busy ? ' disabled' : ''}>지금 수집</button></div></div>`;
        return;
      }
      const fn = { overview: vOverview, posts: vPosts, keywords: vKeywords, cats: vCats, owner: vOwner }[dashTab] || vOverview;
      v.innerHTML = fn(d) + notesHtml(d);
      if (dashTab === 'posts') afterPosts();
      drawAll();
    }
    const notesHtml = d => d.notes && d.notes.length ? `<ul class="dnotes">${d.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : '';

    // ── 개요 ──
    // 출처가 꺼져 있으면 0이 아니라 "모름"으로 보여 준다
    function kpiOff(k, d) {
      const en = d.collect.enabled, st = d.collect.settings;
      if (['exposureRate', 'top10', 'avgRank'].includes(k) && !en.exposure) return '검색 API 키 필요';
      if (['smartBlock', 'aiCited'].includes(k) && !st.serp) return '검색 화면 확인 꺼짐';
      if (k === 'estSearchTraffic' && !en.keywords) return '검색광고 키 필요';
      if (k === 'estSearchTraffic' && !en.exposure) return '검색 API 키 필요';
      return '';
    }
    function kpiHint(k, d) {
      if (k === 'visitors') return '내일 수집하면 계산';
      if (k === 'subscriberCount' && d.collect.settings.strictRobots) return 'robots 엄격 모드';
      if (k === 'exposureRate' || k === 'avgRank') return '노출 기록 없음';
      return '수집 전';
    }
    function kpiTile(k, i, d) {
      const off = kpiOff(k.key, d);
      const v = off ? null : k.value, dec = k.key === 'avgRank' ? 1 : 0;
      let dl = '<span class="kpi-d none">7일 비교 없음</span>';
      if (k.delta7 != null) {
        if (k.delta7 === 0) dl = '<span class="kpi-d flat">±0 · 7일</span>';
        else { const good = k.better === 'down' ? k.delta7 < 0 : k.delta7 > 0; dl = `<span class="kpi-d ${good ? 'kd-up' : 'kd-dn'}">${k.delta7 > 0 ? '▲' : '▼'} ${nf(Math.abs(k.delta7), 1)}<small> · 7일</small></span>`; }
      }
      const hint = v == null ? off || kpiHint(k.key, d) : '';
      return `<div class="kpi${v == null ? ' na' : ''}"><div class="kpi-l"><span>${pad(i + 1)}</span>${esc(KPI_EN[k.key] || k.key)}</div>
        <div class="kpi-v">${v == null ? '—' : nf(v, dec)}${v != null ? `<small>${esc(k.unit)}</small>` : ''}</div>
        <div class="kpi-k">${esc(k.label)}</div>${v == null ? `<span class="kpi-d none">${esc(hint)}</span>` : dl}</div>`;
    }
    function vOverview(d) {
      const ch = d.charts, en = d.collect.enabled, goal = (d.config.goals && d.config.goals.postsPer30) || 20;
      const vis = ch.visitors || [];
      const hasViews = vis.some(x => x.views != null);
      const visHtml = chart('vis', el => drawLine(el, {
        label: '일 방문자', h: 190, floor0: true, int: true, unit: '명', fmt: v => nf(v),
        series: [{ label: '방문자', primary: true, pts: vis.map(x => ({ d: x.date, v: x.visitors, note: x.source })) }].concat(hasViews ? [{ label: '조회수', dash: '3 3', pts: vis.map(x => ({ d: x.date, v: x.views })) }] : []),
        empty: '방문자 그래프는 수집이 이틀 이상 쌓이면 그려집니다(누적 방문자 차이로 계산)',
      }));
      const wk = ch.weeklyPosts || [];
      const wkHtml = chart('wk', el => drawBars(el, {
        h: 190, goal: Math.round(goal * 7 / 30 * 10) / 10, goalLabel: `목표 주 ${nf(goal * 7 / 30, 1)}편`,
        pts: wk.map((w, i) => ({ label: md(w.week), v: w.posts, on: i === wk.length - 1, tip: `<div class="ch-td">${esc(w.week)} 주</div><div class="ch-tr"><i class="p"></i><span>발행</span><b>${w.posts}편</b></div>` })),
      }));
      const small = (id, label, pts, o) => `<div class="dcell"><div class="dcell-h"><b>${esc(label)}</b><span class="mono">${(lp => lp ? nf(lp.value, 1) + esc(o.unit || '') : '—')(pts.filter(p => p.value != null).pop())}</span></div>${chart(id, el => drawLine(el, Object.assign({ h: 130, mini: true, label, series: [{ label, primary: true, pts: pts.map(p => ({ d: p.date, v: p.value })) }] }, o)))}</div>`;
      const ranks = (ch.ranks || []).filter(r => r.series.length);
      const rankHtml = ranks.length
        ? chart('rk', el => drawLine(el, { label: '키워드 순위', h: 220, invert: true, yMin: 1, int: true, unit: '위', fmt: v => nf(v), endLabels: true, series: ranks.map((r, i) => ({ label: r.keyword, primary: i === 0, dash: ['', '', '4 3', '1 3', '6 2 1 2'][i], pts: r.series.map(p => ({ d: p.date, v: p.value })) })) }))
        : `<div class="d-empty">${!en.exposure ? `검색 API 키를 넣거나 "검색 화면에서 노출 확인"을 켜면 키워드 순위가 열립니다. ${goSet}` : !en.keywords ? `검색량 상위 키워드 순위는 검색광고 API 키가 있어야 고를 수 있습니다. ${goSet}` : '노출 확인 기록이 쌓이면 상위 5개 키워드 순위가 그려집니다.'}</div>`;
      return `<section class="dsec first"><div class="kpis">${d.kpis.map((k, i) => kpiTile(k, i, d)).join('')}</div></section>
        <section class="dsec">${eb(1, 'Traffic')}<h2>방문 · 발행</h2>
          <div class="dgrid c21"><div class="dcell"><div class="dcell-h"><b>일 방문자${hasViews ? ' · 조회수' : ''}</b><span class="d-leg"><i class="p"></i>방문자${hasViews ? '<i class="n1 dash"></i>조회수' : ''}</span></div>${visHtml}</div>
            <div class="dcell"><div class="dcell-h"><b>주간 발행</b><span class="mono">최근 12주</span></div>${wkHtml}</div></div>
          <div class="dgrid c3">${small('ex', '노출 성공률', ch.exposureRate || [], { unit: '%', yMin: 0, yMax: 100, fmt: v => nf(v), empty: en.exposure ? '노출 확인 기록이 아직 없습니다' : `검색 API 키 필요 · ${goSet}` })}
            ${small('sub', '이웃', ch.subscribers || [], { unit: '명', int: true, fmt: v => nf(v), empty: '이웃 수 기록이 아직 없습니다' })}
            ${small('con', '발행 꾸준함', ch.consistency || [], { unit: '점', yMin: 0, yMax: 100, fmt: v => nf(v), empty: '기록이 아직 없습니다' })}</div></section>
        <section class="dsec">${eb(2, 'Search')}<h2>키워드 순위</h2><div class="d-sub">추정 유입이 큰 상위 5개 키워드 · 위로 갈수록 상위</div>${rankHtml}</section>
        <section class="dsec">${eb(3, 'AdPost')}<h2>애드포스트 준비도 · 저품질 신호</h2>
          <div class="dgrid c2"><div class="dcell">${readyHtml(d.checklist)}</div><div class="dcell">${signalsHtml(d.signals)}</div></div></section>
        <section class="dsec">${eb(4, 'Next')}<h2>다음에 할 일</h2>${recsHtml(d.recommendations)}</section>`;
    }
    function readyHtml(c) {
      if (!c) return '<div class="d-empty">기록이 아직 없습니다</div>';
      const ST = { ok: ['ok', '충족'], todo: ['warn', '진행 중'], unknown: ['none', '모름'] };
      return `<div class="rd-top"><div class="rd-score"><b>${nf(c.score)}</b><span>/ 100</span></div><div class="rd-bar"><i style="width:${Math.max(0, Math.min(100, c.score))}%"></i></div></div>
        <table class="tbl rd"><tbody>${c.items.map(it => `<tr><td>${esc(it.label)}${it.note ? `<div class="dim">${esc(it.note)}</div>` : ''}</td>
          <td class="rd-p"><span class="pbar${it.status === 'ok' ? ' full' : ''}"><i style="width:${Math.round((it.progress || 0) * 100)}%"></i></span></td>
          <td class="num">${it.value == null ? '—' : nf(it.value)}<span class="dim"> / ${nf(it.target)}${esc(it.unit)}</span></td>
          <td class="num"><span class="st ${ST[it.status] ? ST[it.status][0] : 'none'}">${esc(ST[it.status] ? ST[it.status][1] : it.status)}</span></td></tr>`).join('')}</tbody></table>
        ${c.eta && c.eta.length ? `<dl class="rd-eta">${c.eta.map(e => `<div><dt>${esc(e.label)}</dt><dd class="mono">${esc(e.date)}<span> · D-${Math.max(0, Math.round((Date.parse(e.date + 'T00:00:00+09:00') - Date.now()) / DAYMS))}</span></dd></div>`).join('')}</dl>` : ''}
        <p class="d-cap">${esc(c.criteriaNote || '')}</p>`;
    }
    function signalsHtml(sig) {
      const list = sig || [];
      return `<div class="dcell-h"><b>저품질 의심 신호</b><span class="mono">${list.length}건</span></div>` + (list.length
        ? LEVEL.map(([lv, txt, cls]) => { const g = list.filter(s => s.level === lv); return g.length ? `<div class="sig-g"><div class="sig-h"><span class="st ${cls}">${txt}</span><span class="mono">${g.length}</span></div>${g.map(s => `<div class="sig"><span>${esc(s.message)}</span><code>${esc(s.code)}</code></div>`).join('')}</div>` : ''; }).join('')
        : '<div class="d-empty ok-line"><span class="st ok">없음</span> 지금 기준으로 저품질 의심 신호가 없습니다. 노출 확인 기록이 쌓일수록 더 정확해집니다.</div>');
    }
    const postLink = (it) => it.logNo ? `<button type="button" class="link" data-open="${esc(it.logNo)}">${esc(it.title || it.logNo)}</button>` : esc(it.title || '');
    const REC_COLS = {
      NEW_KEYWORD: [['키워드', i => esc(i.keyword)], ['검색량', i => nf(i.volume), 1], ['경쟁도', i => esc(i.compIdx || '—')], ['유입', i => i.inflow != null ? nf(i.inflow) : '', 1]],
      PUSH_TOP10: [['글', postLink], ['키워드', i => esc(i.keyword || '')], ['순위', i => nf(i.rank) + '위', 1], ['검색량', i => nf(i.volume), 1]],
      FIX_MISSING: [['글', postLink], ['키워드', i => esc(i.keyword || '')], ['발행일', i => `<span class="mono">${esc(i.date || '')}</span>`]],
      CANNIBAL: [['키워드', i => esc(i.keyword)], ['내 글(순위)', i => esc((i.posts || []).map(p => p.logNo + (p.rank ? ` ${p.rank}위` : '')).join(', '))]],
      TITLE: [['글', postLink], ['문제', i => esc(i.issue)]],
      IMAGES: [['글', postLink], ['사진', i => nf(i.images) + '장', 1]],
      TIMING: [['구분', i => esc(i.kind)], ['때', i => esc(i.label)], ['평균 점수', i => nf(i.avgScore), 1], ['글', i => nf(i.posts), 1]],
      OPPORTUNITY: [['키워드', i => esc(i.keyword)], ['검색량', i => nf(i.volume), 1], ['현재', i => i.rank ? nf(i.rank) + '위' : '밖', 1], ['3위 시 월 유입', i => nf(i.potentialTop3), 1]],
    };
    function recsHtml(recs) {
      if (!recs || !recs.length) return '<div class="d-empty">지금은 추천할 일이 없습니다. 데이터가 더 쌓이면 키워드·제목·발행 시간 제안이 나옵니다.</div>';
      return `<div class="recs">${recs.map(r => {
        const cols = REC_COLS[r.type], items = r.items || [];
        const tbl = cols && items.length ? `<table class="tbl rec-t"><thead><tr>${cols.map(c => `<th${c[2] ? ' class="num"' : ''}>${esc(c[0])}</th>`).join('')}</tr></thead><tbody>${items.slice(0, 5).map(i => `<tr>${cols.map(c => `<td${c[2] ? ' class="num"' : ''}>${c[1](i)}</td>`).join('')}</tr>`).join('')}</tbody></table>${items.length > 5 ? `<div class="d-cap">외 ${items.length - 5}건</div>` : ''}` : '';
        return `<div class="rec"><div class="rec-e"><span>P${r.priority}</span>${esc(r.type)}</div><b>${esc(r.title)}</b><p>${esc(r.reason || '')}</p>${tbl}</div>`;
      }).join('')}</div>`;
    }

    // ── 글별 성과 ──
    const COLS = [
      ['date', '발행일시', r => postMs(r)], ['title', '제목', r => r.title || ''], ['category', '카테고리', r => r.category || ''],
      ['sympathy', '공감', r => r.sympathy, 1], ['comments', '댓글', r => r.comments, 1], ['images', '사진', r => r.images, 1],
      ['keyword', '키워드', r => (r.targetKeywords || [r.keyword || r.autoKeyword || ''])[0] || ''], ['rank', '순위·상태', r => r.rank, 1],
      ['smart', '스마트블록', r => (r.smart || []).length || null], ['ai', 'AI 인용', r => r.aiCited ? 1 : null, 1], ['score', '성과 점수', r => r.score, 1],
    ];
    function filtered(d) {
      const q = pf.q.trim().toLowerCase(), now = Date.now(), days = { '7': 7, '30': 30, '90': 90 }[pf.period];
      const col = COLS.find(c => c[0] === pf.sort) || COLS[0];
      return d.tables.posts.filter(r => (!pf.cat || r.category === pf.cat) && (!pf.st || r.status === pf.st) && (!days || postMs(r) >= now - days * DAYMS) && (!q || String(r.title || '').toLowerCase().includes(q)))
        .sort((a, b) => {
          const x = col[2](a), y = col[2](b);
          const nx = x == null || x === '', ny = y == null || y === '';
          if (nx || ny) return nx && ny ? postMs(b) - postMs(a) : nx ? 1 : -1;   // 빈 값은 항상 아래
          const c = typeof x === 'string' ? x.localeCompare(y, 'ko') : x - y;
          return c ? c * pf.dir : postMs(b) - postMs(a);
        });
    }
    function vPosts(d) {
      const rows = d.tables.posts, cats = [...new Set(rows.map(r => r.category))].sort((a, b) => a.localeCompare(b, 'ko'));
      const sts = Object.keys(ST_TXT).filter(s => rows.some(r => r.status === s));
      return `<section class="dsec first dt-sec">
        <div class="dt-bar">
          <input class="inp dt-q" type="search" data-f="q" placeholder="제목 검색" value="${esc(pf.q)}" aria-label="제목 검색">
          <select class="inp dt-s" data-f="cat" aria-label="카테고리"><option value="">카테고리 전체</option>${cats.map(c => `<option value="${esc(c)}"${c === pf.cat ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
          <select class="inp dt-s" data-f="st" aria-label="노출 상태"><option value="">노출 상태 전체</option>${sts.map(s => `<option value="${s}"${s === pf.st ? ' selected' : ''}>${esc(ST_TXT[s])}</option>`).join('')}</select>
          <div class="seg" data-f="period">${[['7', '7일'], ['30', '30일'], ['90', '90일'], ['all', '전체']].map(([k, l]) => `<button type="button" data-v="${k}" class="${pf.period === k ? 'on' : ''}">${l}</button>`).join('')}</div>
          <div class="grow"></div><span class="mono muted" data-r="cnt"></span>
        </div>
        <div class="dt-wrap"><table class="tbl dt"><thead><tr>${COLS.map(c => `<th data-sort="${c[0]}" class="${c[3] ? 'num ' : ''}${pf.sort === c[0] ? 'on' : ''}" aria-sort="${pf.sort === c[0] ? (pf.dir > 0 ? 'ascending' : 'descending') : 'none'}">${esc(c[1])}<i>${pf.sort === c[0] ? (pf.dir > 0 ? '↑' : '↓') : ''}</i></th>`).join('')}</tr></thead><tbody data-r="tb"></tbody></table></div>
        <div class="d-cap">행을 누르면 순위·반응 이력과 타깃 키워드 편집이 열립니다. 성과 점수 = 반응 백분위 50 + 검색 노출 50 (노출 판정이 없으면 반응만) · 정의 insight\\METRICS.md</div></section>`;
    }
    function rowHtml(r) {
      const ms = postMs(r), kw = r.targetKeywords || [];
      const kwCell = kw.length ? `<span class="kw" title="${esc(kw.join(', '))}">${esc(kw.join(', '))}</span>` : `<span class="dim" title="제목에서 자동으로 뽑은 키워드">${esc(r.keyword || r.autoKeyword || '')}</span><div class="auto">AUTO</div>`;
      const rk = r.rank != null ? `<b class="mono">${nf(r.rank)}위</b> ` : '';
      const sc = r.score != null ? r.score : 0;
      return `<tr class="dt-r click${openRows.has(r.logNo) ? ' open' : ''}" data-no="${esc(r.logNo)}">
        <td class="dt-d"><span class="mono">${r.addedAt ? esc(fmtDT(ms)) : esc(r.date || '') + '<span class="dim"> --:--</span>'}</span><div class="dim">${ms ? esc(relT(ms)) : ''}</div></td>
        <td class="dt-t">${esc(r.title || '(제목 없음)')}${!r.searchYn || !r.open ? ' <span class="st bad">비공개·검색 제외</span>' : ''}</td>
        <td class="dt-c">${esc(r.category || '')}</td>
        <td class="num">${nf(r.sympathy)}</td><td class="num">${nf(r.comments)}</td><td class="num">${nf(r.images)}</td>
        <td class="dt-k">${kwCell}</td>
        <td class="num">${rk}${stTag(r.status)}</td>
        <td class="dt-sb">${(r.smart || []).length ? esc(r.smart.join(', ')) : '<span class="nil">—</span>'}</td>
        <td class="num">${r.aiCited ? '<span class="st info">인용</span>' : '<span class="nil">—</span>'}</td>
        <td class="num"><span class="sc">${nf(r.score)}</span><span class="sbar"><i style="width:${Math.max(0, Math.min(100, sc))}%"></i></span></td></tr>
        ${openRows.has(r.logNo) ? detailHtml(r) : ''}`;
    }
    function detailHtml(r) {
      const kw = r.targetKeywords || [];
      const kwPos = r.kwInTitle == null ? '—' : r.kwInTitle < 0 ? '제목에 없음' : r.kwInTitle === 0 ? '맨 앞' : r.kwInTitle + '자 뒤';
      chartsPending.push([`rk-${r.logNo}`, el => drawLine(el, { label: '순위 이력', h: 120, mini: true, invert: true, yMin: 1, int: true, unit: '위', fmt: v => nf(v), series: [{ label: '순위', primary: true, pts: (r.rankHist || []).map(h => ({ d: h.date, v: h.rank, note: `${ST_TXT[h.status] || h.status} · ${h.keyword}` })) }], empty: (r.rankHist || []).length ? '순위 안에 든 날이 없습니다(모두 100위 밖·미노출)' : '노출 확인 기록이 없습니다' })]);
      chartsPending.push([`en-${r.logNo}`, el => drawLine(el, { label: '공감·댓글', h: 120, mini: true, floor0: true, int: true, fmt: v => nf(v), series: [{ label: '공감', primary: true, pts: (r.hist || []).map(h => ({ d: h.date, v: h.s })) }, { label: '댓글', dash: '3 3', pts: (r.hist || []).map(h => ({ d: h.date, v: h.c })) }], empty: '반응 기록이 아직 없습니다' })]);
      return `<tr class="dt-x" data-no="${esc(r.logNo)}"><td colspan="${COLS.length}"><div class="dx">
        <div class="dx-c"><div class="dcell-h"><b>순위 이력</b><span class="mono">${(r.rankHist || []).length}회 확인</span></div><div class="ch" data-ch="rk-${esc(r.logNo)}"></div></div>
        <div class="dx-c"><div class="dcell-h"><b>공감 · 댓글</b><span class="d-leg"><i class="p"></i>공감<i class="n1 dash"></i>댓글</span></div><div class="ch" data-ch="en-${esc(r.logNo)}"></div></div>
        <div class="dx-c dx-kw">
          <div class="field"><label for="kw-${esc(r.logNo)}">타깃 키워드</label>
            <div class="row"><input class="inp grow" id="kw-${esc(r.logNo)}" data-kw="${esc(r.logNo)}" maxlength="210" value="${esc(kw.join(', '))}" placeholder="${esc(r.autoKeyword || '')}">
              <button type="button" class="btn sm pri" data-act="saveKw" data-no="${esc(r.logNo)}">저장</button>${kw.length ? `<button type="button" class="btn sm" data-act="autoKw" data-no="${esc(r.logNo)}">자동으로</button>` : ''}</div>
            <div class="hint">쉼표로 나눠 최대 5개. 비우면 제목에서 뽑은 <b>${esc(r.autoKeyword || '')}</b>로 확인합니다. 다음 노출 확인부터 적용.</div></div>
          <dl class="kv dx-kv"><dt>글 번호</dt><dd class="mono">${esc(r.logNo)}</dd><dt>발행 시각</dt><dd class="mono">${r.addedAt ? esc(fmtDT(r.addedAt)) : esc(r.date || '')}</dd>
            <dt>태그</dt><dd>${r.tags && r.tags.length ? esc(r.tags.slice(0, 8).map(t => '#' + t).join(' ')) + (r.tags.length > 8 ? `<span class="dim"> 외 ${r.tags.length - 8}개</span>` : '') : '<span class="nil">—</span>'}</dd>
            <dt>제목 · 키워드 위치</dt><dd>${nf(r.titleLen)}자 · ${esc(kwPos)}</dd><dt>검색량 · 공유</dt><dd class="mono">${r.volume != null ? nf(r.volume) + '/월' : '—'} · ${nf(r.shares)}</dd></dl>
          <div class="row"><button type="button" class="btn sm" data-act="openPost" data-no="${esc(r.logNo)}">글 열기 ↗</button></div>
        </div></div></td></tr>`;
    }
    let chartsPending = [];
    function paintRows() {
      const d = D(), tb = $('tb'); if (!d || !tb) return;
      chartsPending = [];
      const list = filtered(d);
      tb.innerHTML = list.length ? list.map(rowHtml).join('') : `<tr><td colspan="${COLS.length}"><div class="empty">${d.tables.posts.length ? '조건에 맞는 글이 없습니다' : '글이 아직 없습니다'}</div></td></tr>`;
      $('cnt').textContent = `${list.length} / ${d.tables.posts.length}개`;
      fitDx();
      for (const [id, fn] of chartsPending) { const el = tb.querySelector(`[data-ch="${CSS.escape(id)}"]`); if (el) fn(el); }
      charts = charts.filter(c => !/^(rk|en)-/.test(c[0])).concat(chartsPending);
    }
    function afterPosts() { paintRows(); }
    // 표가 창보다 넓어 가로로 밀릴 때도 펼친 상세는 보이는 폭에 맞춰 왼쪽에 붙어 있게
    function fitDx() {
      const w = root.querySelector('.dt-wrap'); if (!w) return;
      const over = w.scrollWidth > w.clientWidth + 1;
      root.querySelectorAll('.dx').forEach(x => { x.style.width = over ? (w.clientWidth - 32) + 'px' : ''; x.classList.toggle('pin', over); });
    }

    // ── 키워드·노출 ──
    function vKeywords(d) {
      const en = d.collect.enabled, x = d.tables.exposure || {}, rows = d.tables.keywords || [];
      const strip = [['판정한 글', x.judged], ['노출', x.exposed], ['100위 밖', x.outOfRange], ['색인 누락', x.missing], ['판정 보류', x.pending], ['중앙 순위', x.medianRank != null ? nf(x.medianRank, 1) + '위' : null], ['3위 안', x.top3], ['확인 비율', x.coverage != null ? x.coverage + '%' : null]];
      const tbl = rows.length ? `<div class="dt-wrap short"><table class="tbl"><thead><tr><th>키워드</th><th class="num">월 검색량</th><th>경쟁도</th><th class="num">현재 순위</th><th class="num">추정 월 유입</th><th class="num">3위 시 월 유입</th></tr></thead><tbody>
          ${rows.map(r => `<tr><td>${esc(r.keyword)}</td><td class="num">${nf(r.volume)}</td><td><span class="st ${r.compIdx === '낮음' ? 'ok' : r.compIdx === '높음' ? 'bad' : r.compIdx ? 'warn' : 'none'}">${esc(r.compIdx || '—')}</span></td><td class="num">${r.rank != null ? nf(r.rank) + '위' : '<span class="dim">밖</span>'}</td><td class="num">${nf(r.estMonthly)}</td><td class="num">${nf(r.potentialTop3)}</td></tr>`).join('')}
          </tbody></table></div>`
        : `<div class="d-empty">${!en.keywords ? `검색광고 API 키를 넣으면 키워드 검색량·경쟁도·추정 유입이 열립니다. ${goSet}` : !en.exposure ? `검색 순위가 있어야 추정 유입을 계산합니다. 블로그 검색 API 키를 넣으세요. ${goSet}` : '검색량을 조회한 키워드가 아직 없습니다. [지금 수집]을 누르세요.'}</div>`;
      const can = x.cannibal || [];
      return `<section class="dsec first">${eb(1, 'Exposure')}<h2>검색 노출 요약</h2>
          ${en.exposure ? `<dl class="runs strip">${strip.map(([l, v]) => `<div class="run"><dt>${esc(l)}</dt><dd><b class="big">${v == null ? '—' : typeof v === 'number' ? nf(v) : esc(v)}</b></dd></div>`).join('')}</dl>` : `<div class="d-empty">블로그 검색 API 키를 넣거나 "검색 화면에서 노출 확인"을 켜면 글별 노출 여부·순위가 열립니다. ${goSet}</div>`}
          ${can.length ? `<div class="d-sub">내 글끼리 같은 키워드에서 경쟁: ${can.map(c => `<b>${esc(c.keyword)}</b> (${(c.posts || []).length}개)`).join(', ')}</div>` : ''}</section>
        <section class="dsec">${eb(2, 'Keywords')}<h2>키워드 경쟁도 대비 순위</h2><div class="d-sub">3위 안에 들었을 때 기대 월 유입이 큰 순 · 클릭률은 가정값(1위 25% · 3위 10% · 10위 4%)</div>${tbl}</section>`;
    }

    // ── 카테고리·시간대 ──
    function vCats(d) {
      const cats = d.tables.categories || [], t = d.tables.timing || { weekday: [], hourBand: [] }, c = d.tables.cadence || {};
      const maxS = Math.max(1, ...cats.map(x => x.avgScore || 0), ...t.weekday.map(x => x.avgScore || 0), ...t.hourBand.map(x => x.avgScore || 0));
      const bar = v => `<span class="sbar wide"><i style="width:${Math.round((v || 0) / maxS * 100)}%"></i></span>`;
      const tTbl = (list, label) => `<table class="tbl"><thead><tr><th>${label}</th><th class="num">글</th><th>평균 성과 점수</th><th class="num">노출률</th></tr></thead><tbody>${list.map(x => `<tr${x.enough ? '' : ' class="thin"'}><td>${esc(x.label)}</td><td class="num">${nf(x.posts)}</td><td><div class="sb-cell"><span class="mono">${x.avgScore == null ? '—' : nf(x.avgScore)}</span>${bar(x.avgScore)}</div></td><td class="num">${x.exposureRate == null ? '—' : x.exposureRate + '%'}</td></tr>`).join('')}</tbody></table>`;
      const kv = [['최근 7일', c.posts7, '편'], ['최근 30일', c.posts30, `편 / 목표 ${nf(c.goal30)}`], ['주 평균', c.perWeek, '편'], ['목표 달성', c.goalPct, '%'], ['평균 간격', c.avgGap, '일'], ['최대 공백(90일)', c.maxGap90, '일'], ['마지막 글 후', c.currentGap, '일'], ['발행한 주(최근 4주)', c.activeWeeks, '주']];
      return `<section class="dsec first">${eb(1, 'Cadence')}<h2>발행 리듬</h2><dl class="runs strip">${kv.map(([l, v, u]) => `<div class="run"><dt>${esc(l)}</dt><dd><b class="big">${nf(v, 1)}</b><em>${esc(u)}</em></dd></div>`).join('')}</dl></section>
        <section class="dsec">${eb(2, 'Category')}<h2>카테고리 효율</h2>
          ${cats.length ? `<table class="tbl"><thead><tr><th>카테고리</th><th class="num">글</th><th class="num">평균 공감</th><th class="num">평균 댓글</th><th class="num">노출률</th><th>평균 성과 점수</th></tr></thead><tbody>${cats.map(x => `<tr><td>${esc(x.category)}</td><td class="num">${nf(x.posts)}</td><td class="num">${nf(x.avgSympathy, 1)}</td><td class="num">${nf(x.avgComments, 1)}</td><td class="num">${x.exposureRate == null ? '—' : x.exposureRate + '%'}</td><td><div class="sb-cell"><span class="mono">${nf(x.avgScore)}</span>${bar(x.avgScore)}</div></td></tr>`).join('')}</tbody></table>` : '<div class="d-empty">글이 아직 없습니다</div>'}</section>
        <section class="dsec">${eb(3, 'Timing')}<h2>요일 · 시간대별 발행 효과</h2><div class="d-sub">발행 시각을 아는 글 ${nf(t.exactTimes)}편 기준 · 흐린 줄은 글 3편 미만(추천에 안 씀)</div>
          <div class="dgrid c2"><div class="dcell">${tTbl(t.weekday, '요일')}</div><div class="dcell">${tTbl(t.hourBand, '시간대')}</div></div></section>`;
    }

    // ── 유입(주인 통계) ──
    function vOwner(d) {
      const o = d.tables.owner, on = d.collect.settings.ownerStats;
      if (!o) return `<section class="dsec first">${eb(1, 'Inflow')}<h2>유입 검색어 · 유입 경로</h2><div class="d-empty">${on ? '주인 통계를 아직 읽지 못했습니다. [지금 수집]을 누르거나 다음 자동 수집을 기다리세요(크롬 창이 열려 있으면 건너뜁니다).' : `"주인 통계 읽기"를 켜면 유입 검색어·유입 경로·조회수가 열립니다. 블로그 로그인 프로필로 통계 화면 1장만 읽기 전용으로 엽니다. ${goSet}`}</div></section>`;
      const t = (list, a, b, ka, kb) => list && list.length ? `<table class="tbl"><thead><tr><th>${a}</th><th class="num">${b}</th></tr></thead><tbody>${list.map(x => `<tr><td>${esc(x[ka] ?? '')}</td><td class="num">${nf(x[kb], 1)}</td></tr>`).join('')}</tbody></table>` : '<div class="d-empty">이 표는 비어 있습니다</div>';
      return `<section class="dsec first">${eb(1, 'Inflow')}<h2>유입 검색어 · 유입 경로</h2><div class="d-sub">주인 통계 <span class="mono">${esc(o.date || '')}</span> 기준</div>
        <div class="dgrid c2"><div class="dcell"><div class="dcell-h"><b>유입 검색어</b><span class="mono">${(o.keywords || []).length}</span></div>${t(o.keywords, '검색어', '유입', 'keyword', 'value')}</div>
          <div class="dcell"><div class="dcell-h"><b>유입 경로</b><span class="mono">${(o.sources || []).length}</span></div>${t(o.sources, '경로', '비율·수', 'name', 'value')}</div></div></section>
        ${o.topPosts && o.topPosts.length ? `<section class="dsec">${eb(2, 'Top posts')}<h2>많이 본 글</h2>${t(o.topPosts, '글', '조회', 'title', 'value')}</section>` : ''}`;
    }

    // ── 이벤트 ──
    async function startCollect(kinds) {
      const a = curAcc(); if (!a || busy) return;
      try {
        logLines = []; showLog = true; busy = true; paintHead();
        const r = await BB.api('/api/insight/collect', kinds ? { blogId: a.blogId, kinds } : { blogId: a.blogId });
        if (DD && DD.data && DD.data.collect) DD.data.collect.running = { kinds: r.kinds, started: Date.now(), lines: [] };
        paintHead();
      } catch (e) { busy = false; paintHead(); }
    }
    async function saveKw(no, list) {
      const a = curAcc(); if (!a) return;
      try {
        const r = await BB.api('/api/insight/config', { blogId: a.blogId, keywords: { [no]: list } });
        const row = D() && D().tables.posts.find(x => x.logNo === no);
        if (row) row.targetKeywords = (r.config.keywords || {})[no] || null;
        if (D()) D().config = r.config;
        BB.toast(list.length ? '타깃 키워드를 저장했습니다. 다음 노출 확인부터 적용됩니다' : '제목에서 자동으로 뽑은 키워드로 되돌렸습니다');
        paintRows();
      } catch (e) { }
    }
    root.addEventListener('click', e => {
      const go = e.target.closest('[data-go]');
      if (go && root.contains(go)) { BB.go(go.dataset.go); return; }
      const tab = e.target.closest('[data-tab]');
      if (tab) { dashTab = tab.dataset.tab; lsSet('bb.dash.tab', dashTab); paint(); return; }
      const th = e.target.closest('th[data-sort]');
      if (th) { const k = th.dataset.sort; if (pf.sort === k) pf.dir = -pf.dir; else { pf.sort = k; pf.dir = ['title', 'category', 'keyword'].includes(k) ? 1 : -1; } paint(); return; }
      const sg = e.target.closest('[data-f="period"] button');
      if (sg) { pf.period = sg.dataset.v; [...sg.parentElement.children].forEach(b => b.classList.toggle('on', b === sg)); paintRows(); return; }
      const op = e.target.closest('[data-open]');
      if (op) { e.stopPropagation(); openP(`https://blog.naver.com/${curAcc().blogId}/${op.dataset.open}`); return; }
      const t = e.target.closest('[data-act]');
      if (t && root.contains(t)) {
        const act = t.dataset.act, no = t.dataset.no;
        if (act === 'collect') startCollect();
        else if (act === 'openBlog') { const a = curAcc(); if (a) openP('https://blog.naver.com/' + a.blogId); }
        else if (act === 'hideLog') { showLog = false; paintHead(); }
        else if (act === 'openPost') { const r = D().tables.posts.find(x => x.logNo === no); if (r) openP(r.url); }
        else if (act === 'saveKw') { const inp = root.querySelector(`[data-kw="${CSS.escape(no)}"]`); const list = inp.value.split(/[,，]/).map(s => s.trim()).filter(Boolean); if (list.length > 5) return BB.toast('키워드는 5개까지 넣을 수 있습니다'); if (list.some(s => s.length > 40)) return BB.toast('키워드 하나는 40자 이하로 입력하세요'); saveKw(no, list); }
        else if (act === 'autoKw') saveKw(no, []);
        return;
      }
      const tr = e.target.closest('tr.dt-r');
      if (tr && !e.target.closest('input,button,select,a')) { const no = tr.dataset.no; if (openRows.has(no)) openRows.delete(no); else openRows.add(no); paintRows(); }
    });
    root.addEventListener('input', e => { if (e.target.dataset.f === 'q') { pf.q = e.target.value; paintRows(); } });
    root.addEventListener('change', e => { const f = e.target.dataset.f; if (f === 'cat' || f === 'st') { pf[f] = e.target.value; paintRows(); } });
    root.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.kw) { e.preventDefault(); root.querySelector(`[data-act="saveKw"][data-no="${CSS.escape(e.target.dataset.kw)}"]`).click(); } });

    const onEv = ev => {
      if (!ctx.alive || !ev || !curAcc() || !ev.data || ev.data.blogId !== curAcc().blogId) return;
      if (ev.type === 'inslog') {
        logLines.push(ev.data.line); if (logLines.length > 300) logLines.shift();
        if (!busy) { busy = true; showLog = true; paintHead(); }
        const lg = $('log'); if (lg) { lg.textContent += (lg.textContent ? '\n' : '') + ev.data.line; lg.scrollTop = lg.scrollHeight; }
      } else if (ev.type === 'insdone') {
        busy = false;
        BB.toast(ev.data.ok ? '데이터를 모았습니다' : '일부를 모으지 못했습니다. 수집 기록을 확인하세요');
        load(true);
      }
    };
    const off = BB.onEvent(onEv);
    let rt = null;
    const onResize = () => { clearTimeout(rt); rt = setTimeout(() => { if (ctx.alive) { fitDx(); drawAll(); } }, 120); };
    window.addEventListener('resize', onResize);
    const tick = setInterval(() => { if (ctx.alive && D() && !busy) paintHead(); }, 60000);   // 상대 시간 갱신

    loadState().then(() => { if (!ctx.alive) return; if (DD && curAcc() && DD.blogId === curAcc().blogId) paint(); load(); }).catch(() => { if (ctx.alive) $('view').innerHTML = '<div class="empty">계정 목록을 불러오지 못했습니다.</div>'; });
    return () => { ctx.alive = false; off(); window.removeEventListener('resize', onResize); clearInterval(tick); clearTimeout(rt); };
  }

  // ── 데이터 설정 ──
  function pageInsightSettings(root) {
    const ctx = { alive: true };
    root.innerHTML = `<div class="page-h"><h1>데이터 설정</h1><div class="sub">대시보드가 쓰는 수집 방식과 API 키입니다. 키는 이 PC의 Windows 계정으로 암호화해 저장하고 화면에 다시 보이지 않습니다.</div></div>
      <div data-r="body"><div class="empty">불러오는 중</div></div>`;
    const body = root.querySelector('[data-r="body"]');
    let F = null, C = null;
    const GROUPS = [
      ['search_', '블로그 검색 API', 'Search API', '글별 검색 노출·순위(관련도 100위 안)를 공식 API로 확인합니다. NAVER API HUB(ID·Key) 또는 예전 개발자센터(Client ID·Secret) 중 한 쌍이면 됩니다.'],
      ['searchad_', '검색광고 API', 'Search Ad API', '키워드 월 검색량·경쟁도·연관 키워드(다음 글 키워드 후보)를 가져옵니다. 네이버 검색광고 → 도구 → API 사용 관리에서 발급합니다.'],
    ];
    function secretRow(f) {
      return `<div class="field"><label for="is-${esc(f.key)}">${esc(f.label)}</label>
        <div class="row"><input class="inp grow mono" type="password" id="is-${esc(f.key)}" data-sec="${esc(f.key)}" autocomplete="new-password" spellcheck="false" placeholder="${f.hasValue ? '저장됨 (바꾸려면 새 값 입력)' : '값 입력'}">
          ${f.hasValue ? `<button type="button" class="btn danger" data-act="clear" data-k="${esc(f.key)}">지우기</button>` : ''}</div>
        <div class="hint">${f.hasValue ? '<span class="ok">저장됨</span>' : '<span class="dim">없음</span>'}${f.hint ? ' · ' + esc(f.hint) : ''}</div></div>`;
    }
    function paint() {
      if (!ctx.alive || !F) return;
      const a = curAcc(), flags = F.fields.filter(f => !f.secret), en = F.enabled || {};
      const g = (C && C.goals) || {}, ad = (C && C.adpost) || {};
      body.innerHTML = `
        <div class="panel"><div class="panel-h"><b>수집 방식</b><span class="sub">모든 계정에 같이 적용</span></div>
          <form class="form" data-form="flags" autocomplete="off">
            ${flags.map(f => f.type === 'bool'
              ? `<div class="field"><label class="row is-chk"><input type="checkbox" data-flag="${esc(f.key)}"${f.value ? ' checked' : ''}> ${esc(f.label)}</label>${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`
              : `<div class="field"><label for="is-${esc(f.key)}">${esc(f.label)}</label><input class="inp is-num mono" type="number" min="1" max="200" id="is-${esc(f.key)}" data-flag="${esc(f.key)}" value="${esc(f.value ?? f.default ?? '')}">${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`).join('')}
            <div class="row"><button type="submit" class="btn pri">저장</button></div>
          </form></div>
        ${GROUPS.map(([pre, title, en2, desc]) => {
          const fs = F.fields.filter(f => f.secret && f.key.startsWith(pre) && !(pre === 'search_' && f.key.startsWith('searchad_')));
          const on = pre === 'search_' ? en.exposure : en.keywords;
          return `<div class="panel"><div class="panel-h"><b>${esc(title)}</b><span class="sub">${on ? '<span class="ok">사용 중</span>' : '<span class="dim">키 없음</span>'}</span></div>
            <form class="form" data-form="sec" autocomplete="off"><p class="d-cap is-desc">${esc(desc)}</p>${fs.map(secretRow).join('')}<div class="row"><button type="submit" class="btn pri">저장</button></div></form></div>`;
        }).join('')}
        ${a ? `<div class="panel"><div class="panel-h"><b>목표 · 애드포스트 기준</b><span class="sub">${esc(a.name)} · <span class="mono">${esc(a.blogId)}</span></span></div>
          <form class="form" data-form="cfg" autocomplete="off">
            <div class="row is-grid">
              <div class="field"><label for="is-g1">30일 목표 글 수</label><input class="inp mono" type="number" min="1" max="90" id="is-g1" name="postsPer30" value="${esc(g.postsPer30 ?? '')}" placeholder="20"></div>
              <div class="field"><label for="is-a1">운영 기간 기준(일)</label><input class="inp mono" type="number" min="1" id="is-a1" name="minDays" value="${esc(ad.minDays ?? '')}" placeholder="90"></div>
              <div class="field"><label for="is-a2">게시글 기준(개)</label><input class="inp mono" type="number" min="1" id="is-a2" name="minPosts" value="${esc(ad.minPosts ?? '')}" placeholder="50"></div>
              <div class="field"><label for="is-a3">일 방문자 기준(명)</label><input class="inp mono" type="number" min="1" id="is-a3" name="minDailyVisitors" value="${esc(ad.minDailyVisitors ?? '')}" placeholder="100"></div>
            </div>
            <p class="d-cap is-desc">비우면 기본값(회색 글자)을 씁니다. 네이버는 애드포스트 승인 숫자 기준을 공개하지 않아 90일·50글·일 100명은 참고 기준입니다.</p>
            <div class="field"><label for="is-extra">추가로 지켜볼 키워드</label><textarea class="inp" id="is-extra" name="extra" rows="4" placeholder="한 줄에 하나 (최대 100개)">${esc(((C && C.extraKeywords) || []).join('\n'))}</textarea>
              <div class="hint">아직 글이 없어도 순위·검색량을 같이 확인합니다. 글별 타깃 키워드는 대시보드 → 글별 성과에서 행을 눌러 바꿉니다.</div></div>
            <div class="row"><button type="submit" class="btn pri">저장</button></div>
          </form></div>` : ''}
        <div class="panel"><div class="panel-h"><b>자동 수집</b></div>
          <dl class="kv"><dt>상태</dt><dd>${F.sched ? `<span class="ok">켜짐</span> · 앱이 켜져 있는 동안 ${F.tickMin}분마다 확인` : '<span class="dim">꺼짐</span>'}</dd>
            ${F.sched && F.nextTickAt ? `<dt>다음 확인</dt><dd class="mono">${esc(fmtDT(F.nextTickAt))}</dd>` : ''}
            <dt>간격</dt><dd>블로그 공개 정보·검색 노출 20시간 · 주인 통계 22시간 · 검색량 7일 · 실패하면 3시간 뒤 다시</dd>
            <dt>순서</dt><dd>계정을 하나씩 차례로 모읍니다. 블로그 발행 중인 계정은 주인 통계를 건너뜁니다.</dd>
            <dt>지금 켜진 항목</dt><dd class="is-kinds">${Object.keys(KIND_TXT).map(k => `<span class="st ${en[k] ? 'ok' : 'none'}">${esc(KIND_TXT[k])}${en[k] ? '' : ' · 꺼짐'}</span>`).join('')}</dd></dl></div>`;
    }
    async function load() {
      try {
        await loadState();
        const a = curAcc();
        const [f, c] = await Promise.all([BB.api('/api/insight/settings'), a ? BB.api('/api/insight/config?blogId=' + encodeURIComponent(a.blogId)) : Promise.resolve(null)]);
        if (!ctx.alive) return;
        F = f; C = c && c.config; paint();
      } catch (e) { if (ctx.alive) body.innerHTML = '<div class="empty">설정을 불러오지 못했습니다.</div>'; }
    }
    root.addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target, kind = f.dataset.form;
      try {
        if (kind === 'flags') {
          const values = {};
          f.querySelectorAll('[data-flag]').forEach(i => { values[i.dataset.flag] = i.type === 'checkbox' ? i.checked : i.value; });
          await BB.api('/api/insight/settings', { values });
          BB.toast('수집 방식을 저장했습니다');
        } else if (kind === 'sec') {
          const values = {};
          f.querySelectorAll('[data-sec]').forEach(i => { if (i.value.trim()) values[i.dataset.sec] = i.value.trim(); });
          if (!Object.keys(values).length) return BB.toast('바꿀 값을 입력하세요');
          await BB.api('/api/insight/settings', { values });
          BB.toast('키를 저장했습니다');
        } else if (kind === 'cfg') {
          const a = curAcc(); if (!a) return;
          const el = f.elements;
          await BB.api('/api/insight/config', {
            blogId: a.blogId, goals: { postsPer30: el.postsPer30.value }, adpost: { minDays: el.minDays.value, minPosts: el.minPosts.value, minDailyVisitors: el.minDailyVisitors.value },
            extraKeywords: el.extra.value.split('\n').map(s => s.trim()).filter(Boolean),
          });
          BB.toast('목표와 키워드를 저장했습니다');
        }
        load();
      } catch (err) { }
    });
    root.addEventListener('click', async e => {
      const t = e.target.closest('[data-act="clear"]');
      if (!t) return;
      if (!(await BB.confirm('저장한 값을 지울까요?'))) return;
      try { await BB.api('/api/insight/settings', { clear: [t.dataset.k] }); BB.toast('지웠습니다'); load(); } catch (err) { }
    });
    load();
    return () => { ctx.alive = false; };
  }

  // ── 블로그 분석: 링크만 넣으면 공개 정보로 지표 계산 (로그인 없이 손님으로 조회) ──
  function pageAnalyze(root) {
    const ctx = { alive: true };
    root.classList.add('dash');
    const PAGE_STEPS = [1, 2, 3, 5, 10, 20];      // 1쪽 = 최근 글 30편
    let R = null, mine = false, list = [], job = null, shown = 5, charts = [], cmp = null;
    const params = (BB.params || []).filter(Boolean);
    root.innerHTML = `
      <div class="page-h"><h1>블로그 분석</h1>
        <div class="sub">블로그 주소나 아이디만 넣으면 공개된 정보로 분석합니다. 네이버 로그인 없이 손님으로 읽기 때문에 내 계정과 엮이지 않습니다.</div></div>
      <form class="ana-form" data-r="form" autocomplete="off">
        <input class="inp" name="url" maxlength="300" placeholder="예: blog.naver.com/아이디  또는  https://blog.naver.com/아이디/글번호" required>
        <button type="submit" class="btn pri" data-r="go">분석</button>
      </form>
      <div data-r="job"></div>
      <div data-r="body"></div>
      <div class="panel" data-r="list"></div>`;
    const $ = r => root.querySelector(`[data-r="${r}"]`);
    const chart = (id, fn) => { charts.push([id, fn]); return `<div class="ch" data-ch="${esc(id)}"></div>`; };
    const drawAll = () => { for (const [id, fn] of charts) { const el = root.querySelector(`[data-ch="${CSS.escape(id)}"]`); if (el) try { fn(el); } catch (e) { console.error(e); } } };
    const postUrl = (id, no) => `https://blog.naver.com/${encodeURIComponent(id)}/${encodeURIComponent(no)}`;
    const tile = (i, en, label, v, unit, sub) => `<div class="kpi${v == null ? ' na' : ''}"><div class="kpi-l"><span>${pad(i)}</span>${esc(en)}</div>
      <div class="kpi-v">${v == null ? '—' : esc(typeof v === 'number' ? nf(v, unit === '편/주' || unit === '개' ? 1 : 0) : v)}${v != null && unit ? `<small>${esc(unit)}</small>` : ''}</div>
      <div class="kpi-k">${esc(label)}</div>${sub ? `<span class="kpi-d none">${esc(sub)}</span>` : ''}</div>`;

    function paintJob() {
      const box = $('job');
      if (!job) { box.innerHTML = ''; return; }
      box.innerHTML = `<div class="panel"><div class="panel-h"><b>${job.done ? (job.error ? '분석 실패' : '분석 완료') : '분석하는 중'} · ${esc(job.blogId)}</b>
        <span class="sub">${job.done ? '' : '사람이 읽는 속도로 천천히 가져옵니다(요청 사이 2초 이상)'}</span></div>
        ${job.error ? `<div class="bad">${esc(job.error)}</div>` : ''}<div class="log" style="height:120px">${esc((job.lines || []).join('\n'))}</div></div>`;
      const lg = box.querySelector('.log'); if (lg) lg.scrollTop = lg.scrollHeight;
      $('go').disabled = !!(job && !job.done);
    }

    function paintList() {
      const box = $('list');
      box.innerHTML = `<div class="panel-h"><b>분석한 블로그 ${list.length}곳</b><span class="sub">결과는 이 PC에만 저장됩니다</span></div>
        ${list.length ? `<table class="tbl"><thead><tr><th>블로그</th><th class="num">전체 글</th><th class="num">이웃</th><th class="num">최근 30일</th><th>조회한 때</th><th></th></tr></thead><tbody>
        ${list.map(x => `<tr class="click" data-open="${esc(x.blogId)}"><td>${esc(x.blogName || x.blogId)}<div class="muted mono">${esc(x.blogId)}</div></td>
          <td class="num">${nf(x.totalPosts)}</td><td class="num">${nf(x.subscribers)}</td><td class="num">${x.last30 == null ? '—' : nf(x.last30) + '편'}</td>
          <td class="mono">${esc(relT(x.fetchedAt))}</td><td class="num"><button type="button" class="btn sm danger" data-del="${esc(x.blogId)}">지우기</button></td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">아직 분석한 블로그가 없습니다. 위에 주소를 넣어 보세요.</div>'}`;
    }

    function postsTable() {
      const rows = R.recent.slice(0, shown);
      const more = shown < R.recent.length || !R.analyzed.covered;
      const met = R.analyzed.metrics;
      return `<section class="dsec">${eb(1, 'Recent')}<h2>최근 글</h2>
        <div class="d-sub">최근 ${rows.length}편${R.analyzed.covered ? '' : ` · 전체 ${nf(R.profile.totalPosts)}편 중 ${nf(R.analyzed.posts)}편까지 가져옴`}</div>
        <table class="tbl dt"><thead><tr><th>발행</th><th>제목</th><th>카테고리</th>${met ? '<th class="num">공감</th><th class="num">댓글</th><th class="num">사진</th>' : ''}</tr></thead><tbody>
        ${rows.map(p => `<tr><td class="dt-d"><div class="mono">${esc(p.at ? fmtAt(p.at) : p.date)}</div><div class="dim">${esc(relT(p.at || Date.parse(p.date + 'T00:00:00+09:00')))}</div></td>
          <td class="dt-t"><a class="link" href="${esc(postUrl(R.blogId, p.logNo))}" target="_blank" rel="noopener">${esc(p.title || '(제목 없음)')}</a>${p.searchYn ? '' : ' <span class="st warn">검색 비허용</span>'}</td>
          <td class="dt-k">${esc(p.category || '')}</td>${met ? `<td class="num">${nf(p.sympathy)}</td><td class="num">${nf(p.comments)}</td><td class="num">${nf(p.images)}</td>` : ''}</tr>`).join('')}
        </tbody></table>
        ${more ? `<div class="row" style="margin-top:14px;justify-content:center"><button type="button" class="btn" data-act="more">추가 조회 +5</button>
          <button type="button" class="btn" data-act="more" data-n="20">+20</button></div>` : ''}</section>`;
    }

    function cmpHtml() {
      const accs = (S && S.accounts) || [];
      if (mine || !accs.length) return '';
      const rows = c => [
        ['전체 글', r => r.profile.totalPosts, '편'], ['이웃', r => r.profile.subscribers, '명'], ['누적 방문자', r => r.profile.totalVisitors, '명'],
        ['글당 방문자', r => r.profile.visitorsPerPost, '명'], ['최근 30일 발행', r => r.activity.last30, '편'], ['주당 발행(90일)', r => r.activity.perWeek90, '편'],
        ['평균 공감(최근 30편)', r => r.engagement && r.engagement.avgSympathy30, '개'], ['평균 댓글(최근 30편)', r => r.engagement && r.engagement.avgComments30, '개'],
        ['평균 사진 수', r => r.content.avgImages, '장'], ['평균 제목 길이', r => r.content.avgTitleLen, '자'],
      ].map(([k, f, u]) => { const a = f(R), b = c ? f(c) : null; return `<tr><td>${esc(k)}</td><td class="num">${a == null ? '—' : nf(a, 1) + u}</td><td class="num">${b == null ? '—' : nf(b, 1) + u}</td>
        <td class="num">${a != null && b != null ? (b - a > 0 ? '<span class="ok">+' : b - a < 0 ? '<span class="bad">' : '<span class="muted">') + nf(b - a, 1) + '</span>' : ''}</td></tr>`; }).join('');
      return `<section class="dsec">${eb(6, 'Compare')}<h2>내 블로그와 비교</h2>
        <div class="row"><select class="inp" data-r="cmpSel" style="max-width:320px"><option value="">비교할 내 블로그 고르기</option>${accs.map(a => `<option value="${esc(a.blogId)}"${cmp && cmp.blogId === a.blogId ? ' selected' : ''}>${esc(a.name || a.blogId)}</option>`).join('')}</select></div>
        ${cmp ? `<table class="tbl" style="margin-top:14px"><thead><tr><th>지표</th><th class="num">${esc(R.profile.blogName || R.blogId)}</th><th class="num">${esc(cmp.profile.blogName || cmp.blogId)} (내 블로그)</th><th class="num">차이</th></tr></thead><tbody>${rows(cmp)}</tbody></table>` : ''}</section>`;
    }

    function paint() {
      charts = [];
      const box = $('body');
      if (!R) { box.innerHTML = ''; return; }
      const p = R.profile, a = R.activity, e = R.engagement, c = R.content;
      const badges = [p.powerBlog && '파워블로그', p.influencer && '인플루언서', p.directory].filter(Boolean);
      const months = a.months || [];
      box.innerHTML = `
        <section class="dsec first">
          <div class="dash-h"><div><h2 style="font-size:28px;margin:0">${esc(p.blogName || R.blogId)}</h2>
            <div class="sub"><span class="mono">blog.naver.com/${esc(R.blogId)}</span>${p.nickName ? ' · ' + esc(p.nickName) : ''}${badges.length ? ' · ' + badges.map(esc).join(' · ') : ''} · 조회 ${esc(fmtAt(R.fetchedAt))}</div></div>
            <div class="row"><a class="btn" href="https://blog.naver.com/${esc(encodeURIComponent(R.blogId))}" target="_blank" rel="noopener">블로그 열기</a>
              <button type="button" class="btn" data-act="refresh">다시 조회</button></div></div>
          <div class="kpis" style="margin-top:18px">
            ${tile(1, 'Posts', '전체 글', p.totalPosts, '편')}${tile(2, 'Neighbors', '이웃', p.subscribers, '명')}${tile(3, 'Visitors', '누적 방문자', p.totalVisitors, '명')}
            ${tile(4, 'Per post', '글당 방문자', p.visitorsPerPost, '명', '누적 방문자 ÷ 전체 글')}${tile(5, '30 days', '최근 30일 발행', a.last30, '편', R.analyzed.covered || R.analyzed.posts >= a.last30 + 1 ? '' : '가져온 글 기준')}
            ${tile(6, 'Last post', '마지막 글', a.lastPostAgo == null ? null : a.lastPostAgo === 0 ? '오늘' : a.lastPostAgo + '일 전', '')}
            ${tile(7, 'Weekly', '주당 발행(90일)', a.perWeek90, '편/주')}${tile(8, 'Gap', '평균 발행 간격', a.avgGapDays, '일', a.maxGapDays90 != null ? `90일 중 최장 ${a.maxGapDays90}일` : '')}
            ${tile(9, 'Likes', '평균 공감(최근 30편)', e ? e.avgSympathy30 : null, '개', e ? `중앙값 ${nf(e.medianSympathy30, 1)}` : '데이터 설정에서 꺼짐')}
            ${tile(10, 'Comments', '평균 댓글(최근 30편)', e ? e.avgComments30 : null, '개', e ? `반응 없는 글 ${e.noReaction30}편` : '')}
            ${tile(11, 'Images', '글당 사진', c.avgImages, '장', c.videoPosts ? `동영상 글 ${c.videoPosts}편` : '')}
            ${tile(12, 'Age', '블로그 운영', p.ageDays == null ? null : p.ageDays >= 365 ? Math.floor(p.ageDays / 365) + '년 ' + Math.floor(p.ageDays % 365 / 30) + '개월' : p.ageDays + '일', '', p.firstPostDate ? '첫 글 ' + p.firstPostDate : '전체 글을 가져오면 계산')}
          </div>
          ${R.signals.length ? `<ul class="dnotes" style="margin-top:14px">${R.signals.map(s => `<li>${esc(s.text)}</li>`).join('')}</ul>` : ''}
        </section>
        ${postsTable()}
        <section class="dsec">${eb(2, 'Rhythm')}<h2>발행 리듬</h2>
          <div class="dgrid c3">
            <div class="dcell"><div class="dcell-h"><b>월별 발행</b><span class="mono">최근 12개월</span></div>${chart('m', el => drawBars(el, { h: 170, pts: months.map((m, i) => ({ label: m.month.slice(2).replace('-', '.'), v: m.posts, on: i === months.length - 1, tip: `<div class="ch-td">${esc(m.month)}</div><div class="ch-tr"><i class="p"></i><span>발행</span><b>${m.posts}편</b></div>` })) }))}</div>
            <div class="dcell"><div class="dcell-h"><b>요일</b><span class="mono">최근 90일</span></div>${chart('w', el => drawBars(el, { h: 170, pts: a.weekday.map(x => ({ label: x.label, v: x.n, tip: `<div class="ch-tr"><i class="p"></i><span>${esc(x.label)}요일</span><b>${x.n}편</b></div>` })) }))}</div>
            <div class="dcell"><div class="dcell-h"><b>발행 시각</b><span class="mono">${a.timedPosts}편 기준</span></div>${a.timedPosts ? chart('h', el => drawBars(el, { h: 170, pts: a.hour.map(x => ({ label: x.label, v: x.n, tip: `<div class="ch-tr"><i class="p"></i><span>${esc(x.label)}시</span><b>${x.n}편</b></div>` })) })) : '<div class="ch-empty">발행 시각 정보가 없습니다</div>'}</div>
          </div></section>
        ${e && e.top.length ? `<section class="dsec">${eb(3, 'Top')}<h2>반응 많은 글</h2><div class="d-sub">가져온 ${nf(R.analyzed.posts)}편 중 공감+댓글 순</div>
          <table class="tbl"><thead><tr><th>제목</th><th>발행일</th><th class="num">공감</th><th class="num">댓글</th><th class="num">사진</th></tr></thead><tbody>
          ${e.top.map(t => `<tr><td><a class="link" href="${esc(postUrl(R.blogId, t.logNo))}" target="_blank" rel="noopener">${esc(t.title)}</a><div class="muted">${esc(t.category || '')}</div></td><td class="mono">${esc(t.date)}</td><td class="num">${nf(t.sympathy)}</td><td class="num">${nf(t.comments)}</td><td class="num">${nf(t.images)}</td></tr>`).join('')}
          </tbody></table></section>` : ''}
        <section class="dsec">${eb(4, 'Topics')}<h2>카테고리 · 주제</h2>
          <div class="dgrid c2">
            <div class="dcell"><div class="dcell-h"><b>카테고리</b><span class="mono">${R.categories.length}개</span></div>
              <table class="tbl"><thead><tr><th>카테고리</th><th class="num">글</th><th class="num">최근 90일</th>${R.analyzed.metrics ? '<th class="num">평균 반응</th>' : ''}</tr></thead><tbody>
              ${R.categories.slice(0, 12).map(k => `<tr><td>${esc(k.name)}</td><td class="num">${nf(k.posts)}<span class="muted"> ${k.share}%</span></td><td class="num">${nf(k.recent90)}</td>${R.analyzed.metrics ? `<td class="num">${nf(k.avgEngagement, 1)}</td>` : ''}</tr>`).join('')}
              </tbody></table></div>
            <div class="dcell"><div class="dcell-h"><b>제목에 자주 쓴 말</b><span class="mono">평균 제목 ${nf(c.avgTitleLen)}자</span></div>
              ${c.titleWords.length ? `<div class="ana-words">${c.titleWords.map(w => `<span><b>${esc(w.word)}</b><i class="mono">${w.count}</i></span>`).join('')}</div>` : '<div class="ch-empty">반복되는 말이 없습니다</div>'}
              ${c.tags.length ? `<div class="dcell-h" style="margin-top:18px"><b>태그</b><span class="mono">RSS 최근 글</span></div><div class="ana-words">${c.tags.map(t => `<span>#${esc(t.tag)}<i class="mono">${t.count}</i></span>`).join('')}</div>` : ''}
            </div></div></section>
        ${cmpHtml()}
        <section class="dsec"><div class="d-cap">출처: ${R.sources.map(esc).join(' · ')}${R.errors.length ? ' · 일부 실패: ' + R.errors.map(x => esc(x.message)).join(' / ') : ''}. 숫자는 조회 시점의 공개 값이며, 방문자 수는 블로그가 방문자 표시를 숨기면 비어 있습니다.</div></section>`;
      drawAll();
    }

    async function loadList() { try { const r = await BB.api('/api/insight/analyze/list'); if (!ctx.alive) return; list = r.items || []; if (r.job && !r.job.done) { job = r.job; paintJob(); } paintList(); } catch (e) { } }
    async function open(id, keepShown) {
      try {
        const r = await BB.api('/api/insight/analyze/get?blogId=' + encodeURIComponent(id));
        if (!ctx.alive) return;
        R = r.report; mine = r.mine; if (!keepShown) shown = 5;
        if (cmp && cmp.blogId === R.blogId) cmp = null;
        if (location.hash !== '#/blog/analyze/' + id) history.replaceState(null, '', '#/blog/analyze/' + encodeURIComponent(id));
        paint();
      } catch (e) { }
    }
    async function start(url, opts = {}) {
      try {
        const r = await BB.api('/api/insight/analyze', { url, pages: opts.pages || 1, refresh: !!opts.refresh });
        if (r.cached) {
          if (opts.compareFor) { const g = await BB.api('/api/insight/analyze/get?blogId=' + encodeURIComponent(r.blogId)); cmp = g.report; paint(); }
          else await open(r.blogId, opts.keepShown);
          return;
        }
        job = { blogId: r.blogId, lines: [], done: false, keepShown: !!opts.keepShown, compareFor: opts.compareFor || null };
        paintJob();
      } catch (e) { }
    }
    function nextPages() { const cur = (R && R.pages) || 1; return PAGE_STEPS.find(n => n > cur) || null; }

    root.addEventListener('submit', e => { e.preventDefault(); const v = e.target.elements.url.value.trim(); if (v) start(v); });
    root.addEventListener('click', async e => {
      const t = e.target.closest('[data-act],[data-open],[data-del]');
      if (!t || !root.contains(t)) return;
      if (t.dataset.del) { e.stopPropagation(); if (!(await BB.confirm(`[${t.dataset.del}] 분석 결과를 지울까요?`))) return; await BB.api('/api/insight/analyze/delete', { blogId: t.dataset.del }); if (R && R.blogId === t.dataset.del) { R = null; paint(); } return loadList(); }
      if (t.dataset.open) return open(t.dataset.open);
      const act = t.dataset.act;
      if (act === 'refresh' && R) start(R.blogId, { refresh: true, pages: R.pages || 1 });
      else if (act === 'more' && R) {
        const add = +t.dataset.n || 5;
        if (shown + add <= R.recent.length) { shown += add; paint(); return; }
        shown += add;
        const np = nextPages();
        if (!R.analyzed.covered && np) {
          const want = PAGE_STEPS.find(n => n >= np && n * 30 >= shown) || PAGE_STEPS[PAGE_STEPS.length - 1];
          start(R.blogId, { pages: want, refresh: true, keepShown: true });
        } else paint();
      }
    });
    root.addEventListener('change', async e => {
      if (e.target.dataset.r !== 'cmpSel') return;
      const id = e.target.value;
      if (!id) { cmp = null; return paint(); }
      try { const r = await BB.api('/api/insight/analyze/get?blogId=' + encodeURIComponent(id)); cmp = r.report; paint(); }
      catch (err) {
        BB.toast('내 블로그를 먼저 조회합니다');
        start(id, { compareFor: R.blogId });
      }
    });
    const off = BB.onEvent ? BB.onEvent(ev => {
      if (!ctx.alive || !ev) return;
      if (ev.type === 'analog' && job && ev.data.blogId === job.blogId) { job.lines.push(ev.data.line); paintJob(); }
      else if (ev.type === 'anadone' && job && ev.data.blogId === job.blogId) {
        job.done = true; job.error = ev.data.error || null; paintJob(); loadList();
        if (!ev.data.ok) return;
        if (job.compareFor) { const back = job.compareFor; BB.api('/api/insight/analyze/get?blogId=' + encodeURIComponent(ev.data.blogId)).then(r => { cmp = r.report; return open(back, true); }).catch(() => { }); }
        else open(ev.data.blogId, job.keepShown);
      }
    }) : null;

    loadList().then(() => { if (params[0]) open(params[0]); });
    return () => { ctx.alive = false; if (typeof off === 'function') off(); };
  }

  const PAGES = { analyze: pageAnalyze, dash: pageDash, 'insight-settings': pageInsightSettings, write: pageWrite, posts: pagePosts, accounts: pageAccounts, history: pageHistory, neighbors: pageNeighbors, topics: pageTopics, settings: pageSettings };

  BB.mod('blog', {
    name: '네이버 블로그',
    desc: '네이버 블로그에 원고를 사람 타자 속도로 입력하고, 전수검사를 통과하면 발행합니다.',
    order: 1,
    ready: true,
    nav: [['dash', '대시보드'], ['analyze', '블로그 분석'], ['topics', '주제 조회'], ['write', '원고 만들기'], ['posts', '원고·발행'], ['accounts', '블로그 계정'], ['history', '발행 기록'], ['neighbors', '이웃 후보'], ['settings', '입력 설정'], ['insight-settings', '데이터 설정']],
    sideTop,
    render,
  });
})();
