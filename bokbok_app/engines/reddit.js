// 레딧 엔진 — 공식 OAuth2(코드 그랜트, duration=permanent) + oauth.reddit.com Data API
// 비밀번호(script) 그랜트는 쓰지 않는다. 토큰은 ctx.setSecret 으로만 저장.
// 레이트리밋 헤더(X-Ratelimit-*)가 필요해 common.request 대신 헤더를 돌려주는 작은 fetch 래퍼를 쓴다(_setRequest 로 교체 가능).
const { ApiError, sleep, redact } = require('./common');

const AUTH_URL = 'https://www.reddit.com/api/v1/authorize';
const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const API = 'https://oauth.reddit.com';
const SCOPES = ['identity', 'submit', 'read', 'flair'];
const VERSION = '2.0.0';
const SR_RE = /^[A-Za-z0-9_]{2,21}$/;
const MAX_WAIT_MS = 60 * 1000;   // 레이트리밋 리셋까지 이 시간 이하면 기다리고, 넘으면 실패로 알린다

// ---- HTTP: (url, {method, headers, form, query, timeoutMs}) -> {status, headers:{소문자키:값}, data}
async function fetchRequest(url, { method = 'GET', headers = {}, form, query, timeoutMs = 30000 } = {}) {
  const u = new URL(url);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  const h = { ...headers };
  let body;
  if (form) {
    body = new URLSearchParams(Object.entries(form).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])).toString();
    h['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(u, { method, headers: h, body, signal: ac.signal });
    const text = await res.text();
    let data = text;
    try { data = JSON.parse(text); } catch { }
    const hdrs = {};
    res.headers.forEach((v, k) => { hdrs[k.toLowerCase()] = v; });
    return { status: res.status, headers: hdrs, data };
  } catch (e) {
    throw new ApiError(`레딧 연결 실패: ${e.name === 'AbortError' ? '시간 초과' : e.message}`, {});
  } finally { clearTimeout(t); }
}
let doRequest = fetchRequest;
function _setRequest(fn) { doRequest = fn || fetchRequest; }

// ---- 레이트리밋 상태 (프로세스 내 공유)
const rate = { remaining: null, used: null, resetAt: null };
function _resetRate() { rate.remaining = null; rate.used = null; rate.resetAt = null; }
function noteRate(headers = {}) {
  const rem = Number(headers['x-ratelimit-remaining']);
  const reset = Number(headers['x-ratelimit-reset']);
  const used = Number(headers['x-ratelimit-used']);
  if (headers['x-ratelimit-remaining'] !== undefined && Number.isFinite(rem)) rate.remaining = rem;
  if (headers['x-ratelimit-used'] !== undefined && Number.isFinite(used)) rate.used = used;
  if (headers['x-ratelimit-reset'] !== undefined && Number.isFinite(reset)) rate.resetAt = Date.now() + reset * 1000;
}
async function waitForRate(log) {
  if (rate.remaining === null || rate.remaining >= 1 || !rate.resetAt) return;
  const ms = rate.resetAt - Date.now();
  if (ms <= 0) return;
  if (ms > MAX_WAIT_MS) throw new ApiError(`레딧 API 호출 한도 소진 — ${Math.ceil(ms / 1000)}초 뒤 다시 시도`, { status: 429, step: 'ratelimit' });
  log && log(`레딧 호출 한도 소진, ${Math.ceil(ms / 1000)}초 대기`);
  await sleep(ms + 500);
}

const userAgent = ctx => `windows:bokbok.publisher:${VERSION} (by /u/${(ctx.config && ctx.config.redditUsername || 'unknown').replace(/^\/?u\//i, '')})`;

async function call(ctx, step, url, opts = {}, retried = false) {
  await waitForRate(ctx.log);
  const res = await doRequest(url, { ...opts, headers: { 'User-Agent': userAgent(ctx), ...(opts.headers || {}) } });
  noteRate(res.headers || {});
  ctx.log && ctx.log(`${step} ${res.status} ${redact(new URL(url).origin + new URL(url).pathname)}`);
  if (res.status === 429) {
    const reset = Number((res.headers || {})['x-ratelimit-reset'] || (res.headers || {})['retry-after']);
    const ms = Number.isFinite(reset) && reset > 0 ? reset * 1000 : 5000;
    if (!retried && ms <= MAX_WAIT_MS) { await sleep(ms + 500); return call(ctx, step, url, opts, true); }
    throw new ApiError(`${step}: 레딧 호출 한도 초과 — ${Math.ceil(ms / 1000)}초 뒤 다시 시도`, { status: 429, body: res.data, step });
  }
  if (res.status >= 500 && !retried) { await sleep(2000); return call(ctx, step, url, opts, true); }
  if (res.status < 200 || res.status >= 300) {
    const d = res.data;
    let msg = `${step} 실패 (${res.status})`;
    if (res.status === 401) msg += ': 토큰이 만료됐거나 취소됨 — 레딧 다시 연결';
    else if (res.status === 403) msg += ': 권한 없음(앱 승인·스코프·서브레딧 제한 확인)';
    else if (res.status === 404) msg += ': 대상을 찾을 수 없음';
    msg += ' ' + redact(typeof d === 'string' ? d.slice(0, 200) : JSON.stringify(d || '').slice(0, 200));
    throw new ApiError(msg, { status: res.status, body: d, step });
  }
  return res.data;
}

