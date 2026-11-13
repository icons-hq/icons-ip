#!/usr/bin/env node
/*
 * 0901-008(11/11 묶음 11) "빈 화면에서 공개까지 10클릭 이내" 측정 스크립트 — T15b.
 *
 * 셈법(오케스트레이터 판단): 단품(옵션 1개)·필수 항목만·고시 프리셋 사용·KC 해당 없음 조건에서, 빈 상품 등록 화면부터
 * '저장 후 공개'까지 사람이 누르는 버튼·선택 클릭만 센다. 입력칸에 글자를 넣으려고 누르는 포커스 클릭은 세지 않는다
 * (R4a 0901-008 #637 측정과 같은 셈법). 로그인과 화면 이동(주소 입력)은 세지 않는다.
 *
 * 사람처럼 보이는 이름(역할·라벨·글자)으로만 찾고 누른다. CSS 셀렉터·page.evaluate로 동작을 대신하지 않는다.
 * 로컬 격리 스택의 운영 빌드(`SUPABASE_WORKDIR=<스택> npm run build:local && npm run start:local`)에서만 돈다(루프백 주소만 허용).
 *
 * 준비(시험 담당이 한다): 고정 테스트 계정을 서버 기동 뒤 admin + 운영자 멤버십(primary)으로 올리고, 유형이 연결된 말단 카테고리·
 * 공개 IP·그 유형의 상품정보고시 템플릿을 둔다. 대표 이미지로 올릴 PNG/JPEG/WebP 파일 경로를 넘긴다.
 *
 * 사용: node scripts/goods-register-click-count.mjs --origin http://clicks.localhost:3614 --category "키링" --ip "메이플스토리"
 *         --image /path/to/main.png [--name "측정 상품"] [--price 12000] [--stock 5] [--output /tmp/clicks] [--limit 10]
 * 결과: 표준 출력에 JSON({ clicks, limit, withinLimit, published, steps[], screenshots[] }). 공개되지 않았거나 상한을 넘으면 종료 코드 1.
 */
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LOCAL_TEST_ACCOUNT } from './local-supabase-runtime.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`알 수 없는 인자: ${key}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) { args[key.slice(2)] = true; continue; }
    args[key.slice(2)] = value; index += 1;
  }
  return args;
}

