import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, webkit } from 'playwright-core';

// Run against an already running app. Each context has only local presentation
// fixtures; no account, payment, reservation or reward API is written.
const origin = new URL(process.env.AOUAD_QA_ORIGIN || 'http://127.0.0.1:4314').origin;
const output = process.env.AOUAD_QA_OUTPUT_DIR || await mkdtemp(join(tmpdir(), 'aouad-mobile-'));
await mkdir(output, { recursive: true });
const viewports = [
  { width: 320, height: 568 }, { width: 375, height: 667 },
  { width: 390, height: 844 }, { width: 440, height: 956 },
];
const results = [];
const fixture = {
  op: true, temp: true, callsign: '모바일 검수', photo: 'cheongsan',
  cart: [{ id: 'ribbon_keyring', qty: 1 }, { id: 'uniform_female', option: 'M', qty: 1 }],
};

async function rect(locator) {
  const box = await locator.boundingBox();
  assert.ok(box, 'Expected a rendered element');
  return { ...box, right: box.x + box.width, bottom: box.y + box.height };
}

function within(box, bounds, label) {
  assert.ok(box.x >= bounds.x - 1 && box.right <= bounds.right + 1, `${label} leaves its horizontal bounds`);
}

async function screenshot(page, name) {
  await page.screenshot({ path: join(output, `${name}.png`) });
}

async function checkBroadcast(page, engine, viewport) {
  await page.goto(`${origin}/ip/aouad?zone=broadcast`);
  await page.getByRole('button', { name: '체험 시작하기', exact: true }).tap();
  await page.locator('[class*="GameGate-module__"] button').filter({ hasText: '시작' }).tap();
  const game = page.getByRole('button', { name: /^호스 잡기 —/ });
  await game.waitFor();
  await page.waitForFunction(() => document.querySelector('[aria-label^="호스 잡기 —"]')?.getAttribute('aria-disabled') === 'false');
  await page.waitForFunction(() => {
    const section = document.querySelector('[aria-label^="호스 잡기 —"]')?.closest('section');
    return section && Math.abs(section.getBoundingClientRect().top) < 1;
  });
  const navigation = page.getByRole('navigation', { name: '효산고 탐험 안내', exact: true });
  const field = await rect(game);
  const hud = await rect(navigation.locator('[class*="orbs"]'));
  within(field, { x: 0, right: viewport.width }, 'Broadcast game');
  await screenshot(page, `${engine}-${viewport.width}-broadcast-ready`);
  assert.ok(field.y >= 58 && field.bottom <= hud.y - 4, `HUD covers the broadcast playfield: ${JSON.stringify({ field, hud })}`);
  assert.ok((await rect(game.locator('[class*="__world"]'))).height <= field.height - 1, 'Broadcast crops the game world instead of fitting its scale');
  await game.tap();
  const shaft = game.locator('[class*="__shaft"]');
  const readPosition = () => shaft.evaluate((element) => element.style.transform);
  const initial = await readPosition();
  assert.ok(initial, 'Broadcast game must have an actual rendered camera position');
  await page.waitForFunction((initial) => document.querySelector('[aria-label^="호스 잡기 —"] [class*="__shaft"]')?.style.transform !== initial, initial);
  await screenshot(page, `${engine}-${viewport.width}-broadcast`);

  for (const panel of ['sheet', 'map']) {
    await navigation.getByRole('button', { name: panel === 'sheet' ? /안내 펼치기$/ : /^학교 안내도 열기/ }).tap();
    await page.waitForFunction(() => document.querySelector('[aria-label^="호스 잡기 —"]')?.getAttribute('aria-disabled') === 'true');
    const paused = await readPosition();
    await page.waitForTimeout(650); // Cover several simulation ticks while the overlay owns interaction.
    assert.equal(await readPosition(), paused, `Broadcast keeps running under the ${panel}`);
    if (panel === 'sheet') await navigation.getByRole('button', { name: /안내 접기$/ }).tap();
    else await page.getByRole('dialog', { name: '학교 안내도', exact: true }).getByRole('button', { name: '학교 안내도 닫기', exact: true }).tap();
    await page.waitForFunction((paused) => {
      const field = document.querySelector('[aria-label^="호스 잡기 —"]');
      return field?.getAttribute('aria-disabled') === 'false' && field.querySelector('[class*="__shaft"]').style.transform !== paused;
    }, paused, { timeout: 3000 });
  }
}

