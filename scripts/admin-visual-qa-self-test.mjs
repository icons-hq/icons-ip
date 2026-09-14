import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
import { measureAdminLayout } from './admin-visual-qa-measure.mjs';
import { browserExecutable, loadRunConfig, prepareOutputDirectory, runAdminVisualQa, startSnapshotServer } from './admin-visual-qa.mjs';

// These are deliberately independent rendering examples, not copies of the
// detector's arithmetic or string contracts. No live app/auth/DB is involved.
delete process.env.ADMIN_QA_ORIGIN;
delete process.env.ADMIN_QA_STORAGE_STATE;
delete process.env.ADMIN_QA_OUTPUT_DIR;
const output = await mkdtemp(join(tmpdir(), 'icons-admin-qa-self-test-'));
const css = `*{box-sizing:border-box} body{margin:0;font:14px/1.5 Arial,sans-serif} main{padding:16px} h1{font-size:22px} label{display:block} input,select,textarea,button{font:inherit;min-height:44px;padding:8px 12px;border:1px solid #888} input,textarea{width:240px;max-width:100%} button{display:block;margin-top:12px} .field{margin-bottom:16px} .table-scroll{overflow-x:auto;width:100%} table{width:650px} th,td{text-align:left;padding:12px}`;
const body = `<div class="wc-admin"><main class="admin-content"><h1>검사 예제</h1><p>실제 브라우저에서 폼과 목록의 배치를 검사하는 독립 예제입니다.</p><div class="field"><label for="title">상품명</label><input id="title" value="PRIVATE-SENTINEL" /></div><button type="button">검색 조건 적용</button></main></div>`;
const html = (extraCss = '', extraBody = '', baseBody = body) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>Admin QA example</title><style>${css}${extraCss}</style></head><body>${baseBody}${extraBody}</body></html>`;
const checks = [];
let browser;
async function check(name, work) { await work(); checks.push(name); console.log(`PASS ${name}`); }
try {
  browser = await chromium.launch({ executablePath: await browserExecutable(), headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const measure = async (markup) => { await page.setContent(markup); return page.evaluate(measureAdminLayout, { heading: '검사 예제' }); };
  await check('healthy Korean form passes and does not log input values', async () => {
    const result = await measure(html()); assert.deepEqual(result.findings, []); assert.equal(result.identity.headingMatched, true); assert.equal(JSON.stringify(result).includes('PRIVATE-SENTINEL'), false);
  });
  await check('narrow text input is detected without page overflow', async () => {
    const result = await measure(html('input{width:44px}')); assert.ok(result.findings.some((finding) => finding.code === 'field-narrow')); assert.ok(!result.findings.some((finding) => finding.code === 'document-overflow'));
  });
  await check('native select selected label clipping is detected', async () => {
    const result = await measure(html('', '', body.replace('<button', '<select style="width:84px"><option>배송 준비가 완료된 주문</option></select><button'))); assert.ok(result.findings.some((finding) => finding.code === 'control-text-clipped'));
  });
  const selectedLabel = '배송 준비가 완료된 주문의 전체 선택값';
  const selectWithHint = (hintStyle = '', hintText = selectedLabel, attributes = 'aria-describedby="other-description full-value"') => `<div style="position:relative"><select id="described-select" style="width:120px" ${attributes}><option>${selectedLabel}</option></select><p id="other-description" hidden>다른 설명</p><p id="full-value" style="margin:6px 0 0;max-width:280px;${hintStyle}">${hintText}</p></div>`;
  await check('complete adjacent described select value is readable evidence, not a clipping error', async () => {
    const result = await measure(html('', '', body.replace('</main>', `${selectWithHint()}</main>`)));
    assert.equal(result.fullValueHints.length, 1); assert.equal(result.counts.fullValueHints, 1);
    assert.equal(result.fullValueHints[0].hintSelector, 'p#full-value');
    assert.ok(result.findings.some((finding) => finding.code === 'select-full-value-readable' && finding.severity === 'info'));
    assert.ok(!result.findings.some((finding) => finding.code === 'control-text-clipped'));
  });
  await check('complete described value below the document fold remains readable by scrolling', async () => {
    const result = await measure(html('html,body{height:100%;overflow-y:auto;overflow-x:hidden}', '', body.replace('</main>', `<div style="height:1100px"></div>${selectWithHint()}</main>`)));
    assert.equal(result.fullValueHints.length, 1);
    assert.ok(result.fullValueHints[0].hintRect.top > 844);
    assert.ok(!result.findings.some((finding) => finding.code === 'control-text-clipped'));
  });
  await check('internal vertical auto and hidden scrollports still reject clipped described values', async () => {
    for (const overflow of ['auto', 'hidden']) {
      const markup = `<div style="height:56px;overflow-y:${overflow}">${selectWithHint()}</div>`;
      const result = await measure(html('', '', body.replace('</main>', `${markup}</main>`)));
      assert.equal(result.fullValueHints.length, 0, overflow);
      assert.ok(result.findings.some((finding) => finding.code === 'control-text-clipped'), overflow);
    }
  });
  await check('hidden, clipped, unrelated, far, title-only, or covered select hints cannot bypass clipping', async () => {
    const cases = [
      ['hidden', selectWithHint('display:none')], ['clipped', selectWithHint('width:80px;white-space:nowrap;overflow:hidden')],
      ['wrong text', selectWithHint('', '선택값이 아닌 다른 설명')], ['far', selectWithHint('margin-top:100px')],
      ['title only', selectWithHint('display:none', selectedLabel, `title="${selectedLabel}"`)],
      ['covered', selectWithHint().replace('</div>', '<div style="position:absolute;inset:44px 0 0;background:white;z-index:5"></div></div>')],
    ];
    for (const [name, markup] of cases) {
      const result = await measure(html('', '', body.replace('</main>', `${markup}</main>`)));
      assert.equal(result.fullValueHints.length, 0, name);
      assert.ok(result.findings.some((finding) => finding.code === 'control-text-clipped'), name);
    }
  });
  await check('button label clipping is detected', async () => {
    const result = await measure(html('button{width:42px;white-space:nowrap;overflow:hidden}')); assert.ok(result.findings.some((finding) => finding.code === 'control-text-clipped'));
  });
  await check('body overflow is detected', async () => {
    const result = await measure(html('.admin-content{width:900px}')); assert.ok(result.findings.some((finding) => finding.code === 'document-overflow'));
  });
  await check('ancestor clipping is detected even with overflow-x hidden body', async () => {
    const result = await measure(html('body{overflow-x:hidden}.field{width:80px;overflow:hidden}input{max-width:none;width:240px}')); assert.ok(result.findings.some((finding) => finding.code === 'control-parent-clipped'));
  });
  await check('two separate overlapping actions are detected', async () => {
    const result = await measure(html('button{position:absolute;top:220px;left:16px}', '', body.replace('</main>', '<button type="button">상세 보기</button></main>'))); assert.ok(result.findings.some((finding) => finding.code === 'control-collision'));
  });
  await check('intentional table scrolling is recorded without false page overflow', async () => {
    const result = await measure(html('', '', body.replace('</main>', '<div class="table-scroll"><table><tr><th>상품명</th><th>상품코드</th><th>배송 상태</th></tr><tr><td>검수 상품</td><td>SKU-12345</td><td>배송 준비</td></tr></table></div></main>'))); assert.deepEqual(result.findings, []); assert.equal(result.intentionalScrollers.length, 1); assert.equal(result.intentionalScrollers[0].containsTable, true);
  });
  await check('long editable input values are not mistaken for clipped action text', async () => {
    const result = await measure(html('', '', body.replace('PRIVATE-SENTINEL', '매우긴상품이름'.repeat(15)))); assert.deepEqual(result.findings, []);
  });
  await check('closed disclosure fields are excluded but become measurable when open', async () => {
    const disclosure = '<details><summary>상품 등록 폼 펼치기</summary><label for="inside">내부 상품명</label><input id="inside" style="width:40px" /></details>';
    const closed = await measure(html('', '', body.replace('</main>', `${disclosure}</main>`)));
    assert.deepEqual(closed.findings, []); assert.equal(closed.controls.some((control) => control.selector.includes('#inside')), false);
    const opened = await measure(html('', '', body.replace('</main>', `${disclosure.replace('<details>', '<details open>')}</main>`)));
    assert.ok(opened.findings.some((finding) => finding.code === 'field-narrow' && finding.selector.includes('#inside')));
  });
  await check('embedded storefront quantity preserves its own size contract', async () => {
    const preview = '<div class="wc-pdp is-embedded"><input class="wc-stepper__input" type="number" value="1" style="width:28px;height:30px;min-height:30px;padding:0" /></div>';
    const result = await measure(html('', '', body.replace('</main>', `${preview}</main>`)));
    assert.deepEqual(result.findings, []);
  });
  await check('short search placeholder clipping is detected before any value is entered', async () => {
    const result = await measure(html('', '', body.replace('value="PRIVATE-SENTINEL"', 'type="search" value="" placeholder="상품명·상품코드 검색" style="width:140px"')));
    assert.ok(result.findings.some((finding) => finding.code === 'search-placeholder-clipped' && finding.severity === 'error'));
  });
  await check('offscreen scroll-list row cannot collide with the form below', async () => {
    const list = '<div style="height:50px;overflow:auto"><div style="height:150px"><button id="hidden-row" style="position:relative;top:50px">스크롤 안의 행</button></div></div><button id="below-scroll">스크롤 아래 폼</button>';
    const result = await measure(html('', '', body.replace('</main>', `${list}</main>`)));
    assert.ok(result.controls.some((control) => control.selector.includes('#hidden-row')), 'Offscreen row must remain available for width measurements.');
    assert.ok(!result.findings.some((finding) => finding.code === 'control-collision'));
  });
  await check('real overlap inside a scrollport is still detected', async () => {
    const list = '<div style="height:50px;overflow:auto"><div style="height:150px;position:relative"><button id="overlap-one" style="position:absolute;top:0">첫 번째 행</button><button id="overlap-two" style="position:absolute;top:0">두 번째 행</button></div></div>';
    const result = await measure(html('', '', body.replace('</main>', `${list}</main>`)));
    assert.ok(result.findings.some((finding) => finding.code === 'control-collision' && finding.selector.includes('#overlap-one') && finding.otherSelector.includes('#overlap-two')));
  });
  await check('login, empty shell, wrong heading, and error page fail closed', async () => {
    for (const [markup, expectedCode] of [
      [html('', '<form action="/login"><label>비밀번호<input type="password"></label><button>로그인</button></form>'), 'identity-login'],
      [html('', '', '<div class="wc-admin"><main class="admin-content"></main></div>'), 'identity-blank'],
      [html('', '', body.replace('검사 예제', '다른 페이지')), 'identity-heading'],
      [html('', '', '<div class="wc-admin"><h1>Application error</h1></div>'), 'identity-error'],
    ]) assert.ok((await measure(markup)).findings.some((finding) => finding.code === expectedCode), expectedCode);
  });
  await check('masked operational input and closed password form are not login screens', async () => {
    const masked = '<form><h2>QR 원문 수동 검표</h2><label>가린 QR 원문<input type="password" autocomplete="off"></label><button type="button">검표 확인</button></form>';
    const closed = '<details><summary>계정 인증</summary><form action="/login"><input type="password"><button>로그인</button></form></details>';
    const result = await measure(html('', '', body.replace('</main>', `${masked}${closed}</main>`)));
    assert.equal(result.identity.login, false); assert.ok(!result.findings.some((finding) => finding.code === 'identity-login'));
  });
  await check('remote origin and malformed manifest cannot silently run', async () => {
    await assert.rejects(loadRunConfig(['--origin', 'https://example.com']), /Remote origins/);
    const bad = join(output, 'invalid.json'); await writeFile(bad, JSON.stringify({ routes: [{ id: 'x', path: '/admin' }] }));
    await assert.rejects(loadRunConfig(['--manifest', bad]), /heading required/);
    await assert.rejects(loadRunConfig(['--routes', 'missing-route']), /existing, unique/);
  });
  await check('fixture refuses repository and symlink output before writing evidence', async () => {
    const repository = fileURLToPath(new URL('..', import.meta.url));
    const repositoryAlias = join(output, 'repository-link');
    await symlink(repository, repositoryAlias, 'dir');
    const forbidden = join(repository, `qa-forbidden-${Date.now()}`);
    for (const target of ['.', forbidden, repositoryAlias]) {
      const result = spawnSync(process.execPath, ['scripts/admin-visual-fixture/qa.mjs'], {
        cwd: repository, env: { ...process.env, ADMIN_VISUAL_FIXTURE_OUTPUT: target }, encoding: 'utf8',
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /outside the repository/);
    }
    await assert.rejects(access(forbidden));
    const external = await prepareOutputDirectory(join(output, 'private-fixture'));
    assert.equal((await stat(external)).mode & 0o077, 0);
  });
  await browser.close(); browser = undefined;
  const snapshotRoot = join(output, 'snapshot'); await mkdir(join(snapshotRoot, 'assets'), { recursive: true });
  await writeFile(join(snapshotRoot, 'assets', 'style.css'), 'body{background:#fff}');
  await writeFile(join(snapshotRoot, 'form.html'), html('', '<script>document.querySelector("h1").textContent="MUTATED";fetch("/mutate",{method:"POST"})</script>').replace('</head>', '<link rel="stylesheet" href="/assets/style.css"></head>'));
  await writeFile(join(snapshotRoot, 'form-390.html'), (await readFile(join(snapshotRoot, 'form.html'), 'utf8')).replace('<main', '<main data-captured-width="390"'));
  const manifest = join(snapshotRoot, 'manifest.json');
  await writeFile(manifest, JSON.stringify({ capturedAt: new Date().toISOString(), routes: [{ id: 'example', path: '/admin/catalog/goods?create=1', heading: '검사 예제', htmlFile: 'form.html', htmlFilesByWidth: { '390': 'form-390.html' } }], viewports: [{ width: 390, height: 844 }] }));
  await check('snapshot sandbox serves assets, denies POST and traversal', async () => {
    const config = await loadRunConfig(['--snapshot-manifest', manifest, '--output', join(output, 'sandbox')]);
    const server = await startSnapshotServer(config);
    try {
      const response = await fetch(`${server.origin}/assets/style.css`); assert.equal(response.status, 200); assert.match(response.headers.get('content-security-policy'), /script-src 'none'/);
      assert.equal((await fetch(`${server.origin}/mutate`, { method: 'POST' })).status, 405);
      assert.equal((await fetch(`${server.origin}/manifest.json`)).status, 404);
      assert.equal((await fetch(`${server.origin}/assets/%2E%2E%2F%2E%2E%2Foutside.css`)).status, 404);
    } finally { await server.close(); }
  });
  await check('end-to-end replay labels evidence, blocks scripts and refuses full-coverage pass', async () => {
    const config = await loadRunConfig(['--snapshot-manifest', manifest, '--output', join(output, 'replay')]);
    const result = await runAdminVisualQa(config);
    assert.equal(result.report.mode, 'captured-layout'); assert.equal(result.report.results[0].status, 'pass'); assert.equal(result.report.verdict, 'incomplete'); assert.equal(result.exitCode, 2);
    assert.equal(result.report.sources.length, 2); assert.equal(result.report.sources[1].viewportWidth, 390); assert.ok(result.report.results[0].measurement.identity.url.endsWith('/example/390'));
    assert.equal(result.report.snapshotAssets.length, 1); assert.ok(result.report.coverage.uncoveredTemplates.length > 0);
    assert.ok(result.report.results[0].screenshotSha256); assert.equal(result.report.results[0].measurement.identity.headings[0], '검사 예제');
    assert.equal(JSON.parse(await readFile(join(config.output, 'report.json'), 'utf8')).verdict, 'incomplete');
  });
  const componentManifest = join(output, 'components-manifest.json');
  await writeFile(componentManifest, JSON.stringify({ evidenceMode: 'captured-components', routes: [{ id: 'component-example', path: '/admin/visual-replay/example', sourcePath: '/admin/catalog/goods', heading: '검사 예제', readySelector: 'body[data-admin-select-replay-ready]', viewportQuery: 'width' }], viewports: [{ width: 390, height: 844 }] }));
  await check('captured-components rejects remote origins and authentication state', async () => {
    await assert.rejects(loadRunConfig(['--manifest', componentManifest, '--origin', 'https://example.com', '--allow-remote-read-only']), /loopback origin/);
    process.env.ADMIN_QA_STORAGE_STATE = '/must-not-be-read.json';
    try { await assert.rejects(loadRunConfig(['--manifest', componentManifest]), /authentication state/); }
    finally { delete process.env.ADMIN_QA_STORAGE_STATE; }
  });
  await check('component replay waits for readiness, passes width, and records source and actual URLs separately', async () => {
    // Runner contract fixture only; actual AdminSelect behavior has its own fixture.
    const server = createServer((request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(html('', '<script>setTimeout(()=>{if(new URLSearchParams(location.search).get("width")==="390"){document.querySelector("h1").textContent="검사 예제";document.body.dataset.adminSelectReplayReady=""}},80)</script>', body.replace('검사 예제', '준비 중')));
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    try {
      const config = await loadRunConfig(['--manifest', componentManifest, '--origin', `http://127.0.0.1:${server.address().port}`, '--output', join(output, 'components')]);
      const result = await runAdminVisualQa(config);
      assert.equal(result.report.mode, 'captured-components'); assert.equal(result.report.results[0].status, 'pass');
      assert.ok(result.report.results[0].actualUrl.endsWith('/admin/visual-replay/example?width=390'));
      assert.equal(result.report.results[0].sourcePath, '/admin/catalog/goods'); assert.equal(result.report.coverage.basis, 'captured-source-templates-only');
      assert.deepEqual(result.report.coverage.coveredTemplates, ['/admin/catalog/goods']);
      config.routes = [{ ...config.routes[0], readySelector: 'body[data-never-ready]' }]; config.timeout = 1000; config.output = join(output, 'components-not-ready'); await mkdir(config.output, { mode: 0o700 });
      const missingReady = await runAdminVisualQa(config);
      assert.equal(missingReady.exitCode, 1); assert.equal(missingReady.report.results[0].status, 'error'); assert.deepEqual(missingReady.report.coverage.coveredTemplates, []);
    } finally { await new Promise((done) => server.close(done)); }
  });
  await writeFile(join(output, 'self-test.json'), JSON.stringify({ status: 'pass', checks, evidence: output }, null, 2));
  console.log(`Self-test: ${checks.length} passed; evidence: ${output}`);
} finally { await browser?.close(); }
