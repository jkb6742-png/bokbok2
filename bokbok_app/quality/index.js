// bokbok 품질 검사(G2) 모듈
const gate = require('./gate');
const fingerprint = require('./fingerprint');
module.exports = {
  runG2: gate.runG2,
  qualityJsonPath: gate.qualityJsonPath,
  History: require('./history').History,
  defaultHistoryRoot: require('./history').defaultRoot,
  structureFromBlocks: fingerprint.structureFromBlocks,
  FINGERPRINT_VERSION: fingerprint.FINGERPRINT_VERSION,
  fingerprint,
  similarity: require('./similarity'),
  style: require('./style'),
  normalize: require('./normalize'),
  idf: require('./idf'),
  thresholds: require('./thresholds'),
};
