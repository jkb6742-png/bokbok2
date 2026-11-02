/* bokbok v2 - 네트워크·테더링 화면 (#/net)
   신호등(초록/주황/빨강) · 공인 IP · 지역·통신사 · 어떤 선으로 나가는지 · 새 IP 받기(adb로 휴대폰 데이터 껐다 켜기) · 피할 지역 · IP 이력 */
(function () {
  'use strict';
  var BB = window.BB = window.BB || {};
  var esc = function (s) { return BB.esc ? BB.esc(s) : String(s == null ? '' : s); };
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var fmtAt = function (t) { var d = new Date(t); if (isNaN(d)) return ''; return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  var rel = function (t) { var s = (Date.now() - t) / 1000; if (s < 60) return '방금'; if (s < 3600) return Math.floor(s / 60) + '분 전'; if (s < 86400) return Math.floor(s / 3600) + '시간 전'; return Math.floor(s / 86400) + '일 전'; };
  var KIND = { usb: 'USB 테더링', hotspot: '휴대폰 핫스팟', wwan: '모바일 데이터', wifi: '와이파이', lan: '유선', none: '없음' };

  BB.page('net', {
    title: '네트워크',
    render: function (el) {
      var N = null, job = null, alive = true, busy = false, timer = null, mode = 'data', tries = null, pendingAvoid = null;
      el.innerHTML = '<div class="page-h"><h1>네트워크</h1><div class="sub">이 PC가 인터넷에 나가는 길과 공인 IP입니다. 블로그 발행 전에 초록불인지 확인하세요.</div></div>' +
        '<div data-r="top"></div><div data-r="job"></div><div class="net-grid" data-r="grid"></div><div class="panel" data-r="hist"></div>';
      var $ = function (r) { return el.querySelector('[data-r="' + r + '"]'); };

      // 설정 폼에서 체크 중인 제외 지역(저장 전) — 저장 전까지는 pendingAvoid, 없으면 서버 값
      function sel() { return pendingAvoid || (N && N.settings && N.settings.avoidRegions) || []; }
      function curTries() { if (tries) return tries; return (N && N.settings && (N.settings.avoidRegions || []).length) ? 5 : 1; }
      function paintTop() {
        var box = $('top');
        if (!N) { box.innerHTML = '<div class="panel"><div class="empty">확인하는 중</div></div>'; return; }
        var lt = N.light || { color: 'none', text: '확인 전', reason: '' }, g = N.geo, lk = N.link || {};
        var avoided = N.region && (N.settings.avoidRegions || []).indexOf(N.region.key) >= 0;
        box.innerHTML =
          '<div class="net-hero lt-' + esc(lt.color) + '">' +
            '<div class="net-light"><i class="dot"></i><div><b>' + esc(lt.text) + '</b><span>' + esc(lt.reason || '') + '</span></div></div>' +
            '<div class="net-ip"><div class="net-eb">PUBLIC IP</div><div class="net-ipv mono">' + esc(N.ip || '확인 실패') + '</div>' +
              '<div class="net-sub">' + (g ? esc((N.region && N.region.label) || '') + (g.org ? ' · ' + esc(g.org) : '') : '지역 정보 없음') +
              (N.prev ? ' · 이전 <span class="mono">' + esc(N.prev) + '</span>' : '') + (N.checkedAt ? ' · ' + esc(rel(N.checkedAt)) + ' 확인' : '') + '</div></div>' +
            '<div class="net-link"><div class="net-eb">LINK</div><div class="net-lk"><b>' + esc(lk.label || '연결 없음') + '</b>' +
              (lk.adapter ? '<span>' + esc(lk.adapter) + (lk.desc ? ' · ' + esc(lk.desc) : '') + '</span>' : '') +
              (lk.ifIp ? '<span class="mono">내부 ' + esc(lk.ifIp) + (lk.gateway ? ' → ' + esc(lk.gateway) : '') + '</span>' : '') + '</div></div>' +
            '<div class="net-act">' +
              '<button type="button" class="btn" data-act="refresh"' + (busy ? ' disabled' : '') + '>다시 확인</button>' +
              (N.region ? '<button type="button" class="btn' + (avoided ? ' on' : '') + '" data-act="avoid" title="이 지역 IP가 잡히면 주황불로 알리고, 새 IP 받기에서 자동으로 다시 받습니다">' + (avoided ? '이 지역 제외 해제' : '이 지역 제외') + '</button>' : '') +
              '<span class="net-excl">' + ((N.settings.avoidRegions || []).length ? '제외: <b>' + (N.settings.avoidRegions || []).map(function (k) { return esc(k.replace(/^KR\//, '')); }).join(', ') + '</b>' : '제외한 지역 없음 · 아래 설정에서 고르세요') + '</span>' +
              '<div class="net-roll">' +
                '<select class="inp" data-r="mode"><option value="data"' + (mode === 'data' ? ' selected' : '') + '>데이터 껐다 켜기 (핫스팟 유지)</option><option value="airplane"' + (mode === 'airplane' ? ' selected' : '') + '>비행기 모드 켰다 끄기</option></select>' +
                '<select class="inp" data-r="tries">' + [1, 3, 5, 8, 10].map(function (n) { return '<option value="' + n + '"' + (curTries() === n ? ' selected' : '') + '>' + (n === 1 ? '1번만' : '제외 지역이면 최대 ' + n + '번') + '</option>'; }).join('') + '</select>' +
                '<button type="button" class="btn pri" data-act="reroll"' + (busy || (job && !job.done) ? ' disabled' : '') + '>새 IP 받기</button>' +
              '</div></div>' +
          '</div>';
      }

      function paintJob() {
        var box = $('job');
        if (!job) { box.innerHTML = ''; return; }
        var r = job.result;
        box.innerHTML = '<div class="panel"><div class="panel-h"><b>' + (job.done ? (job.error ? '새 IP 받기 실패' : '새 IP 받기 완료') : '새 IP 받는 중') + '</b>' +
          '<span class="sub">' + (job.done ? '' : '휴대폰 데이터를 껐다 켜고 인터넷이 돌아오길 기다립니다 (보통 10~30초)') + '</span></div>' +
          (job.error ? '<div class="bad">' + esc(job.error) + '</div>' : '') +
          (r && r.ok ? '<div class="ok">새 IP ' + esc(r.ip) + (r.geo ? ' · ' + esc(N && N.region ? N.region.label : '') : '') + (r.avoided ? ' <span class="bad">(피하기로 한 지역입니다)</span>' : '') + '</div>' : '') +
          '<div class="log" style="height:140px">' + esc((job.lines || []).join('\n')) + '</div></div>';
        var lg = box.querySelector('.log'); if (lg) lg.scrollTop = lg.scrollHeight;
      }

      function paintGrid() {
        var box = $('grid');
        if (!N) { box.innerHTML = ''; return; }
        var a = N.adb || {}, st = N.settings || {};
        var devs = a.devices || [];
        var adbHtml = !a.available
          ? '<div class="net-note"><b>adb가 없습니다.</b> 새 IP 받기는 PC가 휴대폰에 "데이터 껐다 켜" 명령을 보내는 방식이라 안드로이드 adb가 필요합니다.' +
            '<ol><li>구글 "SDK Platform-Tools" 압축을 풀어 <span class="mono">C:\\platform-tools\\adb.exe</span> 에 둡니다 (또는 아래에 경로 입력).</li>' +
            '<li>휴대폰: 설정 → 휴대전화 정보 → 빌드번호 7번 → 개발자 옵션 → <b>USB 디버깅</b> 켬.</li>' +
            '<li>USB로 연결하고 휴대폰 화면의 "USB 디버깅 허용"을 누릅니다.</li></ol>' +
            '<div class="muted">adb 없이도 휴대폰에서 직접 비행기 모드를 켰다 끈 뒤 [다시 확인]을 누르면 됩니다.</div></div>'
          : '<div class="net-kv"><div><dt>adb</dt><dd class="mono">' + esc(a.path) + '</dd></div>' +
            '<div><dt>휴대폰</dt><dd>' + (devs.length ? devs.map(function (d) { return '<span class="st ' + (d.state === 'device' ? 'ok' : 'warn') + '">' + esc(d.model || d.serial) + ' · ' + esc(d.state === 'device' ? '연결됨' : d.state === 'unauthorized' ? '허용 필요' : d.state) + '</span>'; }).join(' ') : '<span class="st none">연결된 휴대폰 없음</span>') + '</dd></div>' +
            (a.error ? '<div><dt>오류</dt><dd class="bad">' + esc(a.error) + '</dd></div>' : '') + '</div>' +
            '<div class="hint">휴대폰이 "허용 필요"면 휴대폰 화면에서 USB 디버깅 허용을 누르세요. 아이폰은 adb가 없어 직접 비행기 모드를 쓰셔야 합니다.</div>';
        var avoid = st.avoidRegions || [];
        box.innerHTML =
          '<div class="panel"><div class="panel-h"><b>휴대폰 제어 (adb)</b></div>' + adbHtml + '</div>' +
          '<div class="panel"><div class="panel-h"><b>설정</b></div><form class="form" data-r="form" autocomplete="off">' +
            '<div class="field"><label for="net-hot">휴대폰 핫스팟 이름 (SSID)</label><input class="inp" id="net-hot" name="hotspotName" maxlength="64" value="' + esc(st.hotspotName || '') + '" placeholder="와이파이 테더링을 쓰면 적어 주세요">' +
              '<div class="hint">같은 이름의 와이파이에 붙어 있으면 테더링으로 판단합니다' + (N.link && N.link.ssid ? ' · 지금 와이파이: <b>' + esc(N.link.ssid) + '</b>' : '') + '</div></div>' +
            '<div class="field"><label for="net-adb">adb.exe 경로</label><input class="inp mono" id="net-adb" name="adbPath" maxlength="260" value="' + esc(st.adbPath || '') + '" placeholder="비우면 자동으로 찾습니다"></div>' +
            '<label class="row" style="align-items:center;cursor:pointer"><input type="checkbox" name="tetherOnly"' + (st.tetherOnly ? ' checked' : '') + '> <span>테더링이 아닌 선(유선·집 와이파이)으로 나가면 주황불</span></label>' +
            '<div class="field"><label>제외할 지역</label>' +
              '<div class="hint" style="margin-bottom:8px">체크한 지역의 IP가 잡히면 주황불이 켜지고, [새 IP 받기]가 그 지역을 벗어날 때까지 다시 받습니다. 지금 IP: <b>' + esc(N.region ? N.region.label : '—') + '</b></div>' +
              '<div class="reg-grid">' + (N.regions || []).map(function (r) { var on = sel().indexOf(r.key) >= 0, cur = N.region && N.region.key === r.key; return '<label class="reg' + (on ? ' on' : '') + (cur ? ' cur' : '') + '"><input type="checkbox" data-reg="' + esc(r.key) + '"' + (on ? ' checked' : '') + '><b>' + esc(r.label) + '</b>' + (cur ? '<i>지금</i>' : '') + '</label>'; }).join('') + '</div>' +
              '<div class="row" style="margin-top:8px;gap:6px;flex-wrap:wrap"><button type="button" class="btn sm" data-preset="KR/서울,KR/경기,KR/인천">수도권 제외</button><button type="button" class="btn sm" data-preset="__all_but_cur__">지금 지역만 남기고 전부 제외</button><button type="button" class="btn sm" data-preset="">모두 해제</button></div>' +
              (avoid.filter(function (k) { return !(N.regions || []).some(function (r) { return r.key === k; }); }).length ? '<div class="hint">그 밖의 제외: ' + avoid.filter(function (k) { return !(N.regions || []).some(function (r) { return r.key === k; }); }).map(function (k) { return esc(k) + ' <button type="button" class="link" data-unavoid="' + esc(k) + '">해제</button>'; }).join(' · ') + '</div>' : '') +
            '</div>' +
            '<div class="row"><button type="submit" class="btn pri">저장</button></div></form></div>';
      }

      function paintHist() {
        var box = $('hist');
        if (!N) { box.innerHTML = ''; return; }
        var h = N.history || [];
        box.innerHTML = '<div class="panel-h"><b>IP 이력</b><span class="sub">최근 ' + h.length + '건 · 이 PC에만 저장</span></div>' +
          (h.length ? '<table class="tbl"><thead><tr><th>IP</th><th>지역</th><th>통신사</th><th>연결</th><th>처음</th><th>마지막</th></tr></thead><tbody>' +
            h.map(function (x) { return '<tr' + (x.ip === N.ip ? ' class="cur"' : '') + '><td class="mono">' + esc(x.ip) + (x.ip === N.ip ? ' <span class="st ok">지금</span>' : '') + '</td><td>' + esc(x.label || x.region || '—') + (x.avoided ? ' <span class="st warn">피함</span>' : '') + '</td><td>' + esc(x.org || '—') + '</td><td>' + esc(KIND[x.link] || x.link || '—') + '</td><td class="mono">' + esc(fmtAt(x.at)) + '</td><td class="mono">' + esc(rel(x.lastSeen || x.at)) + '</td></tr>'; }).join('') +
            '</tbody></table>' : '<div class="empty">아직 기록이 없습니다.</div>');
      }
      function paintAll() { paintTop(); paintJob(); paintGrid(); paintHist(); }

      async function load(force) {
        busy = true; paintTop();
        try {
          var r = await fetch('/api/net' + (force ? '?refresh=1' : ''), { credentials: 'same-origin' });
          if (!alive) return;
          if (r.ok) { N = await r.json(); if (N.job && !N.job.done) job = N.job; }
        } catch (e) { }
        busy = false;
        if (alive) { paintAll(); if (BB.loadNet && force) BB.loadNet(false); }
      }

      el.addEventListener('click', async function (e) {
        var t = e.target.closest('[data-act],[data-unavoid],[data-preset]');
        if (!t) return;
        try {
          if (t.dataset.preset !== undefined) {
            var p = t.dataset.preset;
            var list = p === '__all_but_cur__' ? (N.regions || []).map(function (r) { return r.key; }).filter(function (k) { return !(N.region && N.region.key === k); }) : p ? p.split(',') : [];
            N = await BB.api('/api/net/settings', { avoidRegions: list }); pendingAvoid = null; paintAll(); BB.loadNet && BB.loadNet(false);
            BB.toast(list.length ? list.length + '개 지역을 제외했습니다' : '제외를 모두 해제했습니다'); return;
          }
          if (t.dataset.unavoid) { N = await BB.api('/api/net/avoid', { region: t.dataset.unavoid, on: false }); paintAll(); BB.loadNet && BB.loadNet(false); return; }
          var act = t.dataset.act;
          if (act === 'refresh') load(true);
          else if (act === 'avoid') {
            var on = (N.settings.avoidRegions || []).indexOf(N.region.key) < 0;
            N = await BB.api('/api/net/avoid', { region: N.region.key, on: on });
            paintAll(); BB.loadNet && BB.loadNet(false);
            pendingAvoid = null; BB.toast(on ? N.region.label + ' 지역을 제외했습니다' : '제외를 해제했습니다');
          } else if (act === 'reroll') {
            if (!N.adb || !N.adb.available) return BB.toast('adb가 없어 자동으로 받을 수 없습니다. 휴대폰에서 비행기 모드를 켰다 끈 뒤 [다시 확인]을 누르세요');
            if (pendingAvoid) return BB.toast('제외 지역을 바꿨으면 먼저 [저장]을 누르세요');
            var msg = mode === 'airplane' ? '휴대폰 비행기 모드를 켰다 끕니다. 통화 중이면 끊기고, 와이파이 핫스팟은 꺼질 수 있습니다. 계속할까요?' : '휴대폰 모바일 데이터를 4초간 껐다 켭니다. 그동안 인터넷이 잠시 끊깁니다. 계속할까요?';
            if (!(await BB.confirm(msg, '새 IP 받기'))) return;
            job = { mode: mode, lines: [], done: false }; paintJob(); paintTop();
            await BB.api('/api/net/reroll', { mode: mode, tries: curTries() });
          }
        } catch (err) { }
      });
      el.addEventListener('change', function (e) {
        if (e.target.dataset.r === 'mode') mode = e.target.value;
        else if (e.target.dataset.r === 'tries') tries = +e.target.value;
        else if (e.target.dataset.reg) {
          var set = sel().slice(), k = e.target.dataset.reg, i = set.indexOf(k);
          if (e.target.checked && i < 0) set.push(k); if (!e.target.checked && i >= 0) set.splice(i, 1);
          pendingAvoid = set; e.target.closest('.reg').classList.toggle('on', e.target.checked);
        }
      });
      el.addEventListener('submit', async function (e) {
        e.preventDefault();
        var f = e.target;
        try {
          var regs = Array.prototype.map.call(f.querySelectorAll('[data-reg]:checked'), function (c) { return c.dataset.reg; }).concat(((N.settings.avoidRegions || [])).filter(function (k) { return !(N.regions || []).some(function (r) { return r.key === k; }); }));
          N = await BB.api('/api/net/settings', { hotspotName: f.elements.hotspotName.value.trim(), adbPath: f.elements.adbPath.value.trim(), tetherOnly: f.elements.tetherOnly.checked, avoidRegions: regs });
          pendingAvoid = null;
          BB.toast('저장했습니다'); paintAll(); BB.loadNet && BB.loadNet(false);
        } catch (err) { }
      });
      var off = BB.onEvent ? BB.onEvent(function (ev) {
        if (!alive || !ev) return;
        if (ev.type === 'netlog') { if (!job) job = { lines: [], done: false }; job.lines.push(ev.data.line); paintJob(); }
        else if (ev.type === 'netdone') { if (!job) job = { lines: [], done: false }; job.done = true; job.error = ev.data.error || null; paintJob(); load(false); BB.toast(ev.data.ok ? '새 IP: ' + (ev.data.ip || '') : '새 IP를 받지 못했습니다'); }
      }) : null;

      load(false);
      timer = setInterval(function () { if (!(job && !job.done)) load(false); }, 30000);
      return function () { alive = false; clearInterval(timer); if (typeof off === 'function') off(); };
    }
  });
})();
