// Credentials stay in memory; only the exact NAVER login origin receives them.
async function fillLogin(page, credentials) {
  const assertOrigin = () => {
    if (new URL(page.url()).origin !== 'https://nid.naver.com') throw new Error('네이버 로그인 주소를 확인할 수 없습니다');
  };
  assertOrigin();
  await page.waitForSelector('#id', { visible: true, timeout: 15000 });
  await page.waitForSelector('#pw', { visible: true, timeout: 15000 });
  assertOrigin();
  // Check the origin inside the same document operation that sets the values.
  await page.evaluate(({ loginId, password }) => {
    if (location.origin !== 'https://nid.naver.com') throw new Error('로그인 주소 변경');
    for (const [id, value] of [['id', loginId], ['pw', password]]) {
      const input = document.getElementById(id);
      if (!(input instanceof HTMLInputElement)) throw new Error('로그인 입력 칸 없음');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    document.getElementById('pw').focus();
  }, credentials);
}
module.exports = { fillLogin };
