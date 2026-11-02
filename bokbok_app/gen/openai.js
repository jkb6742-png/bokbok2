// OpenAI 호출(전역 fetch만). 텍스트 = chat/completions JSON 모드, 이미지 = images/generations
// 키는 로그·오류 어디에도 남기지 않는다.
const { redact } = require('../engines/common');

const BASE = 'https://api.openai.com/v1';
const TEXT_TIMEOUT = 120000, IMAGE_TIMEOUT = 180000;

let _fetch = (...a) => fetch(...a);
let _sleep = ms => new Promise(r => setTimeout(r, ms));
function _setFetch(fn) { _fetch = fn || ((...a) => fetch(...a)); }
function _setSleep(fn) { _sleep = fn || (ms => new Promise(r => setTimeout(r, ms))); }

class OpenAIError extends Error {
  constructor(msg, { status, code, kind } = {}) { super(msg); this.name = 'OpenAIError'; this.status = status; this.code = code; this.kind = kind; }
}

// 키 가리기: common.redact + sk- 형태 + 실제 키 문자열
function scrub(s, apiKey) {
  let out = redact(s).replace(/sk-[A-Za-z0-9_*-]{6,}/g, 'sk-***');
  if (apiKey && apiKey.length >= 6) out = out.split(apiKey).join('***');
  return out;
}

function mapError(status, data, apiKey, what) {
  const err = (data && data.error) || {};
  const code = err.code || err.type || '';
  const msg = scrub(err.message || (typeof data === 'string' ? data : ''), apiKey).slice(0, 300);
  const E = (m, kind) => new OpenAIError(m, { status, code, kind });
  if (status === 401) return E('API 키가 맞지 않습니다. 앱 설정에서 OpenAI API 키를 다시 넣어 주세요.', 'auth');
  if (status === 429) {
    if (/insufficient_quota|billing|quota/i.test(code + ' ' + msg)) return E('OpenAI 사용 한도(크레딧)가 없습니다. OpenAI 결제·사용 한도를 확인해 주세요.', 'quota');
    return E('요청이 너무 많습니다(속도 제한). 1~2분 뒤 다시 시도해 주세요.', 'rate');
  }
  if (status === 400 && /content_policy|moderation|safety/i.test(code + ' ' + msg))
    return E(what === 'image' ? '이미지 프롬프트가 정책에 걸렸습니다. 장면 묘사를 바꿔 다시 생성해 주세요.' : '요청 내용이 OpenAI 정책에 걸렸습니다. 주제·메모를 바꿔 주세요.', 'policy');
  if (status === 403) return E(`이 API 키로는 이 모델을 쓸 수 없습니다(조직 인증·권한 확인). ${msg}`.trim(), 'forbidden');
  if (status === 404 || code === 'model_not_found') return E(`모델을 찾을 수 없습니다. 설정의 모델 이름을 확인해 주세요. ${msg}`.trim(), 'model');
  if (status >= 500) return E(`OpenAI 서버 오류(${status})입니다. 잠시 뒤 다시 시도해 주세요.`, 'server');
  return E(`OpenAI 요청 실패(${status}): ${msg || '알 수 없는 오류'}`, 'request');
}

// 공통 POST: 시간 초과, 429(속도)·5xx는 한 번 재시도
function multipart(parts) {
  const boundary = '----bokbok' + Date.now().toString(16) + Math.random().toString(16).slice(2);
  const chunks = [];
  for (const p of parts) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"`;
    if (p.file) { head += `; filename="${p.file.name}"\r\nContent-Type: ${p.file.type}\r\n\r\n`; chunks.push(Buffer.from(head), p.file.buf, Buffer.from('\r\n')); }
    else { head += `\r\n\r\n`; chunks.push(Buffer.from(head), Buffer.from(String(p.value), 'utf8'), Buffer.from('\r\n')); }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), type: `multipart/form-data; boundary=${boundary}` };
}

