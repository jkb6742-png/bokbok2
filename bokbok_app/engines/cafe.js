// 네이버 카페 엔진 — 공식 Open API만 사용
//  - 로그인: 네이버 로그인 OAuth 2.0 (https://nid.naver.com/oauth2.0/authorize · /token)
//  - 글쓰기: POST https://openapi.naver.com/v1/cafe/{clubid}/menu/{menuid}/articles
//    처리한도 200건/일(네이버 계정당). 이미지는 multipart 'image' 필드 반복, 본문에서 <img src="#0"> 로 위치 지정.
//
// subject/content 인코딩 (공식 문서·샘플 기준):
//   문서: "URL 인코딩하여 요청함 — 해당 string은 UTF-8로 encode 후 MS949로 재 encode를 수행한 값"
//   즉 서버는 전송 계층(form/multipart)을 풀고 나서 값을 한 번 더 URL 디코드한다.
//   따라서 '파라미터 값' 자체가 UTF-8 퍼센트 인코딩 문자열(encodeURIComponent)이어야 한다.
//   - form(x-www-form-urlencoded): 값=encodeURIComponent(text) → URLSearchParams가 한 번 더 인코딩
//     → 전송 바이트는 이중 인코딩 (Java 샘플 URLEncoder.encode(URLEncoder.encode(s,"UTF-8"),"MS949")와 동일.
//     안쪽 결과가 ASCII라 바깥 MS949 인코딩은 사실상 '%'→'%25' 처리일 뿐 MS949 문자는 생기지 않음)
//   - multipart: 값=encodeURIComponent(text) 그대로 (Python/Node multipart 샘플의 quote/encodeURI 1회와 동일)
const fs = require('fs'), path = require('path');
const common = require('./common');

let request = common.request;
function _setRequest(fn) { request = fn || common.request; }

const AUTH_URL = 'https://nid.naver.com/oauth2.0/authorize';
const TOKEN_URL = 'https://nid.naver.com/oauth2.0/token';
const PROFILE_URL = 'https://openapi.naver.com/v1/nid/me';
const articleUrl = (clubId, menuId) => `https://openapi.naver.com/v1/cafe/${clubId}/menu/${menuId}/articles`;
const REFRESH_MARGIN_MS = 5 * 60 * 1000;   // 만료 5분 전부터 미리 갱신
const IMG_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
// 공식 글쓰기 선택 파라미터(boolean) — post.options 에 있으면 그대로 전달
const BOOL_OPTS = ['openyn', 'searchopen', 'replyyn', 'scrapyn', 'metoo', 'autosourcing', 'rclick', 'ccl'];

const limits = {
  dailyMax: 20,          // API 한도는 200건/일(계정당)이지만 카페 스팸 차단(AP005)을 피하려고 낮게 둔다
  minIntervalMin: 10,
  titleMax: 100,
  bodyMax: 20000,
  imagesMax: 10,
};

const configFields = [
  { key: 'clientId', label: 'Client ID', required: true,
    hint: '네이버 개발자센터(developers.naver.com) → Application → 애플리케이션 등록. 사용 API에 "카페"와 "네이버 로그인"을 추가하고, 로그인 오픈 API 서비스 환경 PC웹에 서비스 URL http://127.0.0.1:3600 , Callback URL http://127.0.0.1:3600/oauth/cafe/callback 을 입력한 뒤 발급된 Client ID를 붙여 넣습니다.' },
  { key: 'clientSecret', label: 'Client Secret', secret: true, required: true,
    hint: '같은 애플리케이션 화면의 Client Secret. 이 PC 사용자 계정으로 암호화 저장되며 다시 표시되지 않습니다.' },
  { key: 'defaultClubId', label: '기본 카페 ID(clubid)',
    hint: '숫자. 카페 관리 화면 주소 cafe.naver.com/ManageHome.nhn?clubid=12345678 의 숫자. 원고 target.clubId가 비어 있으면 사용합니다.' },
  { key: 'defaultMenuId', label: '기본 게시판 ID(menuid)',
    hint: '숫자. 게시판 주소의 menuid= 값. 원고 target.menuId가 비어 있으면 사용합니다. 글쓰기 권한이 있는 게시판이어야 합니다.' },
];

