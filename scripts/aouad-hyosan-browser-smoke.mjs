import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, webkit } from 'playwright-core';

// All writes are isolated browser presentation saves. No account or commerce APIs are used.
const origin = new URL(process.env.AOUAD_QA_ORIGIN || 'http://127.0.0.1:4314').origin;
const output = process.env.AOUAD_QA_OUTPUT_DIR || await mkdtemp(join(tmpdir(), 'aouad-hyosan-'));
const packagePath = '/ip-popups/aouad/hyosan/';
const campaignKey = 'hyosan-memories-campaign-v1';
const writerLock = 'hyosan-memories:3d-campaign-writer';
await mkdir(output, { recursive: true });
const results = [];

async function screenshot(page, name) {
  await page.screenshot({ path: join(output, `${name}.png`) });
}

async function frameFor(page) {
  const element = await page.locator('iframe[title="효산의 기억"]').elementHandle();
  const frame = await element?.contentFrame();
  assert.ok(frame, 'The popup must mount an embedded game document');
  return frame;
}

async function openGame(page) {
  await page.getByRole('button', { name: '효산의 기억 시작하기', exact: true }).click();
  const frame = await frameFor(page);
  await frame.locator('[data-hyosan-ready="true"]').waitFor({ timeout: 90000 });
  assert.equal(await frame.locator('canvas').count(), 1, 'The actual game canvas must boot');
  assert.equal(await frame.evaluate(() => Boolean(window.__HYOSAN_3D_QA__)), false);
  return frame;
}

async function expectClosed(page) {
  await page.locator('iframe[title="효산의 기억"]').waitFor({ state: 'detached' });
  await page.waitForFunction(async name => !(await navigator.locks.query()).held.some(lock => lock.name === name), writerLock);
  assert.equal(new URL(page.url()).searchParams.get('s'), 'hyosan');
}

async function expectFit(page, frame, label) {
  const parent = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scroll: document.documentElement.scrollWidth }));
  const game = await page.locator('iframe[title="효산의 기억"]').boundingBox();
  const exit = await page.getByRole('button', { name: '팝업으로 돌아가기', exact: true }).boundingBox();
  assert.ok(game && exit);
  assert.ok(parent.scroll <= parent.width, `${label}: parent overflows horizontally`);
  assert.ok(game.x >= 0 && game.x + game.width <= parent.width + 1,
    `${label}: iframe exceeds viewport ${JSON.stringify({ game, parent })}`);
  assert.ok(game.y >= exit.y + exit.height - 1, `${label}: exit bar overlaps the game`);
  assert.ok(game.y + game.height <= parent.height + 1, `${label}: game extends below the viewport`);
  const inner = await frame.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(inner.scroll <= inner.width, `${label}: game document overflows horizontally`);
  assert.ok(await page.getByRole('button', { name: '팝업으로 돌아가기', exact: true }).evaluate(element => {
    const box = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  }), `${label}: exit must remain reachable above the canvas`);
}

async function firstVisit(page) {
  await page.goto(`${origin}/ip/aouad?s=hyosan`);
  await page.getByRole('button', { name: '…누구야. 나한테 말한 거야?', exact: true }).click({ timeout: 60000 });
  await page.getByRole('textbox', { name: '이름', exact: true }).fill('통합 검수');
  await page.getByRole('button', { name: '장하리', exact: true }).click();
  await page.getByRole('button', { name: '그래, 옥상으로 갈게, 만나', exact: true }).click();
  await page.getByRole('button', { name: '효산의 기억 시작하기', exact: true }).waitFor();
}

