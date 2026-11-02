/* bokbok v2 - 로그인 / 회원가입 화면 (작업자 C) */
(function () {
  'use strict';
  var BB = window.BB = window.BB || {};

  function esc(s) {
    if (BB.esc) return BB.esc(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // 인증 호출은 raw fetch: 401에서 로그인 화면으로 튕기지 않고, 오류는 카드 안에 표시
  function post(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body || {})
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (!res.ok) throw new Error(j.error || ('요청에 실패했습니다 (' + res.status + ')'));
        return j;
      });
    }, function () {
      throw new Error('서버에 연결하지 못했습니다');
    });
  }

  var EMAIL_RE = /^([^\s@]+@[^\s@]+\.[^\s@]+|[A-Za-z0-9_.-]{3,30})$/;

  function field(id, label, type, extra, en) {
    return '<div class="field">' +
      '<label for="' + id + '">' + (en ? en + '<em>' + label + '</em>' : label) + '</label>' +
      '<input class="inp" id="' + id + '" type="' + type + '" ' + (extra || '') + '>' +
      '<div class="hint bad" data-err="' + id + '" style="display:none"></div>' +
      '</div>';
  }

  function render(mode, el) {
    var signup = mode === 'signup';
    // 50:50 — 왼쪽 브랜드 면(큰 영문 타이포 + 크롬 오브젝트), 오른쪽 폼 칸(카드 없음)
    var html = '<div class="auth-wrap">' +
      '<section class="auth-art" aria-hidden="true">' +
        '<div class="auth-logo">bokbok</div>' +
        '<div class="chrome-wrap"><div class="chrome"><i></i></div></div>' +
        '<div><h2 class="auth-display">Publish<br>every<span>channel.</span></h2>' +
        '<div class="auth-meta"><span>Naver</span><span>Meta</span><span>Global</span><span>Local only</span></div></div>' +
      '</section>' +
      '<section class="auth-side">' +
      '<button type="button" class="topbtn auth-theme" data-act="theme" title="테마 바꾸기" aria-label="테마 바꾸기"><svg viewBox="0 0 16 16" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="5.5"/><path d="M8 2.5v11" /></g><path fill="currentColor" d="M8 2.5a5.5 5.5 0 0 1 0 11z"/></svg></button>' +
      '<div class="auth-card">' +
      '<div class="auth-eb">' + (signup ? '02 / Create account' : '01 / Sign in') + '</div>' +
      '<h1 class="auth-title">' + (signup ? '회원가입' : '로그인') + '</h1>' +
      '<form class="form stack" novalidate>';
    if (signup) {
      html += field('au-name', '이름', 'text', 'maxlength="30" autocomplete="name"', 'Name');
    }
    html += field('au-email', '아이디 또는 이메일', 'text', 'autocomplete="username" autocapitalize="off" spellcheck="false"', 'ID / Email');
    html += field('au-pw', '비밀번호', 'password', 'autocomplete="' + (signup ? 'new-password' : 'current-password') + '"' + (signup ? ' placeholder="8자 이상"' : ''), 'Password');
    if (signup) {
      html += field('au-pw2', '비밀번호 확인', 'password', 'autocomplete="new-password"', 'Confirm');
    } else {
      html += '<label class="row" style="align-items:center;cursor:pointer">' +
        '<input type="checkbox" id="au-remember" checked> <span>로그인 상태 유지</span></label>';
    }
    html += '<div class="bad" data-err="form" style="display:none"></div>' +
      '<button type="submit" class="btn pri" id="au-submit" style="width:100%">' + (signup ? '가입' : '로그인') + '</button>' +
      '</form>' +
      '<div class="auth-alt">' +
      (signup
        ? '<span class="muted">이미 계정이 있으신가요?</span> <button type="button" class="link" data-go="#/login">로그인</button>'
        : '<span class="muted">계정이 없으신가요?</span> <button type="button" class="link" data-go="#/signup">회원가입</button>') +
      '</div>' +
      '</div>' +
      '<p class="auth-note">이 PC 안에서만 쓰는 계정입니다. 네이버 비밀번호는 저장하지 않습니다.</p>' +
      '</section></div>';
    el.innerHTML = html;

    var form = el.querySelector('form');
    var btn = el.querySelector('#au-submit');
    var $ = function (id) { return el.querySelector('#' + id); };

    function setErr(key, msg) {
      var box = el.querySelector('[data-err="' + key + '"]');
      if (!box) return;
      box.textContent = msg || '';
      box.style.display = msg ? '' : 'none';
    }
    function clearErrs() {
      Array.prototype.forEach.call(el.querySelectorAll('[data-err]'), function (b) {
        b.textContent = ''; b.style.display = 'none';
      });
    }

    Array.prototype.forEach.call(el.querySelectorAll('[data-go]'), function (b) {
      b.addEventListener('click', function () {
        var h = b.getAttribute('data-go');
        if (BB.go) BB.go(h); else location.hash = h;
      });
    });

    var tb = el.querySelector('[data-act="theme"]');
    if (tb) tb.addEventListener('click', function () {
      if (BB.setTheme) BB.setTheme(BB.getTheme() === 'dark' ? 'light' : 'dark');
    });

    // 입력하면 해당 칸 오류 지움
    Array.prototype.forEach.call(el.querySelectorAll('input.inp'), function (inp) {
      inp.addEventListener('input', function () { setErr(inp.id, ''); setErr('form', ''); });
    });

    function validate() {
      var ok = true, first = null;
      function fail(id, msg) { setErr(id, msg); ok = false; if (!first) first = id; }
      var email = $('au-email').value.trim();
      var pw = $('au-pw').value;
      if (signup) {
        var name = $('au-name').value.trim();
        if (!name) fail('au-name', '이름을 입력하세요');
        else if (name.length > 30) fail('au-name', '이름은 30자 이하로 입력하세요');
      }
      if (!email) fail('au-email', '아이디를 입력하세요');
      else if (!EMAIL_RE.test(email)) fail('au-email', '아이디는 영문·숫자 3~30자 또는 이메일 형식입니다');
      if (!pw) fail('au-pw', '비밀번호를 입력하세요');
      else if (signup && pw.length < 8) fail('au-pw', '비밀번호는 8자 이상이어야 합니다');
      if (signup) {
        var pw2 = $('au-pw2').value;
        if (!pw2) fail('au-pw2', '비밀번호를 한 번 더 입력하세요');
        else if (pw2 !== pw) fail('au-pw2', '비밀번호가 서로 다릅니다');
      }
      if (first) $(first).focus();
      return ok;
    }

    var busy = false;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy) return;
      clearErrs();
      if (!validate()) return;
      var email = $('au-email').value.trim();
      var body, path;
      if (signup) {
        path = '/api/auth/signup';
        body = { name: $('au-name').value.trim(), email: email, password: $('au-pw').value };
      } else {
        path = '/api/auth/login';
        body = { email: email, password: $('au-pw').value, remember: $('au-remember').checked };
      }
      busy = true;
      btn.disabled = true;
      var label = btn.textContent;
      btn.textContent = signup ? '가입하는 중...' : '로그인하는 중...';
      post(path, body).then(function (r) {
        if (r && r.pending) {   // 승인 대기: 로그인 화면으로 보내고 안내만
          if (BB.toast) BB.toast(r.message || '가입 신청이 접수되었습니다. 관리자 승인 뒤 로그인할 수 있습니다');
          if (BB.go) BB.go('#/login'); else location.hash = '#/login';
          return;
        }
        if (BB.setUser) BB.setUser(r.user); else BB.user = r.user;
        var start = r.user && r.user.prefs && r.user.prefs.startView === 'blog' ? '#/blog' : '#/home';
        if (BB.go) BB.go(start); else location.hash = start;
      }).catch(function (err) {
        setErr('form', err.message);
        if (!signup) { $('au-pw').value = ''; $('au-pw').focus(); }
      }).then(function () {
        busy = false;
        btn.disabled = false;
        btn.textContent = label;
      });
    });

    setTimeout(function () {
      var f = signup ? $('au-name') : $('au-email');
      if (f) f.focus();
    }, 0);
  }

  BB.auth = { render: render };
})();