// ---- 토큰
async function basicAuth(ctx) {
  const id = ctx.config && ctx.config.clientId;
  if (!id) throw new ApiError('레딧 client_id가 설정되지 않음', { step: 'config' });
  const secret = (await ctx.getSecret('clientSecret')) || '';   // installed app 은 빈 문자열
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
}
async function tokenRequest(ctx, step, form) {
  let data;
  try {
    data = await call(ctx, step, TOKEN_URL, { method: 'POST', form, headers: { Authorization: await basicAuth(ctx) } });
  } catch (e) {
    if (e.status === 401) throw new ApiError(`${step} 실패: client_id/secret 불일치(앱 종류 installed/web 확인)`, { status: 401, body: e.body, step });
    throw e;
  }
  if (!data || data.error || !data.access_token) {
    const e = data && data.error;
    const why = e === 'invalid_grant' ? '인증 코드/리프레시 토큰이 만료되었거나 이미 사용됨 — 다시 연결'
      : e === 'unsupported_grant_type' ? '지원하지 않는 그랜트' : e === 401 || e === 'invalid_client' ? 'client_id/secret 불일치' : String(e || '응답에 access_token 없음');
    throw new ApiError(`${step} 실패: ${why}`, { body: data, step });
  }
  return data;
}
async function saveTokens(ctx, data) {
  await ctx.setSecret('accessToken', data.access_token);
  await ctx.setSecret('tokenExpiresAt', String(Date.now() + (Number(data.expires_in) || 3600) * 1000));
  if (data.refresh_token) await ctx.setSecret('refreshToken', data.refresh_token);
}
async function accessToken(ctx, force = false) {
  const tok = await ctx.getSecret('accessToken');
  const exp = Number(await ctx.getSecret('tokenExpiresAt')) || 0;
  if (!force && tok && exp - Date.now() > 60 * 1000) return tok;
  const refresh = await ctx.getSecret('refreshToken');
  if (!refresh) throw new ApiError('레딧이 연결되지 않음 — 설정에서 레딧 연결 먼저', { step: 'token' });
  const data = await tokenRequest(ctx, '토큰 갱신', { grant_type: 'refresh_token', refresh_token: refresh });
  await saveTokens(ctx, data);
  return data.access_token;
}
async function api(ctx, step, path, opts = {}) {
  const url = API + path;
  try {
    return await call(ctx, step, url, { ...opts, headers: { Authorization: 'Bearer ' + await accessToken(ctx) } });
  } catch (e) {
    if (e.status !== 401) throw e;   // 만료 직전 토큰 등 → 한 번 강제 갱신 후 재시도
    return call(ctx, step, url, { ...opts, headers: { Authorization: 'Bearer ' + await accessToken(ctx, true) } });
  }
}

// ---- 인터페이스
function authUrl(ctx) {
  const id = ctx.config && ctx.config.clientId;
  if (!id) throw new Error('레딧 client_id를 먼저 입력');
  if (!ctx.state) throw new Error('state 값 없음');
  const u = new URL(AUTH_URL);
  u.searchParams.set('client_id', id);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('state', ctx.state);
  u.searchParams.set('redirect_uri', ctx.redirectUri);
  u.searchParams.set('duration', 'permanent');
  u.searchParams.set('scope', SCOPES.join(' '));
  return u.toString();
}

async function authCallback(ctx, query = {}) {
  if (query.error) throw new ApiError(query.error === 'access_denied' ? '레딧 연결을 거부함' : `레딧 인증 오류: ${query.error}`, { step: 'authorize' });
  if (!query.state || query.state !== ctx.state) throw new ApiError('state 값이 맞지 않음 — 연결을 처음부터 다시', { step: 'authorize' });
  if (!query.code) throw new ApiError('인증 코드 없음', { step: 'authorize' });
  const data = await tokenRequest(ctx, '토큰 발급', { grant_type: 'authorization_code', code: query.code, redirect_uri: ctx.redirectUri });
  if (!data.refresh_token) throw new ApiError('리프레시 토큰이 오지 않음(duration=permanent 확인)', { step: '토큰 발급' });
  await saveTokens(ctx, data);
  const me = await call(ctx, '내 계정', API + '/api/v1/me', { headers: { Authorization: 'Bearer ' + data.access_token } });
  return { account: { name: me.name, handle: 'u/' + me.name, id: me.id } };
}

