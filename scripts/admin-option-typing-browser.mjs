#!/usr/bin/env node
/*
 * 상품 등록·수정 화면의 옵션 칸(바코드·ERP 코드·ERP 품명·옵션 이름)이 빠른 입력에서 글자를 잃지 않는지 실제 브라우저로 본다.
 *
 *   npm run test:admin-option-typing-browser
 *
 * 왜 브라우저인가(2026-11-26, QA-B F7): 바코드 스캐너는 글자를 몇 ms 간격으로 넣는다. 13자리를 넣으면 6~12자리만 남았다.
 * 원인은 편집 폼의 `onInputCapture`(캡처 단계)에서 상태를 바꾼 것이었다 — 같은 input 이벤트의 캡처 단계와 버블 단계(onChange) 사이에
 * 브라우저가 마이크로태스크를 돌리고, React가 그 틈에 화면을 다시 그리면서 값을 상태로 들고 있는 칸을 방금 친 글자 이전 값으로 되돌렸다.
 * jsdom 같은 가짜 DOM은 이벤트를 한 번에 돌려 이 틈이 없으므로(그리고 이 저장소의 vitest에는 DOM이 없다) 단위 시험으로는 잡히지 않는다.
 *
 * 하는 일: 실제 `GoodEditor`를 서버 없이 그릴 수 있게 묶고(서버 액션·next 모듈은 빈 것으로 바꾼다) 헤드리스 Chrome에서 키를 0·5ms 간격으로 넣는다.
 * 서버·DB·로그인을 쓰지 않는다. React는 Next가 실제로 싣는 것(next/dist/compiled)을 쓴다.
 *
 * 환경 변수
 *   ADMIN_TYPING_BROWSER  Chrome 실행 파일 경로(없으면 설치된 Chrome)
 *   ADMIN_TYPING_SOURCE   견줄 다른 체크아웃의 루트(그 폴더에 node_modules가 있어야 한다). 고치기 전 코드가 실패하는지 볼 때 쓴다.
 */
import { statSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const source = path.resolve(process.env.ADMIN_TYPING_SOURCE ?? repo);
const compiled = path.join(repo, 'node_modules/next/dist/compiled');
const TEXT = '8801234567890';
const DELAYS = [0, 5];
/** [옵션 개수, 입력할 칸의 이름들]. 옵션이 여럿이면 옵션목록의 이름 칸도 본다. */
const SCENARIOS = [
  [1, ['옵션 1 바코드', '옵션 1 ERP 코드', '옵션 1 ERP 품명', '옵션 이름']],
  [60, ['옵션 1 바코드', '옵션 1 ERP 코드', '옵션 1 ERP 품명', '옵션 1 이름']],
];

/* 번들러는 vite가 싣고 오는 rolldown을 쓴다(따로 설치하지 않는다). */
const require = createRequire(import.meta.url);
const rolldownEntry = createRequire(require.resolve('vite/package.json')).resolve('rolldown');
const rolldownModule = await import(pathToFileURL(rolldownEntry).href);
const rolldown = rolldownModule.rolldown ?? rolldownModule.default.rolldown;

const VIRTUAL = {
  'next/link': `import { createElement } from 'react'; export default function Link({ href, children, prefetch, replace, scroll, ...props }) { return createElement('a', { href: typeof href === 'string' ? href : '#', ...props }, children); }`,
  'next/image': `import { createElement } from 'react'; export default function Image({ src, alt, fill, priority, ...props }) { return createElement('img', { src: typeof src === 'string' ? src : '', alt: alt ?? '', ...props }); }`,
  'next/navigation': `const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
    export const useRouter = () => router; export const usePathname = () => '/admin/catalog/goods'; export const useSearchParams = () => new URLSearchParams(); export const useParams = () => ({});
    export const redirect = () => { throw new Error('redirect'); }; export const notFound = () => { throw new Error('notFound'); }; export const unstable_rethrow = () => {};`,
  '@/lib/supabase/client': `export const createClient = () => ({ auth: { getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    storage: { from: () => ({ upload: async () => ({ error: { message: 'stub' } }) }) }, rpc: async () => ({ data: null, error: { message: 'stub' } }) });`,
  'server-only': 'export {};', 'next/cache': 'export {};', 'next/headers': 'export {};',
};
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '/index.ts', '/index.tsx'];
const isFile = (candidate) => { try { return statSync(candidate).isFile(); } catch { return false; } };
const stubs = {
  name: 'admin-option-typing-stubs',
  resolveId(id) {
    if (id in VIRTUAL) return `\0typing:${id}`;
    if (id.endsWith('.css')) return '\0typing:server-only';
    if (!id.startsWith('@/')) return null;
    const base = path.join(source, id.slice(2));
    return ['', ...EXTENSIONS].map((extension) => base + extension).find(isFile) ?? null;
  },
  load(id) { return id.startsWith('\0typing:') ? VIRTUAL[id.slice('\0typing:'.length)] : null; },
  /* 'use server' 파일(서버 액션)은 브라우저에서 못 돌린다. 내보낸 이름마다 실패를 돌려주는 빈 함수로 바꾼다. */
  transform(code, id) {
    if (!id.startsWith(source) || id.includes('node_modules')) return null;
    if (!/^['"]use server['"]/.test(code.replace(/^\s*(\/\*[\s\S]*?\*\/\s*|\/\/.*\n\s*)*/, ''))) return null;
    const names = new Set([...code.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g), ...code.matchAll(/export\s+const\s+([A-Za-z0-9_$]+)/g)].map((match) => match[1]));
    return { code: [...names].map((name) => `export const ${name} = async () => ({ ok: false, error: 'stub:${name}' });`).join('\n'), map: null };
  },
};

const HARNESS = `
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { GoodEditor } from '@/components/admin/GoodEditor';
import { GoodWorkspaceProvider } from '@/components/admin/GoodWorkspace';
import { CartProvider } from '@/components/shell/CartProvider';
import { AuthPresenceProvider } from '@/components/shell/AuthPresenceProvider';
import { StaffPreviewAvailabilityProvider } from '@/components/shell/StaffPreviewAvailability';
const props = { accountId: '00000000-0000-4000-8000-000000000001', action() {}, catalogIps: [], ipOptions: [{ id: 'ip-1', title: 'IP', archivedAt: null }], pending: false, selected: null, state: {},
  variants: [], origins: [{ id: 'origin-1', name: '출고지', baseFee: 3000, freeThreshold: 50000, isDefault: true, active: true }], categories: [], shippingNoticeOptions: [], regionSummaries: [] };
createRoot(document.getElementById('root')).render(h(CartProvider, null, h(AuthPresenceProvider, null, h(StaffPreviewAvailabilityProvider, null, h(GoodWorkspaceProvider, null, h(GoodEditor, props))))));
`;

async function bundle(directory) {
  const entry = path.join(directory, 'harness.jsx');
  await writeFile(entry, HARNESS);
  const build = await rolldown({
    input: entry, platform: 'browser', plugins: [stubs], logLevel: 'silent',
    resolve: { alias: {
      'react-dom/client': path.join(compiled, 'react-dom/client.js'), 'react-dom/server': path.join(compiled, 'react-dom/server.browser.js'), 'react-dom': path.join(compiled, 'react-dom/index.js'),
      'react/jsx-runtime': path.join(compiled, 'react/jsx-runtime.js'), 'react/jsx-dev-runtime': path.join(compiled, 'react/jsx-dev-runtime.js'), react: path.join(compiled, 'react/index.js'), scheduler: path.join(compiled, 'scheduler/index.js'),
    } },
    transform: { define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_SUPABASE_URL': 'undefined', 'process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY': 'undefined', 'process.env': '{}' }, jsx: { runtime: 'automatic' } },
  });
  await build.write({ file: path.join(directory, 'harness.js'), format: 'iife' });
  await writeFile(path.join(directory, 'index.html'), '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>option typing</title></head><body><div id="root"></div><script src="./harness.js"></script></body></html>');
  return pathToFileURL(path.join(directory, 'index.html')).href;
}

const openAll = () => document.querySelectorAll('details').forEach((details) => { details.open = true; });

async function type(browser, url, options, label, delay) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error).slice(0, 200)));
  try {
    await page.goto(url);
    await page.locator('[data-option-editor]').waitFor({ timeout: 15_000 }).catch(() => { throw new Error(`상품 편집 화면이 뜨지 않았습니다. ${errors[0] ?? '화면 오류는 없었습니다.'}`); });
    await page.evaluate(openAll);
    if (options > 1) {
      /* 준비 단계는 입력 사이를 넉넉히 띄운다 — 여기서 보는 것은 아래의 빠른 입력이다. */
      const pause = () => page.waitForTimeout(300);
      await page.getByText('옵션 있음', { exact: true }).first().click(); await pause();
      await page.locator('#option-axis-0').fill('색상'); await pause();
      await page.locator('#option-values-0').fill(Array.from({ length: 10 }, (_, index) => `색${index + 1}`).join(', ')); await pause();
      await page.locator('#option-axis-1').fill('크기'); await pause();
      await page.locator('#option-values-1').fill(Array.from({ length: options / 10 }, (_, index) => `크${index + 1}`).join(', ')); await pause();
      await page.locator('[data-good-option-create]').click(); await pause();
      await page.evaluate(openAll);
    }
    const input = page.getByLabel(label, { exact: true }).first();
    const before = await input.inputValue();
    await input.focus();
    await input.evaluate((node) => node.setSelectionRange(node.value.length, node.value.length));
    await page.keyboard.type(TEXT, { delay });
    await page.waitForTimeout(500);
    return { typed: (await input.inputValue()).slice(before.length), errors };
  } finally { await page.close(); }
}

const directory = await mkdtemp(path.join(tmpdir(), 'admin-option-typing-'));
let browser;
let failed = 0;
try {
  const url = await bundle(directory);
  browser = await chromium.launch(process.env.ADMIN_TYPING_BROWSER ? { headless: true, executablePath: process.env.ADMIN_TYPING_BROWSER } : { headless: true, channel: 'chrome' });
  for (const [options, labels] of SCENARIOS) for (const label of labels) for (const delay of DELAYS) {
    const { typed, errors } = await type(browser, url, options, label, delay);
    const ok = typed === TEXT && !errors.length;
    if (!ok) failed += 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'} 옵션 ${String(options).padStart(2)}개 · ${label} · ${delay}ms 간격 → ${JSON.stringify(typed)} (${typed.length}/${TEXT.length})${errors.length ? ` · 화면 오류: ${errors[0]}` : ''}`);
  }
} finally {
  await browser?.close();
  await rm(directory, { recursive: true, force: true });
}
if (failed) { console.error(`\n${failed}건에서 글자가 빠졌습니다. 편집 폼의 캡처 단계 핸들러(on*Capture)에서 상태를 바꾸는 곳이 있는지 먼저 봅니다(components/admin/GoodEditor.tsx).`); process.exit(1); }
console.log(`\n${TEXT.length}자리가 모두 들어갔습니다(소스: ${source === repo ? '이 체크아웃' : source}).`);
