// 인스타그램 발행 엔진 — 공식 Instagram Graph API (Content Publishing)
// 흐름: /{ig-user-id}/media (컨테이너) → 상태 확인(status_code) → /{ig-user-id}/media_publish → permalink 조회
// 인증: Meta 개발자 콘솔에서 발급한 장기 토큰(60일)을 사용자가 붙여넣는다. OAuth 웹 흐름 없음(Meta는 https 리다이렉트만 허용).
// 참고: https://developers.facebook.com/docs/instagram-platform/content-publishing
//       https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit
const common = require('./common');

const GRAPH_VERSION = process.env.GRAPH_VERSION || 'v26.0';
const CAPTION_MAX = 2200, HASHTAG_MAX = 30, MENTION_MAX = 20, IMAGES_MAX = 10;
const POLL_TRIES = 20, POLL_MS = 3000;

let request = common.request;
let sleep = common.sleep;
const _setRequest = fn => { request = fn || common.request; };
const _setSleep = fn => { sleep = fn || common.sleep; };

// "IGAA…"로 시작하는 토큰은 Instagram 로그인 토큰(graph.instagram.com), 그 외(EAA…)는 Facebook 로그인 토큰(graph.facebook.com)
const baseFor = token => /^IG/.test(String(token || '')) ? `https://graph.instagram.com/${GRAPH_VERSION}` : `https://graph.facebook.com/${GRAPH_VERSION}`;

const isWarn = m => String(m).startsWith('주의:');
const chars = s => [...String(s || '')].length;
const URL_RE = /https?:\/\/\S+/i;

function normTags(tags) {
  const out = [], seen = new Set();
  for (const t of tags || []) {
    const v = String(t || '').trim().replace(/^#+/, '').replace(/\s+/g, '');
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase()); out.push(v);
  }
  return out;
}