// body 가 { multipart: [...] } 이면 multipart/form-data 로 보낸다(이미지 편집). 아니면 JSON.
async function post(pathname, body, { apiKey, timeoutMs, log, what }) {
  if (!apiKey) throw new OpenAIError('OpenAI API 키가 없습니다. 앱 설정에서 키를 넣어 주세요.', { kind: 'auth' });
  const mp = body && body.multipart ? multipart(body.multipart) : null;
  for (let attempt = 0; ; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let res, text;
    const t0 = Date.now();
    try {
      res = await _fetch(BASE + pathname, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': mp ? mp.type : 'application/json' },
        body: mp ? mp.body : JSON.stringify(body),
        signal: ac.signal,
      });
      text = await res.text();
    } catch (e) {
      clearTimeout(timer);
      if (e && e.name === 'AbortError') throw new OpenAIError(`OpenAI 응답 시간 초과(${Math.round(timeoutMs / 1000)}초)`, { kind: 'timeout' });
      throw new OpenAIError(`OpenAI 연결 실패: ${scrub(e && e.message, apiKey)}`, { kind: 'network' });
    }
    clearTimeout(timer);
    log && log(`OpenAI ${pathname} ${res.status} ${((Date.now() - t0) / 1000).toFixed(1)}초`);
    let data = text;
    try { data = JSON.parse(text); } catch { }
    if (res.ok) return data;
    const e = mapError(res.status, data, apiKey, what);
    if (attempt === 0 && (e.kind === 'rate' || e.kind === 'server')) {
      const ra = Number(res.headers && res.headers.get && res.headers.get('retry-after'));
      await _sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 30) * 1000 : 3000);
      continue;
    }
    throw e;
  }
}

function parseJSON(s) {
  if (typeof s !== 'string') return null;
  const t = s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { const o = JSON.parse(t); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; } catch { return null; }
}

const isReasoning = m => /^(gpt-5|o\d)/i.test(m || '');

// messages: user 뒤에 붙일 추가 대화(수정 요청 등) [{role, content}]
async function chatJSON({ apiKey, model = 'gpt-5', system, user, messages = [], maxTokens = 16000, reasoningEffort, timeoutMs = TEXT_TIMEOUT, log } = {}) {
  const msgs = [{ role: 'system', content: system }, { role: 'user', content: user }, ...messages];
  const body = { model, messages: msgs, response_format: { type: 'json_object' }, max_completion_tokens: maxTokens };
  if (reasoningEffort && isReasoning(model)) body.reasoning_effort = reasoningEffort;
  for (let attempt = 0; attempt < 2; attempt++) {
    const data = await post('/chat/completions', body, { apiKey, timeoutMs, log, what: 'text' });
    const ch = data && data.choices && data.choices[0];
    if (!ch) throw new OpenAIError('OpenAI 응답이 비어 있습니다', { kind: 'empty' });
    if (ch.message && ch.message.refusal) throw new OpenAIError(`모델이 작성을 거절했습니다: ${scrub(ch.message.refusal, apiKey).slice(0, 200)}`, { kind: 'refusal' });
    if (data.usage) log && log(`토큰: 입력 ${data.usage.prompt_tokens} · 출력 ${data.usage.completion_tokens}`);
    const obj = parseJSON(ch.message && ch.message.content);
    if (obj) return obj;
    if (ch.finish_reason === 'length') throw new OpenAIError('응답이 길이 제한에 걸려 잘렸습니다. 분량을 줄이거나 사진 수를 줄여 주세요.', { kind: 'length' });
    log && log('JSON 해석 실패 → 1회 다시 요청');
    if (attempt === 0) body.messages = [...msgs, { role: 'user', content: '방금 응답은 올바른 JSON이 아니었습니다. 설명 없이 JSON 객체 하나만 다시 출력하세요.' }];
  }
  throw new OpenAIError('OpenAI 응답을 JSON으로 읽을 수 없습니다(2회 시도)', { kind: 'json' });
}

