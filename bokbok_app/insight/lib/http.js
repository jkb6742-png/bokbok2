// 예의 있는 HTTP 호출: 호스트별 최소 간격(기본 2초)+흔들림, 15초 시간 초과, 재시도 최대 2회.
// fetch·sleep·now 는 주입 가능(시험에서 실제 네트워크·대기 없이 돌리기 위해).
'use strict';
const { InsightError } = require('./util');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0 Safari/537.36';

function createClient({
  fetch = globalThis.fetch,
  sleep = ms => new Promise(r => setTimeout(r, ms)),
  now = () => Date.now(),
  random = Math.random,
  minIntervalMs = 2000,       // 같은 호스트 연속 호출 최소 간격
  jitterMs = 1200,            // 0~jitter 만큼 더 기다림(사람 속도처럼)
  hostIntervals = {},         // { 'openapi.naver.com': 300 } 처럼 호스트별 덮어쓰기
  timeoutMs = 15000,
  retries = 2,
  log = () => { },
} = {}) {
  const last = new Map();
  let calls = 0;

  async function wait(host) {
    const gap = (hostIntervals[host] ?? minIntervalMs) + Math.round(random() * (hostIntervals[host] != null ? Math.min(jitterMs, hostIntervals[host]) : jitterMs));
    const prev = last.get(host);
    if (prev != null) {
      const left = prev + gap - now();
      if (left > 0) await sleep(left);
    }
    last.set(host, now());
  }

  // 반환: { status, text, json(파싱 가능하면), headers }
  async function request(url, { method = 'GET', headers = {}, body, step = '요청', source, okStatus = [200, 204], allowStatus = [] } = {}) {
    const u = new URL(url);
    const h = { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9', ...headers };
    for (let attempt = 0; ; attempt++) {
      await wait(u.host);
      calls++;
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), timeoutMs);
      let res, text;
      try {
        res = await fetch(u.toString(), { method, headers: h, body, signal: ac.signal });
        text = await res.text();
      } catch (e) {
        clearTimeout(t);
        const timeout = e && (e.name === 'AbortError' || e.name === 'TimeoutError');
        if (attempt < retries) { log(`${step}: ${timeout ? '시간 초과' : '연결 실패'}, 다시 시도 (${attempt + 1}/${retries})`); await sleep(1500 * 2 ** attempt); continue; }
        throw new InsightError(`${step} ${timeout ? '시간 초과(15초)' : '연결 실패: ' + (e && e.message)}`, { code: timeout ? 'TIMEOUT' : 'NETWORK', source });
      }
      clearTimeout(t);
      log(`${step} ${res.status} ${u.host}${u.pathname}`);
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const ra = Number(res.headers && res.headers.get && res.headers.get('retry-after'));
        await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 60) * 1000 : 3000 * 2 ** attempt);
        continue;
      }
      if (!okStatus.includes(res.status) && !allowStatus.includes(res.status)) {
        const msg = res.status === 429 ? '요청이 너무 잦다고 거절됨(429). 내일 다시 시도합니다'
          : res.status === 401 || res.status === 403 ? `접근이 거절됨(${res.status})`
            : res.status === 404 ? '주소를 찾을 수 없음(404)' : `응답 오류(${res.status})`;
        throw new InsightError(`${step} 실패: ${msg}`, { code: 'HTTP', status: res.status, source });
      }
      let json;
      try { json = JSON.parse(text); } catch { json = undefined; }
      return { status: res.status, text, json, headers: res.headers };
    }
  }

  return { request, get calls() { return calls; } };
}

// 시험용 가짜 fetch: routes = [[정규식|문자열, 응답|함수(url,opts)]]
// 응답 = { status=200, body(string|object), headers={} }
function fakeFetch(routes, seen = []) {
  return async (url, opts = {}) => {
    seen.push({ url, opts });
    for (const [m, r] of routes) {
      const hit = typeof m === 'string' ? url.includes(m) : m.test(url);
      if (!hit) continue;
      const v = typeof r === 'function' ? await r(url, opts) : r;
      if (v instanceof Error) throw v;
      const body = typeof v.body === 'string' ? v.body : JSON.stringify(v.body ?? '');
      const hdr = new Map(Object.entries(v.headers || {}));
      return { status: v.status ?? 200, text: async () => body, headers: { get: k => hdr.get(k.toLowerCase()) ?? null } };
    }
    throw new Error('가짜 fetch에 없는 주소: ' + url);
  };
}

module.exports = { createClient, fakeFetch, UA };