async function checkMobile(browser, engine, viewport) {
  const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const errors = [];
  try {
    await context.addInitScript((state) => localStorage.setItem('icons:aouad-presentation:v1', JSON.stringify(state)), fixture);
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${origin}/ip/aouad?s=offline`);
    const offline = page.locator('[data-scene="offline"]');
    const body = offline.locator('[class*="sectionBody"]');
    await offline.locator('[class*="offProgList"]').waitFor({ state: 'attached' });
    await page.evaluate(() => document.fonts.ready);
    const grid = await rect(offline.locator('[class*="offGrid"]'));
    const poster = await rect(offline.getByRole('img', { name: '오프라인 팝업 포스터', exact: true }));
    assert.ok(Math.abs(poster.width - grid.width) <= 1, 'Safari collapsed the offline poster');
    assert.ok(Math.abs(poster.height - poster.width / 1.5) <= 1, 'Offline poster lost its aspect ratio');
    assert.ok((await rect(offline.locator('[class*="offMain"]'))).y >= poster.bottom, 'Poster overlaps introduction');
    assert.ok((await rect(offline.locator('[class*="offProgram"]'))).y >= grid.bottom, 'Offline information overlaps program cards');
    await screenshot(page, `${engine}-${viewport.width}-offline`);

    await offline.getByRole('button', { name: '설명 보기', exact: true }).tap();
    const tooltip = page.getByRole('tooltip');
    await tooltip.waitFor({ state: 'visible', timeout: 2000 });
    within(await rect(tooltip), { x: 0, right: viewport.width }, 'Explanation');

    await page.getByRole('button', { name: /^학생증 ·/ }).tap();
    const me = page.getByRole('dialog', { name: '나 — 학생증·퀘스트·보유·장바구니', exact: true });
    const close = me.getByRole('button', { name: '닫기', exact: true });
    within(await rect(close), { x: 0, right: viewport.width }, 'Student panel close button');
    await me.locator('[class*="meBox"]').evaluate((element) => { element.scrollTop = element.scrollHeight; });
    assert.ok(await close.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    }), 'Student panel close button is hidden after scrolling');
    await me.getByRole('tab', { name: /^장바구니/ }).tap();
    await me.getByRole('button', { name: '주문하기', exact: true }).tap();
    const order = page.getByRole('dialog', { name: '주문 시연', exact: true });
    const rows = order.locator('[class*="coList"] li');
    assert.equal(await rows.count(), 2);
    for (const row of await rows.all()) {
      const image = await rect(row.locator('i'));
      const name = await rect(row.locator('span'));
      const price = await rect(row.locator('em'));
      assert.ok(name.x >= image.right && name.width >= 72, 'Order image overlaps or collapses the product name');
      assert.ok(price.y >= name.bottom, 'Order price overlaps the product name or option');
      within(price, await rect(row), 'Order price');
    }
    await screenshot(page, `${engine}-${viewport.width}-order`);
    await order.getByRole('button', { name: '취소', exact: true }).tap();

    await page.getByRole('button', { name: '오프라인 팝업 안내 펼치기', exact: true }).tap();
    const sheet = page.getByRole('navigation', { name: '효산고 탐험 안내', exact: true }).locator(':scope > [class*="mid"]');
    await page.waitForFunction(() => {
      const panel = document.querySelector('nav[aria-label="효산고 탐험 안내"] > [class*="mid"]');
      return panel && Math.abs(panel.getBoundingClientRect().bottom - panel.parentElement.getBoundingClientRect().bottom) < 1;
    }, undefined, { timeout: 3000 }).catch(async (error) => {
      await screenshot(page, `${engine}-${viewport.width}-hud-failure`);
      const state = await page.evaluate(() => {
        const panel = document.querySelector('nav[aria-label="효산고 탐험 안내"] > [class*="mid"]');
        return { viewport: innerHeight, panel: panel?.getBoundingClientRect().toJSON(), panelStyle: panel && { height: getComputedStyle(panel).height, transform: getComputedStyle(panel).transform }, nav: panel?.parentElement.className };
      });
      throw new Error(`HUD did not finish opening: ${JSON.stringify(state)}`, { cause: error });
    });
    await body.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    assert.ok((await rect(offline.locator('[class*="offFoot"]'))).bottom <= (await rect(sheet)).y - 4, 'Expanded HUD covers the end of the offline information');
    await screenshot(page, `${engine}-${viewport.width}-expanded-hud`);

    await page.goto(`${origin}/ip/aouad?p=uniform_female`);
    const actions = page.locator('[class*="pdActions"]');
    await actions.waitFor();
    await actions.scrollIntoViewIfNeeded();
    const info = await rect(page.locator('[class*="pdInfo"]'));
    for (const button of await actions.getByRole('button').all()) within(await rect(button), info, 'Product action');
    await screenshot(page, `${engine}-${viewport.width}-product`);

    await page.goto(`${origin}/ip/aouad?zone=reserve`);
    const reservation = page.locator('[class*="rsvWrap"]');
    await reservation.locator('[class*="rsvDays"] button:enabled').first().tap();
    await reservation.locator('[class*="rsvSlots"] button:enabled').first().tap();
    const reservationAction = reservation.locator('[class*="rsvBar"] button');
    const navigation = page.getByRole('navigation', { name: '효산고 탐험 안내', exact: true });
    for (const expanded of [false, true]) {
      if (expanded) {
        await navigation.getByRole('button', { name: /안내 펼치기$/ }).tap();
        await page.waitForFunction(() => {
          const panel = document.querySelector('nav[aria-label="효산고 탐험 안내"] > [class*="mid"]');
          return panel && Math.abs(panel.getBoundingClientRect().bottom - panel.parentElement.getBoundingClientRect().bottom) < 1;
        });
      }
      await page.locator('[class*="zoneView"]').evaluate((element) => { element.scrollTop = element.scrollHeight; });
      const hud = navigation.locator(expanded ? ':scope > [class*="mid"]' : '[class*="orbs"]');
      await page.waitForFunction((expanded) => {
        const action = document.querySelector('[class*="rsvBar"] button');
        const hud = document.querySelector(expanded ? 'nav[aria-label="효산고 탐험 안내"] > [class*="mid"]' : 'nav[aria-label="효산고 탐험 안내"] [class*="orbs"]');
        return action && hud && action.getBoundingClientRect().bottom <= hud.getBoundingClientRect().top - 4;
      }, expanded, { timeout: 2000 }).catch(async (error) => {
        await screenshot(page, `${engine}-${viewport.width}-reservation-failure`);
        throw new Error(`HUD covers reservation confirmation: ${JSON.stringify({ expanded, action: await rect(reservationAction), hud: await rect(hud) })}`, { cause: error });
      });
      await screenshot(page, `${engine}-${viewport.width}-reservation-${expanded ? 'expanded' : 'closed'}`);
    }
    await reservationAction.tap();
    await reservation.getByText('예약 체험 완료', { exact: true }).waitFor();
    await page.locator('[class*="zoneView"]').evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await reservation.getByRole('button', { name: '예약 변경', exact: true }).tap();
    await reservation.getByText('입장 일시를 선택하세요', { exact: true }).waitFor();
    await checkBroadcast(page, engine, viewport);
    assert.deepEqual(errors, []);
    results.push({ engine, viewport, status: 'passed', checks: ['poster', 'touch-tooltip', 'modal-close', 'order-layout', 'expanded-hud', 'product-actions', 'reservation-confirm-change', 'broadcast-playfield', 'game-overlay-pause-resume'] });
    console.log(`${engine} ${viewport.width}×${viewport.height}: passed`);
  } finally {
    await context.close();
  }
}

async function checkFirstVisit(browser, engine) {
  const context = await browser.newContext({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  try {
    const page = await context.newPage();
    await page.goto(`${origin}/ip/aouad?s=offline`);
    await page.getByRole('button', { name: '…누구야. 나한테 말한 거야?', exact: true }).tap();
    await page.getByRole('textbox', { name: '이름', exact: true }).waitFor();
    for (const height of [568, 360]) {
      await page.setViewportSize({ width: 320, height });
      const opening = page.getByRole('dialog', { name: '무전 수신', exact: true });
      await opening.evaluate((element) => { element.scrollTop = 0; });
      assert.ok((await rect(opening.locator('p').first())).y >= 58, 'Short viewport clips the first-visit dialogue above the header');
      await screenshot(page, `${engine}-320x${height}-first-visit`);
    }
    await page.getByRole('textbox', { name: '이름', exact: true }).fill('모바일검수');
    await page.getByRole('button', { name: '이청산', exact: true }).tap();
    await page.getByRole('button', { name: '그래, 옥상으로 갈게, 만나', exact: true }).tap();
    await page.getByRole('button', { name: '학생증 · 모바일검수', exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('s'), 'offline');
    results.push({ engine, status: 'passed', checks: ['short-first-visit', 'onboarding-deep-link'] });
    console.log(`${engine} first visit: passed`);
  } finally {
    await context.close();
  }
}

try {
  for (const [engine, launcher] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await launcher.launch({ headless: true, ...(engine === 'chromium' ? { channel: process.env.AOUAD_CHROMIUM_CHANNEL || 'chrome' } : {}) });
    try {
      for (const viewport of viewports) await checkMobile(browser, engine, viewport);
      await checkFirstVisit(browser, engine);
    } finally {
      await browser.close();
    }
  }
} finally {
  await writeFile(join(output, 'results.json'), JSON.stringify({ origin, results }, null, 2));
  console.log(`Evidence: ${output}`);
}