async function image({ apiKey, model = 'gpt-image-1', prompt, size = '1536x1024', quality = 'medium', timeoutMs = IMAGE_TIMEOUT, log } = {}) {
  if (!prompt || !String(prompt).trim()) throw new OpenAIError('이미지 프롬프트가 비어 있습니다', { kind: 'request' });
  const body = { model, prompt, size, n: 1 };
  if (/^dall-e/i.test(model)) {
    body.response_format = 'b64_json';
    if (model === 'dall-e-3') body.quality = quality === 'high' ? 'hd' : 'standard';
  } else body.quality = quality;
  const data = await post('/images/generations', body, { apiKey, timeoutMs, log, what: 'image' });
  const row = data && data.data && data.data[0];
  if (row && row.b64_json) {
    const buf = Buffer.from(row.b64_json, 'base64');
    if (buf.length < 100) throw new OpenAIError('생성된 이미지가 비어 있습니다', { kind: 'empty' });
    return buf;
  }
  if (row && row.url) {
    const r = await _fetch(row.url);
    if (!r.ok) throw new OpenAIError(`생성된 이미지를 내려받지 못했습니다(${r.status})`, { kind: 'network' });
    return Buffer.from(await r.arrayBuffer());
  }
  throw new OpenAIError('이미지 생성 응답에 이미지가 없습니다', { kind: 'empty' });
}

// 참고 이미지(1~4장)를 주고 비슷한 느낌의 새 장면을 그린다: POST /images/edits (gpt-image-1, image[] 여러 장)
// refs: [{ buf, name, type }]. 참고 이미지는 분위기·색감·화풍·구도만 따르고 피사체·글자·로고는 베끼지 않도록 프롬프트에 못박는다.
async function imageEdit({ apiKey, model = 'gpt-image-1', prompt, refs = [], size = '1536x1024', quality = 'medium', timeoutMs = IMAGE_TIMEOUT, log } = {}) {
  if (!prompt || !String(prompt).trim()) throw new OpenAIError('이미지 프롬프트가 비어 있습니다', { kind: 'request' });
  if (!refs.length) return image({ apiKey, model, prompt, size, quality, timeoutMs, log });
  if (/^dall-e/i.test(model)) throw new OpenAIError('참고 이미지는 gpt-image 모델에서만 쓸 수 있습니다. 설정의 이미지 모델을 gpt-image-1로 바꿔 주세요.', { kind: 'request' });
  const full = `Use the attached reference image(s) ONLY as a guide for overall mood, color palette, lighting, rendering style and composition. Do NOT copy their subjects, people, text, logos or layout. Create a NEW image of the following scene:\n${prompt}`;
  const parts = refs.slice(0, 4).map((r, i) => ({ name: 'image[]', file: { buf: r.buf, name: r.name || `ref${i + 1}.png`, type: r.type || 'image/png' } }));
  parts.push({ name: 'model', value: model }, { name: 'prompt', value: full }, { name: 'size', value: size }, { name: 'quality', value: quality }, { name: 'n', value: '1' });
  const data = await post('/images/edits', { multipart: parts }, { apiKey, timeoutMs, log, what: 'image' });
  const row = data && data.data && data.data[0];
  if (row && row.b64_json) { const buf = Buffer.from(row.b64_json, 'base64'); if (buf.length < 100) throw new OpenAIError('생성된 이미지가 비어 있습니다', { kind: 'empty' }); return buf; }
  if (row && row.url) { const r = await _fetch(row.url); if (!r.ok) throw new OpenAIError(`생성된 이미지를 내려받지 못했습니다(${r.status})`, { kind: 'network' }); return Buffer.from(await r.arrayBuffer()); }
  throw new OpenAIError('이미지 편집 응답에 이미지가 없습니다', { kind: 'empty' });
}

module.exports = { chatJSON, image, imageEdit, OpenAIError, mapError, scrub, _setFetch, _setSleep, TEXT_TIMEOUT, IMAGE_TIMEOUT };
