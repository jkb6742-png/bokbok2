// 네트워크·테더링 상태 엔진 (Windows 전용, Node 내장만)
//   linkInfo()                 지금 인터넷이 나가는 어댑터가 무엇인지 (USB 테더링 / 휴대폰 핫스팟 / 와이파이 / 유선)
//   geo(ip)                    공인 IP의 국가·지역·도시·통신사 (ipinfo.io → ipwho.is, IP 외 다른 정보는 보내지 않음)
//   adb                        휴대폰(안드로이드, USB 디버깅 켬)의 adb 경로·연결 확인
//   reroll({ mode, tries })    휴대폰 데이터(또는 비행기 모드)를 껐다 켜서 통신사 IP를 새로 받는다
//   light(state)               신호등: green / amber / red + 이유
// 상태 파일: <DATA>\net.json — { ip, prev, changedAt, geo:{ip:…}, history:[…], avoidRegions:[], hotspotName, adbPath, tetherOnly }
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { execFile } = require('child_process');

const DATA = process.env.BOKBOK_DATA || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'bokbok');
const FILE = path.join(DATA, 'net.json');
const readState = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } };
function writeState(v) { fs.mkdirSync(DATA, { recursive: true }); const t = FILE + '.tmp'; fs.writeFileSync(t, JSON.stringify(v, null, 1)); fs.renameSync(t, FILE); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = (file, args, { timeout = 15000, encoding = 'utf8' } = {}) => new Promise((res, rej) => {
  execFile(file, args, { timeout, encoding, windowsHide: true, maxBuffer: 1 << 20 }, (e, out, err) => {
    if (e && !out) return rej(Object.assign(new Error((err || e.message || '').trim() || '실행 실패'), { code: e.code }));
    res({ out: String(out || ''), err: String(err || '') });
  });
});
const ps = script => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' + script]);

// ── 어댑터 ───────────────────────────────────────────
const USB_RE = /RNDIS|Remote NDIS|NDIS[- ]?based Internet Sharing|Internet Sharing|USB Ethernet\/RNDIS|Tether|Apple Mobile Device Ethernet|iPhone|Android|Galaxy|Samsung Mobile|Mobile USB/i;
const WWAN_RE = /Mobile Broadband|\bWWAN\b|\bLTE\b|5G Modem|Cellular/i;   // 'Realtek' 안의 lte 같은 부분 일치를 막는다

async function linkInfo(settings = {}) {
  const out = { connected: false, kind: 'none', label: '연결 없음', adapter: null, desc: null, ssid: null, gateway: null, ifIp: null, adapters: [] };
  try {
    const script = `
$ad = Get-NetAdapter | Where-Object Status -eq 'Up' | Select-Object Name,InterfaceDescription,MediaType,InterfaceIndex,LinkSpeed
$rt = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric,InterfaceMetric | Select-Object -First 1 InterfaceIndex,InterfaceAlias,NextHop
$ip = if ($rt) { (Get-NetIPAddress -InterfaceIndex $rt.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress } else { $null }
$ssid = $null
try { $w = (netsh wlan show interfaces) -join "\`n"; if ($w -match '(?m)^\\s*SSID\\s*:\\s*(.+)$') { $ssid = $Matches[1].Trim() } } catch {}
@{ adapters = @($ad); route = $rt; ip = $ip; ssid = $ssid } | ConvertTo-Json -Compress -Depth 4`;
    const { out: txt } = await ps(script);
    const j = JSON.parse(txt.trim() || '{}');
    const adapters = Array.isArray(j.adapters) ? j.adapters : (j.adapters ? [j.adapters] : []);
    out.adapters = adapters.map(a => ({ name: a.Name, desc: a.InterfaceDescription, media: a.MediaType, index: a.InterfaceIndex, speed: a.LinkSpeed }));
    out.ssid = j.ssid || null;
    if (j.route) {
      const act = adapters.find(a => a.InterfaceIndex === j.route.InterfaceIndex) || adapters.find(a => a.Name === j.route.InterfaceAlias);
      out.connected = true; out.gateway = j.route.NextHop || null; out.ifIp = j.ip || null;
      out.adapter = act ? act.Name : j.route.InterfaceAlias; out.desc = act ? act.InterfaceDescription : null;
      const media = String(act ? act.MediaType : ''), desc = `${out.adapter} ${out.desc || ''}`;
      const hot = String(settings.hotspotName || '').trim();
      if (USB_RE.test(desc)) { out.kind = 'usb'; out.label = 'USB 테더링'; }
      else if (/802\.3/.test(media)) { out.kind = 'lan'; out.label = '유선 인터넷'; }
      else if (/WWAN|Wireless WAN/i.test(media) || WWAN_RE.test(desc)) { out.kind = 'wwan'; out.label = '내장 모바일 데이터'; }
      else if (/802\.11|Wireless|WiFi|Wi-Fi/i.test(media + ' ' + desc)) {
        if (hot && out.ssid && out.ssid.toLowerCase() === hot.toLowerCase()) { out.kind = 'hotspot'; out.label = `휴대폰 핫스팟 (${out.ssid})`; }
        else { out.kind = 'wifi'; out.label = `와이파이${out.ssid ? ' (' + out.ssid + ')' : ''}`; }
      } else { out.kind = 'lan'; out.label = '유선 인터넷'; }
    }
  } catch (e) { out.error = e.message; }
  // 사설 IP 대역 192.168.42.x / 172.20.10.x 는 안드로이드·아이폰 테더링 기본값 → 설명이 애매해도 테더링으로 본다
  if (out.connected && out.kind === 'lan' && /^(192\.168\.42\.|172\.20\.10\.)/.test(out.ifIp || '')) { out.kind = 'usb'; out.label = 'USB 테더링'; }
  out.tethered = ['usb', 'hotspot', 'wwan'].includes(out.kind);
  return out;
}

// ── 지역 ───────────────────────────────────────────
const geoCache = new Map();
async function geo(ip, fetchFn = globalThis.fetch) {
  if (!ip) return null;
  if (geoCache.has(ip)) return geoCache.get(ip);
  const st = readState();
  if (st.geo && st.geo[ip] && Date.now() - (st.geo[ip].at || 0) < 7 * 864e5) { geoCache.set(ip, st.geo[ip]); return st.geo[ip]; }
  let g = null;
  try {
    const r = await fetchFn(`https://ipinfo.io/${encodeURIComponent(ip)}/json`, { signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' } });
    if (r.ok) { const j = await r.json(); if (j && !j.bogon) g = { country: j.country || null, region: j.region || null, city: j.city || null, org: j.org || null, loc: j.loc || null, source: 'ipinfo.io' }; }
  } catch { }
  if (!g) try {
    const r = await fetchFn(`https://ipwho.is/${encodeURIComponent(ip)}`, { signal: AbortSignal.timeout(5000) });
    if (r.ok) { const j = await r.json(); if (j && j.success !== false) g = { country: j.country_code || j.country || null, region: j.region || null, city: j.city || null, org: (j.connection && (j.connection.isp || j.connection.org)) || null, loc: j.latitude != null ? `${j.latitude},${j.longitude}` : null, source: 'ipwho.is' }; }
  } catch { }
  if (!g) return null;
  g.at = Date.now();
  // 통신사 이름 짧게 (AS번호 제거)
  if (g.org) g.org = String(g.org).replace(/^AS\d+\s+/, '');
  const s2 = readState(); s2.geo = s2.geo || {};
  const keys = Object.keys(s2.geo); if (keys.length > 200) for (const k of keys.slice(0, keys.length - 200)) delete s2.geo[k];
  s2.geo[ip] = g; writeState(s2); geoCache.set(ip, g);
  return g;
}
// 한국 광역 지역 17곳 (ipinfo 영문 표기 → 한글). 피할 지역 목록은 'KR/서울' 같은 한글 키로 저장한다.
const REGIONS = [
  ['서울', ['Seoul']], ['경기', ['Gyeonggi-do', 'Gyeonggi']], ['인천', ['Incheon']], ['부산', ['Busan']], ['대구', ['Daegu']], ['광주', ['Gwangju']], ['대전', ['Daejeon']], ['울산', ['Ulsan']], ['세종', ['Sejong-si', 'Sejong']],
  ['강원', ['Gangwon-do', 'Gangwon State', 'Gangwon']], ['충북', ['Chungcheongbuk-do', 'North Chungcheong']], ['충남', ['Chungcheongnam-do', 'South Chungcheong']], ['전북', ['Jeollabuk-do', 'Jeonbuk State', 'North Jeolla']], ['전남', ['Jeollanam-do', 'South Jeolla']],
  ['경북', ['Gyeongsangbuk-do', 'North Gyeongsang']], ['경남', ['Gyeongsangnam-do', 'South Gyeongsang']], ['제주', ['Jeju-do', 'Jeju']],
].map(([ko, en]) => ({ key: 'KR/' + ko, label: ko, en }));
const EN2KO = new Map(); for (const r of REGIONS) for (const e of r.en) EN2KO.set(e.toLowerCase(), r.label);
function regionKey(g) {
  if (!g) return null;
  if (g.country === 'KR' && g.region) { const ko = EN2KO.get(String(g.region).toLowerCase()); if (ko) return 'KR/' + ko; }
  return [g.country, g.region].filter(Boolean).join('/') || null;
}
// 영문 지역명 → 한글 (ipinfo 표기 기준)
const KO_REGION = { 'Seoul': '서울', 'Busan': '부산', 'Daegu': '대구', 'Incheon': '인천', 'Gwangju': '광주', 'Daejeon': '대전', 'Ulsan': '울산', 'Sejong-si': '세종', 'Sejong': '세종',
  'Gyeonggi-do': '경기', 'Gangwon-do': '강원', 'Gangwon State': '강원', 'Chungcheongbuk-do': '충북', 'Chungcheongnam-do': '충남', 'Jeollabuk-do': '전북', 'Jeonbuk State': '전북', 'Jeollanam-do': '전남',
  'Gyeongsangbuk-do': '경북', 'Gyeongsangnam-do': '경남', 'Jeju-do': '제주' };
const KO_CITY = { 'Seoul': '서울', 'Busan': '부산', 'Daegu': '대구', 'Incheon': '인천', 'Gwangju': '광주', 'Daejeon': '대전', 'Ulsan': '울산', 'Suwon': '수원', 'Suwon-si': '수원', 'Seongnam-si': '성남', 'Goyang-si': '고양', 'Yongin-si': '용인', 'Bucheon-si': '부천', 'Anyang-si': '안양', 'Ansan-si': '안산', 'Hwaseong-si': '화성', 'Pyeongtaek-si': '평택', 'Icheon-si': '이천', 'Uijeongbu-si': '의정부', 'Paju-si': '파주', 'Gimpo-si': '김포', 'Namyangju-si': '남양주', 'Siheung-si': '시흥', 'Gwangmyeong-si': '광명', 'Cheongju-si': '청주', 'Cheonan-si': '천안', 'Jeonju-si': '전주', 'Changwon-si': '창원', 'Pohang-si': '포항', 'Gimhae-si': '김해', 'Jeju-si': '제주', 'Chuncheon-si': '춘천', 'Wonju-si': '원주', 'Gangneung-si': '강릉' };
const ko = (m, v) => v ? (m[v] || String(v).replace(/-(si|gun|gu)$/i, '')) : '';
function regionLabel(g) {
  if (!g) return '';
  const r = ko(KO_REGION, g.region), c = ko(KO_CITY, g.city);
  const parts = r === c ? [r] : [r, c].filter(Boolean);
  if (g.country && g.country !== 'KR') parts.unshift(g.country);
  return parts.join(' ') || g.country || '';
}

// ── 이력 ───────────────────────────────────────────
function recordIp(ip, g, link) {
  if (!ip) return;
  const st = readState();
  st.history = Array.isArray(st.history) ? st.history : [];
  const last = st.history[0];
  if (last && last.ip === ip) { last.lastSeen = Date.now(); if (g && !last.region) Object.assign(last, { region: regionKey(g), label: regionLabel(g), org: g.org }); }
  else st.history.unshift({ ip, at: Date.now(), lastSeen: Date.now(), region: regionKey(g), label: regionLabel(g), org: g ? g.org : null, link: link ? link.kind : null });
  if (st.history.length > 100) st.history.length = 100;
  writeState(st);
  return st.history;
}

// ── adb ───────────────────────────────────────────
function adbCandidates(settings = {}) {
  const c = [];
  if (settings.adbPath) c.push(settings.adbPath);
  const la = process.env.LOCALAPPDATA || '';
  c.push(path.join(la, 'Android', 'Sdk', 'platform-tools', 'adb.exe'), 'C:\\platform-tools\\adb.exe', 'C:\\adb\\adb.exe', path.join(os.homedir(), 'platform-tools', 'adb.exe'), path.join(DATA, 'platform-tools', 'adb.exe'));
  for (const d of String(process.env.PATH || '').split(';')) if (d) c.push(path.join(d, 'adb.exe'));
  return c;
}
function adbPath(settings) { for (const f of adbCandidates(settings)) { try { if (fs.statSync(f).isFile()) return f; } catch { } } return null; }
async function adbDevices(settings) {
  const bin = adbPath(settings);
  if (!bin) return { available: false, path: null, devices: [] };
  try {
    const { out } = await run(bin, ['devices', '-l'], { timeout: 8000 });
    const devices = out.split(/\r?\n/).slice(1).map(l => l.trim()).filter(l => l && !/^\*/.test(l)).map(l => { const [serial, state, ...rest] = l.split(/\s+/); const m = rest.join(' ').match(/model:(\S+)/); return { serial, state, model: m ? m[1].replace(/_/g, ' ') : null }; });
    return { available: true, path: bin, devices };
  } catch (e) { return { available: true, path: bin, devices: [], error: e.message }; }
}
async function adbShell(bin, serial, cmd) {
  const args = serial ? ['-s', serial, 'shell', cmd] : ['shell', cmd];
  const { out, err } = await run(bin, args, { timeout: 12000 });
  const txt = (out + err).trim();
  if (/(not found|Exception|Error|denied|Security)/i.test(txt) && !/^\s*$/.test(txt)) throw new Error(txt.split('\n')[0]);
  return txt;
}

// 휴대폰 데이터를 껐다 켠다. mode: 'data'(기본, 핫스팟·USB 연결 유지) | 'airplane'(더 확실하지만 핫스팟이 꺼질 수 있음)
async function toggleMobile(bin, serial, mode, log) {
  if (mode === 'airplane') {
    log('비행기 모드 켬');
    await adbShell(bin, serial, 'cmd connectivity airplane-mode enable');
    await sleep(4000);
    log('비행기 모드 끔');
    await adbShell(bin, serial, 'cmd connectivity airplane-mode disable');
  } else {
    log('휴대폰 모바일 데이터 끔');
    await adbShell(bin, serial, 'svc data disable');
    await sleep(4000);
    log('휴대폰 모바일 데이터 켬');
    await adbShell(bin, serial, 'svc data enable');
  }
}

// 인터넷이 다시 붙고 IP가 바뀔 때까지 기다림
async function waitForIp({ getIp, prevIp, timeoutMs = 60000, log }) {
  const t0 = Date.now();
  let ip = null, lastLog = 0;
  while (Date.now() - t0 < timeoutMs) {
    await sleep(3000);
    try { ip = await getIp(); } catch { ip = null; }
    if (ip && ip !== prevIp) return ip;
    if (Date.now() - lastLog > 9000) { log(ip ? `아직 같은 IP(${ip}) · 기다리는 중` : '인터넷 다시 붙는 중'); lastLog = Date.now(); }
  }
  return ip;
}

let rolling = false;
// 새 IP 받기. 피할 지역이면 tries 번까지 반복. getIp: 공인 IP를 새로 조회하는 함수(서버의 publicIp(force)).
async function reroll({ settings = {}, mode = 'data', tries = 1, getIp, log = () => { }, serial } = {}) {
  if (rolling) throw Object.assign(new Error('이미 IP를 다시 받는 중입니다'), { code: 'BUSY' });
  rolling = true;
  try {
    const a = await adbDevices(settings);
    if (!a.available) throw Object.assign(new Error('adb를 찾지 못했습니다. 네트워크 설정에서 adb.exe 경로를 넣거나, 휴대폰에서 직접 비행기 모드를 켰다 꺼 주세요'), { code: 'NOADB' });
    const dev = (serial ? a.devices.find(d => d.serial === serial) : a.devices.find(d => d.state === 'device')) || a.devices[0];
    if (!dev) throw Object.assign(new Error('USB로 연결된 휴대폰이 없습니다. 휴대폰에서 USB 디버깅을 켜고 "이 컴퓨터 허용"을 눌러 주세요'), { code: 'NODEVICE' });
    if (dev.state !== 'device') throw Object.assign(new Error(dev.state === 'unauthorized' ? '휴대폰 화면에서 "USB 디버깅 허용"을 눌러 주세요' : `휴대폰 상태: ${dev.state}`), { code: 'UNAUTHORIZED' });
    const avoid = new Set((settings.avoidRegions || []).map(String));
    let prevIp = null; try { prevIp = await getIp(); } catch { }
    const steps = [];
    tries = Math.max(1, Math.min(10, tries));
    for (let i = 1; i <= tries; i++) {
      log(`${i}번째 시도${dev.model ? ' · ' + dev.model : ''}`);
      await toggleMobile(a.path, dev.serial, mode, log);
      const ip = await waitForIp({ getIp, prevIp, log });
      if (!ip) { steps.push({ try: i, ip: null }); log('인터넷이 돌아오지 않았습니다'); continue; }
      const g = await geo(ip);
      const rk = regionKey(g);
      steps.push({ try: i, ip, region: rk, label: regionLabel(g) });
      log(ip === prevIp ? `IP가 바뀌지 않았습니다 (${ip})` : `새 IP ${ip}${g ? ' · ' + regionLabel(g) + (g.org ? ' · ' + g.org : '') : ''}`);
      prevIp = ip;
      if (rk && avoid.has(rk) && i < tries) { log(`제외한 지역(${regionLabel(g)}) → 다시 받습니다 (${i}/${tries})`); await sleep(2000); continue; }
      return { ok: true, ip, geo: g, avoided: !!(rk && avoid.has(rk)), steps };
    }
    return { ok: false, ip: prevIp, steps, error: `${tries}번 받아 봤지만 제외한 지역을 벗어나지 못했습니다 (통신사 IP는 지역이 잘 안 바뀝니다)` };
  } finally { rolling = false; }
}

// ── 신호등 ───────────────────────────────────────────
function light({ ip, link, geo: g, settings = {} }) {
  const avoid = new Set((settings.avoidRegions || []).map(String));
  const rk = regionKey(g);
  if (!link || !link.connected) return { color: 'red', text: '인터넷 연결 없음', reason: '기본 경로(게이트웨이)가 없습니다' };
  if (!ip) return { color: 'red', text: '인터넷 안 됨', reason: `${link.label}에 붙어 있지만 바깥으로 나가지 못합니다` };
  if (rk && avoid.has(rk)) return { color: 'amber', text: '제외한 지역', reason: `${regionLabel(g)} · [새 IP 받기]로 다른 지역을 받으세요` };
  if (settings.tetherOnly !== false && !link.tethered) return { color: 'amber', text: '테더링 아님', reason: `${link.label}으로 나가고 있습니다 (집·사무실 IP)` };
  return { color: 'green', text: link.tethered ? '테더링 정상' : '연결 정상', reason: `${link.label}${g ? ' · ' + regionLabel(g) : ''}` };
}

module.exports = { REGIONS, linkInfo, geo, regionKey, regionLabel, recordIp, adbPath, adbDevices, reroll, light, readState, writeState, isRolling: () => rolling, _internal: { USB_RE, waitForIp, toggleMobile } };
