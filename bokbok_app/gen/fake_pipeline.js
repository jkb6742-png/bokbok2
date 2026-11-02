// 점검 전용 가짜 생성기 (작업자 M) — 서버를 BOKBOK_FAKE_GEN=1 로 띄웠을 때만 pipeline.js 대신 쓴다.
// OpenAI를 부르지 않고, 올바른 원고.txt + 단색 png 2장 + draft.json 을 만든다. 실제 운영에서는 쓰이지 않는다.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { load } = require(path.resolve(__dirname, '..', '..', 'naver_post', 'manuscript.js'));

const wait = ms => new Promise(r => setTimeout(r, ms));
const pad = n => String(n).padStart(2, '0');

// 단색 PNG (zlib + crc32 직접 계산)
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = b => { let c = 0xFFFFFFFF; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, [r, g, b]) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.alloc(1 + w * 3); for (let x = 0; x < w; x++) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b; }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const COLORS = [[120, 170, 220], [240, 190, 120], [150, 200, 150], [210, 150, 200]];

async function generate({ input, profile, outRoot, log, step }) {
  const now = new Date();
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const slug = String(input.keyword).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 30);
  const dir = path.join(outRoot, profile.blogId, `${stamp}_${slug}`);
  step('원고 작성', 1, 4); log('가짜 원고 작성 중'); await wait(600);
  fs.mkdirSync(dir, { recursive: true });
  step('대표 이미지 생성', 2, 4); log('가짜 대표 이미지'); await wait(500);
  fs.writeFileSync(path.join(dir, '01_대표.png'), png(600, 400, COLORS[0]));
  step('카드 렌더', 3, 4); log('가짜 카드'); await wait(500);
  fs.writeFileSync(path.join(dir, '02_정리.png'), png(430, 560, COLORS[1]));
  step('원고 저장', 4, 4);
  const kw = input.keyword;
  const draft = {
    title: `${kw} 정리해 본 이야기`, category: input.category || '', tags: [kw, '정리', '기록', '일상', '메모'],
    layout: input.layout === 'auto' ? 'classic' : input.layout, imageStyle: input.imageStyle === 'auto' ? 'flat' : input.imageStyle, deco: input.deco,
    charTarget: input.charTarget, charBasis: input.charBasis, tone: input.tone, kwRepeat: input.kwRepeat, emphasis: input.emphasis, titleMode: input.titleMode, qaCount: input.qaCount, keyword: input.keyword,
    warnings: input.charTarget ? ['(가짜 생성) 본문 글자 수가 목표보다 적음'] : [],
    createdAt: now.toISOString(), input,
    images: [
      { kind: 'ai', file: '01_대표.png', prompt: `${kw} 장면, 글자 없음`, alt: kw },
      { kind: 'card', file: '02_정리.png', template: 'points', data: { title: `${kw} 핵심`, items: [{ head: '하나', body: '첫째' }, { head: '둘', body: '둘째' }, { head: '셋', body: '셋째' }] } },
    ],
  };
  const txt = [
    `제목: ${draft.title}`, `카테고리: ${draft.category}`, `태그: ${draft.tags.join(', ')}`, `사진폴더: ${dir}`, '',
    `> ${kw} 정리`, '오늘은 짧게', `**${kw}** 이야기를 해 봅니다`, `[[핵심만|#bdfbfa]] 적어 둘게요`, '---',
    '> 처음 알게 된 것', '[사진] 01_대표.png', `## 1. ${kw}의 시작`, '생각보다 단순했어요', '', '한 줄 더', '---',
    '> 한눈에 보기', '[사진] 02_정리.png', '## 2. 세 가지만 기억', '하나, 둘, 셋', '---',
    '> 오늘의 포스팅을 정리하면?', `## Q. ${kw}는 어렵나요?`, '생각보다 쉽습니다', '[링크]', '[해시태그]', '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'draft.json'), JSON.stringify(draft, null, 2));
  fs.writeFileSync(path.join(dir, '원고.txt'), txt);
  log('저장 완료');
  return { dir, txt, draft };
}

async function regenImage({ dir, index, prompt, log }) {
  const draft = JSON.parse(fs.readFileSync(path.join(dir, 'draft.json'), 'utf8'));
  const im = draft.images[index];
  if (!im) throw new Error('이미지 번호가 올바르지 않습니다');
  if (im.kind === 'ai' && prompt) im.prompt = prompt;
  await wait(400);
  const c = COLORS[Math.floor(Math.random() * COLORS.length)];
  fs.writeFileSync(path.join(dir, im.file), im.kind === 'ai' ? png(600, 400, c) : png(430, 560, c));
  fs.writeFileSync(path.join(dir, 'draft.json'), JSON.stringify(draft, null, 2));
  log && log(`다시 만듦: ${im.file}`);
  return { file: im.file };
}

function saveTxt(dir, txt) {
  const tmp = path.join(dir, '원고.tmp.txt');
  fs.writeFileSync(tmp, txt);
  try { load(tmp); } catch (e) { fs.unlinkSync(tmp); throw new Error('원고 형식 오류: ' + e.message); }
  fs.renameSync(tmp, path.join(dir, '원고.txt'));
  return { ok: true };
}

module.exports = { generate, regenImage, saveTxt, FAKE: true };
