// data.js의 D로 색·머리말·꼬리말을 채움
(() => {
  const r = document.documentElement.style;
  r.setProperty('--acc', D.acc); r.setProperty('--acc-soft', D.soft); r.setProperty('--deep', D.deep);
  window.H = (t, b, d) => `<div class="head"><span class="tag">${D.name}</span><div class="title">${t} <b>${b}</b></div><div class="desc">${d}</div></div>`;
  window.FOOT = '<div class="foot">잡생각투성이 · INTP가 본 MBTI</div>';
})();