function loopbackOrigin(value) {
  const url = new URL(value);
  const host = url.hostname;
  const loopback = host === '127.0.0.1' || host === 'localhost' || host.endsWith('.localhost');
  if (!loopback || url.protocol !== 'http:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('--origin은 로컬 루프백 주소(http://<이름>.localhost:<포트>)만 받습니다. 운영·공유 사이트에서는 돌리지 않습니다.');
  }
  return url.origin;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log('node scripts/goods-register-click-count.mjs --origin http://clicks.localhost:3614 --category <카테고리명> --ip <IP 이름> --image <파일> [--name] [--price] [--stock] [--output] [--limit 10]'); return; }
  const origin = loopbackOrigin(args.origin ?? 'http://clicks.localhost:3000');
  for (const key of ['category', 'ip', 'image']) if (!args[key]) throw new Error(`--${key}가 필요합니다.`);
  const image = resolve(String(args.image));
  if (!existsSync(image)) throw new Error(`대표 이미지 파일이 없습니다: ${image}`);
  const limit = Number(args.limit ?? 10);
  const output = resolve(String(args.output ?? join(process.cwd(), 'output', 'goods-register-click-count')));
  await mkdir(output, { recursive: true });
  const name = String(args.name ?? `클릭 측정 상품 ${new Date().toISOString().slice(0, 16)}`);

  const browser = await chromium.launch({ channel: process.env.CLICK_COUNT_BROWSER_CHANNEL ?? 'chrome', headless: true });
  const steps = [];
  const screenshots = [];
  let clicks = 0;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    const shot = async (label) => { const path = join(output, `${String(screenshots.length + 1).padStart(2, '0')}-${label}.png`); await page.screenshot({ path, fullPage: false }); screenshots.push(path); };
    /** 버튼·선택 클릭 1회를 센다. */
    const click = async (label, locator) => { await locator.click(); clicks += 1; steps.push({ step: clicks, action: 'click', label }); };
    const choose = async (label, locator, value) => { await locator.selectOption(value); clicks += 1; steps.push({ step: clicks, action: 'select', label, value: String(value.label ?? value) }); };
    /** 입력(포커스 클릭은 세지 않는다). */
    const type = async (label, locator, value) => { await locator.fill(String(value)); steps.push({ step: null, action: 'type', label }); };

    // 로그인(세지 않음)
    await page.goto(`${origin}/login?next=${encodeURIComponent('/admin/catalog/goods?create=1')}`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('이메일', { exact: true }).fill(LOCAL_TEST_ACCOUNT.email);
    await page.getByLabel('비밀번호', { exact: true }).fill(LOCAL_TEST_ACCOUNT.password);
    await page.getByLabel('비밀번호', { exact: true }).press('Enter');
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });

    // 빈 상품 등록 화면에서 시작
    await page.goto(`${origin}/admin/catalog/goods?create=1`, { waitUntil: 'domcontentloaded' });
    const save = page.getByRole('button', { name: '저장하기', exact: true });
    await save.waitFor({ state: 'visible', timeout: 60_000 });
    await shot('empty');

    // 1. 기본 정보: 카테고리(검색 후 목록에서 고르기), 상품명, 연결 IP
    await type('카테고리 검색', page.getByRole('combobox', { name: /카테고리/ }).first(), args.category);
    await click(`카테고리 '${args.category}' 고르기`, page.getByRole('option', { name: new RegExp(String(args.category)) }).first());
    await type('상품명', page.getByLabel('상품명 (필수)'), name);
    await choose('연결 IP', page.getByLabel('연결 IP (필수)'), { label: String(args.ip) });

    // 2. 판매 정보: 판매가, 재고수량(단품)
    await type('판매가', page.getByLabel('판매가 (필수)'), args.price ?? 12000);
    await type('재고수량', page.getByLabel('재고수량 (필수)'), args.stock ?? 5);

    // 3. 대표 이미지: 대표 이미지 칸을 눌러 파일을 고르는 1회로 센다(운영체제 파일 창 안의 선택은 세지 않는다).
    //    파일 입력은 시각적으로 숨겨진 칸이라, Playwright 권장대로 그 칸(같은 접근 이름)에 파일을 넣는다.
    await page.getByLabel('대표 이미지 추가').setInputFiles(image);
    clicks += 1; steps.push({ step: clicks, action: 'click', label: '대표 이미지 추가(파일 선택)' });
    await page.getByText('업로드 완료 · 저장 전').first().waitFor({ timeout: 60_000 });

    // 4. 고시: 카테고리 유형에 맞는 템플릿 제안 적용(없으면 '템플릿에서 가져오기'를 열어 첫 템플릿 적용)
    const hint = page.getByText(/에 맞는 템플릿이 있습니다/).first();
    await hint.waitFor({ timeout: 10_000 }).catch(() => {});
    if (await hint.isVisible().catch(() => false)) await click('고시 템플릿 제안 적용', hint.locator('xpath=..').getByRole('button', { name: /적용$/ }));
    else {
      await click('고시 템플릿 목록 열기', page.getByRole('button', { name: '템플릿에서 가져오기' }));
      await click('고시 템플릿 적용', page.getByRole('button', { name: /적용$/ }).first());
    }

    // 5. KC: 대상 아님(고르는 순간 상품 전체 해당 없음 확인이 체크된다)
    await click('KC 대상 아님', page.getByLabel('대상 아님 · 상품 전체 KC 해당 없음'));
    await shot('filled');

    // 6. 저장 후 공개
    const publish = page.getByRole('button', { name: '저장 후 공개', exact: true });
    await publish.waitFor({ state: 'visible', timeout: 15_000 });
    await click('저장 후 공개', publish);
    const outcome = await Promise.race([
      page.getByText('공개했습니다').first().waitFor({ timeout: 60_000 }).then(() => 'published'),
      page.getByText('공개하지 않았습니다').first().waitFor({ timeout: 60_000 }).then(() => 'blocked'),
      page.getByText('저장하지 못했습니다').first().waitFor({ timeout: 60_000 }).then(() => 'failed'),
    ]).catch(() => 'unknown');
    // 저장된 상품 화면(판매 준비 카드)으로 넘어간 뒤의 모습을 남긴다(세지 않음).
    await page.getByRole('heading', { name: '판매 준비' }).waitFor({ timeout: 20_000 }).catch(() => {});
    await shot(`result-${outcome}`);
    const result = { origin, clicks, limit, withinLimit: clicks <= limit, published: outcome === 'published', outcome, name, finalUrl: page.url(), steps, screenshots, pageErrors: errors };
    console.log(JSON.stringify(result, null, 2));
    if (!result.published || !result.withinLimit) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
