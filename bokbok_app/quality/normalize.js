// 원고 읽기 + 비교용 정규화
// - .txt 는 naver_post/manuscript.js 의 parseTxt 로 읽는다(사진 존재 검사 없이)
// - *_layout.js 는 직접 require 해서 같은 블록 구조로 맞춘다
const fs = require('fs'), path = require('path');
const T = require('./thresholds');

const MANUSCRIPT_JS = path.resolve(__dirname, '..', '..', 'naver_post', 'manuscript.js');

// MBTI 별명 → 유형
const NICK = {
  인팁: 'INTP', 인프피: 'INFP', 인프제: 'INFJ', 인티제: 'INTJ',
  엔팁: 'ENTP', 엔프피: 'ENFP', 엔프제: 'ENFJ', 엔티제: 'ENTJ',
  잇팁: 'ISTP', 잇프피: 'ISFP', 잇프제: 'ISFJ', 잇티제: 'ISTJ',
  엣팁: 'ESTP', 엣프피: 'ESFP', 엣프제: 'ESFJ', 엣티제: 'ESTJ',
};
const NICK_RE = new RegExp(Object.keys(NICK).join('|'), 'g');
const MBTI_RE = /[EI][NS][TF][JP]/g;

function loadManuscript(file) {
  file = path.resolve(file);
  let S;
  if (/\.txt$/i.test(file)) {
    S = require(MANUSCRIPT_JS).parseTxt(file);
  } else if (/\.js$/i.test(file)) {
    delete require.cache[require.resolve(file)];
    const L = require(file);
    S = { title: L.title || '', category: L.category || '', tags: [...(L.tags || [])], blocks: (L.blocks || []).map(b => ({ ...b })) };
  } else throw new Error('지원하지 않는 원고 형식: ' + file);
  S.file = file;
  S.rawSha256 = require('crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  return S;
}

// 서식 표시 제거: **굵게**, [[글|#색]], ## 소주제, NFKC, 공백 정리
function stripMarkup(s) {
  return String(s || '').normalize('NFKC')
    .replace(/\[\[([^|\]]+)\|#[0-9a-f]{3,8}\]\]/gi, '$1')
    .replace(/\*\*/g, '')
    .replace(/^\s*##\s*/, '')
    .replace(/\[빈줄\]/g, '')
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, ' ').trim();
}

function normText(s) { return stripMarkup(s).toLowerCase(); }

let mandatoryRes = null;
function isMandatory(line) {
  mandatoryRes = mandatoryRes || T.mandatoryPatterns.map(p => new RegExp(p));
  return mandatoryRes.some(re => re.test(line));
}

// MBTI 유형·별명을 같은 자리표로 (고정 문구 비교용)
function slotTypes(s) {
  return String(s).replace(NICK_RE, '{T}').toUpperCase().replace(MBTI_RE, '{T}');
}

// 본문 줄 목록(해시태그 블록·필수 반복부 제외). 줄마다 kind 표시
function bodyLines(S) {
  const out = [];
  for (const b of S.blocks) {
    if (b.text) for (const l of b.text) { const t = stripMarkup(l); if (t && !isMandatory(t)) out.push({ kind: 'text', text: t, raw: l }); }
    else if (b.quote !== undefined) { const t = stripMarkup(b.quote); if (t && !isMandatory(t)) out.push({ kind: 'quote', text: t, raw: b.quote }); }
    else if (b.table) for (const r of b.table) out.push({ kind: 'table', text: r.map(stripMarkup).join(' ') });
  }
  return out;
}

function bodyText(S) { return bodyLines(S).map(l => l.text).join('\n').toLowerCase(); }

// 어절 토큰(문장부호 제거)
function tokens(text) {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
}

function splitSentences(line) {
  return String(line).split(/(?<=[.!?。…])\s+/).map(s => s.trim()).filter(Boolean);
}

const EMOJI_RE = /(\p{Extended_Pictographic}|[♡♥☆★])️?\s*$/u;

module.exports = { loadManuscript, stripMarkup, normText, isMandatory, slotTypes, bodyLines, bodyText, tokens, splitSentences, NICK, MBTI_RE, NICK_RE, EMOJI_RE };