async function inspectOriginWithKeys(page, frame) {
  // Read the visible minimap marker and walk to the south of the opening cage.
  // Fixed key durations drift with rendering cadence, so observe each actual step.
  // This uses real inputs; it never sets simulation positions or progress.
  const sample = () => frame.locator('[data-surface="mini"] [data-elevation]').evaluate(element => {
    const match = element.getAttribute('transform').match(/translate\(([-\d.]+) ([-\d.]+)\)/);
    const sx = Number(match[1]); const sy = Number(match[2]); const y = Number(element.getAttribute('data-elevation'));
    const forward = (sy + y * 25 / Math.hypot(24, 25)) / (24 / Math.hypot(24, 25));
    return { x: .8 * sx + .6 * forward, z: -.6 * sx + .8 * forward };
  });
  const directions = [
    ['d', .8, -.6], ['a', -.8, .6], ['w', -.6, -.8], ['s', .6, .8],
    ['wd', .141421, -.989949], ['sd', .989949, .141421],
    ['wa', -.989949, -.141421], ['sa', -.141421, .989949],
  ];
  let interacted = false;
  try {
    for (let step = 0; step < 100; step++) {
      const interaction = frame.locator('[data-action="interact"]');
      if (await interaction.isVisible() && /감염 흔적 조사/.test(await interaction.innerText())) {
        await page.keyboard.press('e');
        interacted = true;
        break;
      }
      const position = await sample();
      const dx = -46.35 - position.x; const dz = -1.4 - position.z;
      const direction = [...directions].sort((a, b) => (b[1] * dx + b[2] * dz) - (a[1] * dx + a[2] * dz))[0];
      for (const key of direction[0]) await page.keyboard.down(key);
      await page.waitForTimeout(Math.min(100, Math.max(20, Math.hypot(dx, dz) / 3.9 * 500)));
      for (const key of direction[0]) await page.keyboard.up(key);
    }
  } finally {
    for (const key of 'wasd') await page.keyboard.up(key);
  }
  assert.ok(interacted, `Real keyboard movement must reach the opening investigation: ${JSON.stringify(await sample())}`);
  await frame.waitForFunction(key => JSON.parse(localStorage.getItem(key))?.science?.originInspected === true, campaignKey);
}

async function desktop(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push({ url: request.url(), method: request.method() }));
  try {
    await firstVisit(page);
    assert.equal(requests.filter(item => new URL(item.url).pathname.startsWith(packagePath)).length, 0,
      'The heavy game package must not load before launch');
    await screenshot(page, 'desktop-entry');
    const popupSave = await page.evaluate(() => localStorage.getItem('icons:aouad-presentation:v1'));
    const frame = await openGame(page);
    await expectFit(page, frame, 'desktop');
    await frame.getByRole('button', { name: '여유롭게', exact: true }).click();
    await frame.getByRole('button', { name: '탐험 시작', exact: true }).click();
    await frame.getByRole('button', { name: '이야기 건너뛰기', exact: true }).click();
    await page.keyboard.down('j');
    await page.waitForTimeout(500);
    await page.keyboard.up('j');
    await inspectOriginWithKeys(page, frame);
    await screenshot(page, 'desktop-bow');
    await page.keyboard.press('Escape');
    await frame.locator('[data-hyosan-3d-state="paused"]').waitFor();
    assert.equal(await page.locator('iframe[title="효산의 기억"]').count(), 1,
      'Escape inside the game must pause it instead of closing the popup dialog');
    const saved = await frame.evaluate(key => localStorage.getItem(key), campaignKey);

    const other = await context.newPage();
    await other.goto(`${origin}/ip/aouad?s=hyosan`);
    await other.getByRole('button', { name: '효산의 기억 시작하기', exact: true }).click();
    const otherFrame = await frameFor(other);
    await otherFrame.getByRole('heading', { name: '다른 탭에 탐험이 열려 있습니다', exact: true }).waitFor();
    assert.equal(await otherFrame.locator('canvas').count(), 0);
    assert.equal(await other.evaluate(key => localStorage.getItem(key), campaignKey), saved);
    await screenshot(other, 'desktop-second-tab');

    await page.bringToFront();
    await page.getByRole('button', { name: '팝업으로 돌아가기', exact: true }).click();
    await expectClosed(page);
    assert.equal(await page.evaluate(() => localStorage.getItem('icons:aouad-presentation:v1')), popupSave);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), campaignKey), saved);
    assert.ok(await page.getByRole('button', { name: '효산의 기억 시작하기', exact: true }).evaluate(element => element === document.activeElement),
      'Closing must return focus to the launch action');

    await other.bringToFront();
    await otherFrame.getByRole('button', { name: '다시 확인', exact: true }).click();
    await otherFrame.locator('[data-hyosan-ready="true"]').waitFor({ timeout: 90000 });
    await otherFrame.getByRole('button', { name: /^(?:탐험 이어하기|기억 지점에서 이어하기)$/ }).waitFor();
    assert.equal(await other.evaluate(key => localStorage.getItem(key), campaignKey), saved);
    await screenshot(other, 'desktop-resume');
    await other.getByRole('button', { name: '팝업으로 돌아가기', exact: true }).click();
    await expectClosed(other);
    assert.ok(!requests.some(item => item.url.includes('/api/dev/hyosan-3d/')));
    assert.ok(!requests.some(item => item.method !== 'GET' && new URL(item.url).pathname.startsWith('/api/')),
      'Game presentation must not write any application API');
    assert.deepEqual(errors, []);
    results.push({ group: 'desktop-first-visit-play-save-two-tabs-return', status: 'passed', packageRequests: requests.filter(item => item.url.includes(packagePath)).length });
  } catch (error) {
    await screenshot(page, 'desktop-failure').catch(() => {});
    results.push({ group: 'desktop-first-visit-play-save-two-tabs-return', status: 'failed', message: error.message, errors });
  } finally {
    await context.close();
  }
}

