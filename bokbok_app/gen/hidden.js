// 히든 이미지: 블로그 주인이 자기 블로그의 비공개 글에 넣어 둔 고정 이미지(원장 소개 사진·치과 안내·지도 등)를
// 모든 원고의 정해진 자리(슬롯)에 넣는다. 이미지 바로 아래 적힌 글(규칙 문구)로 자리를 정한다.
//   SLOTS        슬롯 목록(id → 라벨·자리 설명)
//   ruleToSlot   "맨처음"·"중간"·"맨마지막"·"지도" 같은 문구 → 슬롯 id (모르면 custom)
//   normalize    계정의 hidden 목록 → 계획(P.hidden)에 들어갈 모양
//   promptBlock  GPT 지시문 블록(고정 이미지 번호·자리)
'use strict';

const SLOTS = {
  intro: { label: '원장 소개 자리', where: '도입 본문이 끝난 자리, 첫 구분선 바로 앞(이미지 → 원장 인사 본문 1~3줄 → 구분선)' },
  middle: { label: '글 중간', where: '본문 가운데 사진 섹션 앞(그 섹션 구분선 바로 앞, 앞 섹션 마지막 본문 줄 뒤)' },
  outro: { label: '글 끝 안내', where: '마지막 본문 섹션 끝(정리 섹션 구분선 바로 앞, 이미지 → 안내 본문 1~2줄 → 구분선)' },
  map: { label: '위치 안내', where: '글 끝 안내 이미지와 그 본문 바로 다음(정리 섹션 구분선 앞)' },
  custom: { label: '직접 지정', where: '캡션이 가리키는 자리, 애매하면 정리 섹션 구분선 앞' },
};
const SLOT_IDS = Object.keys(SLOTS);
const MAX = 6;

// 규칙 문구 → 슬롯. 사용자가 비공개 글의 이미지 아래에 적는 말: 맨처음 / 중간 / 맨마지막 / 지도 …
function ruleToSlot(text) {
  const t = String(text || '').replace(/\s+/g, '').toLowerCase();
  if (!t) return 'custom';
  if (/지도|위치|오시는길|찾아오|약도|주차/.test(t)) return 'map';
  if (/맨처음|처음|시작|앞부분|도입|원장|의료진|소개|인사/.test(t)) return 'intro';
  if (/맨마지막|마지막|맨끝|끝|마무리|안내|진료시간|연락처/.test(t)) return 'outro';
  if (/중간|가운데|본문중|중반/.test(t)) return 'middle';
  if (/^(intro|top|first|start)$/.test(t)) return 'intro';
  if (/^(middle|mid|center)$/.test(t)) return 'middle';
  if (/^(outro|end|last|bottom)$/.test(t)) return 'outro';
  if (/^(map|location)$/.test(t)) return 'map';
  return 'custom';
}

const clean = (s, n) => String(s || '').replace(/[​‌‍﻿]/g, '').replace(/[\r\n\0]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
// 계정에 저장할 모양으로 다듬기(파일 존재 여부는 서버가 본다). 한 슬롯에 한 장(custom 제외), 최대 6장
function normalize(items) {
  const out = [], used = new Set();
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it !== 'object') continue;
    const file = clean(it.file, 120);
    if (!file || /[\\/]/.test(file)) continue;
    let slot = SLOT_IDS.includes(it.slot) ? it.slot : ruleToSlot(it.rule);
    if (slot !== 'custom' && used.has(slot)) slot = 'custom';
    used.add(slot);
    out.push({ file, slot, caption: clean(it.caption, 120), rule: clean(it.rule, 60), label: slot === 'custom' ? clean(it.label || it.rule, 30) : '' });
    if (out.length >= MAX) break;
  }
  return out;
}

const describe = h => `${SLOTS[h.slot].label}${h.slot === 'custom' && h.label ? `(${h.label})` : ''}`;

// 프롬프트 블록: 번호(k)와 자리, 캡션. P.imageCount 뒤 번호를 쓴다
function promptBlock(P) {
  const H = Array.isArray(P.hidden) ? P.hidden : [];
  if (!H.length) return '';
  const base = P.imageCount;
  const lines = H.map((h, i) => `  ${base + i}번: ${describe(h)} — 자리: ${SLOTS[h.slot].where}${h.caption ? ` · 내용: ${h.caption.replace(/"/g, "'")}` : ''}`);
  return [
    '# 고정 이미지(히든) — 블로그 주인이 정해 둔 이미지를 정해진 자리에 그대로 넣는다',
    ...lines,
    `- 위 번호의 {"img":k} 블록을 그 자리에 정확히 한 번씩 넣는다(사진 순서 규칙과 별개). images[k]는 {"kind":"hidden"} 하나만 적는다(prompt·alt 없음).`,
    '- 고정 이미지 바로 다음에는 그 이미지를 받는 본문 1~3줄을 둔다(예: 원장 소개 이미지 다음 인사말, 안내 이미지 다음 안내 한 줄). 고정 이미지 뒤에 바로 구분선·인용구를 두지 않는다.',
    '- 고정 이미지는 본문 사진 수에 들어가지 않고, 정리 섹션(마지막 인용구 뒤)에는 넣지 않는다.',
  ].join('\n');
}

module.exports = { SLOTS, SLOT_IDS, MAX, ruleToSlot, normalize, promptBlock, describe };
