// 저장소: %LOCALAPPDATA%\bokbok\insight\<blogId>\ (BOKBOK_DATA 가 있으면 그 아래)
//   snapshots\YYYY-MM-DD.json  하루 1개 스냅샷(같은 날 다시 모으면 합침)
//   posts.json   글 목록 + 글별 날짜별 공감·댓글 이력
//   ranks.json   키워드별 날짜별 노출 순위 이력
//   keywords.json 검색량 캐시(검색광고 API)
//   config.json  글별 타깃 키워드·추가 키워드·목표 (UI가 저장)
//   state.json   종류별 마지막 수집 시각(일정 판단용)
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { checkBlogId } = require('./util');

function root() {
  const base = process.env.BOKBOK_DATA || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'bokbok');
  return path.join(base, 'insight');
}
const dir = blogId => path.join(root(), checkBlogId(blogId));
const snapDir = blogId => path.join(dir(blogId), 'snapshots');

function readJson(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } }
function writeJson(f, v) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.tmp' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 1));
  fs.renameSync(tmp, f);   // 중간에 끊겨도 기존 파일이 깨지지 않게
}

const file = (blogId, name) => path.join(dir(blogId), name + '.json');
const load = (blogId, name, d) => readJson(file(blogId, name), d);
const save = (blogId, name, v) => writeJson(file(blogId, name), v);

function listSnapshots(blogId) {
  try { return fs.readdirSync(snapDir(blogId)).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map(f => f.slice(0, 10)).sort(); } catch { return []; }
}
const loadSnapshot = (blogId, date) => readJson(path.join(snapDir(blogId), date + '.json'), null);
const saveSnapshot = (blogId, date, snap) => writeJson(path.join(snapDir(blogId), date + '.json'), snap);

module.exports = { root, dir, load, save, listSnapshots, loadSnapshot, saveSnapshot, readJson, writeJson };
