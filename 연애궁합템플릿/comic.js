// 4컷만화용 캐릭터·말풍선 SVG 조각
const C = {
  labels: [],
  label(x, y, w, h, html, style) { this.labels.push({x, y, w, h, html, style}); return ''; },
  person({x, y, s = 1, body = '#7A8794', hair = '#3A3440', face = 'normal', glasses = false, arm = null, hairStyle = 'short'}) {
    const eyes = {
      normal: '<circle cx="-13" cy="2" r="4" fill="#2B2833"/><circle cx="13" cy="2" r="4" fill="#2B2833"/>',
      blank: '<line x1="-18" y1="3" x2="-8" y2="3" stroke="#2B2833" stroke-width="3.5" stroke-linecap="round"/><line x1="8" y1="3" x2="18" y2="3" stroke="#2B2833" stroke-width="3.5" stroke-linecap="round"/>',
      shock: '<circle cx="-13" cy="1" r="8" fill="#fff" stroke="#2B2833" stroke-width="2.5"/><circle cx="13" cy="1" r="8" fill="#fff" stroke="#2B2833" stroke-width="2.5"/><circle cx="-13" cy="1" r="2.5" fill="#2B2833"/><circle cx="13" cy="1" r="2.5" fill="#2B2833"/>',
      happy: '<path d="M-19 5 Q-13 -3 -7 5" fill="none" stroke="#2B2833" stroke-width="3.5" stroke-linecap="round"/><path d="M7 5 Q13 -3 19 5" fill="none" stroke="#2B2833" stroke-width="3.5" stroke-linecap="round"/>',
      think: '<circle cx="-11" cy="-1" r="4" fill="#2B2833"/><circle cx="15" cy="-1" r="4" fill="#2B2833"/>',
      smile: '<circle cx="-13" cy="2" r="4" fill="#2B2833"/><circle cx="13" cy="2" r="4" fill="#2B2833"/>',
      sad: '<path d="M-20 -4 L-8 -9" stroke="#2B2833" stroke-width="2.5" stroke-linecap="round"/><path d="M20 -4 L8 -9" stroke="#2B2833" stroke-width="2.5" stroke-linecap="round"/><circle cx="-13" cy="5" r="3.5" fill="#2B2833"/><circle cx="13" cy="5" r="3.5" fill="#2B2833"/><path d="M-15 11 q-3 7 0 9 q3 -2 0 -9Z" fill="#8EC5F0"/>',
      moved: '<circle cx="-13" cy="2" r="7" fill="#2B2833"/><circle cx="13" cy="2" r="7" fill="#2B2833"/><circle cx="-10" cy="-1" r="2.6" fill="#fff"/><circle cx="16" cy="-1" r="2.6" fill="#fff"/><circle cx="-15" cy="5" r="1.3" fill="#fff"/><circle cx="11" cy="5" r="1.3" fill="#fff"/>'
    }[face];
    const mouth = {
      normal: '<line x1="-6" y1="18" x2="6" y2="18" stroke="#2B2833" stroke-width="3" stroke-linecap="round"/>',
      blank: '<line x1="-5" y1="19" x2="5" y2="19" stroke="#2B2833" stroke-width="3" stroke-linecap="round"/>',
      shock: '<ellipse cx="0" cy="21" rx="6" ry="8" fill="#2B2833"/>',
      happy: '<path d="M-9 15 Q0 25 9 15" fill="none" stroke="#2B2833" stroke-width="3" stroke-linecap="round"/>',
      think: '<path d="M-4 19 L6 16" stroke="#2B2833" stroke-width="3" stroke-linecap="round"/>',
      smile: '<path d="M-10 14 Q0 26 10 14" fill="#fff" stroke="#2B2833" stroke-width="3" stroke-linecap="round"/>',
      sad: '<path d="M-7 21 Q0 15 7 21" fill="none" stroke="#2B2833" stroke-width="3" stroke-linecap="round"/>',
      moved: '<path d="M-6 16 Q0 22 6 16" fill="none" stroke="#2B2833" stroke-width="3" stroke-linecap="round"/>'
    }[face];
    const hairs = {
      short: `<path d="M-38 -4 Q-40 -42 0 -40 Q40 -42 38 -4 Q30 -24 0 -22 Q-30 -24 -38 -4Z" fill="${hair}"/>`,
      messy: `<path d="M-39 -2 Q-44 -30 -24 -40 L-20 -50 L-10 -41 L0 -54 L8 -41 L22 -50 L22 -38 Q44 -32 39 -2 Q32 -22 12 -20 L6 -28 L0 -20 Q-28 -24 -39 -2Z" fill="${hair}"/>`,
      long: `<path d="M-40 30 Q-46 -42 0 -40 Q46 -42 40 30 L32 30 Q36 -18 0 -20 Q-36 -18 -32 30Z" fill="${hair}"/>`
    }[hairStyle];
    const gl = glasses ? '<circle cx="-13" cy="2" r="11" fill="none" stroke="#2B2833" stroke-width="2.5"/><circle cx="13" cy="2" r="11" fill="none" stroke="#2B2833" stroke-width="2.5"/><line x1="-2" y1="1" x2="2" y2="1" stroke="#2B2833" stroke-width="2.5"/>' : '';
    const armSvg = arm === 'up'
      ? `<path d="M30 52 Q52 30 48 -6" fill="none" stroke="${body}" stroke-width="13" stroke-linecap="round"/><circle cx="48" cy="-10" r="8" fill="var(--skin)" stroke="#2B2833" stroke-width="2"/>`
      : arm === 'type'
      ? `<path d="M-28 60 Q-40 82 -10 86" fill="none" stroke="${body}" stroke-width="13" stroke-linecap="round"/><path d="M28 60 Q40 82 10 86" fill="none" stroke="${body}" stroke-width="13" stroke-linecap="round"/>`
      : '';
    return `<g transform="translate(${x},${y}) scale(${s})">
      <path d="M-38 112 Q-40 46 0 44 Q40 46 38 112Z" fill="${body}" stroke="#2B2833" stroke-width="2.5"/>
      ${armSvg}
      <circle cx="0" cy="0" r="38" fill="var(--skin)" stroke="#2B2833" stroke-width="2.5"/>
      ${hairs}
      <circle cx="-24" cy="12" r="5" fill="#FFB4A8" opacity=".55"/><circle cx="24" cy="12" r="5" fill="#FFB4A8" opacity=".55"/>
      ${eyes}${gl}${mouth}
    </g>`;
  },
  // 말풍선: (x,y)=좌상단, tail=[tx,ty] 꼬리 끝
  bubble(x, y, w, h, html, tail, opt = {}) {
    const [tx, ty] = tail || [x + w / 2, y + h + 20];
    const bx = Math.min(Math.max(tx, x + 24), x + w - 24);
    const by = ty > y ? y + h : y;
    const fill = opt.fill || '#fff';
    return `<path d="M${bx - 12} ${by} L${tx} ${ty} L${bx + 12} ${by}" fill="${fill}" stroke="#2B2833" stroke-width="2.5" stroke-linejoin="round"/>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="${fill}" stroke="#2B2833" stroke-width="2.5"/>
      <rect x="${bx - 11}" y="${by - 3}" width="22" height="6" fill="${fill}"/>
      ${C.label(x, y, w, h, html, opt.style || '')}`;
  },
  thought(x, y, w, h, html, from, opt = {}) {
    const [fx, fy] = from;
    const fill = opt.fill || '#fff';
    return `<circle cx="${fx}" cy="${fy}" r="5" fill="${fill}" stroke="#2B2833" stroke-width="2"/>
      <circle cx="${(fx * 2 + x + w / 2) / 3}" cy="${(fy * 2 + y + h) / 3 + 4}" r="8" fill="${fill}" stroke="#2B2833" stroke-width="2"/>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(h / 2, 40)}" fill="${fill}" stroke="#2B2833" stroke-width="2.5" stroke-dasharray="${opt.dash || ''}"/>
      ${C.label(x, y, w, h, html, opt.style || '')}`;
  },
  heart(x, y, s = 1, c = '#F07A8C') {
    return `<path transform="translate(${x},${y}) scale(${s})" d="M0 6 C-14 -6 -8 -18 0 -10 C8 -18 14 -6 0 6Z" fill="${c}" stroke="#2B2833" stroke-width="1.8"/>`;
  },
  badge(n) {
    return `<circle cx="30" cy="30" r="18" fill="var(--acc)"/><text x="30" y="37" text-anchor="middle" font-family="Jua" font-size="21" fill="#fff">${n}</text>`;
  }
};
