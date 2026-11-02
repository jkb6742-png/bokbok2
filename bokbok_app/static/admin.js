/* bokbok v2 - 관리자: 가입자 관리 (가입 승인 · 역할 · 플랫폼별 사용 범위 · 비밀번호 재설정 · 정지 · 삭제) */
(function () {
  'use strict';
  var BB = window.BB;
  if (!BB || typeof BB.page !== 'function') return;
  var esc = BB.esc;

  function post(path, body) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body || {}) })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          if (res.status === 401) { BB.go('#/login'); throw new Error(j.error || '로그인이 필요합니다'); }
          if (!res.ok) throw new Error(j.error || ('요청에 실패했습니다 (' + res.status + ')'));
          return j;
        });
      }, function () { throw new Error('서버에 연결하지 못했습니다'); });
  }
  function fmt(v) {
    if (!v) return '-';
    var d = new Date(v); if (isNaN(d.getTime())) return esc(String(v));
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  var STATUS = { active: ['사용 중', 'ok'], pending: ['승인 대기', 'warn'], disabled: ['정지', 'bad'] };
  var SIGNUP = [['open', '바로 사용', '가입하면 즉시 로그인할 수 있습니다'], ['approve', '관리자 승인 뒤', '가입 신청만 받고, 여기서 승인해야 로그인됩니다'], ['closed', '받지 않음', '가입 화면에서 막힙니다. 관리자가 여기서 계정을 만들어 줍니다']];

  BB.page('users', {
    title: '사용자 관리',
    admin: true,
    render: function (el) {
      var D = null, open = {}, alive = true;   // open: 권한 편집 펼친 아이디
      el.innerHTML = '<div class="page-h"><h1>사용자 관리</h1><div class="sub">이 앱에 가입한 계정을 승인·정지하고, 플랫폼별로 어디까지 쓸 수 있는지 정합니다. 관리자는 모든 기능을 쓸 수 있습니다.</div></div><div data-r="body"><div class="empty">불러오는 중</div></div>';
      var body = el.querySelector('[data-r="body"]');

      function permSelects(perms, prefix, disabled) {
        return '<div class="perm-grid">' + D.platforms.map(function (pf) {
          var cur = perms[pf.key] || 'none';
          return '<label class="perm-row"><span>' + esc(pf.label) + '</span><select class="inp" data-perm="' + esc(prefix) + '" data-pf="' + esc(pf.key) + '"' + (disabled ? ' disabled' : '') + '>' +
            pf.levels.map(function (l) { return '<option value="' + l.key + '"' + (l.key === cur ? ' selected' : '') + '>' + esc(l.label) + '</option>'; }).join('') + '</select></label>';
        }).join('') + '</div>';
      }
      function permSummary(u) {
        if (u.role === 'admin') return '<span class="muted">관리자 · 전체</span>';
        var on = D.platforms.filter(function (pf) { return (u.perms[pf.key] || 'none') !== 'none'; });
        if (!on.length) return '<span class="bad">사용 가능한 플랫폼 없음</span>';
        return on.map(function (pf) { var lv = u.perms[pf.key]; return '<span class="perm-chip lv-' + lv + '">' + esc(pf.label) + ' <em>' + esc((pf.levels.find(function (l) { return l.key === lv; }) || {}).label || lv) + '</em></span>'; }).join('') + (u.canSettings ? '<span class="perm-chip lv-write">앱 설정 변경</span>' : '');
      }
      function paint() {
        if (!alive || !D) return;
        var S = D.settings, pend = D.users.filter(function (u) { return u.status === 'pending'; });
        body.innerHTML =
          (pend.length ? '<div class="panel"><div class="panel-h"><h2>승인 대기 ' + pend.length + '명</h2><span class="sub">승인하면 기본 권한으로 바로 로그인할 수 있습니다</span></div><div class="stack" style="gap:8px">' +
            pend.map(function (u) { return '<div class="row" style="gap:12px"><b>' + esc(u.name) + '</b><span class="mono muted">' + esc(u.email) + '</span><span class="muted">' + fmt(u.createdAt) + ' 신청</span><span class="grow"></span>' +
              '<button type="button" class="btn sm pri" data-act="approve" data-u="' + esc(u.email) + '">승인</button><button type="button" class="btn sm danger" data-act="delete" data-u="' + esc(u.email) + '">거절(삭제)</button></div>'; }).join('') + '</div></div>' : '') +
          '<div class="panel"><div class="panel-h"><h2>가입자 ' + D.users.length + '명</h2><button type="button" class="btn sm" data-act="newUser">계정 직접 만들기</button></div>' +
          '<div data-r="newUser" hidden class="panel" style="border:1px solid var(--line);border-radius:var(--r);padding:14px;margin-bottom:12px"><form class="form stack" data-r="newForm" autocomplete="off">' +
            '<div class="row"><input class="inp" name="name" maxlength="30" placeholder="이름" style="width:140px"><input class="inp" name="email" maxlength="254" placeholder="아이디(영문·숫자 3~30자) 또는 이메일" style="width:260px"><input class="inp" name="password" type="password" minlength="8" maxlength="200" placeholder="비밀번호 8자 이상" style="width:180px">' +
            '<select class="inp" name="role" style="width:auto"><option value="user">일반 사용자</option><option value="admin">관리자</option></select></div>' +
            '<div class="hint">플랫폼 권한은 아래 기본 권한으로 들어갑니다. 만든 뒤 줄을 펼쳐 바꿀 수 있습니다.</div>' +
            '<div class="row"><button type="submit" class="btn pri">만들기</button><button type="button" class="btn" data-act="newClose">닫기</button><span class="hint bad" data-r="newErr"></span></div></form></div>' +
          '<table class="tbl"><thead><tr><th>이름</th><th>아이디</th><th>상태</th><th>역할</th><th>사용 범위</th><th>가입</th><th>마지막 로그인</th><th>창</th><th></th></tr></thead><tbody>' +
          D.users.map(function (u) {
            var me = u.email === D.me, st = STATUS[u.status] || STATUS.active, isOpen = !!open[u.email];
            return '<tr' + (isOpen ? ' class="sel"' : '') + '><td><b>' + esc(u.name) + '</b>' + (me ? ' <span class="muted">(나)</span>' : '') + '</td><td class="mono">' + esc(u.email) + '</td>' +
              '<td><span class="' + st[1] + '">' + st[0] + '</span></td><td>' + (u.role === 'admin' ? '관리자' : '일반') + '</td><td>' + permSummary(u) + '</td>' +
              '<td class="muted">' + fmt(u.createdAt) + '</td><td class="muted">' + fmt(u.lastLoginAt) + '</td><td class="num">' + u.sessions + '</td>' +
              '<td class="num"><button type="button" class="link" data-act="toggle" data-u="' + esc(u.email) + '">' + (isOpen ? '닫기' : '관리') + '</button></td></tr>' +
              (isOpen ? '<tr class="sel"><td colspan="9"><div class="stack" style="gap:12px;padding:6px 0 10px">' +
                '<div class="row" style="gap:8px"><input class="inp" data-r="name" data-u="' + esc(u.email) + '" maxlength="30" value="' + esc(u.name) + '" style="width:160px"><button type="button" class="btn sm" data-act="rename" data-u="' + esc(u.email) + '">이름 저장</button>' +
                  '<span class="top-div"></span>' +
                  (u.role === 'admin' ? '<button type="button" class="btn sm" data-act="role" data-v="user" data-u="' + esc(u.email) + '">일반 사용자로</button>' : '<button type="button" class="btn sm" data-act="role" data-v="admin" data-u="' + esc(u.email) + '">관리자로 지정</button>') +
                  (u.status === 'disabled' ? '<button type="button" class="btn sm" data-act="status" data-v="active" data-u="' + esc(u.email) + '">정지 해제</button>' : u.status === 'pending' ? '<button type="button" class="btn sm pri" data-act="approve" data-u="' + esc(u.email) + '">승인</button>' : (me ? '' : '<button type="button" class="btn sm" data-act="status" data-v="disabled" data-u="' + esc(u.email) + '">정지</button>')) +
                  '<button type="button" class="btn sm" data-act="kick" data-u="' + esc(u.email) + '">모든 창 로그아웃</button>' +
                  (me ? '' : '<button type="button" class="btn sm danger" data-act="delete" data-u="' + esc(u.email) + '">삭제</button>') + '</div>' +
                '<div class="row" style="gap:8px"><input class="inp" type="password" data-r="pw" data-u="' + esc(u.email) + '" minlength="8" maxlength="200" placeholder="새 비밀번호 8자 이상" autocomplete="new-password" style="width:220px"><button type="button" class="btn sm" data-act="resetPw" data-u="' + esc(u.email) + '">비밀번호 재설정</button><span class="hint">재설정하면 그 사람의 로그인은 모두 끊깁니다</span></div>' +
                '<div><div class="hint" style="margin-bottom:6px">플랫폼별 사용 범위' + (u.role === 'admin' ? ' — 관리자는 전부 쓸 수 있어 바꿀 수 없습니다' : '') + '</div>' + permSelects(u.perms, u.email, u.role === 'admin') +
                  '<label class="row" style="gap:6px;margin-top:8px"><input type="checkbox" data-r="canSettings" data-u="' + esc(u.email) + '"' + (u.canSettings ? ' checked' : '') + (u.role === 'admin' ? ' disabled' : '') + '> 앱 설정 변경 허용 (입력 설정 · 데이터 설정 · AI 키 · 네트워크 설정 · 앱 종료)</label>' +
                  (u.role === 'admin' ? '' : '<div class="row" style="margin-top:8px"><button type="button" class="btn sm pri" data-act="savePerms" data-u="' + esc(u.email) + '">권한 저장</button></div>') + '</div>' +
                '</div></td></tr>' : '');
          }).join('') + '</tbody></table></div>' +
          '<div class="panel"><div class="panel-h"><h2>가입 방식</h2></div><div class="form stack">' +
            '<div class="field"><label>새로 가입하는 사람</label><select class="inp" data-r="signupMode" style="max-width:260px">' + SIGNUP.map(function (o) { return '<option value="' + o[0] + '"' + (S.signupMode === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
              '<div class="hint" data-r="signupHint">' + esc((SIGNUP.find(function (o) { return o[0] === S.signupMode; }) || SIGNUP[1])[2]) + '</div></div>' +
            '<div class="field"><label>새 가입자 기본 권한</label>' + permSelects(S.defaultPerms, '__default__', false) +
              '<label class="row" style="gap:6px;margin-top:8px"><input type="checkbox" data-r="defaultCanSettings"' + (S.defaultCanSettings ? ' checked' : '') + '> 앱 설정 변경 허용</label>' +
              '<div class="row" style="margin-top:8px"><button type="button" class="btn sm pri" data-act="saveDefaults">기본 권한 저장</button><span class="hint">이미 가입한 사람에게는 적용되지 않습니다. 사람마다 위 표에서 바꿉니다.</span></div></div>' +
          '</div></div>';
      }
      function load() {
        return BB.api('/api/admin/users').then(function (r) { if (!alive) return; D = r; paint(); }).catch(function () { if (alive) body.innerHTML = '<div class="empty bad">가입자 목록을 불러오지 못했습니다.</div>'; });
      }
      function readPerms(prefix) {
        var out = {};
        Array.prototype.forEach.call(body.querySelectorAll('select[data-perm="' + prefix + '"]'), function (s) { out[s.getAttribute('data-pf')] = s.value; });
        return out;
      }
      function upd(email, patch, msg) {
        return post('/api/admin/users/update', Object.assign({ email: email }, patch)).then(function (r) {
          var i = D.users.findIndex(function (u) { return u.email === email; }); if (i >= 0) D.users[i] = r.user;
          if (email === D.me && patch.role !== undefined) BB.api('/api/auth/me').then(function (m) { BB.setUser(m.user); }).catch(function () {});
          if (msg) BB.toast(msg); paint();
        }).catch(function (e) { BB.toast(e.message); });
      }

      body.addEventListener('change', function (e) {
        var t = e.target;
        if (t.getAttribute('data-r') === 'signupMode') {
          var v = t.value;
          post('/api/admin/settings', { signupMode: v }).then(function (r) { D.settings = r.settings; var h = body.querySelector('[data-r="signupHint"]'); if (h) h.textContent = (SIGNUP.find(function (o) { return o[0] === v; }) || SIGNUP[1])[2]; BB.toast('가입 방식을 저장했습니다'); }).catch(function (err) { BB.toast(err.message); paint(); });
        }
      });
      body.addEventListener('submit', function (e) {
        if (e.target.getAttribute('data-r') !== 'newForm') return;
        e.preventDefault();
        var f = e.target, err = body.querySelector('[data-r="newErr"]');
        err.textContent = '';
        post('/api/admin/users/create', { name: f.elements.name.value, email: f.elements.email.value, password: f.elements.password.value, role: f.elements.role.value })
          .then(function (r) { D.users.push(r.user); open[r.user.email] = true; BB.toast('계정을 만들었습니다'); paint(); })
          .catch(function (x) { var b2 = body.querySelector('[data-r="newErr"]'); if (b2) b2.textContent = x.message; });
      });
      body.addEventListener('click', function (e) {
        var t = e.target.closest('[data-act]'); if (!t || !body.contains(t)) return;
        var act = t.getAttribute('data-act'), email = t.getAttribute('data-u');
        if (act === 'newUser') { var n = body.querySelector('[data-r="newUser"]'); n.hidden = !n.hidden; if (!n.hidden) n.querySelector('input').focus(); }
        else if (act === 'newClose') { body.querySelector('[data-r="newUser"]').hidden = true; }
        else if (act === 'toggle') { open[email] = !open[email]; paint(); }
        else if (act === 'approve') upd(email, { status: 'active' }, '승인했습니다. 이제 로그인할 수 있습니다');
        else if (act === 'status') upd(email, { status: t.getAttribute('data-v') }, t.getAttribute('data-v') === 'disabled' ? '정지했습니다. 로그인이 끊겼습니다' : '정지를 해제했습니다');
        else if (act === 'role') upd(email, { role: t.getAttribute('data-v') }, '역할을 바꿨습니다');
        else if (act === 'rename') { var inp = body.querySelector('input[data-r="name"][data-u="' + CSS.escape(email) + '"]'); upd(email, { name: inp ? inp.value.trim() : '' }, '이름을 저장했습니다'); }
        else if (act === 'savePerms') { var cs = body.querySelector('input[data-r="canSettings"][data-u="' + CSS.escape(email) + '"]'); upd(email, { perms: readPerms(email), canSettings: !!(cs && cs.checked) }, '권한을 저장했습니다'); }
        else if (act === 'resetPw') {
          var pw = body.querySelector('input[data-r="pw"][data-u="' + CSS.escape(email) + '"]');
          if (!pw || pw.value.length < 8) return BB.toast('새 비밀번호는 8자 이상이어야 합니다');
          post('/api/admin/users/password', { email: email, next: pw.value }).then(function () { pw.value = ''; BB.toast('비밀번호를 재설정했습니다'); load(); }).catch(function (x) { BB.toast(x.message); });
        }
        else if (act === 'kick') post('/api/admin/users/logout', { email: email }).then(function (r) { var i = D.users.findIndex(function (u) { return u.email === email; }); if (i >= 0) D.users[i] = r.user; BB.toast('모든 창에서 로그아웃시켰습니다'); paint(); }).catch(function (x) { BB.toast(x.message); });
        else if (act === 'delete') {
          BB.confirm('[' + email + '] 계정을 지울까요? 되돌릴 수 없습니다', '삭제').then(function (ok) {
            if (!ok) return;
            return post('/api/admin/users/delete', { email: email }).then(function () { D.users = D.users.filter(function (u) { return u.email !== email; }); delete open[email]; BB.toast('삭제했습니다'); paint(); });
          }).catch(function (x) { BB.toast(x.message); });
        }
        else if (act === 'saveDefaults') {
          var dc = body.querySelector('input[data-r="defaultCanSettings"]');
          post('/api/admin/settings', { defaultPerms: readPerms('__default__'), defaultCanSettings: !!(dc && dc.checked) }).then(function (r) { D.settings = r.settings; BB.toast('기본 권한을 저장했습니다'); }).catch(function (x) { BB.toast(x.message); });
        }
      });

      load();
      return function () { alive = false; };
    }
  });
})();