// ---------- 본문 변환 ----------
const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function buildContent(post) {
  let text = String(post.body || '').replace(/\r\n?/g, '\n');
  if (post.link && !text.includes(post.link)) text += `\n\n${post.link}`;
  const tags = (post.tags || []).map(t => String(t).trim().replace(/^#/, '').replace(/\s+/g, '')).filter(Boolean);
  if (tags.length) text += '\n\n' + tags.map(t => '#' + t).join(' ');
  let html = escapeHtml(text).replace(/\n/g, '<br>');
  const n = (post.images || []).length;
  for (let i = 0; i < n; i++) html += `<br><img src="#${i}" />`;
  return html;
}
const buildSubject = post => String(post.title || '').replace(/[\r\n]+/g, ' ').trim();
const encodeValue = s => encodeURIComponent(s);   // 위 인코딩 설명 참고

function resolveTarget(post, config = {}) {
  const t = post.target || {};
  return {
    clubId: String(t.clubId || config.defaultClubId || '').trim(),
    menuId: String(t.menuId || config.defaultMenuId || '').trim(),
  };
}

// ---------- 검사 (네트워크 없음) ----------
// config 를 넘기면 설정 기본값까지 포함해 clubId/menuId 필수 검사. 넘기지 않으면 원고에 있는 값만 형식 검사(publish 때 다시 검사).
function validate(post, config) {
  const errs = [];
  if (!post || typeof post !== 'object') return ['원고 형식이 아님'];
  const title = buildSubject(post);
  if (!title) errs.push('제목이 비어 있음');
  else if ([...title].length > limits.titleMax) errs.push(`제목이 ${limits.titleMax}자를 넘음 (${[...title].length}자)`);
  const body = String(post.body || '').trim();
  if (!body) errs.push('본문이 비어 있음');
  else if (body.length > limits.bodyMax) errs.push(`본문이 ${limits.bodyMax}자를 넘음 (${body.length}자)`);

  const { clubId, menuId } = resolveTarget(post, config || {});
  for (const [k, v, label] of [['clubId', clubId, '카페 ID(clubId)'], ['menuId', menuId, '게시판 ID(menuId)']]) {
    if (v) { if (!/^\d{1,12}$/.test(v)) errs.push(`${label}는 숫자여야 함: ${v}`); }
    else if (config) errs.push(`${label} 없음 — 원고 target.${k} 또는 설정 기본값 필요`);
  }

  const images = post.images || [];
  if (!Array.isArray(images)) errs.push('images는 배열이어야 함');
  else {
    if (images.length > limits.imagesMax) errs.push(`이미지는 ${limits.imagesMax}장까지 (${images.length}장)`);
    for (const p of images) {
      if (!IMG_EXT.includes(path.extname(String(p)).toLowerCase())) errs.push(`이미지 형식이 아님(jpg/png/gif/webp): ${path.basename(String(p))}`);
      else if (!fs.existsSync(p)) errs.push(`이미지 파일 없음: ${p}`);
    }
  }
  if ((!images || !images.length) && (post.imageUrls || []).length)
    errs.push('카페는 로컬 이미지 파일(images)만 첨부 가능 — imageUrls는 사용하지 않음');
  return errs;
}

// ---------- 토큰 ----------
function tokenError(data, step) {
  if (data && typeof data === 'object' && data.error)
    return new common.ApiError(`${step} 실패: ${data.error}${data.error_description ? ' — ' + data.error_description : ''}`, { body: data, step });
  if (!data || !data.access_token) return new common.ApiError(`${step} 실패: 응답에 access_token 없음`, { body: data, step });
  return null;
}

async function saveTokens(ctx, data, keepRefresh) {
  const expiresIn = Number(data.expires_in) || 3600;
  await ctx.setSecret('accessToken', data.access_token);
  if (data.refresh_token || keepRefresh) await ctx.setSecret('refreshToken', data.refresh_token || keepRefresh);
  await ctx.setSecret('tokenExpiresAt', String(Date.now() + expiresIn * 1000));
}

async function clientCreds(ctx) {
  const clientId = ctx.config && ctx.config.clientId;
  const clientSecret = await ctx.getSecret('clientSecret');
  if (!clientId || !clientSecret) throw new Error('Client ID / Client Secret 설정 필요');
  return { clientId, clientSecret };
}

async function refreshToken(ctx) {
  const rt = await ctx.getSecret('refreshToken');
  if (!rt) throw new Error('네이버 로그인 연결 필요 (갱신 토큰 없음)');
  const { clientId, clientSecret } = await clientCreds(ctx);
  const data = await request(TOKEN_URL, {
    method: 'POST', step: '토큰 갱신', log: ctx.log,
    query: { grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: rt },
  });
  const err = tokenError(data, '토큰 갱신');
  if (err) throw err;
  await saveTokens(ctx, data, rt);   // 갱신 응답에는 refresh_token이 없을 수 있어 기존 값 유지
  ctx.log && ctx.log('카페: 접근 토큰 갱신');
  return data.access_token;
}

async function getToken(ctx, { force = false } = {}) {
  const at = await ctx.getSecret('accessToken');
  const exp = Number(await ctx.getSecret('tokenExpiresAt')) || 0;
  if (!force && at && exp - Date.now() > REFRESH_MARGIN_MS) return at;
  return refreshToken(ctx);
}

// 401이면 한 번 강제 갱신 후 재시도
async function authed(ctx, fn) {
  let token = await getToken(ctx);
  try { return await fn(token); }
  catch (e) {
    if (e && e.status === 401) { token = await getToken(ctx, { force: true }); return fn(token); }
    throw e;
  }
}

// ---------- OAuth ----------
function authUrl(ctx) {
  const u = new URL(AUTH_URL);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', (ctx.config && ctx.config.clientId) || '');
  u.searchParams.set('redirect_uri', ctx.redirectUri);
  u.searchParams.set('state', ctx.state);
  return u.toString();
}

async function fetchProfile(ctx, token) {
  const data = await request(PROFILE_URL, { headers: { Authorization: `Bearer ${token}` }, step: '프로필 조회', log: ctx.log });
  if (!data || data.resultcode !== '00' || !data.response) throw new common.ApiError(`프로필 조회 실패: ${data && data.message || '응답 형식 오류'}`, { body: data, step: '프로필 조회' });
  const r = data.response;
  return { name: r.nickname || r.name || r.id, handle: r.email || r.nickname || '', id: r.id };
}

async function authCallback(ctx, query = {}) {
  if (!query.state || query.state !== ctx.state) throw new Error('state 값 불일치 — 로그인을 처음부터 다시 진행하세요');
  if (query.error) throw new Error(`네이버 로그인 실패: ${query.error}${query.error_description ? ' — ' + query.error_description : ''}`);
  if (!query.code) throw new Error('인증 코드(code) 없음');
  const { clientId, clientSecret } = await clientCreds(ctx);
  const data = await request(TOKEN_URL, {
    method: 'POST', step: '토큰 발급', log: ctx.log,
    query: { grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret, code: query.code, state: query.state },
  });
  const err = tokenError(data, '토큰 발급');
  if (err) throw err;
  await saveTokens(ctx, data);
  return { account: await fetchProfile(ctx, data.access_token) };
}

async function check(ctx) {
  try {
    if (!(await ctx.getSecret('refreshToken')) && !(await ctx.getSecret('accessToken')))
      return { ok: false, name: '', detail: '네이버 로그인 연결 필요' };
    const acc = await authed(ctx, t => fetchProfile(ctx, t));
    const exp = Number(await ctx.getSecret('tokenExpiresAt')) || 0;
    return { ok: true, name: acc.name, detail: `접근 토큰 만료 ${new Date(exp).toLocaleString('ko-KR')} (자동 갱신)` };
  } catch (e) {
    return { ok: false, name: '', detail: e.message };
  }
}

// ---------- 발행 ----------
function buildPayload(post, config) {
  const { clubId, menuId } = resolveTarget(post, config);
  const fields = { subject: encodeValue(buildSubject(post)), content: encodeValue(buildContent(post)) };
  const opts = post.options || {};
  for (const k of BOOL_OPTS) if (typeof opts[k] === 'boolean') fields[k] = String(opts[k]);
  const files = (post.images || []).map(p => common.readImage(p));
  return { url: articleUrl(clubId, menuId), clubId, menuId, fields, files };
}

function cafeError(e) {
  const m = e && e.body && e.body.message;
  const er = m && m.error;
  if (er && er.code) return new common.ApiError(`카페 글쓰기 실패 (${er.code}): ${er.msg || ''}`, { status: e.status, body: e.body, step: '카페 글쓰기' });
  return e;
}

async function publish(ctx, post, { dryRun = false } = {}) {
  const errs = validate(post, ctx.config || {});
  if (errs.length) throw new Error('원고 검사 실패: ' + errs.join(' / '));
  const p = buildPayload(post, ctx.config || {});
  const multipart = p.files.length > 0;

  if (dryRun) {
    return {
      id: null, url: null, dryRun: true,
      payload: {
        method: 'POST', url: p.url,
        contentType: multipart ? 'multipart/form-data' : 'application/x-www-form-urlencoded',
        fields: p.fields,   // 값은 encodeURIComponent 1회 결과. form 전송 시 URLSearchParams가 한 번 더 인코딩
        wireBody: multipart ? null : new URLSearchParams(p.fields).toString(),
        files: p.files.map((f, i) => ({ field: 'image', index: i, name: f.name, type: f.type, bytes: f.buf.length })),
        decoded: { subject: decodeURIComponent(p.fields.subject), content: decodeURIComponent(p.fields.content) },
      },
    };
  }

  const send = token => {
    const opt = { method: 'POST', headers: { Authorization: `Bearer ${token}` }, step: '카페 글쓰기', log: ctx.log, retries: 0 };
    if (multipart) opt.multipart = [...Object.entries(p.fields).map(([name, value]) => ({ name, value })), ...p.files.map(file => ({ name: 'image', file }))];
    else opt.form = p.fields;
    return request(p.url, opt);
  };
  let data;
  try { data = await authed(ctx, send); } catch (e) { throw cafeError(e); }

  const msg = data && data.message;
  const result = msg && msg.result;
  if (!msg || String(msg.status) !== '200' || !result || result.articleId == null) {
    const er = msg && msg.error;
    throw new common.ApiError(`카페 글쓰기 실패${er ? ` (${er.code}): ${er.msg}` : ': 응답 형식 오류'}`, { body: data, step: '카페 글쓰기' });
  }
  const url = result.articleUrl || (result.cafeUrl ? `https://cafe.naver.com/${result.cafeUrl}/${result.articleId}` : null);
  return { id: String(result.articleId), url, dryRun: false };
}

module.exports = {
  platform: 'cafe',
  label: '네이버 카페',
  configFields, limits,
  authUrl, authCallback, check, validate, publish,
  _setRequest,
  _internal: { buildContent, buildSubject, encodeValue, resolveTarget, getToken, escapeHtml },
};
