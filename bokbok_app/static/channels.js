/* bokbok v2 - 채널 모듈(네이버 카페·인스타그램·쓰레드·레딧). 연결·원고 검사·미리 실행·발행은 서버 엔진(/api/engine/*) 사용. */
(function () {
  'use strict';
  if (!window.BB || typeof window.BB.mod !== 'function') return;
  var BB = window.BB;

  var NAV = [['overview', '개요'], ['connect', '연결'], ['posts', '원고·발행'], ['accounts', '계정 메모'], ['history', '발행 기록'], ['settings', '설정']];

  /* 연결 안내: 단계(문자열, {redirect:true}는 돌아오는 주소 복사 줄), 참고(회색 글) */
  var GUIDES = {
    cafe: {
      steps: [
        'developers.naver.com 에 로그인한 뒤 Application → 애플리케이션 등록으로 들어갑니다.',
        '사용 API에 "카페"와 "네이버 로그인"을 추가합니다.',
        '로그인 오픈 API 서비스 환경에서 PC 웹을 고르고, 서비스 URL에 http://127.0.0.1:3600 , Callback URL에 아래 돌아오는 주소를 넣습니다.',
        { redirect: true },
        '발급된 Client ID와 Client Secret을 아래 엔진 설정에 붙여 넣고, 글을 올릴 카페 ID(clubid)·게시판 ID(menuid)를 적은 뒤 [저장]을 누릅니다.',
        '[연결하기]를 누르면 브라우저에 네이버 로그인·동의 화면이 열립니다. 동의 후 "연결되었습니다" 창이 뜨면 닫고 돌아옵니다.',
        '[연결 확인]으로 계정 이름과 토큰 만료 시각이 나오는지 봅니다. 토큰은 자동으로 갱신됩니다.'
      ],
      notes: ['네이버 카페 API는 계정당 하루 200건까지지만, 카페 스팸 차단을 피하려고 앱은 하루 20건·10분 간격 이하로 제한합니다.',
        '가입되어 있고 글쓰기 등급이 되는 게시판이어야 합니다.']
    },
    instagram: {
      steps: [
        '인스타그램 앱에서 계정을 비즈니스 또는 크리에이터 계정으로 바꿉니다.',
        'developers.facebook.com 에서 앱을 만들고 Instagram 사용 사례(Instagram API)를 추가합니다.',
        'instagram_content_publish 권한이 들어간 장기 액세스 토큰(60일)을 발급합니다. 토큰을 만드는 화면에서 계정의 숫자 사용자 ID도 확인합니다.',
        '아래 엔진 설정에 사용자 ID와 장기 액세스 토큰을 붙여 넣고 [저장]을 누릅니다.',
        '[연결 확인]으로 @계정 이름과 24시간 발행 한도가 나오는지 봅니다.'
      ],
      notes: ['인스타그램은 Meta 서버가 이미지를 직접 가져가므로 원고의 imageUrls에 공개 https 주소가 있어야 합니다. 이 PC의 이미지 파일(images)만 있으면 발행할 수 없습니다.',
        '장기 토큰은 60일 뒤 만료됩니다. 만료 전에 새로 발급해 다시 저장하세요.']
    },
    threads: {
      steps: [
        '쓰레드 프로필을 만듭니다(인스타그램 계정으로 가입).',
        'developers.facebook.com 에서 앱을 만들고 Threads API 사용 사례를 추가합니다.',
        'threads_basic, threads_content_publish 권한이 들어간 장기 액세스 토큰(60일)을 발급합니다.',
        '아래 엔진 설정에 장기 액세스 토큰을 붙여 넣고 [저장]을 누릅니다. 사용자 ID는 비워 두면 토큰 주인 계정을 씁니다.',
        '[연결 확인]으로 @계정 이름과 토큰 만료일을 봅니다. 만료 7일 전부터는 연결 확인 때 자동으로 갱신합니다.'
      ],
      notes: ['쓰레드 이미지 글도 원고의 imageUrls에 공개 https 주소가 있어야 합니다. 글만 있는 원고는 이미지 없이 올라갑니다.']
    },
    reddit: {
      steps: [
        'reddit.com/prefs/apps 에서 "create another app"을 눌러 앱을 만듭니다(installed app 권장).',
        'redirect uri 칸에 아래 돌아오는 주소를 그대로 넣습니다.',
        { redirect: true },
        '앱 이름 아래에 보이는 문자열(Client ID)과 레딧 사용자명을 아래 엔진 설정에 넣고 [저장]을 누릅니다. web app으로 만들었다면 Client Secret도 넣습니다.',
        '[연결하기]를 누르면 브라우저에 레딧 허용 화면이 열립니다. Allow 후 "연결되었습니다" 창이 뜨면 닫고 돌아옵니다.',
        '[연결 확인]으로 카르마와 남은 API 호출 수를 봅니다.'
      ],
      notes: ['레딧은 2025년 11월부터 Responsible Builder Policy에 따라 API 사용 승인을 받아야 합니다. 승인 전에는 연결이나 발행이 거절될 수 있습니다.',
        '서브레딧마다 홍보·자기 홍보 규칙이 다릅니다. 하루 3건·30분 간격 이하로 제한합니다. 이미지 글은 아직 지원하지 않습니다.']
    }
  };

  var CHANNELS = {
    cafe: {
      name: '네이버 카페', order: 2, desc: '카페 게시판에 글을 발행합니다.',
      handleLabel: '카페 주소',
      handleCol: '카페 주소',
      handlePh: 'https://cafe.naver.com/…',
      handleHint: 'https://cafe.naver.com/ 으로 시작하는 카페 주소를 입력합니다.',
      memoPh: '사용할 네이버 계정 등',
      formHint: '',
      prereq: [
        '카페에 가입되어 있고 글쓰기 권한(등급)이 있는 네이버 계정',
        '발행할 게시판 이름 확인',
        '카페별 홍보·도배 규칙 확인'
      ],
      normalize: function (v) { return v.trim(); },
      validate: function (v) {
        if (v.indexOf('https://cafe.naver.com/') !== 0 || v.length <= 'https://cafe.naver.com/'.length) {
          return '카페 주소는 https://cafe.naver.com/ 으로 시작해야 합니다.';
        }
        if (/\s/.test(v)) return '카페 주소에 공백이 들어갈 수 없습니다.';
        return '';
      },
      settings: [
        { k: 'board', label: '기본 게시판 이름', type: 'text', def: '', max: 50 },
        { k: 'dailyMax', label: '하루 최대 발행 수', type: 'number', def: 1, min: 1, max: 5 },
        { k: 'intervalMin', label: '발행 간격(분)', type: 'number', def: 60, min: 30, max: 1440 }
      ]
    },
    instagram: {
      name: '인스타그램', order: 4, desc: '피드·릴스 게시물을 발행합니다.',
      handleLabel: '인스타그램 사용자 이름',
      handleCol: '아이디',
      handlePh: '@ 없이 입력',
      handleHint: '@ 없이 사용자 이름만 입력합니다. (영문·숫자·마침표·밑줄)',
      memoPh: '',
      formHint: '비즈니스 또는 크리에이터 계정이어야 하고, 페이스북 페이지와 연결되어 있어야 합니다(공식 API 사용).',
      prereq: [
        '비즈니스 또는 크리에이터 계정으로 전환',
        '페이스북 페이지와 계정 연결',
        'Meta 개발자 앱 등록(공식 Instagram API)'
      ],
      normalize: function (v) { return v.trim().replace(/^@+/, ''); },
      validate: function (v) {
        if (!/^[A-Za-z0-9._]{1,30}$/.test(v)) return '사용자 이름은 영문·숫자·마침표·밑줄 30자 이내입니다.';
        return '';
      },
      settings: [
        { k: 'hashtags', label: '기본 해시태그', type: 'text', def: '', max: 300, hint: '띄어쓰기로 구분합니다. 예: #MBTI #성격유형' },
        { k: 'dailyMax', label: '하루 최대 발행 수', type: 'number', def: 1, min: 1, max: 5 },
        { k: 'intervalMin', label: '발행 간격(분)', type: 'number', def: 60, min: 30, max: 1440 }
      ]
    },
    threads: {
      name: '쓰레드', order: 5, desc: '쓰레드 게시물을 발행합니다.',
      handleLabel: '쓰레드 사용자 이름',
      handleCol: '아이디',
      handlePh: '@ 없이 입력',
      handleHint: '@ 없이 사용자 이름만 입력합니다. (인스타그램 사용자 이름과 같습니다)',
      memoPh: '',
      formHint: '공식 Threads API를 사용할 예정입니다.',
      prereq: [
        '쓰레드 프로필 생성(인스타그램 계정 연동)',
        'Meta 개발자 앱 등록(공식 Threads API)'
      ],
      normalize: function (v) { return v.trim().replace(/^@+/, ''); },
      validate: function (v) {
        if (!/^[A-Za-z0-9._]{1,30}$/.test(v)) return '사용자 이름은 영문·숫자·마침표·밑줄 30자 이내입니다.';
        return '';
      },
      settings: [
        { k: 'hashtags', label: '기본 해시태그', type: 'text', def: '', max: 300, hint: '띄어쓰기로 구분합니다.' },
        { k: 'dailyMax', label: '하루 최대 발행 수', type: 'number', def: 1, min: 1, max: 5 },
        { k: 'intervalMin', label: '발행 간격(분)', type: 'number', def: 60, min: 30, max: 1440 }
      ]
    },
    reddit: {
      name: '레딧', order: 6, desc: '서브레딧에 글을 게시합니다.',
      handleLabel: '레딧 사용자 이름',
      handleCol: '아이디',
      handlePh: 'u/ 없이 입력',
      handleHint: 'u/ 없이 사용자 이름만 입력합니다. (영문·숫자·밑줄·하이픈 3~20자)',
      memoPh: '',
      formHint: '공식 Reddit API 앱 등록이 필요합니다. 서브레딧마다 홍보 규칙을 먼저 확인합니다.',
      prereq: [
        '공식 Reddit API 앱 등록(script 유형)',
        '게시할 서브레딧의 홍보·자기 홍보 규칙 확인',
        '계정 카르마·가입 기간 조건 확인'
      ],
      normalize: function (v) { return v.trim().replace(/^\/?u\//i, ''); },
      validate: function (v) {
        if (!/^[A-Za-z0-9_-]{3,20}$/.test(v)) return '사용자 이름은 영문·숫자·밑줄·하이픈 3~20자입니다.';
        return '';
      },
      settings: [
        { k: 'subreddit', label: '기본 서브레딧', type: 'text', def: '', max: 21, hint: 'r/ 없이 입력합니다.',
          normalize: function (v) { return v.replace(/^\/?r\//i, ''); },
          validate: function (v) { return v && !/^[A-Za-z0-9_]{2,21}$/.test(v) ? '서브레딧 이름은 영문·숫자·밑줄 2~21자입니다.' : ''; } },
        { k: 'dailyMax', label: '하루 최대 게시 수', type: 'number', def: 1, min: 1, max: 3 },
        { k: 'intervalMin', label: '발행 간격(분)', type: 'number', def: 120, min: 60, max: 1440 }
      ]
    },
    facebook: {
      name: '페이스북', order: 3, desc: '페이스북 페이지에 게시물을 발행합니다.', noEngine: true,
      handleLabel: '페이지 주소',
      handleCol: '페이지 주소',
      handlePh: 'https://www.facebook.com/…',
      handleHint: 'https://www.facebook.com/ 으로 시작하는 페이지 주소를 입력합니다. (개인 프로필이 아닌 페이지)',
      memoPh: '',
      formHint: '공식 Graph API로 페이지에 발행할 예정입니다. 개인 프로필 발행은 API가 지원하지 않습니다.',
      prereq: [
        '페이스북 페이지(개인 프로필 아님)와 관리자 권한',
        'Meta 개발자 앱 등록(pages_manage_posts 권한)',
        '발행 엔진 준비 중 — 계정 메모와 설정만 먼저 저장할 수 있습니다'
      ],
      normalize: function (v) { return v.trim(); },
      validate: function (v) {
        if (!/^https:\/\/(www\.|m\.)?facebook\.com\/\S+$/.test(v)) return '페이지 주소는 https://www.facebook.com/ 으로 시작해야 합니다.';
        return '';
      },
      settings: [
        { k: 'dailyMax', label: '하루 최대 발행 수', type: 'number', def: 1, min: 1, max: 5 },
        { k: 'intervalMin', label: '발행 간격(분)', type: 'number', def: 60, min: 30, max: 1440 }
      ]
    },
    twitter: {
      name: 'X (트위터)', order: 7, desc: 'X에 게시물을 발행합니다.', noEngine: true,
      handleLabel: 'X 사용자 이름',
      handleCol: '아이디',
      handlePh: '@ 없이 입력',
      handleHint: '@ 없이 사용자 이름만 입력합니다. (영문·숫자·밑줄 15자 이내)',
      memoPh: '',
      formHint: '공식 X API를 사용할 예정입니다. X API는 유료 요금제 확인이 필요합니다.',
      prereq: [
        'X 개발자 계정(developer.x.com)과 앱 등록',
        'API 요금제·월 게시 한도 확인',
        '발행 엔진 준비 중 — 계정 메모와 설정만 먼저 저장할 수 있습니다'
      ],
      normalize: function (v) { return v.trim().replace(/^@+/, ''); },
      validate: function (v) {
        if (!/^[A-Za-z0-9_]{1,15}$/.test(v)) return '사용자 이름은 영문·숫자·밑줄 15자 이내입니다.';
        return '';
      },
      settings: [
        { k: 'hashtags', label: '기본 해시태그', type: 'text', def: '', max: 100, hint: '1~2개 권장. 띄어쓰기로 구분합니다.' },
        { k: 'dailyMax', label: '하루 최대 발행 수', type: 'number', def: 2, min: 1, max: 10 },
        { k: 'intervalMin', label: '발행 간격(분)', type: 'number', def: 60, min: 30, max: 1440 }
      ]
    }
  };

  var esc = function (s) { return BB.esc(s == null ? '' : String(s)); };

  function fmtDate(v) {
    if (!v) return '';
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function pageHead(c, title, sub) {
    return '<div class="page-h"><h1>' + esc(title) + '</h1><div class="sub">' + esc(sub) + '</div></div>';
  }

  function loadAccounts(p) {
    return BB.api('/api/channels?p=' + encodeURIComponent(p)).then(function (r) {
      return (r && r.items) || [];
    });
  }

  function loadSettings(p) {
    return BB.api('/api/channel-settings?p=' + encodeURIComponent(p)).then(function (r) {
      return (r && r.settings) || {};
    });
  }

  function loadInfo(p) { return BB.api('/api/engine/info?p=' + encodeURIComponent(p)); }
  function loadPosts(p) { return BB.api('/api/channel-posts?p=' + encodeURIComponent(p)); }

  function fmtTime(v) {
    if (!v) return '';
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    return fmtDate(v) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }
  function quotaText(q) {
    if (!q) return '';
    var s = '24시간 발행 ' + q.used + (q.dailyMax != null ? '/' + q.dailyMax + '건 (남은 ' + q.left + '건)' : '건');
    if (q.intervalMin) s += ' · 간격 ' + q.intervalMin + '분';
    if (q.nextAt) s += ' · ' + fmtTime(q.nextAt) + ' 이후 발행 가능';
    return s;
  }
  function requiredDone(info) {
    var req = info.configFields.filter(function (f) { return f.required; });
    var done = req.filter(function (f) { return f.secret ? f.hasValue : !!String(info.config[f.key] || '').trim(); });
    return { total: req.length, done: done.length };
  }

  /* ---------- 개요 ---------- */
  function renderOverview(p, c, root) {
    root.innerHTML = pageHead(c, c.name, c.desc) +
      '<div class="panel"><div class="panel-h"><h2>준비 상태</h2></div><div data-slot="check"><div class="empty">불러오는 중</div></div></div>';

    var soft = function (pr) { return pr.catch(function () { return null; }); };
    Promise.all([loadAccounts(p).catch(function () { return []; }), loadSettings(p).catch(function () { return {}; }), c.noEngine ? null : soft(loadInfo(p)), c.noEngine ? null : soft(loadPosts(p))]).then(function (res) {
      if (!root.isConnected) return;
      var items = res[0], st = res[1], info = res[2], posts = res[3];
      var hasSettings = Object.keys(st).length > 0;
      var rows = [];
      if (info) {
        var rd = requiredDone(info);
        rows.push('<tr><td>엔진 설정</td><td>' + (rd.done === rd.total
          ? '<span class="ok">저장됨</span>'
          : '<span class="muted">필수 항목 ' + rd.done + '/' + rd.total + '</span> <button class="link" data-act="go" data-to="connect">설정하기</button>') + '</td></tr>');
        rows.push('<tr><td>연결</td><td>' + (info.connected
          ? '<span class="ok">연결됨</span>' + (info.account && info.account.name ? ' <span class="muted">' + esc(info.account.name) + '</span>' : '')
          : '<span class="muted">연결 필요</span> <button class="link" data-act="go" data-to="connect">연결</button>') + '</td></tr>');
      }
      if (posts) {
        var okN = posts.items.filter(function (x) { return !x.problems.length; }).length;
        rows.push('<tr><td>채널 원고</td><td>' + (posts.items.length
          ? '<span class="ok">' + posts.items.length + '개</span> <span class="muted">검사 통과 ' + okN + '개</span> <button class="link" data-act="go" data-to="posts">원고·발행</button>'
          : '<span class="muted">없음</span> <button class="link" data-act="go" data-to="posts">원고·발행</button>') + '</td></tr>');
        rows.push('<tr><td>발행 한도</td><td><span class="muted">' + esc(quotaText(posts.quota)) + '</span></td></tr>');
      }
      rows.push('<tr><td>계정 메모</td><td>' + (items.length
        ? '<span class="ok">' + items.length + '개</span>'
        : '<span class="muted">없음</span> <button class="link" data-act="go" data-to="accounts">계정 메모</button>') + '</td></tr>');
      rows.push('<tr><td>발행 설정</td><td>' + (hasSettings
        ? '<span class="ok">저장됨</span>'
        : '<span class="muted">기본값 사용 중</span> <button class="link" data-act="go" data-to="settings">설정</button>') + '</td></tr>');
      c.prereq.forEach(function (t) {
        rows.push('<tr><td>' + esc(t) + '</td><td><span class="muted">직접 확인</span></td></tr>');
      });
      var slot = root.querySelector('[data-slot="check"]');
      slot.innerHTML = '<table class="tbl"><thead><tr><th>항목</th><th>상태</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>';
    }).catch(function () {
      if (!root.isConnected) return;
      root.querySelector('[data-slot="check"]').innerHTML = '<div class="empty">상태를 불러오지 못했습니다.</div>';
    });
  }

  /* ---------- 계정 등록 ---------- */
  function renderAccounts(p, c, root) {
    root.innerHTML = pageHead(c, '계정 메모', c.name + '에서 쓰는 계정을 메모해 둡니다. 실제 발행 계정은 [연결] 화면에서 정해집니다.') +
      '<div class="stack">' +
      '<div class="panel"><div class="panel-h"><h2>등록된 계정</h2></div><div data-slot="list"><div class="empty">불러오는 중</div></div></div>' +
      '<div class="panel"><div class="panel-h"><h2>계정 추가</h2></div>' +
      '<form class="form" data-form="add" autocomplete="off">' +
      '<div class="field"><label for="ch-name">이름</label><input class="inp" id="ch-name" name="name" maxlength="30" placeholder="구분하기 쉬운 이름"></div>' +
      '<div class="field"><label for="ch-handle">' + esc(c.handleLabel) + '</label><input class="inp" id="ch-handle" name="handle" maxlength="200" placeholder="' + esc(c.handlePh) + '">' +
      '<div class="hint">' + esc(c.handleHint) + '</div></div>' +
      '<div class="field"><label for="ch-memo">메모</label><input class="inp" id="ch-memo" name="memo" maxlength="200" placeholder="' + esc(c.memoPh) + '"></div>' +
      (c.formHint ? '<div class="hint muted">' + esc(c.formHint) + '</div>' : '') +
      '<div class="row"><button type="submit" class="btn pri">추가</button></div>' +
      '<div class="muted">비밀번호·토큰은 여기 저장하지 않습니다.</div>' +
      '</form></div></div>';

    var items = [];
    function draw() {
      var slot = root.querySelector('[data-slot="list"]');
      if (!slot) return;
      if (!items.length) { slot.innerHTML = '<div class="empty">등록된 계정이 없습니다.</div>'; return; }
      slot.innerHTML = '<table class="tbl"><thead><tr><th>이름</th><th>' + esc(c.handleCol) + '</th><th>메모</th><th>등록일</th><th></th></tr></thead><tbody>' +
        items.map(function (a, i) {
          return '<tr><td>' + esc(a.name) + '</td><td class="mono">' + esc(a.handle) + '</td><td>' + esc(a.memo) + '</td><td>' + esc(fmtDate(a.addedAt)) +
            '</td><td class="num"><button class="btn sm danger" data-act="del" data-i="' + i + '">삭제</button></td></tr>';
        }).join('') + '</tbody></table>';
    }
    function refresh() {
      return loadAccounts(p).then(function (list) {
        if (!root.isConnected) return;
        items = list; draw();
      }).catch(function () {
        var slot = root.querySelector('[data-slot="list"]');
        if (slot) slot.innerHTML = '<div class="empty">목록을 불러오지 못했습니다.</div>';
      });
    }
    refresh();

    root._onClick = function (btn) {
      if (btn.getAttribute('data-act') !== 'del') return;
      var a = items[Number(btn.getAttribute('data-i'))];
      if (!a) return;
      BB.confirm('"' + (a.name || a.handle) + '" 계정을 삭제할까요?').then(function (ok) {
        if (!ok) return;
        btn.disabled = true;
        return BB.api('/api/channels/delete', { p: p, handle: a.handle }).then(function () {
          BB.toast('삭제했습니다.');
          return refresh();
        });
      }).catch(function () { btn.disabled = false; });
    };

    root._onSubmit = function (form) {
      var name = form.elements.name.value.trim();
      var handle = c.normalize(form.elements.handle.value);
      var memo = form.elements.memo.value.trim();
      if (!name) { BB.toast('이름을 입력하세요.'); form.elements.name.focus(); return; }
      if (name.length > 30) { BB.toast('이름은 30자 이내로 입력하세요.'); return; }
      if (!handle) { BB.toast(c.handleLabel + '을(를) 입력하세요.'); form.elements.handle.focus(); return; }
      var err = c.validate(handle);
      if (err) { BB.toast(err); form.elements.handle.focus(); return; }
      if (items.some(function (a) { return String(a.handle).toLowerCase() === handle.toLowerCase(); })) {
        BB.toast('이미 등록된 계정입니다.'); return;
      }
      var sb = form.querySelector('button[type="submit"]');
      sb.disabled = true;
      BB.api('/api/channels', { p: p, name: name, handle: handle, memo: memo }).then(function () {
        BB.toast('등록했습니다.');
        form.reset();
        return refresh();
      }).catch(function () {}).then(function () { sb.disabled = false; });
    };
  }

  /* ---------- 설정 ---------- */
  function renderSettings(p, c, root) {
    root.innerHTML = pageHead(c, '설정', c.name + ' 발행 기본값을 정합니다.') +
      '<div class="panel"><div data-slot="form"><div class="empty">불러오는 중</div></div></div>';

    var current = {};
    loadSettings(p).catch(function () { return {}; }).then(function (st) {
      if (!root.isConnected) return;
      current = st || {};
      var html = '<form class="form" data-form="settings" autocomplete="off">';
      c.settings.forEach(function (f) {
        var v = current[f.k] != null ? current[f.k] : f.def;
        var id = 'chs-' + f.k;
        html += '<div class="field"><label for="' + id + '">' + esc(f.label) + '</label>';
        if (f.type === 'number') {
          html += '<input class="inp" type="number" id="' + id + '" name="' + f.k + '" min="' + f.min + '" max="' + f.max + '" step="1" value="' + esc(v) + '">' +
            '<div class="hint">' + esc((f.hint ? f.hint + ' ' : '') + f.min + '~' + f.max + ', 기본 ' + f.def) + '</div>';
        } else {
          html += '<input class="inp" type="text" id="' + id + '" name="' + f.k + '" maxlength="' + f.max + '" value="' + esc(v) + '">' +
            (f.hint ? '<div class="hint">' + esc(f.hint) + '</div>' : '');
        }
        html += '</div>';
      });
      html += '<div class="muted">플랫폼별 스팸 정책상 발행 간격과 횟수는 보수적으로 둡니다.</div>' +
        '<div class="muted" data-slot="lim"></div>' +
        '<div class="row"><button type="submit" class="btn pri">저장</button></div></form>';
      root.querySelector('[data-slot="form"]').innerHTML = html;
      loadInfo(p).then(function (info) {
        var s = root.querySelector('[data-slot="lim"]');
        if (!s || !info || !info.limits) return;
        s.textContent = '엔진 기본 한도: 하루 ' + info.limits.dailyMax + '건 · 간격 ' + info.limits.minIntervalMin +
          '분. 여기 저장한 값과 엔진 한도 중 더 엄격한 값으로 발행을 막습니다(저장하지 않으면 엔진 한도만 적용).';
      }).catch(function () {});
    });

    root._onSubmit = function (form) {
      var out = {};
      for (var k in current) if (Object.prototype.hasOwnProperty.call(current, k)) out[k] = current[k];
      for (var i = 0; i < c.settings.length; i++) {
        var f = c.settings[i];
        var raw = String(form.elements[f.k].value || '').trim();
        if (f.type === 'number') {
          var n = Number(raw);
          if (raw === '' || !Number.isInteger(n) || n < f.min || n > f.max) {
            BB.toast(f.label + '은(는) ' + f.min + '~' + f.max + ' 사이 정수로 입력하세요.');
            form.elements[f.k].focus();
            return;
          }
          out[f.k] = n;
        } else {
          if (f.normalize) raw = f.normalize(raw);
          if (raw.length > f.max) { BB.toast(f.label + '은(는) ' + f.max + '자 이내로 입력하세요.'); return; }
          var err = f.validate ? f.validate(raw) : '';
          if (err) { BB.toast(err); form.elements[f.k].focus(); return; }
          out[f.k] = raw;
          form.elements[f.k].value = raw;
        }
      }
      var sb = form.querySelector('button[type="submit"]');
      sb.disabled = true;
      BB.api('/api/channel-settings', { p: p, settings: out }).then(function () {
        current = out;
        BB.toast('저장했습니다.');
      }).catch(function () {}).then(function () { sb.disabled = false; });
    };
  }

  /* ---------- 연결 ---------- */
  function renderConnect(p, c, root) {
    var g = GUIDES[p] || { steps: [], notes: [] };
    root.innerHTML = pageHead(c, '연결', c.name + ' 공식 API에 연결합니다. 비밀번호는 받지도 저장하지도 않습니다.') +
      '<div class="panel"><div class="panel-h"><h2>연결 상태</h2><div class="row" data-slot="acts"></div></div>' +
      '<div data-slot="status"><div class="empty">불러오는 중</div></div><div data-slot="chk" style="margin-top:12px"></div></div>' +
      '<div class="panel"><div class="panel-h"><h2>연결 방법</h2></div><div data-slot="guide"></div></div>' +
      '<div class="panel"><div class="panel-h"><h2>엔진 설정</h2></div><div data-slot="form"></div></div>';

    var info = null;
    var slot = function (n) { return root.querySelector('[data-slot="' + n + '"]'); };

    function drawStatus() {
      var acc = info.account;
      var kv = '<dl class="kv">' +
        '<dt>상태</dt><dd>' + (info.connected ? '<span class="ok">연결됨</span>' : '<span class="muted">연결 필요</span>') + '</dd>' +
        '<dt>계정</dt><dd>' + (acc && acc.name ? esc(acc.name) + (acc.handle && acc.handle !== acc.name ? ' <span class="muted">' + esc(acc.handle) + '</span>' : '') : '<span class="muted">없음</span>') + '</dd>' +
        '<dt>연결 방식</dt><dd>' + (info.oauth ? '브라우저 로그인(OAuth)' : '토큰 붙여 넣기') + '</dd>' +
        '<dt>발행 한도</dt><dd>' + esc(quotaText(info.quota)) + '</dd>' +
        '</dl>';
      slot('status').innerHTML = kv;
      var acts = '';
      if (info.oauth) acts += '<button class="btn sm' + (info.connected ? '' : ' pri') + '" data-act="connect">연결하기</button>';
      acts += '<button class="btn sm" data-act="check">연결 확인</button>';
      if (info.connected) acts += '<button class="btn sm danger" data-act="disconnect">연결 해제</button>';
      slot('acts').innerHTML = acts;
    }

    function drawGuide() {
      // 돌아오는 주소 줄은 앞 단계 항목 안에 넣어 번호가 끊기지 않게 한다
      var items = [];
      g.steps.forEach(function (s) {
        if (s && s.redirect) {
          if (!info.oauth || !items.length) return;
          items[items.length - 1] += '<div class="row" style="margin:6px 0 4px"><input class="inp mono grow" readonly data-ref="redir" value="' + esc(info.redirectUri) + '" aria-label="돌아오는 주소">' +
            '<button class="btn sm" type="button" data-act="copy" data-ref="redir">복사</button></div>';
        } else items.push(esc(s));
      });
      var html = '<ol style="margin:0;padding-left:20px;line-height:1.7">' + items.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ol>';
      g.notes.forEach(function (n) { html += '<p class="muted" style="margin:10px 0 0">' + esc(n) + '</p>'; });
      slot('guide').innerHTML = html;
    }

    function drawForm() {
      var html = '<form class="form" data-form="engine" autocomplete="off">';
      info.configFields.forEach(function (f) {
        var id = 'eng-' + p + '-' + f.key;
        html += '<div class="field"><label for="' + id + '">' + esc(f.label) + (f.required ? '' : ' <span class="muted">(선택)</span>') + '</label>';
        if (f.secret) {
          html += '<input class="inp" type="password" id="' + id + '" name="' + esc(f.key) + '" autocomplete="new-password" placeholder="' +
            (f.hasValue ? '저장됨 - 바꿀 때만 입력' : '') + '">';
        } else {
          html += '<input class="inp" type="text" id="' + id + '" name="' + esc(f.key) + '" value="' + esc(info.config[f.key] || '') + '">';
        }
        if (f.hint) html += '<div class="hint">' + esc(f.hint) + '</div>';
        if (f.secret && f.hasValue) html += '<div><button class="link" type="button" data-act="clear" data-k="' + esc(f.key) + '">저장된 값 지우기</button></div>';
        html += '</div>';
      });
      html += '<div class="muted">비밀 항목은 이 PC의 Windows 사용자 계정으로 암호화해 저장하며 화면에 다시 보여 주지 않습니다.</div>' +
        '<div class="row"><button type="submit" class="btn pri">저장</button></div></form>';
      slot('form').innerHTML = html;
    }

    function refresh() {
      return loadInfo(p).then(function (i) {
        if (!root.isConnected) return;
        info = i; drawStatus(); drawGuide(); drawForm();
      }).catch(function () {
        var s = slot('status'); if (s) s.innerHTML = '<div class="empty">연결 정보를 불러오지 못했습니다.</div>';
      });
    }
    refresh();

    root._cleanups.push(BB.onEvent(function (ev) {
      if (!ev || ev.type !== 'chconnected' || !ev.data || ev.data.p !== p || !root.isConnected) return;
      BB.toast(c.name + ' 연결되었습니다.');
      slot('chk').innerHTML = '';
      refresh();
    }));

    root._onClick = function (btn) {
      var act = btn.getAttribute('data-act');
      if (!info) return;
      if (act === 'copy') {
        var inp = root.querySelector('input[data-ref="' + btn.getAttribute('data-ref') + '"]');
        if (!inp) return;
        var done = function () { BB.toast('복사했습니다.'); };
        var fallback = function () { inp.focus(); inp.select(); try { document.execCommand('copy'); done(); } catch (e) { BB.toast('주소를 선택했습니다. Ctrl+C로 복사하세요.'); } };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(inp.value).then(done, fallback);
        else fallback();
        return;
      }
      if (act === 'connect') {
        btn.disabled = true;
        BB.api('/api/engine/connect', { p: p }).then(function (r) {
          BB.openP(r.url);
          slot('chk').innerHTML = '<div class="muted">브라우저에서 로그인·동의를 마치면 이 화면이 자동으로 바뀝니다(10분 안에 완료). 브라우저가 열리지 않으면 아래 주소를 복사해 여세요.</div>' +
            '<div class="row" style="margin-top:6px"><input class="inp mono grow" readonly data-ref="authurl" value="' + esc(r.url) + '" aria-label="연결 주소">' +
            '<button class="btn sm" type="button" data-act="copy" data-ref="authurl">복사</button></div>';
        }).catch(function () {}).then(function () { btn.disabled = false; });
        return;
      }
      if (act === 'check') {
        btn.disabled = true;
        slot('chk').innerHTML = '<div class="muted">확인 중</div>';
        BB.api('/api/engine/check', { p: p }).then(function (r) {
          if (!root.isConnected) return;
          slot('chk').innerHTML = '<dl class="kv"><dt>연결 확인</dt><dd>' + (r.ok ? '<span class="ok">정상</span>' : '<span class="bad">실패</span>') +
            (r.name ? ' ' + esc(r.name) : '') + '</dd><dt>내용</dt><dd>' + esc(r.detail || '') + '</dd></dl>';
          if (r.ok) return loadInfo(p).then(function (i) { if (root.isConnected) { info = i; drawStatus(); } });
        }).catch(function () { var s = slot('chk'); if (s) s.innerHTML = ''; }).then(function () { btn.disabled = false; });
        return;
      }
      if (act === 'disconnect') {
        BB.confirm(c.name + ' 연결을 해제할까요?\n저장된 접근 토큰과 계정 정보를 지웁니다. Client ID 같은 설정은 남습니다.').then(function (ok) {
          if (!ok) return;
          return BB.api('/api/engine/disconnect', { p: p }).then(function () { BB.toast('연결을 해제했습니다.'); slot('chk').innerHTML = ''; return refresh(); });
        }).catch(function () {});
        return;
      }
      if (act === 'clear') {
        var k = btn.getAttribute('data-k');
        var f = info.configFields.filter(function (x) { return x.key === k; })[0];
        if (!f) return;
        BB.confirm('저장된 ' + f.label + ' 값을 지울까요?').then(function (ok) {
          if (!ok) return;
          return BB.api('/api/engine/config', { p: p, values: {}, clear: [k] }).then(function () { BB.toast('지웠습니다.'); return refresh(); });
        }).catch(function () {});
      }
    };

    root._onSubmit = function (form) {
      if (!info) return;
      var values = {};
      for (var i = 0; i < info.configFields.length; i++) {
        var f = info.configFields[i], el = form.elements[f.key];
        if (!el) continue;
        var v = String(el.value || '').trim();
        if (/[\r\n]/.test(v)) { BB.toast(f.label + '에 줄바꿈이 들어갈 수 없습니다.'); return; }
        if (f.required && !v && !(f.secret && f.hasValue)) { BB.toast(f.label + '을(를) 입력하세요.'); el.focus(); return; }
        values[f.key] = v;
      }
      var sb = form.querySelector('button[type="submit"]');
      sb.disabled = true;
      BB.api('/api/engine/config', { p: p, values: values }).then(function () {
        BB.toast('저장했습니다.');
        return refresh();
      }).catch(function () {}).then(function () { if (sb.isConnected) sb.disabled = false; });
    };
  }

  /* ---------- 원고·발행 ---------- */
  function renderPosts(p, c, root) {
    root.innerHTML = pageHead(c, '원고·발행', '원고함의 ' + c.name + ' 원고를 검사하고 미리 실행하거나 발행합니다.') +
      '<div class="panel"><div class="panel-h"><h2>채널 원고</h2><div class="row">' +
      '<button class="btn sm" data-act="folder">폴더 열기</button><button class="btn sm" data-act="reload">새로고침</button></div></div>' +
      '<div data-slot="meta" class="muted" style="margin-bottom:12px"></div>' +
      '<div data-slot="list"><div class="empty">불러오는 중</div></div></div>' +
      '<div class="panel"><div class="panel-h"><h2>실행</h2><div class="row">' +
      '<button class="btn sm" data-act="dry" disabled>미리 실행</button><button class="btn sm" data-act="queue" disabled title="작업 큐에 넣어 차례로 발행">큐에 추가</button><button class="btn sm pri" data-act="pub" disabled>발행</button></div></div>' +
      '<div data-slot="selinfo" class="muted" style="margin-bottom:10px">원고를 고르세요.</div>' +
      '<div class="log" data-slot="log"></div></div>';

    var data = null, sel = -1, open = {}, running = false;
    var slot = function (n) { return root.querySelector('[data-slot="' + n + '"]'); };
    var logEl = slot('log');
    function log(line, reset) {
      if (!logEl) return;
      if (reset) logEl.textContent = '';
      logEl.textContent += line + '\n';
      logEl.scrollTop = logEl.scrollHeight;
    }

    function imgText(x) {
      var parts = [];
      if (x.imageUrls) parts.push('공개 주소 ' + x.imageUrls);
      if (x.images) parts.push('파일 ' + x.images);
      return parts.length ? parts.join(' · ') : '없음';
    }

    function drawList() {
      var s = slot('list');
      if (!s || !data) return;
      slot('meta').innerHTML = (data.connected ? '<span class="ok">연결됨</span>' : '<span class="muted">연결 필요</span> <button class="link" data-act="go" data-to="connect">연결</button>') +
        ' · ' + esc(quotaText(data.quota)) +
        '<br>원고는 Claude의 bokbok-channels 스킬로 만들 수 있습니다. 위치: <span class="mono">' + esc(data.dir) + '</span>';
      if (!data.items.length) { s.innerHTML = '<div class="empty">원고가 없습니다. 원고함\\' + esc(p) + ' 폴더에 .json 원고를 넣으세요.</div>'; return; }
      var html = '<table class="tbl"><thead><tr><th>제목</th><th>이미지</th><th>검사 결과</th><th>마지막 발행</th></tr></thead><tbody>';
      data.items.forEach(function (x, i) {
        var res;
        if (x.problems.length) res = '<button class="link" type="button" data-act="detail" data-i="' + i + '"><span class="bad">문제 ' + x.problems.length + '</span>' + (x.warnings.length ? ' · 주의 ' + x.warnings.length : '') + '</button>';
        else if (x.warnings.length) res = '<span class="ok">통과</span> <button class="link" type="button" data-act="detail" data-i="' + i + '">주의 ' + x.warnings.length + '</button>';
        else res = '<span class="ok">통과</span>';
        var lr = x.lastResult;
        var last = lr ? (lr.ok ? '<span class="ok">성공</span> ' : '<span class="bad">실패</span> ') + '<span class="muted">' + esc(fmtTime(lr.at)) + '</span>' : '<span class="muted">없음</span>';
        html += '<tr class="click' + (i === sel ? ' sel' : '') + '" data-act="sel" data-i="' + i + '"><td>' + (x.title ? esc(x.title) : '<span class="muted">(제목 없음)</span>') +
          '<div class="mono muted">' + esc(x.file) + '</div></td><td>' + esc(imgText(x)) + '</td><td>' + res + '</td><td>' + last + '</td></tr>';
        if (open[x.file]) {
          html += '<tr><td colspan="4">' +
            x.problems.map(function (m) { return '<div class="bad">' + esc(m) + '</div>'; }).join('') +
            x.warnings.map(function (m) { return '<div class="muted">' + esc(m) + '</div>'; }).join('') + '</td></tr>';
        }
      });
      s.innerHTML = html + '</tbody></table>';
    }

    function cur() { return data && sel >= 0 ? data.items[sel] : null; }
    function drawActions() {
      var x = cur(), dry = root.querySelector('[data-act="dry"]'), pub = root.querySelector('[data-act="pub"]'), info = slot('selinfo'), qb = root.querySelector('[data-act="queue"]');
      if (!dry || !pub) return;
      if (qb) qb.disabled = !x || !!x.problems.length || !data.connected;
      var why = '';
      if (!x) why = '원고를 고르세요.';
      else if (x.problems.length) why = '원고에 문제가 있어 실행할 수 없습니다.';
      else if (running || data.busy) why = '발행 중입니다.';
      else if (!data.connected) why = '미리 실행만 할 수 있습니다. 발행하려면 먼저 연결하세요.';
      else if (data.quota && data.quota.left === 0) why = '24시간 발행 한도를 다 썼습니다.';
      else if (data.quota && data.quota.nextAt) why = fmtTime(data.quota.nextAt) + ' 이후에 발행할 수 있습니다.';
      dry.disabled = !x || !!x.problems.length || running;
      pub.disabled = !x || !!x.problems.length || running || !!data.busy || !data.connected || (data.quota && data.quota.left === 0) || !!(data.quota && data.quota.nextAt);
      info.innerHTML = x ? '<b>' + esc(x.title || x.file) + '</b>' + (why ? ' <span class="muted">' + esc(why) + '</span>' : '') : esc(why);
    }

    function refresh() {
      return loadPosts(p).then(function (r) {
        if (!root.isConnected) return;
        var keep = cur() && cur().file;
        data = r; sel = -1;
        if (keep) data.items.forEach(function (x, i) { if (x.file === keep) sel = i; });
        drawList(); drawActions();
      }).catch(function () {
        var s = slot('list'); if (s) s.innerHTML = '<div class="empty">원고 목록을 불러오지 못했습니다.</div>';
      });
    }
    refresh();

    root._cleanups.push(BB.onEvent(function (ev) {
      if (!ev || !ev.data || ev.data.p !== p || !root.isConnected) return;
      if (ev.type === 'chlog') log(String(ev.data.line || ''));
      else if (ev.type === 'chdone') {
        running = false;
        if (ev.data.error) { log('실패: ' + ev.data.error); BB.toast('발행하지 못했습니다.'); }
        else {
          var rr = ev.data.result || {};
          log('발행 완료' + (rr.id ? ' · id ' + rr.id : '') + (rr.url ? ' · ' + rr.url : ''));
          BB.toast('발행했습니다.');
        }
        refresh();
      }
    }));

    root._onClick = function (btn) {
      var act = btn.getAttribute('data-act');
      if (act === 'reload') { refresh(); return; }
      if (act === 'folder') { if (data) BB.openP(data.dir); return; }
      if (act === 'sel' || act === 'detail') {
        var i = Number(btn.getAttribute('data-i'));
        if (!data || !data.items[i]) return;
        if (act === 'detail') { var f = data.items[i].file; open[f] = !open[f]; }
        sel = i; drawList(); drawActions();
        return;
      }
      var x = cur();
      if (!x) return;
      if (act === 'dry') {
        btn.disabled = true;
        log('미리 실행: ' + x.file + ' (실제로 보내지 않음)', true);
        BB.api('/api/engine/publish', { p: p, file: x.file, dryRun: true }).then(function (r) {
          (r.warnings || []).forEach(function (w) { log(w); });
          log(JSON.stringify(r.result && r.result.payload, null, 2));
          if (logEl) logEl.scrollTop = 0;
        }).catch(function (e) { log('실패: ' + e.message); }).then(function () { drawActions(); });
        return;
      }
      if (act === 'queue') {
        if (BB.jobs) BB.jobs.add({ lane: 'channel', p: p, file: x.file }).catch(function () { });
        return;
      }
      if (act === 'pub') {
        var q = data.quota || {};
        var msg = c.name + '에 발행할까요?\n\n제목: ' + (x.title || x.file) + '\n' +
          (q.dailyMax != null ? '24시간 남은 발행: ' + q.left + '/' + q.dailyMax + '건' : '') + (q.intervalMin ? ' · 발행 간격 ' + q.intervalMin + '분' : '') +
          (x.warnings.length ? '\n\n' + x.warnings.join('\n') : '');
        BB.confirm(msg, '발행').then(function (ok) {
          if (!ok) return;
          running = true; drawActions();
          log('발행 시작: ' + x.file, true);
          return BB.api('/api/engine/publish', { p: p, file: x.file, dryRun: false }).catch(function (e) {
            running = false; log('실패: ' + e.message); drawActions();
          });
        });
      }
    };
  }

  /* ---------- 발행 기록 ---------- */
  function renderHistory(p, c, root) {
    root.innerHTML = pageHead(c, '발행 기록', c.name + '에 실제로 발행한 기록입니다(미리 실행은 남기지 않습니다).') +
      '<div class="panel"><div class="panel-h"><h2>기록</h2><button class="btn sm" data-act="reload">새로고침</button></div><div data-slot="list"><div class="empty">불러오는 중</div></div></div>';
    var items = [];
    function refresh() {
      return BB.api('/api/channel-history?p=' + encodeURIComponent(p)).then(function (r) {
        if (!root.isConnected) return;
        items = (r && r.items) || [];
        var s = root.querySelector('[data-slot="list"]');
        if (!items.length) { s.innerHTML = '<div class="empty">발행 기록이 없습니다.</div>'; return; }
        s.innerHTML = '<table class="tbl"><thead><tr><th>시각</th><th>원고</th><th>결과</th><th></th></tr></thead><tbody>' +
          items.map(function (h, i) {
            return '<tr><td class="mono">' + esc(fmtTime(h.at)) + '</td><td>' + esc(h.title || '') + '<div class="mono muted">' + esc(h.file) + '</div></td><td>' +
              (h.ok ? '<span class="ok">성공</span>' + (h.id ? ' <span class="mono muted">' + esc(h.id) + '</span>' : '') : '<span class="bad">실패</span> ' + esc(h.error || '')) +
              '</td><td class="num">' + (h.ok && h.url ? '<button class="btn sm" data-act="open" data-i="' + i + '">열기</button>' : '') + '</td></tr>';
          }).join('') + '</tbody></table>';
      }).catch(function () {
        var s = root.querySelector('[data-slot="list"]'); if (s) s.innerHTML = '<div class="empty">기록을 불러오지 못했습니다.</div>';
      });
    }
    refresh();
    root._onClick = function (btn) {
      var act = btn.getAttribute('data-act');
      if (act === 'reload') { refresh(); return; }
      if (act === 'open') { var h = items[Number(btn.getAttribute('data-i'))]; if (h && /^https:\/\//.test(h.url || '')) BB.openP(h.url); }
    };
  }

  /* ---------- 공용 팩토리 ---------- */
  function makeChannel(p, c) {
    return {
      name: c.name,
      desc: c.desc,
      order: c.order,
      ready: false,
      engine: !c.noEngine,
      nav: c.noEngine ? [['overview', '개요'], ['accounts', '계정 메모'], ['settings', '설정']] : NAV,
      render: function (page, el) {
        var root = document.createElement('div');
        root.className = 'stack';
        el.innerHTML = '';
        el.appendChild(root);

        var onClick = function (e) {
          var btn = e.target.closest('[data-act]');
          if (!btn || !root.contains(btn)) return;
          if (btn.getAttribute('data-act') === 'go') {
            e.preventDefault();
            BB.go('#/' + p + '/' + btn.getAttribute('data-to'));
            return;
          }
          if (root._onClick) root._onClick(btn);
        };
        var onSubmit = function (e) {
          var form = e.target.closest('form[data-form]');
          if (!form) return;
          e.preventDefault();
          if (root._onSubmit) root._onSubmit(form);
        };
        root.addEventListener('click', onClick);
        root.addEventListener('submit', onSubmit);
        root._cleanups = [];

        if (page === 'accounts') renderAccounts(p, c, root);
        else if (page === 'settings') renderSettings(p, c, root);
        else if (page === 'connect') renderConnect(p, c, root);
        else if (page === 'posts') renderPosts(p, c, root);
        else if (page === 'history') renderHistory(p, c, root);
        else renderOverview(p, c, root);

        return function () {
          root.removeEventListener('click', onClick);
          root.removeEventListener('submit', onSubmit);
          (root._cleanups || []).forEach(function (f) { try { if (typeof f === 'function') f(); } catch (e) { /* 무시 */ } });
          root._cleanups = [];
          root._onClick = root._onSubmit = null;
        };
      }
    };
  }

  Object.keys(CHANNELS).forEach(function (p) {
    try { BB.mod(p, makeChannel(p, CHANNELS[p])); } catch (e) { if (window.console) console.error('channels:', p, e); }
  });
})();