// 캡션 = (제목) + 본문 + 해시태그. 본문에 이미 있는 해시태그는 다시 붙이지 않는다.
function buildCaption(post) {
  const title = String(post.title || '').trim();
  let body = String(post.body || '').trim();
  if (title && !body.startsWith(title)) body = body ? `${title}\n\n${body}` : title;
  const existing = new Set((body.match(/#[^\s#]+/g) || []).map(h => h.slice(1).toLowerCase()));
  const add = normTags(post.tags).filter(t => !existing.has(t.toLowerCase())).map(t => '#' + t);
  return add.length ? `${body}${body ? '\n\n' : ''}${add.join(' ')}` : body;
}

function validate(post) {
  const errs = [];
  if (!post || typeof post !== 'object') return ['원고 형식이 아닙니다'];
  const urls = (post.imageUrls || []).filter(Boolean);
  const local = (post.images || []).filter(Boolean);
  if (!urls.length) errs.push(local.length ? '공개 이미지 주소(imageUrls)가 필요합니다' : '인스타그램은 이미지가 1장 이상 필요합니다(imageUrls)');
  if (urls.length > IMAGES_MAX) errs.push(`이미지는 최대 ${IMAGES_MAX}장입니다 (현재 ${urls.length}장)`);
  for (const u of urls) {
    let ok = false;
    try { ok = new URL(u).protocol === 'https:'; } catch { }
    if (!ok) errs.push(`이미지 주소는 https여야 합니다: ${u}`);
  }
  const cap = buildCaption(post);
  if (!cap.trim()) errs.push('본문이 비어 있습니다');
  if (chars(cap) > CAPTION_MAX) errs.push(`캡션이 ${CAPTION_MAX}자를 넘습니다 (현재 ${chars(cap)}자, 해시태그 포함)`);
  const nTags = (cap.match(/#[^\s#]+/g) || []).length;
  if (nTags > HASHTAG_MAX) errs.push(`해시태그는 최대 ${HASHTAG_MAX}개입니다 (현재 ${nTags}개)`);
  const nMent = (cap.match(/(^|\s)@[A-Za-z0-9._]+/g) || []).length;
  if (nMent > MENTION_MAX) errs.push(`@언급은 최대 ${MENTION_MAX}개입니다 (현재 ${nMent}개)`);
  // 주의(발행은 막지 않음)
  if (URL_RE.test(String(post.body || '')) || post.link) errs.push('주의: 인스타그램 캡션의 링크는 눌리지 않습니다. 링크에 기대지 않는 본문인지 확인하세요');
  for (const u of urls) if (/\.(png|webp|gif)(\?|$)/i.test(u)) errs.push(`주의: 인스타그램 API는 JPEG만 공식 지원합니다: ${u}`);
  return errs;
}

// 발행 단계 목록(가짜 ID 자리표시 포함). dryRun은 이것을 그대로 반환하고, 실제 발행도 같은 순서를 따른다.
function plan(igUserId, post) {
  const caption = buildCaption(post);
  const urls = post.imageUrls.filter(Boolean);
  const steps = [{ step: 'ig.limit', method: 'GET', path: `/${igUserId}/content_publishing_limit`, params: { fields: 'quota_usage,config' } }];
  if (urls.length === 1) {
    steps.push({ step: 'ig.media', method: 'POST', path: `/${igUserId}/media`, params: { image_url: urls[0], caption }, saveAs: 'creation' });
  } else {
    urls.forEach((u, i) => steps.push({ step: 'ig.media.child', method: 'POST', path: `/${igUserId}/media`, params: { image_url: u, is_carousel_item: 'true' }, saveAs: `child${i + 1}` }));
    urls.forEach((_, i) => steps.push({ step: 'ig.container.status', method: 'GET', path: `/{child${i + 1}}`, params: { fields: 'status_code,status' }, poll: true }));
    steps.push({ step: 'ig.media.carousel', method: 'POST', path: `/${igUserId}/media`, params: { media_type: 'CAROUSEL', children: urls.map((_, i) => `{child${i + 1}}`).join(','), caption }, saveAs: 'creation' });
  }
  steps.push({ step: 'ig.container.status', method: 'GET', path: '/{creation}', params: { fields: 'status_code,status' }, poll: true });
  steps.push({ step: 'ig.publish', method: 'POST', path: `/${igUserId}/media_publish`, params: { creation_id: '{creation}' }, saveAs: 'media' });
  steps.push({ step: 'ig.permalink', method: 'GET', path: '/{media}', params: { fields: 'permalink' } });
  return steps;
}

const fill = (s, ids) => String(s).replace(/\{(\w+)\}/g, (m, k) => ids[k] ?? m);

async function call(ctx, token, method, path, params, step) {
  const opts = { method, step, log: ctx && ctx.log };
  if (method === 'GET') opts.query = { ...params, access_token: token };
  else opts.form = { ...params, access_token: token };
  const data = await request(baseFor(token) + path, opts);
  if (data && data.error) {
    const e = data.error;
    throw new common.ApiError(`${step} 실패: ${e.error_user_msg || e.message || '알 수 없는 오류'}`, { status: 200, body: data, step });
  }
  return data;
}

async function getQuota(ctx, token, igUserId) {
  const r = await call(ctx, token, 'GET', `/${igUserId}/content_publishing_limit`, { fields: 'quota_usage,config' }, 'ig.limit');
  const d = (r && r.data && r.data[0]) || {};
  const used = Number(d.quota_usage) || 0;
  const total = Number(d.config && d.config.quota_total) || null;
  return { used, total, left: total == null ? null : Math.max(0, total - used) };
}

async function waitContainer(ctx, token, id) {
  for (let i = 0; i < POLL_TRIES; i++) {
    const r = await call(ctx, token, 'GET', `/${id}`, { fields: 'status_code,status' }, 'ig.container.status');
    if (r.status_code === 'FINISHED') return;
    if (r.status_code === 'PUBLISHED') return;
    if (r.status_code === 'ERROR' || r.status_code === 'EXPIRED') throw new Error(`인스타그램 컨테이너 처리 실패: ${r.status || r.status_code}`);
    if (i < POLL_TRIES - 1) await sleep(POLL_MS);
  }
  throw new Error(`인스타그램 컨테이너 처리 대기 시간 초과 (${POLL_TRIES * POLL_MS / 1000}초)`);
}

async function creds(ctx) {
  const igUserId = String((ctx.config && ctx.config.igUserId) || '').trim();
  const token = await ctx.getSecret('accessToken');
  if (!igUserId) throw new Error('인스타그램 사용자 ID(igUserId)를 설정하세요');
  if (!token) throw new Error('인스타그램 액세스 토큰을 설정하세요');
  return { igUserId, token };
}

async function check(ctx) {
  try {
    const { igUserId, token } = await creds(ctx);
    const me = await call(ctx, token, 'GET', `/${igUserId}`, { fields: 'id,username' }, 'ig.check');
    let quota = '';
    try {
      const q = await getQuota(ctx, token, igUserId);
      quota = q.total == null ? ` · 24시간 발행 ${q.used}건` : ` · 24시간 발행 ${q.used}/${q.total}건 (남은 ${q.left}건)`;
    } catch (e) { quota = ` · 발행 한도 조회 실패: ${e.message}`; }
    return { ok: true, name: me.username ? '@' + me.username : String(me.id || igUserId), detail: `계정 ID ${me.id || igUserId}${quota}` };
  } catch (e) {
    return { ok: false, name: '', detail: common.redact(e.message) };
  }
}

async function publish(ctx, post, { dryRun = false } = {}) {
  const blocking = validate(post).filter(m => !isWarn(m));
  if (blocking.length) throw new Error('원고 확인 필요: ' + blocking.join(' / '));
  const igUserId = String((ctx && ctx.config && ctx.config.igUserId) || '{igUserId}').trim();
  const steps = plan(igUserId, post);
  if (dryRun) return { id: null, url: null, dryRun: true, payload: steps.map(({ saveAs, poll, ...s }) => ({ ...s, ...(poll ? { poll: `최대 ${POLL_TRIES}회 × ${POLL_MS / 1000}초` } : {}) })) };

  const { token } = await creds(ctx);
  const q = await getQuota(ctx, token, igUserId);
  if (q.total != null && q.left <= 0) throw new Error(`인스타그램 24시간 발행 한도(${q.total}건)를 다 썼습니다. 나중에 다시 시도하세요`);

  const ids = {};
  for (const s of steps.slice(1)) {
    const path = fill(s.path, ids);
    const params = Object.fromEntries(Object.entries(s.params).map(([k, v]) => [k, fill(v, ids)]));
    if (s.poll) { await waitContainer(ctx, token, path.slice(1)); continue; }
    if (s.step === 'ig.permalink') {
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
  platform: 'instagram',
  label: '인스타그램',
  configFields: [
    { key: 'igUserId', label: '인스타그램 사용자 ID', secret: false, required: true, hint: '비즈니스/크리에이터 계정의 숫자 ID (Meta 개발자 콘솔 · Graph API 탐색기에서 me?fields=user_id 또는 페이지의 instagram_business_account)' },
    { key: 'accessToken', label: '장기 액세스 토큰', secret: true, required: true, hint: 'Meta 개발자 콘솔에서 발급한 60일 장기 토큰 (instagram_content_publish 권한 포함). 만료 전 다시 발급해 넣으세요' },
  ],
  limits: { dailyMax: 50, minIntervalMin: 30, titleMax: 0, bodyMax: CAPTION_MAX, imagesMax: IMAGES_MAX },
  check, validate, publish,
  isWarning: isWarn,
  buildCaption,
  _setRequest, _setSleep,
};
