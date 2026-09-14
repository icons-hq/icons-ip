#!/usr/bin/env node
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { browserExecutable } from '../admin-visual-qa.mjs';
import { measureAdminLayout } from '../admin-visual-qa-measure.mjs';

const origin = 'http://127.0.0.1:4319';
const output = process.env.ADMIN_VISUAL_FIXTURE_OUTPUT || '/tmp/admin-visual-fixture-qa';
const errors = [];
const blocked = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function evaluateMeasure(page, heading) {
  const fn = `(${measureAdminLayout.toString()})`;
  return page.evaluate(({ source, expected }) => (0, eval)(source)({ heading: expected }), {
    expected: heading,
    source: fn,
  });
}

async function navigate(page, path, heading) {
  await page.goto(`${origin}${path}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.wc-admin');
  const title = await page.title();
  const url = page.url();
  assert(title === 'ICONS Admin visual fixture', `unexpected title for ${path}: ${title}`);
  assert(url.startsWith(origin), `navigation escaped loopback: ${url}`);
  const measure = await evaluateMeasure(page, heading);
  assert(measure.identity.rootFound, `${path}: admin root missing`);
  assert(measure.identity.headingMatched, `${path}: heading ${heading} missing`);
  assert(!measure.identity.login, `${path}: login UI rendered`);
  assert(measure.identity.overlays.length === 0, `${path}: framework overlay rendered`);
  return { url, measure };
}

async function waitForSelectHint(page, selector, expectedText) {
  await page.waitForFunction(({ selector: targetSelector, text }) => {
    const select = document.querySelector(targetSelector);
    if (!(select instanceof HTMLSelectElement)) return false;
    const ids = (select.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    return ids.some((id) => {
      const hint = document.getElementById(id);
      return hint?.classList.contains('admin-select-hint') && hint.textContent?.trim() === text;
    });
  }, { selector, text: expectedText });
  const hint = page.locator('.admin-select-hint').filter({ hasText: expectedText });
  assert(await hint.isVisible(), `${selector}: selected option hint is not visible`);
  const hintState = await page.locator(selector).evaluate((select, text) => {
    if (!(select instanceof HTMLSelectElement)) return null;
    const describedBy = (select.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    const hint = describedBy.map((id) => document.getElementById(id)).find((element) => element?.classList.contains('admin-select-hint'));
    if (!(hint instanceof HTMLElement)) return null;
    const selectedText = select.selectedOptions[0]?.textContent?.trim() || '';
    const hintBox = hint.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(hint);
    const clippedText = [...range.getClientRects()].some((fragment) => (
      fragment.left < hintBox.left - 1
      || fragment.right > hintBox.right + 1
      || fragment.top < hintBox.top - 1
      || fragment.bottom > hintBox.bottom + 1
    ));
    const style = getComputedStyle(hint);
    return {
      selectedText,
      hintText: hint.textContent?.trim() || '',
      connected: describedBy.includes(hint.id),
      immediateBelow: hint.parentElement === select.parentElement && hint.previousElementSibling === select,
      visible: hint.getClientRects().length > 0 && style.display !== 'none' && style.visibility !== 'hidden',
      clippedText,
      expectedText: text,
    };
  }, expectedText);
  assert(hintState?.selectedText === expectedText, `${selector}: hint does not match selected option text`);
  assert(hintState?.hintText === expectedText, `${selector}: hint text is not an exact full selected option label`);
  assert(hintState?.connected, `${selector}: hint is not connected through aria-describedby`);
  assert(hintState?.immediateBelow, `${selector}: hint is not immediately below the native select`);
  assert(hintState?.visible, `${selector}: hint is not visibly rendered`);
  assert(!hintState?.clippedText, `${selector}: full hint text is clipped`);
  return hint;
}

async function assertNoSelectHint(page, selector, expectedText) {
  const hint = page.locator('.admin-select-hint').filter({ hasText: expectedText });
  assert(await hint.count() === 0, `${selector}: stale selected option hint remained`);
  const describedBy = await page.locator(selector).getAttribute('aria-describedby');
  assert(!describedBy?.split(/\s+/).some((id) => id.startsWith('admin-select-hint-')), `${selector}: stale hint id remained in aria-describedby`);
}

async function run() {
  await mkdir(output, { recursive: true });
  let browser;
  const report = {
    origin,
    viewports: [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 844 }],
    results: [],
  };

  try {
    browser = await chromium.launch({ executablePath: await browserExecutable(), headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin || url.pathname.startsWith('/api') || url.pathname.startsWith('/auth')) {
        blocked.push({ method: route.request().method(), url: route.request().url() });
        await route.abort();
        return;
      }
      await route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(`pageerror:${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console:${message.text()}`);
    });

    const goods = await navigate(page, '/?view=goods', '상품 목록');
    await page.locator('input[name="q"]').fill('운영자 화면 수평 스크롤');
    await page.locator('form.admin-console-filters button[type="submit"]').click();
    await page.waitForLoadState('networkidle');
    assert(new URL(page.url()).pathname === '/admin/catalog/goods', 'goods GET did not preserve route');
    assert(new URL(page.url()).searchParams.get('q') === '운영자 화면 수평 스크롤', 'goods GET query was lost');
    assert(await page.locator('input[name="q"]').inputValue() === '운영자 화면 수평 스크롤', 'goods search field did not restore');
    report.results.push({ name: 'goods-filter-get', url: page.url(), findings: goods.measure.findings });
    await page.screenshot({ path: `${output}/goods-filter-get.png`, fullPage: false });

    const dateFilter = await navigate(page, '/?view=filter-date', '주문 통합검색 filter fixture');
    await page.locator('#fixture-date-filter-query').fill('배송 완료 후 거래확정 대기 상태를 찾는 긴 검색어');
    await page.locator('form.admin-console-filters button[type="submit"]').click();
    await page.waitForLoadState('networkidle');
    assert(new URL(page.url()).pathname === '/admin/sales/orders', 'date filter GET did not preserve route');
    assert(new URL(page.url()).searchParams.get('q')?.startsWith('배송 완료 후'), 'date filter query was lost');
    assert(await page.locator('#fixture-date-filter-query').inputValue() !== '', 'date filter search did not restore');
    await page.locator('a.admin-console-preset').nth(1).click();
    await page.waitForLoadState('networkidle');
    assert(new URL(page.url()).searchParams.has('from'), 'date preset did not preserve from');
    assert(new URL(page.url()).searchParams.has('to'), 'date preset did not preserve to');
    report.results.push({ name: 'date-filter-get-and-preset', url: page.url(), findings: dateFilter.measure.findings });
    await page.screenshot({ path: `${output}/date-filter-preset.png`, fullPage: false });

    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(`${origin}/?view=filter-date&selectProbe=1`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wc-admin');
    const statusSelect = page.locator('#fixture-date-filter-status');
    await statusSelect.selectOption('shipping');
    await waitForSelectHint(page, '#fixture-date-filter-status', '배송 완료 후 거래확정 대기 상태');
    assert((await statusSelect.getAttribute('aria-describedby'))?.includes('admin-select-hint-'), 'status hint was not connected with aria-describedby');
    await statusSelect.selectOption('all');
    await page.waitForFunction(() => !document.querySelector('#fixture-date-filter-status')?.getAttribute('aria-describedby')?.split(/\s+/).some((id) => id.startsWith('admin-select-hint-')));
    await assertNoSelectHint(page, '#fixture-date-filter-status', '배송 완료 후 거래확정 대기 상태');
    const controlledSelect = page.locator('#fixture-controlled-select');
    assert(await controlledSelect.inputValue() === 'short', 'controlled AdminSelect did not start at short value');
    await page.locator('#fixture-controlled-toggle').click();
    await waitForSelectHint(page, '#fixture-controlled-select', '외부 controlled prop으로 바뀌는 매우 긴 선택값 전체 표시 검수');
    await page.locator('#fixture-controlled-toggle').click();
    await page.waitForFunction(() => !document.querySelector('#fixture-controlled-select')?.getAttribute('aria-describedby')?.split(/\s+/).some((id) => id.startsWith('admin-select-hint-')));
    await assertNoSelectHint(page, '#fixture-controlled-select', '외부 controlled prop으로 바뀌는 매우 긴 선택값 전체 표시 검수');
    const resetSelect = page.locator('#fixture-reset-select');
    await resetSelect.selectOption('long');
    await waitForSelectHint(page, '#fixture-reset-select', 'form.reset으로 돌아갈 매우 긴 선택값');
    await page.locator('#fixture-native-reset-form button[type="reset"]').click();
    await page.waitForFunction(() => !document.querySelector('#fixture-reset-select')?.getAttribute('aria-describedby')?.split(/\s+/).some((id) => id.startsWith('admin-select-hint-')));
    await assertNoSelectHint(page, '#fixture-reset-select', 'form.reset으로 돌아갈 매우 긴 선택값');
    await page.locator('.fixture-route-switcher').evaluate((node) => { node.style.display = 'none'; });
    await page.screenshot({ path: `${output}/filter-select-hints-320.png`, fullPage: false });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/?view=filter-date`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wc-admin');
    const searchType = page.locator('select[name="searchField"]');
    await searchType.selectOption('buyer');
    await waitForSelectHint(page, 'select[name="searchField"]', '구매자 이름·이메일·주문번호·수취인·휴대전화·배송지·거래확정 상태 전체 검색');
    await searchType.selectOption('order');
    await page.waitForFunction(() => !document.querySelector('select[name="searchField"]')?.getAttribute('aria-describedby')?.split(/\s+/).some((id) => id.startsWith('admin-select-hint-')));
    await assertNoSelectHint(page, 'select[name="searchField"]', '구매자 이름·이메일·주문번호·수취인·휴대전화·배송지·거래확정 상태 전체 검색');
    await searchType.selectOption('buyer');
    await waitForSelectHint(page, 'select[name="searchField"]', '구매자 이름·이메일·주문번호·수취인·휴대전화·배송지·거래확정 상태 전체 검색');
    await searchType.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    // Headless Chromium does not commit native popup keyboard changes; keep
    // the keyboard attempt visible and use Playwright's native select API only
    // for the same final option before asserting GET serialization.
    const keyboardValue = await searchType.inputValue();
    const keyboardSelection = keyboardValue === 'order' ? 'native-keyboard' : 'playwright-native-select-fallback';
    if (keyboardValue !== 'order') await searchType.selectOption('order');
    assert(await searchType.inputValue() === 'order', 'keyboard select did not preserve order selection');
    await page.locator('#fixture-date-filter-query').fill('키보드 선택 후 GET 보존을 확인하는 긴 검색어');
    await page.locator('form.admin-console-filters button[type="submit"]').click();
    await page.waitForLoadState('networkidle');
    const keyboardUrl = new URL(page.url());
    assert(keyboardUrl.pathname === '/admin/sales/orders', 'keyboard select GET route was not preserved');
    assert(keyboardUrl.searchParams.get('searchField') === 'order', 'keyboard select GET searchField was lost');
    assert(keyboardUrl.searchParams.get('q') === '키보드 선택 후 GET 보존을 확인하는 긴 검색어', 'keyboard select GET query was lost');
    const selectMeasure = await evaluateMeasure(page, '주문 통합검색 filter fixture');
    report.results.push({ name: 'admin-select-hints-320-390-and-keyboard-get', url: page.url(), keyboardSelection, findings: selectMeasure.findings });
    await page.locator('.fixture-route-switcher').evaluate((node) => { node.style.display = 'none'; });
    await page.screenshot({ path: `${output}/filter-select-hints-390.png`, fullPage: false });

    await page.setViewportSize({ width: 1440, height: 900 });
    const options = await navigate(page, '/?view=options', '상품 옵션 편집 fixture');
    const beforeRows = await page.locator('.fixture-options-screen table tbody tr').count();
    await page.getByRole('button', { name: '조합 생성' }).click();
    const afterRows = await page.locator('.fixture-options-screen table tbody tr').count();
    assert(beforeRows === 2, `expected 2 initial option rows, got ${beforeRows}`);
    assert(afterRows === 9, `expected 9 generated option rows, got ${afterRows}`);
    const optionName = page.locator('input[aria-label="옵션 1 이름"]');
    await optionName.fill('fixture edited option name');
    assert(await optionName.inputValue() === 'fixture edited option name', 'option input did not update');
    report.results.push({ name: 'options-generate-and-edit', url: page.url(), rows: { beforeRows, afterRows }, findings: options.measure.findings });
    await page.screenshot({ path: `${output}/options-generated.png`, fullPage: false });

    const shell = await navigate(page, '/?view=shell', 'AdminShell interaction fixture');
    await page.getByRole('button', { name: '사이드바 접기' }).click();
    assert(await page.locator('.wc-admin.collapsed').count() === 1, 'sidebar did not enter collapsed state');
    await page.getByRole('button', { name: /fixture\.staff@local\.test 계정 메뉴/ }).click();
    assert(await page.locator('#admin-account-menu').isVisible(), 'account menu did not open');
    report.results.push({ name: 'shell-collapse-and-account-menu', url: page.url(), findings: shell.measure.findings });
    await page.screenshot({ path: `${output}/shell-collapsed-account.png`, fullPage: false });

    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await navigate(page, '/?view=options', '상품 옵션 편집 fixture');
    report.results.push({ name: 'options-mobile', url: page.url(), findings: mobile.measure.findings });
    await page.screenshot({ path: `${output}/options-mobile.png`, fullPage: false });

    assert(blocked.length === 0, `external/Auth/API request attempted: ${JSON.stringify(blocked)}`);
    assert(errors.length === 0, `browser errors: ${JSON.stringify(errors)}`);
    const findingErrors = report.results.flatMap((result) => result.findings).filter((finding) => finding.severity === 'error');
    assert(findingErrors.length === 0, `layout findings with error severity: ${JSON.stringify(findingErrors)}`);
    console.log(JSON.stringify({ output, blocked, errors, results: report.results.map(({ name, url, findings, rows }) => ({ name, url, findings: findings.length, rows })) }, null, 2));
  } finally {
    const findingErrors = report.results.flatMap((result) => result.findings).filter((finding) => finding.severity === 'error');
    try {
      await writeFile(`${output}/report.json`, `${JSON.stringify({ ...report, blocked, errors, findingErrors }, null, 2)}\n`);
    } finally {
      await browser?.close();
    }
  }
}

run().catch(async (error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
