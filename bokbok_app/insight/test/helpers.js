// 시험 공용: fixture 읽기, 가짜 fetch, 임시 데이터 폴더
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { fakeFetch } = require('../lib/http');
const FIX = path.join(__dirname, 'fixtures');
const fx = n => fs.readFileSync(path.join(FIX, n), 'utf8');
const fj = n => JSON.parse(fx(n));
function tempData() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bokbok-insight-'));
  process.env.BOKBOK_DATA = d;
  return d;
}
// 공개 블로그 주소 전부를 fixture 로
const blogRoutes = () => [
  ['PostTitleListAsync.naver', { body: fx('ptl_p1.txt') }],
  [/post-list\?.*page=1(&|$)/, { body: fj('m_post_list_p1.json') }],
  [/post-list\?.*page=\d+/, { body: fj('m_post_list_p2.json') }],
  [/m\.blog\.naver\.com\/api\/blogs\/jsrjkb6742$/, { body: fj('m_blog_info.json') }],
  ['rss.blog.naver.com', { body: fx('rss.xml') }],
];
const noSleep = async () => { };
module.exports = { fx, fj, tempData, blogRoutes, fakeFetch, noSleep, FIX };
