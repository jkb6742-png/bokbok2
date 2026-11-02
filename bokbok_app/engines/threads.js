// 쓰레드 발행 엔진 — 공식 Threads API
// 흐름: /{user-id}/threads (컨테이너) → 상태 확인(status) → /{user-id}/threads_publish → permalink 조회
// 인증: Meta 개발자 콘솔에서 발급한 장기 토큰(60일). check() 때 만료 7일 이내면 th_refresh_token 으로 갱신해 저장한다.
// 참고: https://developers.facebook.com/docs/threads/posts
//       https://developers.facebook.com/docs/threads/troubleshooting (threads_publishing_limit, 컨테이너 상태)
//       https://developers.facebook.com/docs/threads/get-started/long-lived-tokens
const common = require('./common');

const BASE = 'https://graph.threads.net/v1.0';
const REFRESH_URL = 'https://graph.threads.net/refresh_access_token';
const TEXT_MAX = 500, IMAGES_MAX = 20;
const POLL_TRIES = 20, POLL_MS = 3000;
const REFRESH_BEFORE_MS = 7 * 24 * 3600 * 1000;

let request = common.request;
let sleep = common.sleep;
const _setRequest = fn => { request = fn || common.request; };
const _setSleep = fn => { sleep = fn || common.sleep; };

const isWarn = m => String(m).startsWith('주의:');
const chars = s => [...String(s || '')].length;

function normTags(tags) {
  const out = [], seen = new Set();
  for (const t of tags || []) {
    const v = String(t || '').trim().replace(/^#+/, '').replace(/\s+/g, '');
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase()); out.push(v);
  }
  return out;
}

const urls = post => (post.imageUrls || []).filter(Boolean);
// 글만 있고 링크가 있으면 link_attachment(링크 미리보기 카드)로 보내고, 이미지 글이면 본문 끝에 링크를 붙인다.
const useLinkAttachment = post => !!post.link && urls(post).length === 0;