async function keyboardReturn(browser, engine) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => localStorage.setItem('icons:aouad-presentation:v1', JSON.stringify({ op: true, temp: true })));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const returnButton = page.getByRole('button', { name: '팝업으로 돌아가기', exact: true });
  const isReturnFocused = () => returnButton.evaluate(element => element === document.activeElement);
  // macOS WebKit uses Option+Tab for buttons unless full Tab navigation is enabled.
  const optionTab = engine === 'webkit' && process.platform === 'darwin';
  const forwardTab = optionTab ? 'Alt+Tab' : 'Tab';
  const reverseTab = optionTab ? 'Alt+Shift+Tab' : 'Shift+Tab';

  async function leaveMenu(frame, label) {
    await frame.waitForFunction(() => document.activeElement?.closest('[role="dialog"][aria-modal="true"]'));
    const isFirstFocused = () => frame.evaluate(() => {
      const menu = document.querySelector('[role="dialog"][aria-modal="true"]');
      return Boolean(menu && document.activeElement === menu.querySelector('button:not(:disabled)'));
    });
    for (let step = 0; step < 30 && !(await isFirstFocused()); step++) await page.keyboard.press(reverseTab);
    assert.ok(await isFirstFocused(), `${label}: reverse Tab must reach the first menu button`);
    await page.keyboard.press(reverseTab);
    assert.ok(await isReturnFocused(), `${label}: Shift+Tab from the first game button must reach the popup return`);
    await page.keyboard.press(forwardTab);
    await frame.waitForFunction(() => parent.document.activeElement === frameElement
      && document.activeElement?.closest('[role="dialog"][aria-modal="true"]'));
    for (let step = 0; step < 30 && !(await isReturnFocused()); step++) await page.keyboard.press(forwardTab);
    assert.ok(await isReturnFocused(), `${label}: Tab from the last game button must reach the popup return`);
    await screenshot(page, `${engine}-keyboard-${label}`);
    await page.keyboard.press('Enter');
    await expectClosed(page);
    await page.waitForFunction(() => document.activeElement?.textContent?.trim() === '효산의 기억 시작하기');
  }

  try {
    await page.goto(`${origin}/ip/aouad?s=hyosan`);
    let frame = await openGame(page);
    await leaveMenu(frame, 'start-menu');
    await page.keyboard.press('Enter');
    frame = await frameFor(page);
    await frame.locator('[data-hyosan-ready="true"]').waitFor({ timeout: 90000 });
    await frame.getByRole('button', { name: '여유롭게', exact: true }).click();
    await frame.getByRole('button', { name: '탐험 시작', exact: true }).click();
    await frame.getByRole('button', { name: '이야기 건너뛰기', exact: true }).click();
    await page.keyboard.press('Escape');
    await frame.locator('[data-hyosan-3d-state="paused"]').waitFor();
    await leaveMenu(frame, 'pause-menu');
    assert.deepEqual(errors, []);
    results.push({ group: `${engine}-keyboard-menu-and-pause-return`, status: 'passed', forwardTab, reverseTab });
  } catch (error) {
    await screenshot(page, `${engine}-keyboard-failure`).catch(() => {});
    results.push({ group: `${engine}-keyboard-menu-and-pause-return`, status: 'failed', message: error.message, errors });
  } finally {
    await context.close();
  }
}

