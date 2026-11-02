// 수집기 4: 키워드 월간 검색량·경쟁도 (네이버 검색광고 API, 사용자가 발급한 키가 있을 때만)
// 서명 방식은 dental-saas src/lib/naver-ads/client.ts, 호출은 thinklab-app src/lib/seo/naver-ad.ts 와 같다.
//   GET https://api.searchad.naver.com/keywordstool?hintKeywords=a,b,c,d,e&showDetail=1
//   헤더 X-Timestamp, X-API-KEY(액세스라이선스), X-Customer(customerId),
//        X-Signature = base64(HMAC-SHA256(`${timestamp}.GET./keywordstool`, secretKey))
//   힌트는 공백 없이, 한 번에 5개까지. 검색량이 적으면 숫자 대신 "< 10" 문자열.
// 이 PC에는 키가 없어 실제 호출은 확인 못 함(응답 형식은 기존 사내 코드·공식 문서 기준, fixture 는 그 형식으로 만든 것).
'use strict';
const crypto = require('crypto');
const { InsightError } = require('../lib/util');
const { norm } = require('../lib/keyword');

const BASE = 'https://api.searchad.naver.com';
const SECRET_KEYS = { customerId: 'searchad_customer_id', accessLicense: 'searchad_access_license', secretKey: 'searchad_secret_key' };

const sign = (secret, ts, method, uri) => crypto.createHmac('sha256', secret).update(`${ts}.${method}.${uri}`).digest('base64');

// "< 10" → 5 로 보고 lowVolume 표시 (0으로 두면 "검색 없음"과 구분이 안 됨)
function qc(v) {
  if (typeof v === 'number') return { n: v, low: false };
  if (typeof v === 'string' && /<\s*10/.test(v)) return { n: 5, low: true };
  const n = Number(v); return { n: Number.isFinite(n) ? n : 0, low: false };
}

function parseKeywordTool(json) {
  if (!json || !Array.isArray(json.keywordList)) throw new InsightError('검색광고 API 응답 형식이 다릅니다', { code: 'PARSE', source: 'searchad keywordstool' });
  return json.keywordList.map(k => {
    const pc = qc(k.monthlyPcQcCnt), mo = qc(k.monthlyMobileQcCnt);
    return {
      keyword: k.relKeyword, pc: pc.n, mobile: mo.n, total: pc.n + mo.n, lowVolume: pc.low && mo.low,
      compIdx: k.compIdx || null,                       // 낮음/중간/높음 (광고 경쟁 정도)
      clicksPc: Number(k.monthlyAvePcClkCnt) || 0, clicksMobile: Number(k.monthlyAveMobileClkCnt) || 0,
      ctrPc: Number(k.monthlyAvePcCtr) || 0, ctrMobile: Number(k.monthlyAveMobileCtr) || 0,
      adDepth: Number(k.plAvgDepth) || 0,               // 월평균 노출 광고 수
      mobileShare: pc.n + mo.n ? Math.round(mo.n / (pc.n + mo.n) * 100) : null,
    };
  });
}

// keywords: 조회할 키워드 목록 → { volumes: {정규화키: row}, related: {정규화키: [row...]} }
async function collectKeywords({ client, keywords, creds, settings = {}, log = () => { }, now = Date.now }) {
  if (!creds || !creds.customerId || !creds.accessLicense || !creds.secretKey) throw new InsightError('검색량을 보려면 검색광고 API 키(고객 ID·액세스라이선스·비밀키)를 설정에 넣어야 합니다', { code: 'CONFIG', source: 'searchad' });
  const uniq = [...new Map(keywords.filter(Boolean).map(k => [norm(k), k])).values()];
  const max = Math.min(Number(settings.maxKeywordLookups) || 50, 200);
  const list = uniq.slice(0, max);
  const volumes = {}, related = {}, errors = [];
  for (let i = 0; i < list.length; i += 5) {
    const batch = list.slice(i, i + 5);
    const hints = batch.map(h => h.replace(/\s+/g, '')).join(',');
    const ts = String(now());
    try {
      const r = await client.request(`${BASE}/keywordstool?${new URLSearchParams({ hintKeywords: hints, showDetail: '1' })}`, {
        headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Timestamp': ts, 'X-API-KEY': creds.accessLicense, 'X-Customer': String(creds.customerId), 'X-Signature': sign(creds.secretKey, ts, 'GET', '/keywordstool') },
        step: '키워드 검색량', source: 'searchad keywordstool',
      });
      const rows = parseKeywordTool(r.json);
      const hintSet = new Set(batch.map(norm));
      for (const row of rows) {
        const k = norm(row.keyword);
        if (hintSet.has(k)) volumes[k] = { ...row, fetchedAt: now() };
      }
      // 연관 키워드는 이 묶음 힌트 전체에 대해 돌아온다 → 묶음의 각 힌트에 같이 붙인다(검색량 상위 30개)
      const rel = rows.filter(r => !hintSet.has(norm(r.keyword))).sort((a, b) => b.total - a.total).slice(0, 30);
      for (const h of batch) related[norm(h)] = rel;
    } catch (e) {
      if (e.status === 401 || e.status === 403) throw new InsightError('검색광고 API 키가 올바르지 않습니다(설정에서 확인)', { code: 'CONFIG', status: e.status, source: 'searchad' });
      errors.push({ source: 'searchad keywordstool', keyword: hints, message: e.message });
      if (e.status === 429) break;
    }
  }
  log(`검색량 ${Object.keys(volumes).length}개 키워드 조회`);
  return { source: ['api.searchad.naver.com/keywordstool'], fetchedAt: now(), volumes, related, errors };
}

module.exports = { collectKeywords, parseKeywordTool, sign, SECRET_KEYS };