function buildText(post) {
  const title = String(post.title || '').trim();
  let body = String(post.body || '').trim();
  if (title && !body.startsWith(title)) body = body ? `${title}\n\n${body}` : title;
  if (post.link && !useLinkAttachment(post) && !body.includes(post.link)) body = `${body}\n\n${post.link}`;
  const existing = new Set((body.match(/#[^\s#]+/g) || []).map(h => h.slice(1).toLowerCase()));
  const add = normTags(post.tags).filter(t => !existing.has(t.toLowerCase())).map(t => '#' + t);
  return add.length ? `${body}${body ? '\n\n' : ''}${add.join(' ')}` : body;
}

function validate(post) {
  const errs = [];
  if (!post || typeof post !== 'object') return ['원고 형식이 아닙니다'];
  const u = urls(post);
  const local = (post.images || []).filter(Boolean);
  if (!u.length && local.length) errs.push('공개 이미지 주소(imageUrls)가 필요합니다');
  if (u.length > IMAGES_MAX) errs.push(`이미지는 최대 ${IMAGES_MAX}장입니다 (현재 ${u.length}장)`);
  for (const x of u) {
    let ok = false;
    try { ok = new URL(x).protocol === 'https:'; } catch { }
    if (!ok) errs.push(`이미지 주소는 https여야 합니다: ${x}`);
  }
  if (post.link) {
    let ok = false;
    try { ok = /^https?:$/.test(new URL(post.link).protocol); } catch { }
    if (!ok) errs.push(`링크 주소 형식이 아닙니다: ${post.link}`);
  }
  const text = buildText(post);
  if (!text.trim() && !u.length) errs.push('본문이 비어 있습니다');
  if (chars(text) > TEXT_MAX) errs.push(`본문이 ${TEXT_MAX}자를 넘습니다 (현재 ${chars(text)}자, 해시태그·링크 포함)`);
  const nTags = (text.match(/#[^\s#]+/g) || []).length;
  if (nTags > 1) errs.push('주의: 쓰레드는 게시물당 주제 태그 1개만 연결됩니다. 첫 번째 해시태그만 태그로 걸립니다');
  return errs;
}

function plan(userId, post) {
  const text = buildText(post);
  const u = urls(post);
  const steps = [{ step: 'th.limit', method: 'GET', path: `/${userId}/threads_publishing_limit`, params: { fields: 'quota_usage,config' } }];
  if (u.length === 0) {
    const params = { media_type: 'TEXT', text };
    if (useLinkAttachment(post)) params.link_attachment = post.link;
    steps.push({ step: 'th.text', method: 'POST', path: `/${userId}/threads`, params, saveAs: 'creation' });
  } else if (u.length === 1) {
    steps.push({ step: 'th.image', method: 'POST', path: `/${userId}/threads`, params: { media_type: 'IMAGE', image_url: u[0], ...(text ? { text } : {}) }, saveAs: 'creation' });
  } else {
    u.forEach((x, i) => steps.push({ step: 'th.carousel.child', method: 'POST', path: `/${userId}/threads`, params: { media_type: 'IMAGE', image_url: x, is_carousel_item: 'true' }, saveAs: `child${i + 1}` }));
    u.forEach((_, i) => steps.push({ step: 'th.container.status', method: 'GET', path: `/{child${i + 1}}`, params: { fields: 'status,error_message' }, poll: true }));
    steps.push({ step: 'th.carousel', method: 'POST', path: `/${userId}/threads`, params: { media_type: 'CAROUSEL', children: u.map((_, i) => `{child${i + 1}}`).join(','), ...(text ? { text } : {}) }, saveAs: 'creation' });
  }
  steps.push({ step: 'th.container.status', method: 'GET', path: '/{creation}', params: { fields: 'status,error_message' }, poll: true });
  steps.push({ step: 'th.publish', method: 'POST', path: `/${userId}/threads_publish`, params: { creation_id: '{creation}' }, saveAs: 'media' });
  steps.push({ step: 'th.permalink', method: 'GET', path: '/{media}', params: { fields: 'permalink' } });
  return steps;
}

const fill = (s, ids) => String(s).replace(/\{(\w+)\}/g, (m, k) => ids[k] ?? m);

async function call(ctx, token, method, url, params, step) {
  const opts = { method, step, log: ctx && ctx.log };
  if (method === 'GET') opts.query = { ...params, access_token: token };
  else opts.form = { ...params, access_token: token };
  const data = await request(url.startsWith('http') ? url : BASE + url, opts);
  if (data && data.error) {
    const e = data.error;
    throw new common.ApiError(`${step} 실패: ${e.error_user_msg || e.message || '알 수 없는 오류'}`, { status: 200, body: data, step });
  }
  return data;
}

async function getQuota(ctx, token, userId) {
  const r = await call(ctx, token, 'GET', `/${userId}/threads_publishing_limit`, { fields: 'quota_usage,config' }, 'th.limit');
  const d = (r && r.data && r.data[0]) || {};
  const used = Number(d.quota_usage) || 0;
  const total = Number(d.config && d.config.quota_total) || null;
  return { used, total, left: total == null ? null : Math.max(0, total - used) };
}

async function waitContainer(ctx, token, id) {
  for (let i = 0; i < POLL_TRIES; i++) {
    const r = await call(ctx, token, 'GET', `/${id}`, { fields: 'status,error_message' }, 'th.container.status');
    if (r.status === 'FINISHED' || r.status === 'PUBLISHED') return;
    if (r.status === 'ERROR' || r.status === 'EXPIRED') throw new Error(`쓰레드 컨테이너 처리 실패: ${r.error_message || r.status}`);
    if (i < POLL_TRIES - 1) await sleep(POLL_MS);
  }
  throw new Error(`쓰레드 컨테이너 처리 대기 시간 초과 (${POLL_TRIES * POLL_MS / 1000}초)`);
}

const userIdOf = ctx => String((ctx && ctx.config && ctx.config.threadsUserId) || '').trim() || 'me';

// 장기 토큰 갱신: 만료일을 모르거나 7일 이내면 갱신 시도. 발급 24시간 이내 토큰은 Meta가 거절 → 기존 토큰 유지.
async function maybeRefresh(ctx, token, now = Date.now()) {
  const raw = await ctx.getSecret('tokenExpiresAt');
  const exp = raw ? Date.parse(raw) : NaN;
  if (Number.isFinite(exp) && exp - now > REFRESH_BEFORE_MS) return { token, expiresAt: new Date(exp), refreshed: false };
  try {
    const r = await call(ctx, token, 'GET', REFRESH_URL, { grant_type: 'th_refresh_token' }, 'th.refresh');
    if (!r || !r.access_token) throw new Error('갱신 응답에 토큰이 없습니다');
    const expiresAt = new Date(now + (Number(r.expires_in) || 0) * 1000);
    await ctx.setSecret('accessToken', r.access_token);
    await ctx.setSecret('tokenExpiresAt', expiresAt.toISOString());
    return { token: r.access_token, expiresAt, refreshed: true };
  } catch (e) {
    return { token, expiresAt: Number.isFinite(exp) ? new Date(exp) : null, refreshed: false, error: e.message };
  }
}

async function check(ctx) {
  try {
    let token = await ctx.getSecret('accessToken');
    if (!token) throw new Error('쓰레드 액세스 토큰을 설정하세요');
    const userId = userIdOf(ctx);
    const rf = await maybeRefresh(ctx, token);
    token = rf.token;
    const me = await call(ctx, token, 'GET', `/${userId}`, { fields: 'id,username' }, 'th.check');
    const parts = [`계정 ID ${me.id || userId}`];
    if (rf.expiresAt) parts.push(`토큰 만료 ${rf.expiresAt.toISOString().slice(0, 10)}${rf.refreshed ? ' (방금 갱신)' : ''}`);
    else parts.push('토큰 만료일 모름');
    if (rf.error) parts.push(`토큰 갱신 실패: ${common.redact(rf.error)}`);
    try {
      const q = await getQuota(ctx, token, userId);
      parts.push(q.total == null ? `24시간 발행 ${q.used}건` : `24시간 발행 ${q.used}/${q.total}건 (남은 ${q.left}건)`);
    } catch (e) { parts.push(`발행 한도 조회 실패: ${common.redact(e.message)}`); }
    return { ok: true, name: me.username ? '@' + me.username : String(me.id || userId), detail: parts.join(' · ') };
  } catch (e) {
    return { ok: false, name: '', detail: common.redact(e.message) };
  }
}

async function publish(ctx, post, { dryRun = false } = {}) {
  const blocking = validate(post).filter(m => !isWarn(m));
  if (blocking.length) throw new Error('원고 확인 필요: ' + blocking.join(' / '));
  const userId = userIdOf(ctx);
  const steps = plan(userId, post);
  if (dryRun) return { id: null, url: null, dryRun: true, payload: steps.map(({ saveAs, poll, ...s }) => ({ ...s, ...(poll ? { poll: `최대 ${POLL_TRIES}회 × ${POLL_MS / 1000}초` } : {}) })) };

  const token = await ctx.getSecret('accessToken');
  if (!token) throw new Error('쓰레드 액세스 토큰을 설정하세요');
  const q = await getQuota(ctx, token, userId);
  if (q.total != null && q.left <= 0) throw new Error(`쓰레드 24시간 발행 한도(${q.total}건)를 다 썼습니다. 나중에 다시 시도하세요`);

  const ids = {};
  for (const s of steps.slice(1)) {
    const path = fill(s.path, ids);
    const params = Object.fromEntries(Object.entries(s.params).map(([k, v]) => [k, fill(v, ids)]));
    if (s.poll) { await waitContainer(ctx, token, path.slice(1)); continue; }
    if (s.step === 'th.permalink') {
      try { const r = await call(ctx, token, 'GET', path, params, s.step); ids.permalink = r.permalink || ''; } catch { ids.permalink = ''; }
      continue;
    }
    const r = await call(ctx, token, s.method, path, params, s.step);
    if (!r || !r.id) throw new Error(`${s.step} 응답에 id가 없습니다`);
    ids[s.saveAs] = String(r.id);
  }
  return { id: ids.media, url: ids.permalink || null, dryRun: false };
}

module.exports = {
  platform: 'threads',
  label: '쓰레드',
  configFields: [
    { key: 'threadsUserId', label: '쓰레드 사용자 ID', secret: false, required: false, hint: '비워 두면 me (토큰 주인 계정)' },
    { key: 'accessToken', label: '장기 액세스 토큰', secret: true, required: true, hint: 'Meta 개발자 콘솔(Threads 사용 사례)에서 발급한 60일 장기 토큰. threads_basic, threads_content_publish 권한 필요. 연결 확인 때 만료 7일 전이면 자동 갱신' },
  ],
  limits: { dailyMax: 250, minIntervalMin: 10, titleMax: 0, bodyMax: TEXT_MAX, imagesMax: IMAGES_MAX },
  check, validate, publish,
  isWarning: isWarn,
  buildText,
  _setRequest, _setSleep,
};