async function check(ctx) {
  try {
    const me = await api(ctx, '내 계정', '/api/v1/me');
    const exp = Number(await ctx.getSecret('tokenExpiresAt')) || 0;
    const karma = me.total_karma ?? ((me.link_karma || 0) + (me.comment_karma || 0));
    const parts = [`u/${me.name}`, `카르마 ${karma} (글 ${me.link_karma || 0} · 댓글 ${me.comment_karma || 0})`];
    if (rate.remaining !== null) parts.push(`API 남은 호출 ${Math.floor(rate.remaining)}회` + (rate.resetAt ? ` (${Math.max(0, Math.ceil((rate.resetAt - Date.now()) / 1000))}초 뒤 초기화)` : ''));
    if (exp) parts.push(`액세스 토큰 만료 ${new Date(exp).toLocaleString('ko-KR')} (자동 갱신)`);
    if (me.is_suspended) return { ok: false, name: me.name, detail: '계정 정지 상태 · ' + parts.join(' · ') };
    return { ok: true, name: me.name, detail: parts.join(' · '), karma, rateRemaining: rate.remaining };
  } catch (e) {
    return { ok: false, name: '', detail: e.message };
  }
}

const subredditOf = (post, config = {}) => String((post.target && post.target.subreddit) || config.subreddit || '').trim().replace(/^\/?r\//i, '');
const kindOf = post => (post.options && post.options.kind) || (post.link && !String(post.body || '').trim() ? 'link' : 'self');

// validate(post, config?) — config 는 ctx.config(기본 서브레딧). 네트워크 호출 없음
function validate(post, config = {}) {
  const errs = [];
  if (!post || typeof post !== 'object') return ['원고 형식이 아님'];
  const sr = subredditOf(post, config && config.config ? config.config : config);
  if (!sr) errs.push('서브레딧 미지정 (target.subreddit)');
  else if (!SR_RE.test(sr)) errs.push(`서브레딧 이름 형식이 아님: ${sr}`);
  const title = String(post.title || '').trim();
  if (!title) errs.push('제목 없음');
  else if ([...title].length > 300) errs.push(`제목이 300자를 넘음 (${[...title].length}자)`);
  if ((post.images && post.images.length) || (post.imageUrls && post.imageUrls.length)) errs.push('레딧 이미지 글은 아직 지원 안 함');
  const kind = kindOf(post);
  if (kind === 'self') {
    if (!String(post.body || '').trim()) errs.push('텍스트 글은 본문 필요');
    else if (String(post.body).length > 40000) errs.push('본문이 40,000자를 넘음');
  } else if (kind === 'link') {
    let ok = false;
    try { ok = new URL(post.link).protocol === 'https:'; } catch { }
    if (!ok) errs.push('링크 글은 https 링크 필요');
  } else errs.push(`지원하지 않는 글 종류: ${kind}`);
  return errs;
}

function buildForm(post, config = {}) {
  const kind = kindOf(post);
  const o = post.options || {};
  let text = String(post.body || '');
  if (kind === 'self' && post.link && !text.includes(post.link)) text += `\n\n${post.link}`;
  const form = {
    api_type: 'json',
    sr: subredditOf(post, config),
    kind,
    title: String(post.title).trim(),
    resubmit: 'true',
    sendreplies: 'true',
    nsfw: o.nsfw ? 'true' : 'false',
    spoiler: o.spoiler ? 'true' : 'false',
  };
  if (kind === 'self') form.text = text; else form.url = post.link;
  if (o.flairId) form.flair_id = o.flairId;
  if (o.flairText) form.flair_text = o.flairText;
  return form;
}

// /api/submit 의 json.errors: [[코드, 메시지, 필드], ...]
function waitText(msg) {
  const m = /(\d+)\s*(second|minute|hour|초|분)/i.exec(String(msg || ''));
  if (!m) return '';
  const unit = /^s|초/i.test(m[2]) ? '초' : /^h/i.test(m[2]) ? '시간' : '분';
  return `${m[1]}${unit}`;
}
function submitErrorMessage(errors) {
  return errors.map(([code, msg, field]) => {
    switch (code) {
      case 'RATELIMIT': { const w = waitText(msg); return `글 작성 제한(너무 자주 올림)${w ? ` — ${w} 뒤 다시 시도` : ''}`; }
      case 'SUBREDDIT_NOEXIST': return '서브레딧이 없음';
      case 'SUBREDDIT_NOTALLOWED': return '이 서브레딧에 글을 올릴 권한 없음';
      case 'SUBREDDIT_REQUIRED': return '서브레딧 미지정';
      case 'NO_LINKS': return '이 서브레딧은 링크 글을 허용 안 함 — 텍스트 글로';
      case 'NO_SELFS': return '이 서브레딧은 텍스트 글을 허용 안 함 — 링크 글로';
      case 'ALREADY_SUB': return '이미 올라간 링크';
      case 'NO_TEXT': return '제목 또는 본문 없음';
      case 'TOO_LONG': return `${field === 'title' ? '제목' : '내용'}이 너무 김`;
      case 'BAD_URL': return '링크 주소가 잘못됨';
      case 'BAD_FLAIR_TARGET': case 'SUBMIT_VALIDATION_FLAIR_REQUIRED': return '이 서브레딧은 플레어 필수 — options.flairId 지정 (getFlairs 로 조회)';
      case 'USER_REQUIRED': return '로그인 필요 — 레딧 다시 연결';
      case 'BANNED_FROM_SUBREDDIT': return '이 서브레딧에서 차단된 계정';
      case 'INVALID_OPTION': return `잘못된 값: ${field || msg}`;
      default: return `${code}${msg ? ': ' + msg : ''}`;
    }
  }).join(' / ');
}

async function publish(ctx, post, { dryRun = false } = {}) {
  const errs = validate(post, ctx.config || {});
  if (errs.length) throw new ApiError('원고 확인 실패: ' + errs.join(', '), { step: 'validate' });
  const form = buildForm(post, ctx.config || {});
  if (dryRun) return { id: null, url: null, dryRun: true, payload: { endpoint: API + '/api/submit', method: 'POST', form } };
  const data = await api(ctx, '글 등록', '/api/submit', { method: 'POST', form });
  const j = data && data.json;
  if (!j) throw new ApiError('글 등록 응답 형식이 예상과 다름', { body: data, step: '글 등록' });
  if (Array.isArray(j.errors) && j.errors.length) {
    const first = j.errors[0] || [];
    throw new ApiError('레딧 글 등록 실패: ' + submitErrorMessage(j.errors), { body: data, step: '글 등록', status: first[0] === 'RATELIMIT' ? 429 : 400 });
  }
  const d = j.data || {};
  const id = d.id || (d.name || '').replace(/^t3_/, '') || null;
  let url = d.url || null;
  if (url && !/\/comments\//.test(url) && id) url = `https://www.reddit.com/r/${form.sr}/comments/${id}/`;   // 링크 글은 url 이 외부 링크
  if (!url && id) url = `https://www.reddit.com/r/${form.sr}/comments/${id}/`;
  return { id: d.name || (id ? 't3_' + id : null), url, dryRun: false };
}

// ---- 보조: 플레어·규칙 조회 (앱 화면에서 선택지로 사용)
async function getFlairs(ctx, subreddit) {
  const sr = String(subreddit || '').replace(/^\/?r\//i, '');
  if (!SR_RE.test(sr)) throw new Error('서브레딧 이름 형식이 아님');
  const list = await api(ctx, '플레어 조회', `/r/${sr}/api/link_flair_v2`);
  return (Array.isArray(list) ? list : []).map(f => ({ id: f.id, text: f.text, editable: !!f.text_editable, modOnly: !!f.mod_only }));
}
async function getRules(ctx, subreddit) {
  const sr = String(subreddit || '').replace(/^\/?r\//i, '');
  if (!SR_RE.test(sr)) throw new Error('서브레딧 이름 형식이 아님');
  const r = await api(ctx, '규칙 조회', `/r/${sr}/about/rules`);
  return ((r && r.rules) || []).map(x => ({ name: x.short_name, kind: x.kind, description: x.description }));
}

module.exports = {
  platform: 'reddit',
  label: '레딧',
  configFields: [
    { key: 'clientId', label: 'Client ID', required: true, hint: 'reddit.com/prefs/apps 에서 앱 생성(installed app 권장) → 앱 이름 아래 문자열. redirect uri: http://127.0.0.1:3600/oauth/reddit/callback' },
    { key: 'clientSecret', label: 'Client Secret', secret: true, required: false, hint: 'web app 으로 만들었을 때만 입력. installed app 은 비워 둠' },
    { key: 'redditUsername', label: '레딧 사용자명', required: true, hint: 'User-Agent 에 들어감(레딧 규정). u/ 없이 이름만' },
    { key: 'subreddit', label: '기본 서브레딧', required: false, hint: '원고에 target.subreddit 이 없을 때 사용. r/ 없이' },
  ],
  limits: { dailyMax: 3, minIntervalMin: 30, titleMax: 300, bodyMax: 40000, imagesMax: 0 },
  authUrl, authCallback, check, validate, publish,
  getFlairs, getRules,
  // 시험용
  _setRequest, _resetRate, _rate: rate, _buildForm: buildForm, _submitErrorMessage: submitErrorMessage, _userAgent: userAgent,
};
