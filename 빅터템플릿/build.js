// 빅터의 퍼니 이코노믹 — 글 1편용 이미지 세트(7~8장) 렌더러. GPT 없이 HTML→PNG(puppeteer)만 쓴다.
// 사용: node build.js <data.js> <출력폴더>
//   data.js: module.exports = { brand, cards:[ {type:'thumb'|'stats'|'bars'|'timeline'|'versus'|'compare'|'checklist'|'capture', ...} ] }
const fs = require('fs'), path = require('path');
const { puppeteer, CHROME } = require('../chrome.js');

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// **굵게**, [[형광|#색]] 표기를 카드 안에서도 쓸 수 있게
const rich = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\[\[(.+?)\|(#[0-9a-fA-F]{3,6})\]\]/g, '<mark style="background:$2">$1</mark>').replace(/\n/g, '<br>');

// ── 빅터 캐릭터(플랫 벡터). mood: normal | think | happy | point ──
function mascot(mood = 'normal', size = 220) {
  const mouth = mood === 'happy' ? '<path d="M86 118 q14 12 28 0" stroke="#1F2937" stroke-width="3" fill="none" stroke-linecap="round"/>'
    : mood === 'think' ? '<path d="M90 120 h18" stroke="#1F2937" stroke-width="3" stroke-linecap="round"/>'
      : '<path d="M88 118 q12 7 24 0" stroke="#1F2937" stroke-width="3" fill="none" stroke-linecap="round"/>';
  const brow = mood === 'think' ? '<path d="M70 86 l16 -4 M114 82 l16 4" stroke="#1F2937" stroke-width="3" stroke-linecap="round"/>'
    : '<path d="M70 86 l16 -2 M114 84 l16 2" stroke="#1F2937" stroke-width="3" stroke-linecap="round"/>';
  const arm = mood === 'point' ? '<path d="M150 178 q40 -30 62 -56" stroke="#19C37D" stroke-width="22" stroke-linecap="round" fill="none"/><circle cx="214" cy="120" r="13" fill="#F3D3B8"/>'
    : mood === 'think' ? '<path d="M148 180 q30 -10 20 -46" stroke="#19C37D" stroke-width="22" stroke-linecap="round" fill="none"/><circle cx="166" cy="130" r="13" fill="#F3D3B8"/>'
      : mood === 'happy' ? '<path d="M150 178 q46 -20 56 -70" stroke="#19C37D" stroke-width="22" stroke-linecap="round" fill="none"/><circle cx="208" cy="104" r="13" fill="#F3D3B8"/>'
        : '<path d="M150 184 q30 14 58 2" stroke="#19C37D" stroke-width="22" stroke-linecap="round" fill="none"/><circle cx="210" cy="184" r="13" fill="#F3D3B8"/><rect x="132" y="150" width="64" height="44" rx="8" fill="#0F1E3A"/><rect x="138" y="156" width="52" height="32" rx="4" fill="#fff"/><path d="M144 180 l10 -10 l10 6 l12 -14 l8 6" stroke="#19C37D" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
  return `<svg viewBox="0 0 240 240" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="110" cy="226" rx="78" ry="10" fill="#0F1E3A" opacity=".08"/>
  <path d="M46 236 q0 -70 64 -70 q64 0 64 70 z" fill="#19C37D"/>
  <path d="M86 170 h48 v18 h-48z" fill="#15A86A"/>
  ${arm}
  <path d="M62 102 q0 -56 48 -56 q48 0 48 56 v30 q0 40 -48 40 q-48 0 -48 -40 z" fill="#F3D3B8"/>
  <path d="M58 100 q4 -62 54 -62 q50 0 54 62 q-10 -28 -54 -28 q-44 0 -54 28 z" fill="#1F2937"/>
  <path d="M60 96 q10 -22 30 -30 q-26 4 -34 36 z" fill="#1F2937"/>
  <circle cx="84" cy="104" r="15" fill="none" stroke="#0F1E3A" stroke-width="4"/>
  <circle cx="136" cy="104" r="15" fill="none" stroke="#0F1E3A" stroke-width="4"/>
  <path d="M99 104 h22" stroke="#0F1E3A" stroke-width="4"/>
  <circle cx="86" cy="106" r="4" fill="#1F2937"/><circle cx="138" cy="106" r="4" fill="#1F2937"/>
  ${brow}${mouth}
  <circle cx="72" cy="124" r="6" fill="#F4A6A6" opacity=".7"/><circle cx="148" cy="124" r="6" fill="#F4A6A6" opacity=".7"/>
</svg>`;
}

// 상대역 캐릭터(정장·넥타이, 빅터와 다른 머리). mood: normal | worry | shout | happy
function other(mood = 'normal', size = 200, color = '#334155') {
  const mouth = mood === 'shout' ? '<ellipse cx="110" cy="122" rx="12" ry="9" fill="#1F2937"/>' : mood === 'worry' ? '<path d="M96 124 q14 -8 28 0" stroke="#1F2937" stroke-width="3" fill="none" stroke-linecap="round"/>' : mood === 'happy' ? '<path d="M94 118 q16 12 32 0" stroke="#1F2937" stroke-width="3" fill="none" stroke-linecap="round"/>' : '<path d="M96 120 h28" stroke="#1F2937" stroke-width="3" stroke-linecap="round"/>';
  const brow = mood === 'worry' ? '<path d="M72 88 l18 6 M130 94 l18 -6" stroke="#1F2937" stroke-width="3" stroke-linecap="round"/>' : mood === 'shout' ? '<path d="M72 92 l18 -6 M130 86 l18 6" stroke="#1F2937" stroke-width="3" stroke-linecap="round"/>' : '<path d="M72 88 l18 0 M130 88 l18 0" stroke="#1F2937" stroke-width="3" stroke-linecap="round"/>';
  const sweat = mood === 'worry' ? '<path d="M160 96 q8 12 0 18 q-8 -6 0 -18z" fill="#7DD3FC"/>' : '';
  return `<svg viewBox="0 0 240 240" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="110" cy="226" rx="78" ry="10" fill="#0F1E3A" opacity=".08"/>
  <path d="M46 236 q0 -70 64 -70 q64 0 64 70 z" fill="${color}"/>
  <path d="M98 168 l12 14 l12 -14 z" fill="#fff"/><path d="M106 180 l4 40 l4 -40 z" fill="#E5484D"/>
  <path d="M62 102 q0 -56 48 -56 q48 0 48 56 v30 q0 40 -48 40 q-48 0 -48 -40 z" fill="#F3D3B8"/>
  <path d="M62 98 q6 -50 48 -50 q42 0 48 50 q-6 -14 -48 -16 q-42 2 -48 16 z" fill="#6B7280"/>
  <circle cx="88" cy="108" r="4" fill="#1F2937"/><circle cx="132" cy="108" r="4" fill="#1F2937"/>
  ${brow}${mouth}${sweat}
</svg>`;
}

const CSS = `
@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css');
:root{--navy:#0F1E3A;--green:#19C37D;--green-soft:#E6F8EF;--ink:#1a1d21;--sub:#6B7280;--line:#E5E7EB;--bg:#F6F8FB;--card:#fff;--warn:#F59E0B;--warn-soft:#FFF4D6;--red:#E5484D;--red-soft:#FDE7E8}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font-family:Pretendard,'Noto Sans KR','Malgun Gothic',sans-serif;word-break:keep-all;-webkit-font-smoothing:antialiased;letter-spacing:-.01em;position:relative;overflow:hidden}
mark{padding:0 4px;border-radius:4px}
b{font-weight:800}
.kicker{display:inline-flex;align-items:center;gap:10px;font-size:20px;font-weight:700;color:var(--green);letter-spacing:.04em}
.kicker:before{content:'';width:10px;height:10px;border-radius:50%;background:var(--green)}
.badge{display:inline-block;background:var(--navy);color:#fff;font-size:18px;font-weight:700;border-radius:999px;padding:8px 18px}
.badge.g{background:var(--green)}.badge.o{background:var(--warn-soft);color:#9A5B00}.badge.r{background:var(--red-soft);color:#B3262B}.badge.l{background:#EEF1F6;color:var(--navy)}
h1{font-size:50px;font-weight:800;line-height:1.25;letter-spacing:-.025em;color:var(--navy)}
h2{font-size:36px;font-weight:800;line-height:1.3;color:var(--navy);letter-spacing:-.02em}
.sub{font-size:22px;color:var(--sub);line-height:1.5;font-weight:500}
.card{background:var(--card);border:1px solid var(--line);border-radius:22px;box-shadow:0 6px 24px rgba(15,30,58,.05)}
.ft{position:absolute;left:0;right:0;bottom:26px;text-align:center;font-size:16px;color:#9CA3AF;letter-spacing:.06em;font-weight:600}
.src{font-size:15px;color:#9CA3AF;margin-top:18px}
.grid-bg{position:absolute;inset:0;background-image:linear-gradient(rgba(15,30,58,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(15,30,58,.045) 1px,transparent 1px);background-size:40px 40px;z-index:0}
.wrap{position:relative;z-index:1;height:100%}
.tick{display:inline-flex;align-items:flex-start;gap:12px;font-size:22px;line-height:1.5}
.tick:before{content:'✔';color:var(--green);font-weight:800;flex:none}
`;

const page = (w, h, body, extra = '') => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>${CSS}body{width:${w}px;height:${h}px}${extra}</style></head><body><div class="grid-bg"></div><div class="wrap">${body}</div><div class="ft">${esc(BRAND)}</div></body></html>`;
let BRAND = '빅터의 퍼니 이코노믹';

const T = {
  // 썸네일: 제목+부제+배지+빅터
  thumb: d => page(1000, 1000, `
    <div style="padding:64px 64px 0">
      <div style="display:flex;gap:10px;align-items:center"><span class="badge">${esc(d.badge || '오늘의 이슈')}</span><span class="badge l">${esc(d.date || '')}</span></div>
      <h1 style="font-size:${d.titleSize || 66}px;margin-top:38px;line-height:1.22">${rich(d.title)}</h1>
      <div class="sub" style="font-size:25px;margin-top:22px">${rich(d.sub || '')}</div>
      ${d.chips ? `<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:30px">${d.chips.map(c => `<div class="card" style="padding:12px 18px;font-size:19px;border-radius:14px"><span style="color:var(--sub)">${esc(c[0])}</span> <b style="color:var(--navy);margin-left:6px">${esc(c[1])}</b></div>`).join('')}</div>` : ''}
      ${d.lines ? `<div style="display:flex;flex-direction:column;gap:12px;margin-top:34px">${d.lines.map(t => `<div class="tick" style="font-size:23px">${rich(t)}</div>`).join('')}</div>` : ''}
    </div>
    <div style="position:absolute;left:64px;right:48px;bottom:96px;display:flex;align-items:flex-end;justify-content:space-between;gap:16px">
      <div class="card" style="padding:22px 26px;max-width:580px;font-size:23px;line-height:1.5;border-left:8px solid var(--green)"><b style="color:var(--green)">빅터</b>&nbsp; ${rich(d.quote || '')}</div>
      ${mascot(d.mood || 'point', 290)}
    </div>`),

  // 핵심 수치 타일 + ✔ 요약
  stats: d => page(1200, 900, `
    <div style="padding:64px 72px 0">
      <div class="kicker">${esc(d.kicker || '한눈에 요약')}</div>
      <h2 style="margin-top:14px">${rich(d.title)}</h2>
      <div style="display:grid;grid-template-columns:repeat(${d.stats.length > 4 ? 3 : d.stats.length},1fr);gap:18px;margin-top:36px">
        ${d.stats.map(s => `<div class="card" style="padding:26px 24px"><div style="font-size:18px;color:var(--sub);font-weight:600">${esc(s.label)}</div><div style="font-size:${s.size || 44}px;font-weight:800;color:${s.color || 'var(--navy)'};margin-top:8px;letter-spacing:-.03em;line-height:1.1">${rich(s.value)}</div><div style="font-size:16px;color:var(--sub);margin-top:8px">${esc(s.note || '')}</div></div>`).join('')}
      </div>
      <div style="display:flex;gap:28px;align-items:flex-start;margin-top:36px">
        <div style="flex:1;display:flex;flex-direction:column;gap:14px">${(d.ticks || []).map(t => `<div class="tick">${rich(t)}</div>`).join('')}</div>
        ${mascot(d.mood || 'normal', 170)}
      </div>
      ${d.source ? `<div class="src">출처: ${esc(d.source)}</div>` : ''}
    </div>`),

  // 가로 막대 비교(지분 구도 등)
  bars: d => { const max = Math.max(...d.bars.map(b => b.value)); return page(1200, 900, `
    <div style="padding:64px 72px 0">
      <div class="kicker">${esc(d.kicker || '')}</div>
      <h2 style="margin-top:14px">${rich(d.title)}</h2>
      <div class="sub" style="margin-top:10px">${rich(d.sub || '')}</div>
      <div class="card" style="padding:34px 36px;margin-top:30px;display:flex;flex-direction:column;gap:20px">
        ${d.bars.map(b => `<div style="display:grid;grid-template-columns:190px 1fr 120px;align-items:center;gap:18px">
          <div style="font-size:21px;font-weight:700;color:var(--ink)">${esc(b.label)}${b.tag ? `<div style="font-size:14px;color:${b.tagColor || 'var(--sub)'};font-weight:600;margin-top:2px">${esc(b.tag)}</div>` : ''}</div>
          <div style="height:34px;background:#EEF1F6;border-radius:8px;overflow:hidden"><div style="width:${Math.round(b.value / max * 100)}%;height:100%;background:${b.color || 'var(--navy)'};border-radius:8px"></div></div>
          <div style="font-size:26px;font-weight:800;color:${b.color || 'var(--navy)'};text-align:right;font-variant-numeric:tabular-nums">${esc(b.text || b.value + '%')}</div></div>`).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:18px"><div class="src" style="margin:0">${d.source ? '출처: ' + esc(d.source) : ''}</div>${d.note ? `<div class="card" style="padding:14px 20px;font-size:19px;border-left:6px solid var(--green);max-width:720px">${rich(d.note)}</div>` : ''}</div>
    </div>`); },

  // 타임라인(세로)
  timeline: d => page(1200, 1000, `
    <div style="padding:64px 72px 0">
      <div class="kicker">${esc(d.kicker || '흐름 정리')}</div>
      <h2 style="margin-top:14px">${rich(d.title)}</h2>
      <div style="display:grid;grid-template-columns:1fr 200px;gap:24px;margin-top:30px;align-items:start">
        <div class="card" style="padding:14px 36px">
          ${d.items.map((it, i) => `<div style="display:grid;grid-template-columns:150px 28px 1fr;gap:14px;align-items:start;padding:17px 0;${i ? 'border-top:1px solid var(--line)' : ''}">
            <div style="font-size:20px;font-weight:800;color:${it.future ? 'var(--green)' : 'var(--navy)'};font-variant-numeric:tabular-nums">${esc(it.when)}</div>
            <div style="width:18px;height:18px;border-radius:50%;margin-top:6px;background:${it.future ? '#fff' : 'var(--navy)'};border:4px solid ${it.future ? 'var(--green)' : 'var(--navy)'}"></div>
            <div><div style="font-size:22px;font-weight:700;line-height:1.35">${rich(it.head)}</div>${it.body ? `<div style="font-size:17px;color:var(--sub);margin-top:4px;line-height:1.45">${rich(it.body)}</div>` : ''}</div></div>`).join('')}
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:12px">${mascot(d.mood || 'think', 190)}<div class="card" style="padding:12px 14px;font-size:16px;line-height:1.4;text-align:center">${rich(d.aside || '')}</div></div>
      </div>
      ${d.source ? `<div class="src">출처: ${esc(d.source)}</div>` : ''}
    </div>`),

  // 두 진영 비교(VS)
  versus: d => page(1200, 900, `
    <div style="padding:64px 72px 0">
      <div class="kicker">${esc(d.kicker || '')}</div>
      <h2 style="margin-top:14px">${rich(d.title)}</h2>
      <div style="display:grid;grid-template-columns:1fr 80px 1fr;gap:10px;margin-top:30px;align-items:stretch">
        ${[d.left, d.right].map((s, i) => `<div class="card" style="padding:28px 30px;border-top:8px solid ${i ? 'var(--green)' : 'var(--navy)'}">
          <div style="font-size:24px;font-weight:800;color:${i ? 'var(--green)' : 'var(--navy)'}">${esc(s.name)}</div>
          <div style="font-size:52px;font-weight:800;color:var(--ink);letter-spacing:-.03em;margin-top:6px;line-height:1.1">${rich(s.total)}</div>
          <div style="font-size:16px;color:var(--sub);margin-bottom:16px">${esc(s.totalNote || '')}</div>
          ${s.rows.map(r => `<div style="display:flex;justify-content:space-between;font-size:20px;padding:9px 0;border-top:1px solid var(--line)"><span>${esc(r[0])}</span><b style="font-variant-numeric:tabular-nums">${esc(r[1])}</b></div>`).join('')}
        </div>`).join(`<div style="display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:900;color:#9CA3AF">VS</div>`)}
      </div>
      <div style="display:flex;gap:18px;align-items:center;margin-top:22px">
        ${mascot(d.mood || 'think', 120)}
        <div class="card" style="padding:16px 22px;font-size:20px;line-height:1.5;border-left:6px solid var(--warn);flex:1">${rich(d.note || '')}</div>
      </div>
      ${d.source ? `<div class="src">출처: ${esc(d.source)}</div>` : ''}
    </div>`),

  // 항목별 2열 비교표(사례 비교)
  compare: d => page(1200, 900, `
    <div style="padding:64px 72px 0">
      <div class="kicker">${esc(d.kicker || '')}</div>
      <h2 style="margin-top:14px">${rich(d.title)}</h2>
      <div class="card" style="margin-top:30px;overflow:hidden">
        <div style="display:grid;grid-template-columns:200px 1fr 1fr;background:var(--navy);color:#fff;font-size:21px;font-weight:700"><div style="padding:16px 24px">구분</div><div style="padding:16px 24px;background:rgba(255,255,255,.08)">${esc(d.colA)}</div><div style="padding:16px 24px">${esc(d.colB)}</div></div>
        ${d.rows.map((r, i) => `<div style="display:grid;grid-template-columns:200px 1fr 1fr;font-size:21px;line-height:1.45;${i ? 'border-top:1px solid var(--line)' : ''}"><div style="padding:18px 24px;font-weight:700;color:var(--sub);background:#FAFBFD">${esc(r[0])}</div><div style="padding:18px 24px">${rich(r[1])}</div><div style="padding:18px 24px;font-weight:600">${rich(r[2])}</div></div>`).join('')}
      </div>
      <div style="display:flex;gap:18px;align-items:center;margin-top:22px">${mascot(d.mood || 'normal', 110)}<div class="card" style="padding:14px 22px;font-size:20px;line-height:1.5;border-left:6px solid var(--green);flex:1">${rich(d.note || '')}</div></div>
      ${d.source ? `<div class="src">출처: ${esc(d.source)}</div>` : ''}
    </div>`),

  // 체크포인트·일정
  checklist: d => page(1200, 900, `
    <div style="padding:64px 72px 0">
      <div class="kicker">${esc(d.kicker || '체크포인트')}</div>
      <h2 style="margin-top:14px">${rich(d.title)}</h2>
      <div style="display:grid;grid-template-columns:1fr 210px;gap:24px;margin-top:30px;align-items:start">
        <div style="display:flex;flex-direction:column;gap:14px">
          ${d.items.map((it, i) => `<div class="card" style="padding:20px 24px;display:grid;grid-template-columns:48px 1fr auto;gap:16px;align-items:center">
            <div style="width:48px;height:48px;border-radius:12px;background:var(--green-soft);color:var(--green);font-weight:800;font-size:22px;display:flex;align-items:center;justify-content:center">${i + 1}</div>
            <div><div style="font-size:23px;font-weight:700;line-height:1.35">${rich(it.head)}</div>${it.body ? `<div style="font-size:17px;color:var(--sub);margin-top:4px">${rich(it.body)}</div>` : ''}</div>
            ${it.when ? `<span class="badge ${it.badge || 'l'}" style="font-size:16px">${esc(it.when)}</span>` : ''}</div>`).join('')}
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:12px">${mascot(d.mood || 'happy', 200)}<div class="card" style="padding:12px 14px;font-size:16px;line-height:1.4;text-align:center">${rich(d.aside || '')}</div></div>
      </div>
      ${d.source ? `<div class="src">출처: ${esc(d.source)}</div>` : ''}
    </div>`),

  // 단컷·2컷 만화: 캐릭터(빅터 + 상대역)로 상황 표현. panels:[{who:'victor'|'other'|'both', bubble, sub, prop?}]
  comic: d => page(1200, d.panels.length > 1 ? 760 : 700, `
    <div style="padding:56px 64px 0">
      <div class="kicker">${esc(d.kicker || '한 컷으로 보는 상황')}</div>
      <h2 style="margin-top:12px;font-size:32px">${rich(d.title)}</h2>
      <div style="display:grid;grid-template-columns:repeat(${d.panels.length},1fr);gap:22px;margin-top:24px">
        ${d.panels.map((p, i) => `<div class="card" style="position:relative;padding:22px 24px 18px;min-height:420px;background:linear-gradient(180deg,#fff 0%,#F3F6FB 100%);overflow:hidden">
          <div style="position:absolute;left:18px;top:14px;width:34px;height:34px;border-radius:50%;background:var(--navy);color:#fff;font-weight:800;font-size:18px;display:flex;align-items:center;justify-content:center">${i + 1}</div>
          ${p.label ? `<div style="position:absolute;right:18px;top:16px" class="badge l">${esc(p.label)}</div>` : ''}
          <div style="display:flex;flex-direction:column;gap:10px;margin:48px 0 0;align-items:${p.who === 'other' ? 'flex-end' : 'flex-start'}">
            ${(p.bubbles || [p.bubble]).map((b, k) => `<div class="card" style="padding:14px 18px;font-size:${p.panelsBig ? 24 : 21}px;line-height:1.45;max-width:86%;border-radius:18px;${k % 2 === (p.who === 'other' ? 0 : 1) ? 'background:var(--green-soft);border-color:#CDEFDD;align-self:flex-end' : 'align-self:flex-start'}">${rich(b)}</div>`).join('')}
          </div>
          <div style="position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:${p.who === 'both' ? 'space-between' : p.who === 'other' ? 'flex-end' : 'flex-start'};align-items:flex-end;padding:0 10px">
            ${p.who !== 'other' ? mascot(p.mood || 'normal', 200) : ''}
            ${p.prop ? `<div style="font-size:64px;margin:0 8px 20px;line-height:1">${esc(p.prop)}</div>` : ''}
            ${p.who !== 'victor' ? other(p.otherMood || 'normal', 200, p.otherColor) : ''}
          </div>
          ${p.sub ? `<div style="position:absolute;left:0;right:0;bottom:0;background:rgba(15,30,58,.85);color:#fff;font-size:17px;padding:8px 14px;text-align:center">${rich(p.sub)}</div>` : ''}
        </div>`).join('')}
      </div>
      ${d.note ? `<div style="margin-top:16px;font-size:18px;color:var(--sub)">${rich(d.note)}</div>` : ''}
    </div>`),

  // 해외·외부 자료 캡처 액자 + 출처
  capture: d => page(1200, 900, `
    <div style="padding:56px 72px 0">
      <div class="kicker">${esc(d.kicker || '해외 보도')}</div>
      <h2 style="margin-top:12px;font-size:32px">${rich(d.title)}</h2>
      <div class="card" style="margin-top:22px;padding:14px;background:#fff"><img src="file:///${d.image.replace(/\\/g, '/')}" style="display:block;width:100%;height:${d.imageHeight || 520}px;object-fit:cover;object-position:top;border-radius:12px;border:1px solid var(--line)"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;gap:20px">
        <div style="font-size:19px;line-height:1.5;flex:1">${rich(d.caption || '')}</div>
        <div class="badge l" style="font-size:15px;white-space:nowrap">출처: ${esc(d.source)}</div>
      </div>
    </div>`),
};

async function build(dataFile, outDir) {
  const data = require(path.resolve(dataFile));
  BRAND = data.brand || BRAND;
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const pg = await browser.newPage();
  let i = 0;
  for (const c of data.cards) {
    i++;
    const fn = T[c.type]; if (!fn) throw new Error('모르는 카드 종류: ' + c.type);
    const html = fn(c);
    const tmp = path.join(outDir, `_${i}.html`); fs.writeFileSync(tmp, html, 'utf8');
    const m = html.match(/body\{width:(\d+)px;height:(\d+)px\}/); const w = +m[1], h = +m[2];
    await pg.setViewport({ width: w, height: h, deviceScaleFactor: 1.5 });
    await pg.goto('file:///' + tmp.replace(/\\/g, '/'), { waitUntil: 'networkidle0', timeout: 30000 }).catch(() => { });
    await new Promise(r => setTimeout(r, 500));
    // 썸네일(정사각)만 고정, 나머지는 내용 높이에 맞춰 아래 여백을 줄인다
    if (c.type !== 'thumb') {
      const need = await pg.evaluate(() => { const w = document.querySelector('.wrap'); let maxB = 0; for (const el of w.querySelectorAll('*')) { const r = el.getBoundingClientRect(); if (r.height > 0) maxB = Math.max(maxB, r.bottom); } return Math.ceil(maxB + 130); });
      const hh = Math.max(640, Math.min(1500, need));
      await pg.evaluate(hh => { document.body.style.height = hh + 'px'; }, hh);
      await pg.setViewport({ width: w, height: hh, deviceScaleFactor: 1.5 });
      await new Promise(r => setTimeout(r, 200));
    }
    const out = path.join(outDir, `${String(i).padStart(2, '0')}_${c.name || c.type}.png`);
    await pg.screenshot({ path: out }); fs.unlinkSync(tmp);
    console.log('saved', path.basename(out));
  }
  await browser.close();
}
if (require.main === module) build(process.argv[2], process.argv[3]).catch(e => { console.error(e.message); process.exit(1); });
module.exports = { build, mascot };
