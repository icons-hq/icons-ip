import { access, chmod, mkdir, mkdtemp, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { measureAdminLayout } from './admin-visual-qa-measure.mjs';
import { ADMIN_QA_ROUTES, ADMIN_QA_VIEWPORTS } from './admin-visual-qa-manifest.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isInside = (parent, target) => { const part = relative(parent, target); return part === '' || (!part.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && part !== '..' && !isAbsolute(part)); };
const loopback = (hostname) => ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(hostname);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const safeError = (value) => String(value).replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/g, '$1?[redacted]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 1200);

export async function prepareOutputDirectory(output) {
  const requested = resolve(output);
  const repository = await realpath(repoRoot);
  const refuseRepository = (path) => {
    if (isInside(repoRoot, path) || isInside(repository, path)) throw new Error('QA screenshots and evidence must be outside the repository.');
  };
  refuseRepository(requested);
  await mkdir(requested, { recursive: true, mode: 0o700 });
  const outputPath = await realpath(requested);
  refuseRepository(outputPath);
  // Never change permissions on an arbitrary existing caller-owned directory.
  if (((await stat(outputPath)).mode & 0o077) !== 0) throw new Error('Output directory must be private (mode 0700); choose a new dedicated directory.');
  return outputPath;
}

export async function browserExecutable() {
  const configured = process.env.ADMIN_QA_BROWSER_EXECUTABLE;
  if (configured) { await access(configured); return configured; }
  for (const path of [chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    try { await access(path); return path; } catch { /* Try another installed browser; never install one. */ }
  }
  throw new Error('No installed Chromium found. Set ADMIN_QA_BROWSER_EXECUTABLE to an existing Chrome/Chromium executable.');
}

function argsFrom(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (['--allow-remote-read-only', '--allow-partial-coverage', '--help'].includes(key)) result[key.slice(2)] = true;
    else if (['--origin', '--manifest', '--snapshot-manifest', '--output', '--routes', '--widths', '--timeout'].includes(key)) {
      if (!argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(`Missing value for ${key}`);
      result[key.slice(2)] = argv[++index];
    } else throw new Error(`Unknown option: ${key}`);
  }
  if (result.manifest && result['snapshot-manifest']) throw new Error('Use either --manifest or --snapshot-manifest.');
  return result;
}

export async function loadRunConfig(argv = process.argv.slice(2)) {
  const args = argsFrom(argv);
  if (args.help) return { help: true };
  const manifestPath = args['snapshot-manifest'] || args.manifest;
  const manifest = manifestPath ? JSON.parse(await readFile(resolve(manifestPath), 'utf8')) : { routes: ADMIN_QA_ROUTES };
  const mode = args['snapshot-manifest'] ? 'captured-layout' : (manifest.evidenceMode || 'live-read-only');
  if (!['captured-layout', 'captured-components', 'live-read-only'].includes(mode) || (mode === 'captured-layout' && !args['snapshot-manifest'])) throw new Error('Invalid evidenceMode; captured-layout requires --snapshot-manifest.');
  if (!Array.isArray(manifest.routes) || !manifest.routes.length) throw new Error('Manifest requires a nonempty routes array.');
  const routeIds = new Set();
  for (const route of manifest.routes) {
    if (!route.id || !/^[a-zA-Z0-9_-]+$/.test(route.id) || routeIds.has(route.id)) throw new Error(`Invalid or duplicate route id: ${route.id}`);
    routeIds.add(route.id);
    if (typeof route.path !== 'string' || !/^\/admin(?:\/|\?|$)/.test(route.path) || route.path.includes('#') || !/^\/admin(?:\/|$)/.test(new URL(route.path, 'http://localhost').pathname)) throw new Error(`Expected an admin path: ${route.id}`);
    if (!(typeof route.heading === 'string' && route.heading.trim()) && !(Array.isArray(route.heading) && route.heading.length && route.heading.every((heading) => typeof heading === 'string' && heading.trim()))) throw new Error(`Exact expected heading required: ${route.id}`);
    if (mode === 'captured-layout' && !route.htmlFile) throw new Error(`htmlFile required: ${route.id}`);
    if (mode === 'captured-components' && (typeof route.sourcePath !== 'string' || !/^\/admin(?:\/|\?|$)/.test(route.sourcePath) || !/^\/admin(?:\/|$)/.test(new URL(route.sourcePath, 'http://localhost').pathname) || typeof route.readySelector !== 'string' || !route.readySelector.trim())) throw new Error(`captured-components requires sourcePath and readySelector: ${route.id}`);
    if (route.viewportQuery !== undefined && (typeof route.viewportQuery !== 'string' || !/^[a-z][a-z0-9_-]*$/i.test(route.viewportQuery))) throw new Error(`Invalid viewportQuery: ${route.id}`);
    if (route.htmlFilesByWidth && (typeof route.htmlFilesByWidth !== 'object' || Array.isArray(route.htmlFilesByWidth) || Object.entries(route.htmlFilesByWidth).some(([width, file]) => !/^\d+$/.test(width) || Number(width) < 240 || Number(width) > 3840 || typeof file !== 'string' || !file))) throw new Error(`Invalid htmlFilesByWidth: ${route.id}`);
  }
  const selected = args.routes ? args.routes.split(',').filter(Boolean) : [...routeIds];
  if (!selected.length || new Set(selected).size !== selected.length || selected.some((id) => !routeIds.has(id))) throw new Error('--routes must name existing, unique manifest IDs.');
  const routes = manifest.routes.filter((route) => selected.includes(route.id));
  const widths = args.widths?.split(',').map(Number);
  const viewports = widths ? widths.map((width) => ({ width, height: ADMIN_QA_VIEWPORTS.find((viewport) => viewport.width === width)?.height || 900 })) : (manifest.viewports || ADMIN_QA_VIEWPORTS);
  if (!viewports.length || viewports.some((viewport) => !Number.isInteger(viewport.width) || viewport.width < 240 || viewport.width > 3840 || !Number.isInteger(viewport.height) || viewport.height < 400 || viewport.height > 2160)) throw new Error('Invalid viewport dimensions.');
  if (new Set(viewports.map((viewport) => `${viewport.width}x${viewport.height}`)).size !== viewports.length) throw new Error('Duplicate viewport dimensions.');
  const originUrl = new URL(args.origin || process.env.ADMIN_QA_ORIGIN || 'http://127.0.0.1:3000');
  if (!['http:', 'https:'].includes(originUrl.protocol) || originUrl.username || originUrl.password || originUrl.pathname !== '/' || originUrl.search || originUrl.hash) throw new Error('--origin must be an HTTP(S) origin without a path, credentials, query, or fragment.');
  if (mode === 'live-read-only' && !loopback(originUrl.hostname) && !args['allow-remote-read-only']) throw new Error('Remote origins require --allow-remote-read-only.');
  if (mode === 'captured-components' && !loopback(originUrl.hostname)) throw new Error('captured-components requires a loopback origin.');
  if (mode === 'captured-layout' && (args.origin || process.env.ADMIN_QA_ORIGIN)) throw new Error('Snapshot mode owns its isolated loopback server; do not set an origin.');
  if (mode !== 'live-read-only' && process.env.ADMIN_QA_STORAGE_STATE) throw new Error('Captured evidence modes must not receive authentication state.');
  const timeout = Number(args.timeout || 15000);
  if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 60000) throw new Error('--timeout must be between 1000 and 60000 ms.');
  const output = args.output || process.env.ADMIN_QA_OUTPUT_DIR || await mkdtemp(join(tmpdir(), 'icons-admin-visual-qa-'));
  const outputPath = await prepareOutputDirectory(output);
  return { mode, routes, allRoutes: manifest.routes, manifest, manifestPath: manifestPath ? resolve(manifestPath) : null, viewports, timeout, output: outputPath, origin: originUrl.origin, allowPartial: Boolean(args['allow-partial-coverage']), storageState: process.env.ADMIN_QA_STORAGE_STATE || undefined };
}

export async function startSnapshotServer(config) {
  const root = await realpath(dirname(config.manifestPath));
  const htmlByPath = new Map();
  const sources = [];
  const assets = new Map();
  for (const route of config.routes) {
    for (const [width, file] of [['default', route.htmlFile], ...Object.entries(route.htmlFilesByWidth || {})]) {
      const path = await realpath(resolve(root, file));
      if (!isInside(root, path)) throw new Error(`Snapshot htmlFile must stay inside its manifest directory: ${route.id}`);
      const html = await readFile(path);
      htmlByPath.set(`/__snapshot/${route.id}${width === 'default' ? '' : `/${width}`}`, html);
      sources.push({ id: route.id, path: route.path, viewportWidth: width === 'default' ? null : Number(width), htmlFile: basename(path), sha256: hash(html), capturedAt: route.capturedAt || config.manifest.capturedAt || null });
    }
  }
  const server = createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
    response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; script-src 'none'; connect-src 'none'; form-action 'none'; frame-src 'none'; base-uri 'none'");
    response.setHeader('Cache-Control', 'no-store');
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      if (htmlByPath.has(pathname)) { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(request.method === 'HEAD' ? undefined : htmlByPath.get(pathname)); return; }
      // Only inert local assets next to the supplied snapshot are served.
      if (!['.css', '.woff', '.woff2', '.ttf', '.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.svg'].includes(extname(pathname))) { response.writeHead(404); response.end(); return; }
      const assetPath = await realpath(resolve(root, `.${pathname}`));
      if (!isInside(root, assetPath)) { response.writeHead(403); response.end(); return; }
      const mime = { '.css': 'text/css', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif' };
      const bytes = await readFile(assetPath);
      assets.set(pathname, { path: pathname, sha256: hash(bytes), bytes: bytes.length });
      response.writeHead(200, { 'Content-Type': mime[extname(assetPath)] }); response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
  return { origin: `http://127.0.0.1:${server.address().port}`, sources, assets, close: () => new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())) };
}

