/* bokbok v2 - 내 계정 정보 / 환경설정 페이지 (작업자 C) */
(function () {
  'use strict';
  var BB = window.BB;
  if (!BB || typeof BB.page !== 'function') return;

  var esc = BB.esc;

  // 폼 안에 오류를 직접 보여주기 위한 호출 (BB.api는 실패 시 토스트만 띄움)
  function post(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body || {})
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (res.status === 401) { BB.go('#/login'); throw new Error(j.error || '로그인이 필요합니다'); }
        if (!res.ok) throw new Error(j.error || ('요청에 실패했습니다 (' + res.status + ')'));
        return j;
      });
    }, function () {
      throw new Error('서버에 연결하지 못했습니다');
    });
  }

  function fmtDate(v) {
    if (!v) return '-';
    var d = new Date(v);
    if (isNaN(d.getTime())) return esc(String(v));
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function errBox(key) {
    return '<div class="hint bad" data-err="' + key + '" style="display:none"></div>';
  }
  function setErr(el, key, msg) {
    var b = el.querySelector('[data-err="' + key + '"]');
    if (!b) return;
    b.textContent = msg || '';
    b.style.display = msg ? '' : 'none';
  }

  /* ---------- 내 계정 정보 ---------- */
  BB.page('me', {
    title: '내 계정 정보',
    render: function (el) {
      var u = BB.user || {};
      el.innerHTML =
        '<div class="page-h"><h1>내 계정 정보</h1><div class="sub">이 PC에 저장된 bokbok 계정입니다.</div></div>' +
        '<div class="stack" style="max-width:560px">' +
          '<div class="panel">' +
            '<div class="panel-h"><h2>기본 정보</h2></div>' +
            '<form class="form stack" id="me-prof" novalidate>' +
              '<div class="field"><label for="me-name">이름</label>' +
                '<div class="row"><input class="inp grow" id="me-name" maxlength="30" value="' + esc(u.name || '') + '">' +
                '<button type="submit" class="btn pri" id="me-name-save">저장</button></div>' +
                errBox('me-name') + '</div>' +
              '<dl class="kv">' +
                '<dt>이메일</dt><dd>' + esc(u.email || '-') + '</dd>' +
                '<dt>가입일</dt><dd>' + fmtDate(u.createdAt) + '</dd>' +
              '</dl>' +
            '</form>' +
          '</div>' +
          '<div class="panel">' +
            '<div class="panel-h"><h2>비밀번호 변경</h2></div>' +
            '<form class="form stack" id="me-pw" novalidate>' +
              '<div class="field"><label for="pw-cur">현재 비밀번호</label><input class="inp" type="password" id="pw-cur" autocomplete="current-password">' + errBox('pw-cur') + '</div>' +
              '<div class="field"><label for="pw-new">새 비밀번호</label><input class="inp" type="password" id="pw-new" autocomplete="new-password" placeholder="8자 이상">' + errBox('pw-new') + '</div>' +
              '<div class="field"><label for="pw-new2">새 비밀번호 확인</label><input class="inp" type="password" id="pw-new2" autocomplete="new-password">' + errBox('pw-new2') + '</div>' +
              '<div class="hint muted">바꾸면 이 창을 뺀 다른 창의 로그인은 모두 끊깁니다.</div>' +
              errBox('pw-form') +
              '<div class="row"><button type="submit" class="btn pri" id="pw-save">비밀번호 변경</button></div>' +
            '</form>' +
          '</div>' +
        '</div>';

      var $ = function (id) { return el.querySelector('#' + id); };
      Array.prototype.forEach.call(el.querySelectorAll('input.inp'), function (inp) {
        inp.addEventListener('input', function () { setErr(el, inp.id, ''); setErr(el, 'pw-form', ''); });
      });

      // 이름 저장
      $('me-prof').addEventListener('submit', function (e) {
        e.preventDefault();
        var name = $('me-name').value.trim();
        if (!name) return setErr(el, 'me-name', '이름을 입력하세요');
        if (name.length > 30) return setErr(el, 'me-name', '이름은 30자 이하로 입력하세요');
        var btn = $('me-name-save');
        btn.disabled = true;
        post('/api/auth/profile', { name: name }).then(function (r) {
          BB.setUser(r.user);
          $('me-name').value = r.user.name;
          BB.toast('이름을 저장했습니다');
        }).catch(function (err) {
          setErr(el, 'me-name', err.message);
        }).then(function () { btn.disabled = false; });
      });

      // 비밀번호 변경
      $('me-pw').addEventListener('submit', function (e) {
        e.preventDefault();
        var cur = $('pw-cur').value, nx = $('pw-new').value, nx2 = $('pw-new2').value;
        var bad = false;
        if (!cur) { setErr(el, 'pw-cur', '현재 비밀번호를 입력하세요'); bad = true; }
        if (!nx) { setErr(el, 'pw-new', '새 비밀번호를 입력하세요'); bad = true; }
        else if (nx.length < 8) { setErr(el, 'pw-new', '비밀번호는 8자 이상이어야 합니다'); bad = true; }
        if (!bad && nx2 !== nx) { setErr(el, 'pw-new2', '새 비밀번호가 서로 다릅니다'); bad = true; }
        if (bad) return;
        var btn = $('pw-save');
        btn.disabled = true;
        post('/api/auth/password', { current: cur, next: nx }).then(function () {
          $('pw-cur').value = ''; $('pw-new').value = ''; $('pw-new2').value = '';
          BB.toast('비밀번호를 바꿨습니다. 다른 창의 로그인은 끊겼습니다');
        }).catch(function (err) {
          setErr(el, 'pw-form', err.message);
        }).then(function () { btn.disabled = false; });
      });
    }
  });

  /* ---------- 환경설정 ---------- */
  BB.page('prefs', {
    title: '환경설정',
    render: function (el) {
      var u = BB.user || {};
      var sv = (u.prefs && u.prefs.startView) === 'blog' ? 'blog' : 'home';
      var th = BB.getTheme ? BB.getTheme() : 'dark';
      el.innerHTML =
        '<div class="page-h"><h1>환경설정</h1><div class="sub">앱 전체에 적용되는 설정입니다.</div></div>' +
        '<div class="stack" style="max-width:640px">' +
          '<div class="panel">' +
            '<div class="panel-h"><h2>시작 화면</h2></div>' +
            '<div class="form">' +
              '<div class="field"><label for="pf-start">로그인 후 처음 보일 화면</label>' +
                '<select class="inp" id="pf-start">' +
                  '<option value="home"' + (sv === 'home' ? ' selected' : '') + '>전체 서비스 홈</option>' +
                  '<option value="blog"' + (sv === 'blog' ? ' selected' : '') + '>네이버 블로그</option>' +
                '</select>' +
                '<div class="hint">바꾸면 바로 저장됩니다.</div>' +
              '</div>' +
            '</div>' +
            '<p class="muted" style="margin:16px 0 0">블로그 타자 속도 등은 네이버 블로그 &gt; 입력 설정에 있습니다. ' +
              '<button type="button" class="link" id="pf-blogset">블로그 설정 열기</button></p>' +
          '</div>' +
          '<div class="panel">' +
            '<div class="panel-h"><h2>화면 테마</h2></div>' +
            '<div class="form">' +
              '<div class="field"><label for="pf-theme">테마</label>' +
                '<select class="inp" id="pf-theme">' +
                  '<option value="dark"' + (th === 'dark' ? ' selected' : '') + '>다크 (기본)</option>' +
                  '<option value="light"' + (th === 'light' ? ' selected' : '') + '>라이트</option>' +
                '</select>' +
                '<div class="hint">이 PC에 저장됩니다. 위쪽 막대의 해·달 단추와 같은 설정입니다.</div>' +
              '</div>' +
              '<div class="field"><label for="pf-scale">화면 크기</label>' +
                '<select class="inp" id="pf-scale">' +
                  (BB.SCALES || []).map(function (o) { return '<option value="' + o[0] + '"' + ((BB.getScale ? BB.getScale() : 'l') === o[0] ? ' selected' : '') + '>' + o[1] + ' (' + o[2] + ')</option>'; }).join('') +
                '</select>' +
                '<div class="hint">대시보드·원고 만들기 같은 작업 화면의 글자·버튼·표 크기입니다. 이 PC에 저장됩니다.</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="panel">' +
            '<div class="panel-h"><h2>앱 정보</h2></div>' +
            '<div id="pf-app" class="muted">불러오는 중...</div>' +
          '</div>' +
        '</div>';

      var $ = function (id) { return el.querySelector('#' + id); };
      var alive = true;

      $('pf-blogset').addEventListener('click', function () { BB.go('#/blog/settings'); });

      // 테마: 상단바 단추와 같은 값 (bb-theme 이벤트로 서로 맞춘다)
      var tsel = $('pf-theme');
      tsel.addEventListener('change', function () {
        if (BB.setTheme) BB.setTheme(tsel.value);
        BB.toast(tsel.value === 'light' ? '라이트 테마로 바꿨습니다' : '다크 테마로 바꿨습니다');
      });
      var zsel = $('pf-scale');
      if (zsel) zsel.addEventListener('change', function () { if (BB.setScale) BB.setScale(zsel.value); BB.toast('화면 크기를 바꿨습니다'); });
      var onTheme = function (ev) { if (tsel && ev && ev.detail) tsel.value = ev.detail; };
      window.addEventListener('bb-theme', onTheme);

      var sel = $('pf-start');
      sel.addEventListener('change', function () {
        var v = sel.value, prev = sv;
        sel.disabled = true;
        BB.api('/api/auth/prefs', { startView: v }).then(function (r) {
          sv = v;
          BB.setUser(r.user);
          BB.toast('시작 화면을 저장했습니다');
        }).catch(function () {
          sel.value = prev;
        }).then(function () { sel.disabled = false; });
      });

      BB.api('/api/app').then(function (a) {
        if (!alive) return;
        var addr = 'http://127.0.0.1:' + (a.port || 3600);
        $('pf-app').className = '';
        $('pf-app').innerHTML =
          '<dl class="kv">' +
            '<dt>버전</dt><dd>' + esc(a.version || '-') + '</dd>' +
            '<dt>데이터 폴더</dt><dd><div class="row" style="align-items:center"><span class="mono grow" style="word-break:break-all">' + esc(a.dataDir || '-') + '</span>' +
              (a.dataDir ? '<button type="button" class="btn sm" data-open="data">폴더 열기</button>' : '') + '</div></dd>' +
            '<dt>프로젝트 폴더</dt><dd><div class="row" style="align-items:center"><span class="mono grow" style="word-break:break-all">' + esc(a.project || '-') + '</span>' +
              (a.project ? '<button type="button" class="btn sm" data-open="project">폴더 열기</button>' : '') + '</div></dd>' +
            '<dt>주소</dt><dd class="mono">' + esc(addr) + '</dd>' +
          '</dl>';
        Array.prototype.forEach.call($('pf-app').querySelectorAll('[data-open]'), function (b) {
          b.addEventListener('click', function () {
            Promise.resolve(BB.openP(b.getAttribute('data-open') === 'data' ? a.dataDir : a.project)).catch(function () {});
          });
        });
      }).catch(function () {
        if (!alive) return;
        $('pf-app').className = 'bad';
        $('pf-app').textContent = '앱 정보를 불러오지 못했습니다.';
      });

      return function () { alive = false; window.removeEventListener('bb-theme', onTheme); };
    }
  });
})();
