// 시험용 가짜 모델 응답·도우미 (실제 OpenAI 호출 없음)
const fs = require('fs'), path = require('path'), os = require('os');

const PROFILE = {
  blogId: 'testblog', blogName: '복복이 MBTI',
  persona: 'INTP 30대 직장인 화자. 담백한 반말 평서체(~다, ~더라), 관찰하고 분석하는 말투',
  audience: 'MBTI에 관심 있는 20~30대',
  categories: ['MBTI 연애', 'NT 분석가'], rules: ['유형을 깎아내리지 않는다'], color: '#3F9470',
};

const INPUT = { keyword: 'INTP 연애', topic: 'INTP가 연애할 때 보이는 특징', imageCount: 4, layout: 'classic', imageStyle: 'character', deco: 'auto', length: '보통' };

// 기본형(classic) 4장: ai + points + compare + checklist
function goodRaw(over = {}) {
  return {
    title: 'INTP 연애 특징 | 좋아하면 질문이 많아지는 사람',
    category: 'MBTI 연애',
    imageStyle: 'character',
    tags: ['INTP연애', 'INTP', 'INTP특징', 'MBTI연애', '인팁', 'INTP남자', 'INTP여자'],
    blocks: [
      { quote: 'INTP 연애, 티가 안 나는 이유' },
      { text: [
        '"너 나 좋아하는 거 맞아?"',
        '연애할 때 제일 많이 들은 말이다.',
        '',
        'INTP인 나는 좋아하는 마음이',
        '겉으로 잘 안 드러나는 편이다.',
        '대신 **질문이 많아진다.**',
        '',
        '오늘은 INTP 연애에서 자주 보이는',
        '모습들을 하나씩 정리해 본다.',
      ] },
      { line: true },
      { quote: '좋아하면 생기는 변화' },
      { img: 0 },
      { text: [
        '## 1. 상대를 연구하기 시작한다',
        '좋아하는 사람이 생기면',
        '그 사람의 말버릇부터 기억한다.',
        '왜 그렇게 생각하는지 궁금해서',
        '질문이 끝없이 이어진다.',
        '',
        '## 2. 시간을 내어 준다',
        '혼자 있는 시간이 소중한 [[INTP|#d4d4ff]]에게',
        '시간을 내어 준다는 건 큰 신호다.',
      ] },
      { line: true },
      { quote: 'INTP가 연애에서 어려워하는 것' },
      { img: 1 },
      { text: [
        '## 감정 표현은 늦게 도착한다',
        '서운한 일이 있어도',
        '그 자리에서 바로 말하지 못한다.',
        '머릿속에서 정리가 끝나야',
        '겨우 한마디가 나온다.',
        '',
        '## 기념일은 메모로 버틴다',
        '날짜를 외우는 데 약하다.',
        '그래서 나는 달력 알림을 두 번 건다.',
        '',
        '마음이 없는 게 아니라',
        '**표현의 속도가 다를 뿐이다.**',
      ] },
      { line: true },
      { quote: '잘 맞는 대화 방식' },
      { img: 2 },
      { text: [
        'INTP 연애가 편해지는 건',
        '대화의 방식이 맞을 때다.',
        '',
        '"왜 화났어?"보다',
        '"어떤 점이 걸렸어?"가 훨씬 낫다.',
        '질문이 구체적이면',
        '생각을 꺼내기가 쉬워진다.',
        '',
        '결론부터 말해 주는 것도 좋다.',
        '돌려 말하면 끝까지 못 알아챈다.',
      ] },
      { line: true },
      { quote: 'INTP와 오래 가는 법' },
      { img: 3 },
      { text: [
        '✔ 혼자만의 시간을 존중해 주기',
        '✔ 감정은 구체적인 말로 전하기',
        '',
        '거창한 이벤트보다',
        '작은 대화 하나가 오래 남는다.',
        '좋아하는 주제를 꺼내 주면',
        '눈빛부터 달라진다.',
      ] },
      { line: true },
      { quote: '오늘의 포스팅을 정리하면?' },
      { text: [
        '## Q. INTP는 좋아하면 어떻게 하나요?',
        '질문이 많아지고 시간을 내어 준다.',
        '',
        '## Q. INTP 연애가 어려운 점은?',
        '감정 표현이 늦게 나오는 편이다.',
        '',
        '## Q. INTP와 잘 지내려면?',
        '구체적으로 묻고, 혼자 시간을 존중하면 된다.',
        '',
        '본인이 INTP라면',
        '어디가 제일 공감됐는지 궁금하다.',
      ] },
      { link: true },
      { hashtags: true },
    ],
    images: [
      { kind: 'ai', prompt: '카페 창가 자리에서 책을 펼친 채 생각에 잠긴 사람의 뒷모습, 맞은편에는 따뜻한 커피 두 잔', alt: '생각에 잠긴 INTP의 데이트' },
      { kind: 'card', template: 'points', alt: 'INTP 연애 어려운 점', data: { title: 'INTP가 어려워하는 것', items: [{ head: '감정 표현', body: '정리가 끝나야 말이 나온다' }, { head: '기념일', body: '날짜보다 알림에 기댄다' }, { head: '즉답', body: '바로 대답하기보다 생각한다' }] } },
      { kind: 'card', template: 'compare', alt: '대화 방식 비교', data: { title: '이렇게 물어보면 좋다', left: { label: '어려운 질문', items: ['왜 화났어?', '알아서 해 줘'] }, right: { label: '편한 질문', items: ['어떤 점이 걸렸어?', '이거 해 줄래?'] } } },
      { kind: 'card', template: 'checklist', alt: 'INTP와 오래 가는 법', data: { title: 'INTP와 오래 가는 법', items: ['혼자 시간을 존중하기', '감정은 구체적인 말로', '좋아하는 주제 꺼내기'] } },
    ],
    ...over,
  };
}

// 가짜 fetch: 순서대로 응답 내보내기. calls 에 요청 기록
function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    let body = null; if (opts.body) { try { body = JSON.parse(opts.body); } catch { body = null; } }
    calls.push({ url: String(url), opts, body });
    const r = responses.shift();
    if (!r) throw new Error('응답 없음(시험 설정 부족)');
    if (typeof r === 'function') return r(url, opts);
    return resp(r.status || 200, r.json !== undefined ? r.json : r.text, r.headers);
  };
  fn.calls = calls;
  return fn;
}
function resp(status, body, headers = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, headers: { get: k => headers[k.toLowerCase()] ?? null }, text: async () => text, arrayBuffer: async () => Buffer.from(text) };
}
const chatResp = obj => ({ json: { choices: [{ message: { content: typeof obj === 'string' ? obj : JSON.stringify(obj) }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 20 } } });
// 1x1 png
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PNG_BIG = Buffer.concat([PNG, Buffer.alloc(200)]);
const imageResp = () => ({ json: { data: [{ b64_json: PNG_BIG.toString('base64') }] } });

const tmpDir = (p = 'bokbok-gen-') => fs.mkdtempSync(path.join(os.tmpdir(), p));

module.exports = { PROFILE, INPUT, goodRaw, fakeFetch, resp, chatResp, imageResp, PNG, tmpDir };
