// 채널 엔진 공통: HTTP 호출(재시도·시간초과·토큰 가림), 이미지 읽기
const fs = require('fs'), path = require('path');

class ApiError extends Error {
  constructor(msg, { status, body, step } = {}) { super(msg); this.status = status; this.body = body; this.step = step; }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 로그·오류에 토큰이 남지 않게
const SECRET_KEYS = /(access_token|refresh_token|client_secret|token|code|password)=([^&\s"]+)/gi;
const redact = s => String(s ?? '')
  .replace(SECRET_KEYS, (_, k) => `${k}=***`)
  .replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g, '$1 ***')
  .replace(/"(access_token|refresh_token|client_secret|token)"\s*:\s*"[^"]*"/gi, '"$1":"***"');

const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
function readImage(p) {
  const type = TYPES[path.extname(p).toLowerCase()];
  if (!type) throw new Error(`이미지 형식이 아님: ${path.basename(p)}`);
  const st = fs.statSync(p);
  if (st.size > 8 * 1024 * 1024) throw new Error(`이미지가 8MB를 넘음: ${path.basename(p)}`);
  return { buf: fs.readFileSync(p), name: path.basename(p), type };
}

// multipart: [{name, value}] 또는 [{name, file:{buf,name,type}}]
function multipartBody(parts) {
  const boundary = '----bokbok' + Date.now().toString(16) + Math.random().toString(16).slice(2);
  const chunks = [];
  for (const p of parts) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"`;
    if (p.file) {
      head += `; filename="${encodeURIComponent(p.file.name)}"\r\nContent-Type: ${p.file.type}\r\n\r\n`;
      chunks.push(Buffer.from(head), p.file.buf, Buffer.from('\r\n'));
    } else {
      head += `\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n`;
      chunks.push(Buffer.from(head), Buffer.from(String(p.value), 'utf8'), Buffer.from('\r\n'));
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), type: `multipart/form-data; boundary=${boundary}` };
}

async function request(url, { method = 'GET', query, form, json, multipart, headers = {}, timeoutMs = 30000, retries = 3, step = '', log } = {}) {
  const u = new URL(url);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  const h = { 'User-Agent': 'bokbok/2.0 (windows; local publisher)', ...headers };
  let body;
  if (form) { body = new URLSearchParams(Object.entries(form).filter(([, v]) => v !== undefined && v !== null)).toString(); h['Content-Type'] = 'application/x-www-form-urlencoded'; }
  else if (json) { body = JSON.stringify(json); h['Content-Type'] = 'application/json'; }
  else if (multipart) { const m = multipartBody(multipart); body = m.body; h['Content-Type'] = m.type; }

  for (let attempt = 0; ; attempt++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    let res, text;
    try {
      res = await fetch(u, { method, headers: h, body, signal: ac.signal });
      text = await res.text();
    } catch (e) {
      clearTimeout(t);
      if (attempt < retries) { await sleep(1000 * 2 ** attempt); continue; }
      throw new ApiError(`${step || method} 연결 실패: ${e.name === 'AbortError' ? '시간 초과' : e.message}`, { step });
    }
    clearTimeout(t);
    log && log(`${step || method} ${res.status} ${redact(u.origin + u.pathname)}`);
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const ra = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 120) * 1000 : 1500 * 2 ** attempt);
      continue;
    }
    let data = text;
    try { data = JSON.parse(text); } catch { }
    if (!res.ok) throw new ApiError(`${step || method} 실패 (${res.status}): ${redact(typeof data === 'string' ? data.slice(0, 300) : JSON.stringify(data).slice(0, 300))}`, { status: res.status, body: data, step });
    return data;
  }
}

module.exports = { request, ApiError, sleep, redact, readImage, multipartBody };
