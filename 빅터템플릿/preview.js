// 원고.txt(bokbok 엔진 형식) → 네이버 글처럼 보이는 미리보기 HTML. 사용: node preview.js <원고.txt> <출력.html>
const fs = require('fs'), path = require('path');
const [src, out] = process.argv.slice(2);
const raw = fs.readFileSync(src, 'utf8').replace(/^﻿/, '').replace(/\r/g, '');
const [head, ...rest] = raw.split(/\n\s*\n/);
const meta = {}; for (const l of head.split('\n')) { const m = l.match(/^\s*([^:：]+)[:：]\s*(.*)$/); if (m) meta[m[1].trim()] = m[2].trim(); }
const dir = meta['사진폴더'] || path.dirname(src);
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\[\[(.+?)\|(#[0-9a-fA-F]{3,6})\]\]/g, '<mark style="background:$2">$1</mark>');
const tags = (meta['태그'] || '').split(/[,，\s]+/).filter(Boolean);
let html = '', para = [];
const flush = () => { if (!para.length) return; html += '<div class="p">' + para.map(l => l.startsWith('## ') ? `<p class="h">${inline(l.slice(3))}</p>` : l.trim() === '' ? '<p>&nbsp;</p>' : `<p>${inline(l)}</p>`).join('') + '</div>'; para = []; };
let quoteBuf = [];
const flushQ = () => { if (!quoteBuf.length) return; html += `<blockquote>${quoteBuf.map(q => `<p>${inline(q)}</p>`).join('')}</blockquote>`; quoteBuf = []; };
for (const l of rest.join('\n\n').split('\n')) {
  const t = l.trim();
  if (t.startsWith('> ') || t.startsWith('>[')) { flush(); quoteBuf.push(t.replace(/^>(\[[^\]]+\])?\s?/, '')); continue; }
  flushQ();
  if (t === '---' || /^---\[/.test(t)) { flush(); html += '<hr>'; }
  else if (/^\[사진\]/.test(t)) { flush(); const f = t.replace(/^\[사진\]\s*/, ''); const p = path.isAbsolute(f) ? f : path.join(dir, f); html += `<figure><img src="file:///${p.replace(/\\/g, '/')}"><figcaption>${esc(f)}</figcaption></figure>`; }
  else if (/^\[링크\]/.test(t)) { flush(); html += '<div class="link">🔗 블로그 링크 카드</div>'; }
  else if (t === '[해시태그]') { flush(); html += '<div class="tags">' + tags.map(x => '#' + esc(x)).join(' ') + '</div>'; }
  else if (t === '') { flush(); }
  else para.push(t);
}
flush(); flushQ();
const body = raw.substring(raw.indexOf('\n\n') + 2).replace(/\[사진\][^\n]*/g, '').replace(/\[\[([^|]+)\|#[0-9a-fA-F]+\]\]/g, '$1').replace(/\*\*/g, '').replace(/^>\s?/gm, '').replace(/---/g, '').replace(/\[해시태그\]/g, '');
const chars = body.replace(/\s/g, '').length, imgs = (raw.match(/^\[사진\]/gm) || []).length;
fs.writeFileSync(out, `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(meta['제목'])}</title>
<style>
@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css');
body{margin:0;background:#f3f4f6;font-family:Pretendard,'Noto Sans KR',sans-serif;color:#222}
.post{max-width:693px;margin:30px auto;background:#fff;padding:48px 40px 60px;border:1px solid #e5e7eb}
.meta{font-size:13px;color:#888;margin-bottom:6px}
h1{font-size:30px;line-height:1.35;margin:0 0 6px;letter-spacing:-.02em}
.info{font-size:13px;color:#999;margin-bottom:28px}
.p p{font-size:16px;line-height:1.85;margin:0}
.p p.h{font-size:19px;font-weight:700;margin-top:6px}
blockquote{margin:22px 0;padding:6px 0 6px 18px;border-left:4px solid #222;font-size:18px;font-weight:700;line-height:1.6}
blockquote p{margin:2px 0}
hr{border:0;border-top:1px solid #ddd;margin:26px 0}
figure{margin:22px 0}figure img{width:100%;display:block;border-radius:6px}figcaption{font-size:11px;color:#bbb;text-align:center;margin-top:4px}
mark{padding:0 2px}
.link{margin:20px 0;padding:14px;border:1px solid #ddd;border-radius:8px;color:#666;font-size:14px}
.tags{margin-top:30px;color:#2c7be5;font-size:14px;line-height:1.9}
.stat{position:fixed;right:16px;top:16px;background:#0F1E3A;color:#fff;padding:10px 14px;border-radius:10px;font-size:13px;line-height:1.6}
</style></head><body>
<div class="stat">본문 ${chars.toLocaleString()}자(공백 제외)<br>이미지 ${imgs}장 · 태그 ${tags.length}개<br>카테고리 ${esc(meta['카테고리'] || '')}</div>
<div class="post"><div class="meta">${esc(meta['카테고리'] || '')}</div><h1>${esc(meta['제목'])}</h1><div class="info">빅터 · ${new Date().toISOString().slice(0, 10)} · 미리보기(발행 전)</div>${html}</div>
</body></html>`, 'utf8');
console.log('preview', out, 'chars', chars, 'imgs', imgs);