async function mobile(browser, engine, viewport) {
  const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const label = `${engine}-${viewport.width}x${viewport.height}`;
  try {
    await context.addInitScript(() => localStorage.setItem('icons:aouad-presentation:v1', JSON.stringify({ op: true, temp: true, callsign: '모바일 검수', photo: 'hari' })));
    await page.goto(`${origin}/ip/aouad?s=hyosan`);
    await screenshot(page, `${label}-entry`);
    const frame = await openGame(page);
    await expectFit(page, frame, label);
    await screenshot(page, `${label}-menu`);
    await frame.getByRole('button', { name: '탐험 시작', exact: true }).tap();
    await frame.getByRole('button', { name: '이야기 건너뛰기', exact: true }).tap();
    await frame.locator('[data-hyosan-3d-state="playing"]').waitFor();
    if (engine === 'chromium') {
      const touch = await context.newCDPSession(page);
      try {
        const marker = frame.locator('[data-surface="mini"] [data-elevation]');
        const before = await marker.getAttribute('transform');
        const joystick = await frame.locator('[data-control="joystick"]').boundingBox();
        assert.ok(joystick, 'The mobile movement control must be visible');
        const point = { x: joystick.x + joystick.width / 2, y: joystick.y + joystick.height / 2, id: 1 };
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
        await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, x: point.x + joystick.width * .25 }] });
        await page.waitForTimeout(400);
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        assert.notEqual(await marker.getAttribute('transform'), before, 'Touch joystick must move the actual player');
        const fire = await frame.locator('[data-action="fire"]').boundingBox();
        assert.ok(fire, 'The mobile bow control must be visible');
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fire.x + fire.width / 2, y: fire.y + fire.height / 2, id: 1 }] });
        await page.waitForTimeout(500);
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await frame.getByText('첫 화살을 쏴보세요', { exact: true }).waitFor({ state: 'hidden' });
      } finally {
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }).catch(() => {});
        await touch.detach();
      }
    }
    await expectFit(page, frame, label);
    await screenshot(page, `${label}-playing`);
    await page.getByRole('button', { name: '팝업으로 돌아가기', exact: true }).tap();
    await expectClosed(page);
    await page.getByRole('button', { name: '효산의 기억 시작하기', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    results.push({ group: label, status: 'passed', touchMovementAndFire: engine === 'chromium' });
  } catch (error) {
    await screenshot(page, `${label}-failure`).catch(() => {});
    results.push({ group: label, status: 'failed', message: error.message, errors });
  } finally {
    await context.close();
  }
}

