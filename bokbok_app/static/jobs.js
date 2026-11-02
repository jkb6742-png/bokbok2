/* bokbok v2 - 작업 현황 (#/jobs) + 떠 있는 미니 현황판 + 항상 위 미니창(Document Picture-in-Picture)
   큐: 블로그 입력·발행 / GPT 원고 만들기 / 채널 발행을 등록해 두면 서버가 차례로 돌린다. 여기서는 보기·순서·취소·일시정지. */
(function () {
  'use strict';
  var BB = window.BB = window.BB || {};
  var esc = function (s) { return BB.esc ? BB.esc(s) : String(s == null ? '' : s); };
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var hm = function (t) { var d = new Date(t); return isNaN(d) ? '' : pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  var dur = function (a, b) { if (!a) return ''; var s = Math.max(0, Math.round(((b || Date.now()) - a) / 1000)); return s < 60 ? s + '초' : s < 3600 ? Math.floor(s / 60) + '분 ' + pad(s % 60) + '초' : Math.floor(s / 3600) + '시간 ' + Math.floor(s % 3600 / 60) + '분'; };
  var KIND = { publish: ['블로그 발행', 'BLOG'], generate: ['GPT 원고', 'GPT'], channel: ['채널 발행', 'SNS'] };
  var ST = { queued: ['대기', 'none'], running: ['진행 중', 'info'], done: ['완료', 'ok'], failed: ['실패', 'bad'], cancelled: ['취소', 'warn'] };
  var MODE = { test: '시험', check: '검사만', publish: '발행' };

  var Qd = { items: [], summary: { queued: 0, running: 0, done: 0, failed: 0 }, state: {}, logs: {} };   // logs: lane -> [줄]
  var subs = [];
  function notify() { subs.slice().forEach(function (f) { try { f(); } catch (e) { console.error(e); } }); }
  async function refresh() {
    if (!BB.user) return;
    try { var r = await fetch('/api/queue', { credentials: 'same-origin' }); if (!r.ok) return; var j = await r.json(); Qd.items = j.items || []; Qd.summary = j.summary || Qd.summary; Qd.state = j.state || {}; notify(); } catch (e) { }
  }
  function pushLog(lane, line) { var a = Qd.logs[lane] = Qd.logs[lane] || []; a.push(String(line)); if (a.length > 12) a.shift(); }
  // 서버 이벤트
  if (BB.onEvent) BB.onEvent(function (ev) {
    if (!ev) return;
    var t = ev.type, d = ev.data;
    if (t === 'queue') { if (d && d.summary) Qd.summary = d.summary; if (d && d.running) d.running.forEach(function (r) { var it = Qd.items.find(function (x) { return x.id === r.id; }); if (it) Object.assign(it, r); }); refresh(); }
    else if (t === 'queueitem') refresh();
    else if (t === 'log') pushLog('publish', d);
    else if (t === 'progress') pushLog('publish', '진행 ' + d);
    else if (t === 'genlog') pushLog('generate', d);
    else if (t === 'genstep') pushLog('generate', '단계: ' + (d && d.name));
    else if (t === 'chlog') pushLog('channel:' + (d && d.p), d && d.line !== undefined ? d.line : JSON.stringify(d));
    else return;
    notify();
  });
  window.addEventListener('bb-user', function () { refresh(); mountMini(); });

  function laneLabel(x) { return x.kind === 'channel' ? (x.p || '').toUpperCase() : KIND[x.kind] ? KIND[x.kind][1] : x.lane; }
  function itemLine(x, compact) {
    var st = ST[x.status] || [x.status, 'none'];
    var sub = x.status === 'running' ? (x.progress ? x.progress : '시작됨') + ' · ' + dur(x.startedAt)
      : x.status === 'queued' ? '대기' + (x.payload && x.payload.mode ? ' · ' + (MODE[x.payload.mode] || x.payload.mode) : '')
      : x.status === 'failed' ? (x.error || '실패') : x.status === 'done' ? '완료 ' + hm(x.finishedAt) + (x.startedAt ? ' · ' + dur(x.startedAt, x.finishedAt) : '') : '취소';
    return '<div class="mj-it ' + esc(x.status) + '"><span class="mj-k mono">' + esc(laneLabel(x)) + '</span><div class="mj-b"><b>' + esc(x.label) + '</b><span>' + esc(sub) + '</span>' +
      (x.status === 'running' && !compact && Qd.logs[x.lane] && Qd.logs[x.lane].length ? '<em class="mono">' + esc(Qd.logs[x.lane][Qd.logs[x.lane].length - 1]) + '</em>' : '') + '</div><span class="st ' + st[1] + '">' + esc(st[0]) + '</span></div>';
  }
  // 미니 현황판·미니창 공용 내용
  function miniHtml(compact) {
    var run = Qd.items.filter(function (x) { return x.status === 'running'; });
    var que = Qd.items.filter(function (x) { return x.status === 'queued'; });
    var recent = Qd.items.filter(function (x) { return x.status === 'done' || x.status === 'failed' || x.status === 'cancelled'; }).slice(-3).reverse();
    var s = Qd.summary;
    return '<div class="mj-sum' + (s.paused ? ' paused' : '') + '"><b>' + run.length + '</b>진행 <b>' + que.length + '</b>대기' + (s.paused ? ' <span class="st warn">일시정지</span>' : '') + '</div>' +
      (run.length ? run.map(function (x) { return itemLine(x, compact); }).join('') : '<div class="mj-empty">진행 중인 작업 없음</div>') +
      (que.length ? '<div class="mj-h">다음</div>' + que.slice(0, compact ? 3 : 6).map(function (x) { return itemLine(x, true); }).join('') + (que.length > (compact ? 3 : 6) ? '<div class="mj-more">외 ' + (que.length - (compact ? 3 : 6)) + '건</div>' : '') : '') +
      (!compact && recent.length ? '<div class="mj-h">최근</div>' + recent.map(function (x) { return itemLine(x, true); }).join('') : '');
  }

  /* ── 떠 있는 미니 현황판 (모든 화면 오른쪽 아래) ── */
  var mini = null, open = false, wasRunning = false;
  // 자동 동작 설정: 작업이 시작되면 현황판 펼치기(기본 켬) · 내가 작업을 등록/실행할 때 항상 위 미니창 띄우기(기본 켬)
  //   미니창(Document PiP)은 브라우저 규칙상 사용자가 누른 직후에만 열 수 있어서, 예약(매일 자동)으로 시작되는 작업은 이미 열려 있는 미니창만 갱신된다.
  var lsGet = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
  var lsSet = function (k, v) { try { localStorage.setItem(k, v); } catch (e) { } };
  var OPT = { autoOpen: lsGet('bb.mini.autoOpen') !== '0', autoPip: lsGet('bb.mini.autoPip') !== '0' };
  open = lsGet('bb.mini.open') === '1';
  function mountMini() {
    if (!BB.user) { if (mini) { mini.remove(); mini = null; } return; }
    if (mini) return;
    mini = document.createElement('div'); mini.id = 'minijobs'; mini.className = 'mj' + (open ? ' open' : '');
    document.body.appendChild(mini);
    mini.addEventListener('click', function (e) {
      var t = e.target.closest('[data-mj]'); if (!t) return;
      var a = t.dataset.mj;
      if (a === 'toggle') { open = !open; mini.classList.toggle('open', open); try { localStorage.setItem('bb.mini.open', open ? '1' : '0'); } catch (er) { } }
      else if (a === 'page') BB.go('#/jobs');
      else if (a === 'pip') openPip();
    });
    mini.addEventListener('change', function (e) {
      var t = e.target; if (!t || !t.dataset || !t.dataset.mjopt) return;
      OPT[t.dataset.mjopt] = !!t.checked; lsSet('bb.mini.' + t.dataset.mjopt, t.checked ? '1' : '0');
      BB.toast(t.dataset.mjopt === 'autoPip' ? (t.checked ? '작업을 실행·등록하면 미니창을 띄웁니다' : '미니창 자동 띄우기를 껐습니다') : (t.checked ? '작업이 시작되면 현황판을 펼칩니다' : '현황판 자동 펼치기를 껐습니다'));
    });
    paintMini(); subs.push(paintMini);
    setInterval(function () { if (Qd.items.some(function (x) { return x.status === 'running'; })) paintMini(); }, 1000);
  }
  function paintMini() {
    if (!mini) return;
    var s = Qd.summary, run = s.running || 0, que = s.queued || 0;
    // 작업이 새로 시작되면(0 → 1 이상) 현황판을 자동으로 펼친다
    if (OPT.autoOpen && run && !wasRunning && !open) { open = true; lsSet('bb.mini.open', '1'); }
    wasRunning = !!run;
    mini.classList.toggle('open', open);
    mini.classList.toggle('idle', !run && !que);
    mini.innerHTML = '<button type="button" class="mj-pill" data-mj="toggle" title="작업 현황 펼치기/접기"><i class="dot' + (run ? ' on' : '') + '"></i><span>작업</span><b>' + run + '</b><span>진행</span><b>' + que + '</b><span>대기</span><em>' + (open ? '▾' : '▴') + '</em></button>' +
      '<div class="mj-body">' + miniHtml(true) + '<div class="mj-foot"><button type="button" class="link" data-mj="page">현황판 열기</button><button type="button" class="link" data-mj="pip">미니창 띄우기</button></div>' +
      '<div class="mj-opts"><label><input type="checkbox" data-mjopt="autoOpen"' + (OPT.autoOpen ? ' checked' : '') + '> 작업 시작되면 펼치기</label><label><input type="checkbox" data-mjopt="autoPip"' + (OPT.autoPip ? ' checked' : '') + '> 실행·등록하면 미니창 띄우기</label></div></div>';
    if (pipWin && !pipWin.closed) paintPip();
  }

  /* ── 항상 위에 떠 있는 미니창 (Document PiP, 크로미움) ── */
  var pipWin = null;
  async function openPip() {
    if (pipWin && !pipWin.closed) { pipWin.focus(); return; }
    if (!('documentPictureInPicture' in window)) {
      pipWin = window.open(location.origin + '/#/jobs', 'bokbok-jobs', 'popup,width=480,height=420');
      if (!pipWin) BB.toast('팝업이 막혀 있습니다. 브라우저에서 팝업을 허용해 주세요');
      return;
    }
    try {
      pipWin = await window.documentPictureInPicture.requestWindow({ width: 400, height: 300 });
    } catch (e) { BB.toast('미니창을 열지 못했습니다: ' + e.message); return; }
    var d = pipWin.document;
    d.documentElement.setAttribute('data-theme', document.documentElement.getAttribute('data-theme') || 'dark');
    d.documentElement.setAttribute('data-scale', 'm');
    Array.prototype.forEach.call(document.querySelectorAll('link[rel="stylesheet"],style'), function (n) { d.head.appendChild(n.cloneNode(true)); });
    var st = d.createElement('style'); st.textContent = 'body{margin:0;padding:12px 14px;background:var(--canvas);color:var(--text);font:13px/1.5 var(--font);overflow:auto}.mj-pipwrap{display:flex;flex-direction:column;gap:6px}.mj-pip-h{display:flex;align-items:center;justify-content:space-between;font:500 10.5px/1 var(--mono);letter-spacing:.14em;color:var(--text3);margin-bottom:6px}.mj-pip-h a{color:var(--link);text-decoration:none;font:inherit;cursor:pointer}'; d.head.appendChild(st);
    d.title = 'bokbok 작업 현황';
    d.body.innerHTML = '<div class="mj-pip-h"><span>BOKBOK / JOBS</span><a data-pip="page">현황판</a></div><div class="mj-pipwrap" id="pipbody"></div>';
    d.body.addEventListener('click', function (e) { var t = e.target.closest('[data-pip]'); if (t) { window.focus(); BB.go('#/jobs'); } });
    pipWin.addEventListener('pagehide', function () { pipWin = null; });
    paintPip();
  }
  function paintPip() {
    if (!pipWin || pipWin.closed) return;
    var b = pipWin.document.getElementById('pipbody'); if (b) b.innerHTML = miniHtml(true);
    pipWin.document.documentElement.setAttribute('data-theme', document.documentElement.getAttribute('data-theme') || 'dark');
  }
  // 사용자가 누른 직후(실행·큐 등록)에 호출하면 설정에 따라 미니창을 띄운다. 이미 떠 있으면 그대로.
  function autoPip() { if (OPT.autoPip) { try { openPip(); } catch (e) { } } }
  BB.jobs = { refresh: refresh, openPip: openPip, autoPip: autoPip, add: function (body) { autoPip(); return BB.api('/api/queue/add', body).then(function (r) { refresh(); BB.toast('작업을 등록했습니다 · 대기 ' + (r.summary ? r.summary.queued : '') + '건'); return r; }); } };

  /* ── 현황판 화면 ── */
  BB.page('jobs', {
    title: '작업 현황',
    render: function (el) {
      var alive = true, filter = 'all';
      el.innerHTML = '<div class="page-h"><h1>작업 현황</h1><div class="sub">블로그 발행 · GPT 원고 · 채널 발행 작업을 등록해 두면 종류별로 하나씩 차례로 돌립니다. 블로그 발행은 한 번에 한 계정만 입력합니다.</div></div>' +
        '<div data-r="sum"></div><div data-r="ctl"></div><div data-r="list"></div>';
      var $ = function (r) { return el.querySelector('[data-r="' + r + '"]'); };
      function paint() {
        if (!alive) return;
        var s = Qd.summary, items = Qd.items.slice();
        var today = new Date().toDateString();
        var doneToday = items.filter(function (x) { return x.status === 'done' && new Date(x.finishedAt).toDateString() === today; }).length;
        $('sum').innerHTML = '<div class="kpis jb-kpis">' +
          ['진행 중|' + (s.running || 0) + '|RUNNING', '대기|' + (s.queued || 0) + '|QUEUED', '오늘 완료|' + doneToday + '|DONE TODAY', '실패|' + (s.failed || 0) + '|FAILED'].map(function (t, i) { var p = t.split('|'); return '<div class="kpi"><div class="kpi-l"><span>' + pad(i + 1) + '</span>' + p[2] + '</div><div class="kpi-v">' + p[1] + '</div><div class="kpi-k">' + p[0] + '</div></div>'; }).join('') + '</div>';
        $('ctl').innerHTML = '<div class="row jb-ctl">' +
          '<button type="button" class="btn' + (Qd.state.paused ? ' pri' : '') + '" data-act="pause">' + (Qd.state.paused ? '재개' : '일시정지') + '</button>' +
          '<label class="row" style="align-items:center;gap:8px"><span class="muted">발행 사이 간격</span><input class="inp mono" type="number" min="0" max="600" style="width:84px;height:34px" data-r="gap" value="' + (Qd.state.gapMin || 0) + '"><span class="muted">분</span><button type="button" class="btn sm" data-act="gap">저장</button></label>' +
          '<div class="grow"></div>' +
          '<div class="seg" data-r="filter">' + [['all', '전체'], ['queued', '대기'], ['running', '진행'], ['done', '완료'], ['failed', '실패']].map(function (f) { return '<button type="button" data-f="' + f[0] + '"' + (filter === f[0] ? ' class="on"' : '') + '>' + f[1] + '</button>'; }).join('') + '</div>' +
          '<button type="button" class="btn" data-act="pip">미니창 띄우기</button><button type="button" class="btn" data-act="clear">끝난 작업 지우기</button></div>';
        var show = items.filter(function (x) { return filter === 'all' || x.status === filter; });
        var order = { running: 0, queued: 1, failed: 2, done: 3, cancelled: 4 };
        show.sort(function (a, b) { return (order[a.status] - order[b.status]) || (a.status === 'queued' ? a.createdAt - b.createdAt : (b.finishedAt || b.startedAt || b.createdAt) - (a.finishedAt || a.startedAt || a.createdAt)); });
        $('list').innerHTML = show.length ? '<table class="tbl jb"><thead><tr><th>종류</th><th>작업</th><th>상태</th><th>진행 · 최근 로그</th><th>등록</th><th>시작</th><th>걸린 시간</th><th></th></tr></thead><tbody>' +
          show.map(function (x) {
            var st = ST[x.status] || [x.status, 'none'];
            var lg = x.status === 'running' && Qd.logs[x.lane] ? Qd.logs[x.lane].slice(-3) : [];
            var detail = x.status === 'running' ? '<b>' + esc(x.progress || '시작됨') + '</b>' + (lg.length ? '<div class="jb-log mono">' + lg.map(esc).join('<br>') + '</div>' : '')
              : x.status === 'failed' ? '<span class="bad">' + esc(x.error || '') + '</span>'
              : x.status === 'done' && x.result && x.result.url ? '<a class="link" href="' + esc(x.result.url) + '" target="_blank" rel="noopener">' + esc(x.result.url) + '</a>'
              : x.status === 'done' && x.result && x.result.title ? esc(x.result.title) : x.status === 'done' && x.kind === 'publish' ? '전수검사 통과 · ' + esc(MODE[x.payload.mode] || '') : '';
            var acts = x.status === 'queued' ? '<button type="button" class="btn sm" data-act="up" data-id="' + x.id + '" title="먼저">↑</button><button type="button" class="btn sm" data-act="down" data-id="' + x.id + '" title="나중에">↓</button><button type="button" class="btn sm danger" data-act="rm" data-id="' + x.id + '">빼기</button>'
              : x.status === 'running' ? (x.kind === 'channel' ? '' : '<button type="button" class="btn sm danger" data-act="rm" data-id="' + x.id + '">중지</button>')
              : '<button type="button" class="btn sm" data-act="retry" data-id="' + x.id + '">다시</button><button type="button" class="btn sm" data-act="rm" data-id="' + x.id + '">지우기</button>';
            return '<tr class="' + esc(x.status) + '"><td><span class="mj-k mono">' + esc(laneLabel(x)) + '</span><div class="muted">' + esc(KIND[x.kind] ? KIND[x.kind][0] : x.kind) + '</div></td><td class="jb-l">' + esc(x.label) + (x.payload && x.payload.mode ? '<div class="muted">' + esc(MODE[x.payload.mode] || x.payload.mode) + '</div>' : '') + '</td>' +
              '<td><span class="st ' + st[1] + '">' + esc(st[0]) + '</span></td><td class="jb-d">' + detail + '</td><td class="mono">' + esc(hm(x.createdAt)) + '</td><td class="mono">' + esc(x.startedAt ? hm(x.startedAt) : '—') + '</td><td class="mono">' + esc(x.startedAt ? dur(x.startedAt, x.finishedAt) : '—') + '</td><td class="num"><div class="row" style="justify-content:flex-end">' + acts + '</div></td></tr>';
          }).join('') + '</tbody></table>' : '<div class="panel"><div class="empty">' + (filter === 'all' ? '등록된 작업이 없습니다. 원고·발행 화면의 [큐에 추가], 원고 만들기의 [예약 추가], 채널 화면의 [큐에 추가]로 등록합니다.' : '해당하는 작업이 없습니다.') + '</div></div>';
      }
      el.addEventListener('click', async function (e) {
        var f = e.target.closest('[data-f]'); if (f) { filter = f.dataset.f; paint(); return; }
        var t = e.target.closest('[data-act]'); if (!t) return;
        var act = t.dataset.act, id = t.dataset.id;
        try {
          if (act === 'pause') await BB.api('/api/queue/state', { paused: !Qd.state.paused });
          else if (act === 'gap') { await BB.api('/api/queue/state', { gapMin: +$('gap').value || 0 }); BB.toast('저장했습니다'); }
          else if (act === 'clear') await BB.api('/api/queue/clear', {});
          else if (act === 'pip') return openPip();
          else if (act === 'up') await BB.api('/api/queue/move', { id: id, dir: -1 });
          else if (act === 'down') await BB.api('/api/queue/move', { id: id, dir: 1 });
          else if (act === 'retry') await BB.api('/api/queue/retry', { id: id });
          else if (act === 'rm') {
            var it = Qd.items.find(function (x) { return x.id === id; });
            if (it && it.status === 'running' && !(await BB.confirm('[' + it.label + '] 진행 중인 작업을 중지할까요?', '중지'))) return;
            await BB.api('/api/queue/remove', { id: id });
          }
          await refresh();
        } catch (err) { }
      });
      subs.push(paint);
      var tm = setInterval(function () { if (Qd.items.some(function (x) { return x.status === 'running'; })) paint(); }, 1000);
      refresh().then(paint); paint();
      return function () { alive = false; clearInterval(tm); var i = subs.indexOf(paint); if (i >= 0) subs.splice(i, 1); };
    }
  });

  if (BB.user) { refresh(); mountMini(); }
})();
