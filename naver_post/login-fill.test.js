const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { fillLogin } = require('./login-fill');

function fakePage(origin = 'https://nid.naver.com', changedOrigin) {
  class Input {
    constructor() { this.events = []; }
    set value(v) { this.current = v; }
    dispatchEvent(e) { this.events.push(e.type); }
    focus() { this.focused = true; }
  }
  const inputs = { id: new Input(), pw: new Input() };
  const sandbox = { location: { origin: changedOrigin || origin }, HTMLInputElement: Input,
    document: { getElementById: id => inputs[id] }, Event: class { constructor(type) { this.type = type; } } };
  return { inputs, url: () => origin + '/nidlogin.login', waitForSelector: async () => {},
    evaluate: async (fn, args) => vm.runInNewContext('(' + fn.toString() + ')(credentials)', { ...sandbox, credentials: args }) };
}
test('fills both fields, emits input events, and leaves focus in password field', async () => {
  const page = fakePage();
  await fillLogin(page, { loginId: 'local_test_user', password: 'test-only-value' });
  assert.equal(page.inputs.id.current, 'local_test_user');
  assert.equal(page.inputs.pw.current, 'test-only-value');
  assert.deepEqual(page.inputs.pw.events, ['input', 'change']);
  assert.equal(page.inputs.pw.focused, true);
  // No click, keyboard submit, or form submit APIs exist on this fake page.
});
test('rejects a lookalike host before entering credentials', async () => {
  const page = fakePage('https://nid.naver.com.example.org');
  await assert.rejects(fillLogin(page, { loginId: 'test', password: 'test' }));
  assert.equal(page.inputs.pw.current, undefined);
});
test('checks origin again inside the document operation', async () => {
  const page = fakePage('https://nid.naver.com', 'https://example.org');
  await assert.rejects(fillLogin(page, { loginId: 'test', password: 'test' }));
  assert.equal(page.inputs.pw.current, undefined);
});
