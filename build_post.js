// 원고 HTML 생성: node build_post.js <원고데이터.js>
// 데이터: {out, title, category, keywords, rep, folder, color:[acc, soft, bg], imgs:[[파일, alt]], tags:[], body, checks:[]}
// body 안의 {{img1}}~{{img4}} 자리에 이미지가 들어감
const fs = require('fs'), path = require('path');
const P = require(path.resolve(process.argv[2]));
const [acc, soft, bg] = P.color;
const img = i => { const [f, alt] = P.imgs[i]; return `<figure><img src="../04_이미지/${P.folder}/${f}" alt="${alt}"><figcaption>이미지 ${i + 1} · ${f}</figcaption></figure>`; };
const body = P.body.replace(/\{\{img(\d)\}\}/g, (_, n) => img(n - 1));
const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${P.short} 원고</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap">
<style>
:root{--bg:${bg};--card:#fff;--ink:#222;--sub:#6E6A72;--line:#E6E2E8;--acc:${acc};--soft:${soft}}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font-family:'Noto Sans KR','Malgun Gothic',sans-serif;word-break:keep-all;padding:32px 16px 80px}
.wrap{max-width:760px;margin:0 auto}
.meta{background:var(--card);border-radius:16px;padding:22px 24px;margin-bottom:16px}
.meta h1{font-size:15px;color:var(--acc);margin-bottom:12px}
.meta table{width:100%;border-collapse:collapse;font-size:14px}
.meta th{width:110px;text-align:left;color:var(--sub);font-weight:500;padding:7px 0;vertical-align:top;border-top:1px solid var(--line)}
.meta td{padding:7px 0;border-top:1px solid var(--line)}
.tags span{display:inline-block;background:var(--soft);color:var(--acc);border-radius:6px;padding:2px 8px;margin:0 4px 4px 0;font-size:13px}
.bar{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap}
.bar button{border:0;border-radius:10px;padding:11px 16px;font:inherit;font-size:14px;font-weight:700;cursor:pointer;background:var(--acc);color:#fff}
.bar button.sec{background:#fff;color:var(--ink)}
.bar .msg{align-self:center;font-size:13px;color:var(--acc)}
article{background:var(--card);border-radius:16px;padding:44px 40px}
article .ttl{font-size:26px;font-weight:700;line-height:1.4;margin-bottom:8px}
article .by{color:var(--sub);font-size:13px;padding-bottom:24px;margin-bottom:28px;border-bottom:1px solid var(--line)}
article p{font-size:16px;line-height:1.9;margin-bottom:22px;text-align:center}
article h2{font-size:20px;margin:44px 0 20px;text-align:center}
article figure{margin:30px 0}
article img{width:100%;display:block;border-radius:4px}
article figcaption{font-size:12px;color:var(--sub);text-align:center;margin-top:6px}
article .hash{color:var(--acc);font-size:15px;line-height:1.9;margin-top:36px}
.check{background:var(--card);border-radius:16px;padding:22px 24px;margin-top:16px;font-size:14px;line-height:1.8}
.check h2{font-size:15px;margin-bottom:8px}
.check li{margin-left:18px}
@media (max-width:600px){article{padding:28px 18px}}
</style></head><body><div class="wrap">

<section class="meta">
  <h1>발행 정보</h1>
  <table>
    <tr><th>제목</th><td id="title">${P.title}</td></tr>
    <tr><th>카테고리</th><td>${P.category}</td></tr>
    <tr><th>검색 키워드</th><td>${P.keywords}</td></tr>
    <tr><th>대표 이미지</th><td>${P.imgs[0][0]}</td></tr>
    <tr><th>이미지 폴더</th><td>04_이미지\\${P.folder}\\</td></tr>
    <tr><th>태그</th><td class="tags" id="tags"></td></tr>
  </table>
</section>

<div class="bar">
  <button onclick="copy('title')">제목 복사</button>
  <button onclick="copyBody()">본문 복사</button>
  <button class="sec" onclick="copyTags()">태그 복사</button>
  <span class="msg" id="msg"></span>
</div>

<article id="body">
  <div class="ttl">${P.title}</div>
  <div class="by">잡생각투성이 · INTP가 본 MBTI</div>
${body}
  <p class="hash" id="hash"></p>
</article>

<section class="check">
  <h2>발행 전 체크</h2>
  <ul>
    <li>본문 약 <span id="cnt"></span>자(공백 제외) · 이미지 4장 · 소제목 4개 + 마치며 · 해시태그 <span id="tc"></span>개 본문 끝 포함</li>
    <li>'본문 복사' → 에디터 붙여넣기 → [이미지 N] 자리에 사진 삽입, 대표 이미지는 1번(4컷)</li>
${P.checks.map(c => `    <li>${c}</li>`).join('\n')}
  </ul>
</section>

</div>
<script>
const TAGS=${JSON.stringify(P.tags)};
document.getElementById('tags').innerHTML=TAGS.map(t=>'<span>#'+t+'</span>').join('');
document.getElementById('hash').textContent=TAGS.map(t=>'#'+t).join(' ');
document.getElementById('tc').textContent=TAGS.length;
(()=>{const a=document.getElementById('body').cloneNode(true);a.querySelectorAll('.ttl,.by,figure,.hash').forEach(e=>e.remove());document.getElementById('cnt').textContent=a.textContent.replace(/\\s/g,'').length.toLocaleString()})();
function flash(t){const m=document.getElementById('msg');m.textContent=t;setTimeout(()=>m.textContent='',2000)}
function put(text){navigator.clipboard.writeText(text).then(()=>flash('복사됨'),()=>flash('복사 실패 — 직접 드래그해 주세요'))}
function copy(id){put(document.getElementById(id).innerText)}
function copyTags(){put(TAGS.map(t=>'#'+t).join(' '))}
function copyBody(){
  const a=document.getElementById('body').cloneNode(true);
  a.querySelectorAll('.ttl,.by').forEach(e=>e.remove());
  a.querySelectorAll('figure').forEach(f=>f.replaceWith(document.createTextNode('\\n['+f.querySelector('figcaption').textContent+']\\n')));
  document.body.appendChild(a);a.style.position='absolute';a.style.left='-9999px';
  const t=a.innerText.replace(/\\n{3,}/g,'\\n\\n').trim();a.remove();put(t);
}
</script>
</body></html>
`;
fs.writeFileSync(path.resolve(__dirname, '..', '03_원고', P.out), html);
console.log('ok', P.out);