async function recovery(browser, engine) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await context.addInitScript(() => {
      localStorage.setItem('icons:aouad-presentation:v1', JSON.stringify({ op: true, temp: true }));
      if (location.pathname === '/ip-popups/aouad/hyosan/index.html') {
        const getItem = Storage.prototype.getItem;
        Storage.prototype.getItem = function (key) {
          if (key.startsWith('hyosan-memories')) throw new DOMException('QA read failure', 'SecurityError');
          return getItem.call(this, key);
        };
      }
    });
    await page.goto(`${origin}/ip/aouad?s=hyosan`);
    await page.getByRole('button', { name: '효산의 기억 시작하기', exact: true }).click();
    const frame = await frameFor(page);
    await frame.getByRole('heading', { name: '저장된 기억을 읽지 못했습니다', exact: true }).waitFor();
    await frame.getByRole('button', { name: '저장 없이 탐험', exact: true }).click();
    await frame.locator('[data-hyosan-ready="true"]').waitFor({ timeout: 90000 });
    await frame.getByRole('button', { name: '탐험 시작', exact: true }).click();
    await frame.getByRole('button', { name: '이야기 건너뛰기', exact: true }).click();
    await screenshot(page, `${engine}-storage-recovery`);
    await page.getByRole('button', { name: '팝업으로 돌아가기', exact: true }).click();
    await expectClosed(page);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), campaignKey), null,
      'The explicit temporary game must not create a saved campaign');
    results.push({ group: `${engine}-storage-recovery`, status: 'passed' });
  } catch (error) {
    await screenshot(page, `${engine}-storage-recovery-failure`).catch(() => {});
    results.push({ group: `${engine}-storage-recovery`, status: 'failed', message: error.message });
  } finally {
    await context.close();
  }

  const retryContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const retryPage = await retryContext.newPage();
  const pattern = '**/ip-popups/aouad/hyosan/assets/*.js';
  try {
    await retryContext.addInitScript(() => localStorage.setItem('icons:aouad-presentation:v1', JSON.stringify({ op: true, temp: true })));
    await retryPage.route(pattern, route => route.abort());
    await retryPage.goto(`${origin}/ip/aouad?s=hyosan`);
    await retryPage.getByRole('button', { name: '효산의 기억 시작하기', exact: true }).click();
    await retryPage.getByRole('alert').filter({ hasText: '게임 화면을 불러오지 못했습니다' }).waitFor({ timeout: 40000 });
    await screenshot(retryPage, `${engine}-load-retry`);
    await retryPage.unroute(pattern);
    await retryPage.getByRole('button', { name: '다시 시도', exact: true }).click();
    const frame = await frameFor(retryPage);
    await frame.locator('[data-hyosan-ready="true"]').waitFor({ timeout: 90000 });
    await retryPage.getByRole('button', { name: '팝업으로 돌아가기', exact: true }).click();
    await expectClosed(retryPage);
    results.push({ group: `${engine}-load-retry`, status: 'passed' });
  } catch (error) {
    await screenshot(retryPage, `${engine}-load-retry-failure`).catch(() => {});
    results.push({ group: `${engine}-load-retry`, status: 'failed', message: error.message });
  } finally {
    await retryContext.close();
  }
}

const selected = process.env.AOUAD_QA_BROWSER;
const selectedGroup = process.env.AOUAD_QA_GROUP;
for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  if (selected && selected !== name) continue;
  const browser = await engine.launch({ headless: true });
  try {
    if (name === 'chromium' && (!selectedGroup || selectedGroup === 'desktop')) await desktop(browser);
    if (!selectedGroup || selectedGroup === 'keyboard') await keyboardReturn(browser, name);
    for (const viewport of selectedGroup && selectedGroup !== 'mobile' ? [] : [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 568 }]) {
      await mobile(browser, name, viewport);
    }
    if (!selectedGroup || selectedGroup === 'recovery') await recovery(browser, name);
  } finally {
    await browser.close();
  }
}
const report = { origin, checkedAt: new Date().toISOString(), scope: 'Actual browser input against the integrated production game bundle; mobile viewport emulation, not physical device QA.', results };
await writeFile(join(output, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output, ...report }, null, 2));
if (results.some(result => result.status !== 'passed')) process.exitCode = 1;
