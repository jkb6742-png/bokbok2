// 전수검사: 에디터에 들어간 내용을 처음부터 끝까지 원고와 대조
const hex2rgb = h => `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`;
const stripInline = s => s.replace(/\*\*([^*]+?)\*\*/g, '$1').replace(/__([^_]+?)__/g, '$1').replace(/\{\{([^|}]+)\|#[0-9a-f]{6}\}\}/gi, '$1').replace(/\[\[([^|\]]+)\|#[0-9a-f]{6}\]\]/gi, '$1');
const headOf = l => l.startsWith('### ') ? 'h24' : l.startsWith('## ') ? 'h19' : l.startsWith('#s ') ? 's15' : '';
const body = l => l.replace(/^### |^## |^#s /, '');
const plain = l => stripInline(body(l));
const sizeOf = l => headOf(l) === 'h24' ? '24' : headOf(l) === 'h19' ? '19' : headOf(l) === 's15' ? '15' : '16';
const boldOf = l => /^h/.test(headOf(l)) ? plain(l) : [...body(l).matchAll(/\*\*([^*]+?)\*\*/g)].map(m => m[1]).join('').replace(/__([^_]+?)__/g, '$1').replace(/\{\{([^|}]+)\|#[0-9a-f]{6}\}\}/gi, '$1').replace(/\[\[([^|\]]+)\|#[0-9a-f]{6}\]\]/gi, '$1');   // 굵게 안의 다른 표시는 글자만
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

async function inspect(f, S) {
  const doc = await f.evaluate(() => {
    const clean = s => s.replace(/\u200b/g, '').replace(/\u00a0/g, ' ').trim();
    const comps = [...document.querySelectorAll('.se-content .se-component')].map(c => {
      const type = [...c.classList].find(x => x.startsWith('se-') && x !== 'se-component' && !x.startsWith('se-l-')).slice(3);
      const ps = [...c.querySelectorAll('.se-module-text .se-text-paragraph, .se-quote .se-text-paragraph')].map(p => ({
        t: clean(p.innerText),
        center: p.classList.contains('se-text-paragraph-align-center'),
        fs: [...p.querySelectorAll('span')].filter(s => clean(s.innerText)).map(s => (s.className.match(/se-fs(\d+)/) || [])[1] || '?'),
        bold: [...p.querySelectorAll('b')].map(x => clean(x.innerText)).join(''),
        hl: [...p.querySelectorAll('span.se-highlight')].map(s => [clean(s.innerText), s.style.backgroundColor]),
      }));
      const style = ([...c.classList].find(x => x.startsWith('se-l-')) || 'se-l-default').slice(5);
      return { type, style, ps, text: clean(c.innerText), ol: !!c.querySelector('ol, ul') };
    });
    const title = clean(document.querySelector('.se-title-text')?.innerText || '');
    const cat = document.querySelector('button[class^="selectbox_button"]')?.innerText.trim().split(String.fromCharCode(10)).pop();
    const tagBox = document.querySelector('#tag-input')?.closest('div')?.parentElement?.innerText || '';
    return { comps, title, cat, tags: tagBox.split('#').map(x => x.trim()).filter(x => x && !x.startsWith('태그 입력')) };
  });

  const rows = [], fails = [];
  const check = (item, ok, detail = '') => { rows.push([item, ok, detail]); if (!ok) fails.push(`${item}: ${detail}`); };

  check('제목', doc.title === S.title, doc.title);

  // 구성 순서
  const want = ['documentTitle'];
  for (const b of S.blocks) want.push(b.quote ? 'quotation' : b.line ? 'horizontalLine' : b.img !== undefined ? 'image' : b.link ? 'oglink' : 'text');
  const got = doc.comps.map(c => c.type);
  check('구성 순서', JSON.stringify(got) === JSON.stringify(want), `원고 ${want.length}칸 / 에디터 ${got.length}칸` + (JSON.stringify(got) === JSON.stringify(want) ? '' : ` · 에디터: ${got.join(' > ')}`));

  // 블록별 대조 (순서가 맞을 때 정확히, 아니면 같은 종류끼리 차례로)
  const byType = t => doc.comps.filter(c => c.type === t);
  const qs = byType('quotation'), ts = byType('text'), ims = byType('image'), hls = byType('horizontalLine');
  const ST = require('./styles');
  const qStyle = S.quoteStyle || 'default', lStyle = S.lineStyle || 'default';
  let qi = 0, ti = 0, li = 0, n = 0;
  const badLines = [];
  for (const b of S.blocks) {
    n++;
    if (b.quote) {
      const q = qs[qi++]; const t = q ? q.ps[0]?.t : '(없음)';
      check(`${n}. 인용구`, t === b.quote, t);
      const want = b.style || qStyle;
      if (q) check(`${n}. 인용구 스타일`, q.style === want, q.style === want ? ST.quoteLabel(want) : `원고 ${ST.quoteLabel(want)} / 편집기 ${ST.quoteLabel(q.style)}(${q.style})`);
    } else if (b.line) {
      const h = hls[li++]; const want = b.style || lStyle;
      if (h && h.style !== want) badLines.push(`${n}번째 칸 원고 ${ST.lineLabel(want)} / 편집기 ${ST.lineLabel(h.style)}(${h.style})`);
    } else if (b.text || b.hashtags) {
      const c = ts[ti++];
      const exp = b.hashtags ? [S.tags.map(t => '#' + t).join(' ')] : b.text;
      const gotL = c ? c.ps.map(p => p.t) : [];
      const diff = exp.findIndex((l, k) => plain(l) !== (gotL[k] ?? '(없음)'));
      const okText = diff < 0 && gotL.length === exp.length;
      check(`${n}. 본문 ${exp.length}줄 글자 대조`, okText, okText ? `${exp.join('').length}자 일치` : diff >= 0 ? `${diff + 1}번째 줄 · 원고 "${plain(exp[diff])}" / 입력 "${gotL[diff] ?? '(없음)'}"` : `줄 수 원고 ${exp.length} / 입력 ${gotL.length}`);
      if (c) {
        // 줄마다: 가운데 · 소주제 19 굵게 / 설명 16 보통(강조만 굵게) / 해시태그 15
        const bad = [];
        c.ps.forEach((p, k) => {
          const l = exp[k]; if (!p.t || l === undefined) return;
          const size = b.hashtags ? '15' : sizeOf(l);
          if (!p.center) bad.push(`"${p.t.slice(0, 15)}" 정렬`);
          else if (p.fs.some(x => x !== size)) bad.push(`"${p.t.slice(0, 15)}" 크기 ${p.fs.join('/')}≠${size}`);
          else if (p.bold.replace(/\s/g, '') !== boldOf(l).replace(/\s/g, '')) bad.push(`"${p.t.slice(0, 15)}" 굵게 "${p.bold}"≠"${boldOf(l)}"`);
        });
        check(`${n}. 서식(정렬·크기·굵게)`, bad.length === 0, bad.length ? `${bad.length}줄 다름 · ${bad.slice(0, 3).join(' / ')}` : '전 줄 일치');
        check(`${n}. 자동 목록 없음`, !c.ol, c.ol ? '왼쪽 번호 목록이 생김' : '번호는 글자로 입력됨');
        const wantHl = exp.flatMap(l => [...l.matchAll(/\[\[([^|]+)\|(#[0-9a-f]{6})\]\]/gi)].map(m => [m[1], hex2rgb(m[2])]));
        if (wantHl.length) {
          const gotHl = c.ps.flatMap(p => p.hl);
          const okHl = wantHl.every(([w, col]) => gotHl.some(([g, gc]) => g === w && gc === col));
          check(`${n}. 형광펜 ${wantHl.length}곳`, okHl && gotHl.length === wantHl.length, gotHl.map(h => h[0]).join(', ') || '없음');
        }
      }
    }
  }
  const wantLines = S.blocks.filter(b => b.line).length;
  if (wantLines) check('구분선 스타일', badLines.length === 0 && hls.length === wantLines, badLines.length ? badLines.slice(0, 3).join(' / ') : hls.length === wantLines ? `${wantLines}개 전부 ${ST.lineLabel(lStyle)}${S.blocks.some(b => b.line && b.style && b.style !== lStyle) ? '(일부 지정 스타일)' : ''}` : `개수 원고 ${wantLines} / 편집기 ${hls.length}`);
  check('사진', ims.length === S.blocks.filter(b => b.img !== undefined).length, `${ims.length}장`);
  check('블로그 링크 카드', byType('oglink').length === S.blocks.filter(b => b.link).length, `${byType('oglink').length}개`);
  const empties = doc.comps.filter(c => c.type === 'text' && !c.text).length;
  check('빈 본문 칸', empties === 0, `${empties}개`);
  check('카테고리', String(doc.cat || '').replace(/[ \s]+/g, ' ').trim() === String(S.category || '').replace(/[ \s]+/g, ' ').trim(), doc.cat);   // NBSP·연속 공백 무시
  const wantTags = S.tags.slice(0, 30);
  const missing = wantTags.filter(t => !doc.tags.includes(t)), extra = doc.tags.filter(t => !wantTags.includes(t));
  check('태그', !missing.length && !extra.length, `${doc.tags.length}개` + (missing.length ? ` · 빠짐 ${missing.join(',')}` : '') + (extra.length ? ` · 잘못 ${extra.join(',')}` : ''));
  const chars = doc.comps.filter(c => c.type === 'text').reduce((a, c) => a + c.text.replace(/\s/g, '').length, 0);
  rows.push(['본문 글자 수(공백 제외)', true, chars + '자']);

  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>전수검사</title>
<style>body{margin:0;background:#fff;color:#222;font-family:'Malgun Gothic',sans-serif;padding:32px 16px}.w{max-width:820px;margin:0 auto}h1{font-size:20px;margin:0 0 4px}p{color:#6E6A72;font-size:14px;margin:0 0 18px}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:8px 6px;border-top:1px solid #E6E2E8;vertical-align:top}th{color:#6E6A72;font-weight:500}td.r{width:60px}.x{color:#D23B3B;font-weight:700}</style></head><body><div class="w">
<h1>전수검사 · ${esc(S.title)}</h1><p>${new Date().toLocaleString('ko-KR')} · ${fails.length ? '실패 ' + fails.length + '건' : '전 항목 통과'}</p>
<table><tr><th>항목</th><th>결과</th><th>내용</th></tr>${rows.map(([a, ok, d]) => `<tr><td>${esc(a)}</td><td class="r ${ok ? '' : 'x'}">${ok ? '통과' : '실패'}</td><td>${esc(d)}</td></tr>`).join('')}</table></div></body></html>`;
  return { pass: fails.length === 0, fails, rows, html };
}

module.exports = { inspect };