async function sourceRoutes(folder = join(repoRoot, 'app/admin'), pieces = ['admin']) {
  const routes = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.isDirectory()) routes.push(...await sourceRoutes(join(folder, entry.name), entry.name.startsWith('(') ? pieces : [...pieces, entry.name]));
    else if (entry.name === 'page.tsx') routes.push(`/${pieces.join('/')}`);
  }
  return routes.sort();
}

function matchesTemplate(path, template) {
  const expected = template.split('/'); const actual = new URL(path, 'http://localhost').pathname.split('/');
  return expected.length === actual.length && expected.every((part, index) => /^\[[^\]]+\]$/.test(part) ? actual[index].length > 0 : part === actual[index]);
}

async function writeEvidence(path, value) { await writeFile(path, value, { mode: 0o600 }); }

export async function runAdminVisualQa(config) {
  const results = []; let browser; let snapshot;
  const sources = [];
  try {
    if (config.mode === 'captured-layout') { snapshot = await startSnapshotServer(config); config.origin = snapshot.origin; sources.push(...snapshot.sources); }
    browser = await chromium.launch({ executablePath: await browserExecutable(), headless: true });
    for (const route of config.routes) for (const viewport of config.viewports) {
      const name = `${route.id}-${viewport.width}x${viewport.height}`;
      const result = { id: route.id, path: route.path, sourcePath: config.mode === 'captured-components' ? route.sourcePath : route.path, actualUrl: null, mode: config.mode, viewport, status: 'error', findings: [], console: [], blockedRequests: [], failedResources: [] };
      let context;
      try {
        context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', javaScriptEnabled: config.mode !== 'captured-layout', storageState: config.storageState, acceptDownloads: false });
        await context.route('**/*', async (intercept) => {
          const request = intercept.request(); const target = new URL(request.url());
          if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || (config.mode !== 'live-read-only' && !['data:', 'blob:'].includes(target.protocol) && target.origin !== config.origin)) {
            result.blockedRequests.push({ method: request.method(), resourceType: request.resourceType(), url: `${target.origin}${target.pathname}` }); await intercept.abort('blockedbyclient'); return;
          }
          await intercept.continue();
        });
        if (typeof context.routeWebSocket === 'function') await context.routeWebSocket('**/*', (socket) => socket.close());
        const page = await context.newPage(); page.setDefaultTimeout(config.timeout);
        page.on('pageerror', (error) => result.console.push({ level: 'pageerror', message: safeError(error.message) }));
        page.on('console', (message) => { if (['warning', 'error'].includes(message.type())) result.console.push({ level: message.type(), message: safeError(message.text()) }); });
        page.on('response', (response) => { if (response.status() >= 400) result.failedResources.push({ status: response.status(), url: safeError(response.url()), type: response.request().resourceType() }); });
        const snapshotWidth = route.htmlFilesByWidth?.[String(viewport.width)] ? `/${viewport.width}` : '';
        const targetUrl = new URL(config.mode === 'captured-layout' ? `${config.origin}/__snapshot/${route.id}${snapshotWidth}` : `${config.origin}${route.path}`);
        if (route.viewportQuery) targetUrl.searchParams.set(route.viewportQuery, String(viewport.width));
        const url = targetUrl.href;
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.timeout });
        result.actualUrl = page.url();
        result.httpStatus = response?.status() ?? null;
        await page.waitForLoadState('load', { timeout: config.timeout });
        if (route.readySelector) await page.locator(route.readySelector).waitFor({ state: 'visible', timeout: config.timeout });
        if (new URL(page.url()).pathname === new URL(url).pathname && result.httpStatus < 400) await page.locator(route.rootSelector || '.wc-admin').waitFor({ state: 'visible', timeout: config.timeout }).catch(() => {});
        // Disabled page JS must never await an in-page timer/rAF/promise: Chrome
        // can discard that execution context. Poll font status from Node instead.
        const fontDeadline = Date.now() + config.timeout;
        while (await page.evaluate(() => document.fonts.status) !== 'loaded') {
          if (Date.now() >= fontDeadline) throw new Error('Fonts did not become ready within timeout.');
          await page.waitForTimeout(50);
        }
        result.measurement = await page.evaluate(measureAdminLayout, route);
        result.findings.push(...result.measurement.findings);
        if (!response || response.status() >= 400) result.findings.push({ code: 'http-status', severity: 'error', message: `Navigation response: ${result.httpStatus}` });
        const actual = new URL(page.url()); const expected = new URL(url);
        result.actualUrl = page.url();
        if (actual.origin !== expected.origin || actual.pathname !== expected.pathname || actual.search !== expected.search) result.findings.push({ code: 'identity-url', severity: 'error', message: 'Navigation did not stay on the exact requested route and query.', expected: `${expected.origin}${expected.pathname}${expected.search}`, actual: safeError(page.url()) });
        if (result.console.some((entry) => ['pageerror', 'error'].includes(entry.level))) result.findings.push({ code: 'console-error', severity: 'error', message: 'Browser console contains errors; inspect the recorded messages.' });
        if (result.failedResources.length) result.findings.push({ code: 'resource-error', severity: 'error', message: 'Requested resources returned HTTP errors.' });
        if (result.blockedRequests.length) result.findings.push({ code: 'read-only-request-blocked', severity: 'error', message: 'Requests were blocked by the read-only/replay guard. Coverage is incomplete.' });
        result.screenshot = `${name}.png`;
        await page.screenshot({ path: join(config.output, result.screenshot), fullPage: true, animations: 'disabled', timeout: config.timeout });
        await chmod(join(config.output, result.screenshot), 0o600);
        result.screenshotSha256 = hash(await readFile(join(config.output, result.screenshot)));
        result.status = result.findings.some((finding) => finding.severity === 'error') ? 'fail' : 'pass';
      } catch (error) { result.error = safeError(error.stack || error); result.status = 'error'; }
      finally { await context?.close(); }
      results.push(result);
      await writeEvidence(join(config.output, `${name}.json`), `${JSON.stringify(result, null, 2)}\n`);
      console.log(`${result.status.toUpperCase()} ${config.mode} ${route.id} ${viewport.width}x${viewport.height} findings=${result.findings.length}`);
    }
  } finally { await browser?.close(); await snapshot?.close(); }
  const templates = await sourceRoutes();
  const coveragePath = (route) => config.mode === 'captured-components' ? route.sourcePath : route.path;
  const attemptedTemplates = templates.filter((template) => config.routes.some((route) => matchesTemplate(coveragePath(route), template)));
  const inspectedRoutes = config.routes.filter((route) => {
    const captures = results.filter((result) => result.id === route.id);
    return captures.length === config.viewports.length && captures.every((result) => result.screenshot && result.measurement && !result.findings.some((finding) => finding.code.startsWith('identity-') || ['http-status', 'resource-error', 'read-only-request-blocked', 'console-error'].includes(finding.code)));
  });
  const coveredTemplates = templates.filter((template) => inspectedRoutes.some((route) => matchesTemplate(coveragePath(route), template)));
  const uncoveredTemplates = templates.filter((template) => !coveredTemplates.includes(template));
  const unselected = config.allRoutes.filter((route) => !config.routes.some((selected) => selected.id === route.id)).map((route) => route.id);
  const missingViewports = ADMIN_QA_VIEWPORTS.filter((viewport) => !config.viewports.some((selected) => selected.width === viewport.width)).map((viewport) => viewport.width);
  const incomplete = uncoveredTemplates.length > 0 || unselected.length > 0 || missingViewports.length > 0;
  const failed = results.some((result) => result.status !== 'pass');
  const report = {
    schemaVersion: 1, generatedAt: new Date().toISOString(), mode: config.mode,
    verdict: failed ? 'fail' : incomplete ? (config.allowPartial ? 'scoped-pass' : 'incomplete') : 'pass',
    origin: config.origin, manifest: config.manifestPath ? basename(config.manifestPath) : 'repository-default',
    sources, snapshotAssets: snapshot ? [...snapshot.assets.values()] : [], requestedScreens: config.routes.length, requestedCaptures: config.routes.length * config.viewports.length,
    completedCaptures: results.length, coverage: { basis: config.mode === 'captured-components' ? 'captured-source-templates-only' : config.mode, attemptedTemplates, coveredTemplates, uncoveredTemplates, unselected, missingViewports, partialCoverageExplicitlyAllowed: config.allowPartial },
    limitations: config.mode === 'captured-layout'
      ? ['Captured DOM with current supplied CSS only. No live authentication, React hydration, data fetching, clicks, forms, focus transitions, or permission checks were validated.', 'Screenshots still require human/model visual review; geometry is not a design-quality verdict.']
      : config.mode === 'captured-components'
      ? ['Captured DOM, current CSS, and the actual AdminSelect React component only. This is not a full Next.js route, authentication, permission, data-fetching, or form-mutation test.', 'Coverage refers only to captured source route templates. The actual local replay URL is recorded separately; screenshots still require visual review.']
      : ['Read-only navigation and rendered geometry only. No forms, actions, downloads, authentication bootstrap, or data mutation are exercised.', 'Screenshots still require human/model visual review; geometry is not a design-quality verdict.'],
    results,
  };
  const cell = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
  const markdown = [
    '# Admin visual QA', '', `- Verdict: **${report.verdict}**`, `- Evidence mode: **${report.mode}**`, `- Origin: ${report.origin}`,
    `- Captures: ${report.completedCaptures}/${report.requestedCaptures}`, `- Generated: ${report.generatedAt}`, '',
    ...report.limitations.map((entry) => `- ${entry}`), '',
    '| Source route | Actual URL | Viewport | Status | Findings | Screenshot |', '| --- | --- | --- | --- | --- | --- |',
    ...results.map((result) => `| ${cell(result.sourcePath)} | ${cell(result.actualUrl || 'not reached')} | ${result.viewport.width}×${result.viewport.height} | ${result.status} | ${cell(result.findings.map((entry) => entry.code).join(', ') || result.error || '0')} | ${result.screenshot ? `[image](${result.screenshot})` : 'missing'} |`),
    '', '## Coverage not established', '',
    `- Uncovered route templates: ${uncoveredTemplates.join(', ') || 'none'}`,
    `- Unselected manifest states: ${unselected.join(', ') || 'none'}`,
    `- Missing standard viewport widths: ${missingViewports.join(', ') || 'none'}`, '',
  ].join('\n');
  await writeEvidence(join(config.output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeEvidence(join(config.output, 'report.md'), markdown);
  return { report, exitCode: failed ? 1 : incomplete && !config.allowPartial ? 2 : 0 };
}

async function main() {
  const config = await loadRunConfig();
  if (config.help) { console.log('node scripts/admin-visual-qa.mjs [--origin http://127.0.0.1:3000] [--manifest /external/routes.json | --snapshot-manifest /external/captures.json] [--routes id,id] [--widths 1440,1280,1024,768,390,320] [--output /external/evidence] [--allow-remote-read-only] [--allow-partial-coverage]\nAuth: ADMIN_QA_STORAGE_STATE=/external/storage-state.json; Browser: ADMIN_QA_BROWSER_EXECUTABLE=/installed/chrome'); return; }
  const result = await runAdminVisualQa(config);
  console.log(`Verdict: ${result.report.verdict}; evidence: ${config.output}`);
  process.exitCode = result.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((error) => { console.error(safeError(error.stack || error)); process.exitCode = 1; });
