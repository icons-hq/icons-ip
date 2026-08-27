import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';

import { chromium } from 'playwright-core';
import { createClient } from '@supabase/supabase-js';

const MINIMUM_ZOMBIES = 20;
const MINIMUM_FPS = 30;
const SAMPLE_COUNT = 20;
const VIEWPORT_TOLERANCE_PX = 1;

export async function runNextBuild(environment, spawnProcess = spawn) {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const buildProcess = spawnProcess(
    npmCommand,
    ['run', 'build'],
    { env: environment, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let buildLog = '';
  buildProcess.stdout.on('data', (chunk) => { buildLog += chunk; });
  buildProcess.stderr.on('data', (chunk) => { buildLog += chunk; });

  const exitCode = await new Promise((resolve, reject) => {
    buildProcess.once('error', reject);
    buildProcess.once('close', resolve);
  });
  if (exitCode !== 0) {
    const detail = buildLog.trim();
    throw new Error(`npm run build exited with ${exitCode}${detail ? `\n${detail}` : ''}`);
  }
}

function processHasExited(process) {
  return process.exitCode !== null || process.signalCode !== null;
}

function waitForProcessExit(process, timeoutMs) {
  if (processHasExited(process)) return Promise.resolve(true);

  return new Promise((resolve) => {
    let timeout;
    const onExit = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    process.once('exit', onExit);
    timeout = setTimeout(() => {
      process.off('exit', onExit);
      resolve(false);
    }, timeoutMs);
  });
}

export async function terminateNextProcess(
  process,
  gracefulTimeoutMs = 3_000,
  forceTimeoutMs = 1_000,
) {
  if (!process || processHasExited(process)) return;

  const gracefulExit = waitForProcessExit(process, gracefulTimeoutMs);
  process.kill('SIGTERM');
  if (await gracefulExit) return;
  if (processHasExited(process)) return;

  const forcedExit = waitForProcessExit(process, forceTimeoutMs);
  process.kill('SIGKILL');
  if (!await forcedExit) throw new Error('Next server did not exit after SIGKILL');
}

export async function cleanupSmokeResources({ browser, nextProcess, smokeUser }) {
  const cleanupResults = await Promise.allSettled([
    browser ? Promise.resolve().then(() => browser.close()) : Promise.resolve(),
    terminateNextProcess(nextProcess),
    smokeUser ? Promise.resolve().then(() => smokeUser.cleanup()) : Promise.resolve(),
  ]);
  const cleanupErrors = cleanupResults
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason);
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'Smoke cleanup failed');
  }
}

export function createIdempotentCleanup(cleanup) {
  let cleanupPromise;
  return () => {
    cleanupPromise ??= Promise.resolve().then(cleanup);
    return cleanupPromise;
  };
}

export function installSmokeSignalCleanup({
  cleanup,
  emitter = process,
  onSignal = () => {},
  onRepeatedSignal = (signal) => process.exit(signal === 'SIGINT' ? 130 : 143),
}) {
  let received = false;
  let cleanupPromise;
  const handlers = new Map();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () => {
      if (received) {
        onRepeatedSignal(signal);
        return;
      }
      received = true;
      onSignal(signal);
      cleanupPromise = Promise.resolve().then(cleanup);
      // The main path awaits this promise and reports errors.
      void cleanupPromise.catch(() => {});
    };
    handlers.set(signal, handler);
    emitter.on(signal, handler);
  }

  return {
    dispose() {
      for (const [signal, handler] of handlers) emitter.off(signal, handler);
    },
    wait() {
      return cleanupPromise ?? Promise.resolve();
    },
  };
}

async function openPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!port) throw new Error('Could not reserve a local port');
  return port;
}

export async function waitForServer(url, process, fetchPage = fetch) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (processHasExited(process)) {
      throw new Error(`Next server exited with ${process.exitCode ?? process.signalCode}`);
    }
    try {
      const response = await fetchPage(url);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Next server did not become ready: ${url}`);
}

function numericAttribute(value, name) {
  if (value === null || value.trim() === '') throw new Error(`Missing ${name}`);
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid ${name}: ${value}`);
  return number;
}

function readLocalSupabaseEnvironment() {
  let output;
  try {
    output = execFileSync('supabase', ['status', '-o', 'env'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    throw new Error('Start the local Supabase stack before running the Hyosan browser smoke test');
  }

  const values = Object.fromEntries(output.trim().split('\n').map((line) => {
    const separator = line.indexOf('=');
    const name = line.slice(0, separator);
    const value = line.slice(separator + 1).replace(/^"|"$/g, '');
    return [name, value];
  }));
  const url = values.API_URL;
  const publishableKey = values.PUBLISHABLE_KEY || values.ANON_KEY;
  const serviceRoleKey = values.SERVICE_ROLE_KEY;
  if (!url || !publishableKey || !serviceRoleKey) {
    throw new Error('Local Supabase status did not provide the required API keys');
  }

  const hostname = new URL(url).hostname;
  if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
    throw new Error(`Refusing to create a smoke-test user outside local Supabase: ${hostname}`);
  }
  return { url, publishableKey, serviceRoleKey };
}

async function createSmokeUser(supabaseEnvironment) {
  const suffix = randomUUID();
  const email = `hyosan-g1-${suffix}@example.test`;
  const password = `Hyosan-${suffix}-A1!`;
  const admin = createClient(supabaseEnvironment.url, supabaseEnvironment.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`Could not create the local smoke-test user: ${error?.message}`);

  const { error: profileError } = await admin.from('profiles').update({
    nickname: `hyosan_${suffix.replaceAll('-', '').slice(0, 20)}`,
    birth_date: '2000-01-01',
    consents: { terms: true, privacy: true, marketing: false },
    onboarded_at: new Date().toISOString(),
  }).eq('id', data.user.id).select('id').single();
  if (profileError) {
    const { error: cleanupError } = await admin.auth.admin.deleteUser(data.user.id);
    if (cleanupError) {
      throw new Error(
        `Could not onboard the local smoke-test user: ${profileError.message}; `
        + `cleanup also failed: ${cleanupError.message}`,
      );
    }
    throw new Error(`Could not onboard the local smoke-test user: ${profileError.message}`);
  }

  return {
    email,
    password,
    async cleanup() {
      const { error: deleteError } = await admin.auth.admin.deleteUser(data.user.id);
      if (deleteError) throw new Error(`Could not delete the local smoke-test user: ${deleteError.message}`);
    },
  };
}

export async function prepareSmokeBuild({
  ambientEnvironment = process.env,
  readEnvironment = readLocalSupabaseEnvironment,
  build = runNextBuild,
} = {}) {
  const supabaseEnvironment = readEnvironment();
  const environment = {
    ...ambientEnvironment,
    NEXT_PUBLIC_SUPABASE_URL: supabaseEnvironment.url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabaseEnvironment.publishableKey,
    SUPABASE_SERVICE_ROLE_KEY: supabaseEnvironment.serviceRoleKey,
    ICONS_CATALOG_SOURCE: 'supabase',
  };
  await build(environment);
  return { environment, supabaseEnvironment };
}

export async function prepareSmokeTarget({ createUser = createSmokeUser, ...buildOptions } = {}) {
  const { environment, supabaseEnvironment } = await prepareSmokeBuild(buildOptions);
  const smokeUser = await createUser(supabaseEnvironment);
  return { environment, smokeUser, supabaseEnvironment };
}

async function main() {
  const { environment, supabaseEnvironment } = await prepareSmokeBuild();
  let smokeUser;
  let nextProcess;
  let serverLog = '';
  let browser;
  let cleanupSmokeUser = () => Promise.resolve();
  let cleanupBrowser = () => Promise.resolve();
  let completed = false;
  let runError;
  let receivedSignal;
  const cleanup = () => cleanupSmokeResources({
    browser: { close: cleanupBrowser },
    nextProcess,
    smokeUser: { cleanup: cleanupSmokeUser },
  });
  const signalCleanup = installSmokeSignalCleanup({
    cleanup,
    onSignal: (signal) => {
      receivedSignal = signal;
      process.exitCode = signal === 'SIGINT' ? 130 : 143;
    },
  });
  const assertNotInterrupted = () => {
    if (receivedSignal) throw new Error(`Smoke interrupted by ${receivedSignal}`);
  };
  try {
    smokeUser = await createSmokeUser(supabaseEnvironment);
    cleanupSmokeUser = createIdempotentCleanup(() => smokeUser.cleanup());
    assertNotInterrupted();
    const port = await openPort();
    assertNotInterrupted();
    const baseUrl = `http://127.0.0.1:${port}`;
    nextProcess = spawn(
      process.execPath,
      ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)],
      { env: environment, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    nextProcess.stdout.on('data', (chunk) => { serverLog += chunk; });
    nextProcess.stderr.on('data', (chunk) => { serverLog += chunk; });
    const processError = new Promise((_, reject) => {
      nextProcess.once('error', (error) => reject(
        new Error(`Could not start the Next server: ${error.message}`, { cause: error }),
      ));
    });
    await Promise.race([
      waitForServer(`${baseUrl}/games/hyosan-memories`, nextProcess),
      processError,
    ]);
    assertNotInterrupted();
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    cleanupBrowser = createIdempotentCleanup(() => browser.close());
    assertNotInterrupted();
    const page = await browser.newPage({
      viewport: { width: 667, height: 320 },
      hasTouch: true,
      isMobile: true,
    });
    const consoleErrors = [];
    let localSupabaseRequests = 0;
    const externalSupabaseHosts = new Set();
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    page.on('request', (request) => {
      const requestUrl = new URL(request.url());
      if (request.url().startsWith(supabaseEnvironment.url)) localSupabaseRequests += 1;
      if (requestUrl.hostname.endsWith('.supabase.co')) externalSupabaseHosts.add(requestUrl.hostname);
    });

    await page.goto(`${baseUrl}/games/hyosan-memories?smoke=${Date.now()}`, {
      waitUntil: 'networkidle',
    });
    const loginGate = page.locator('main[data-hyosan-access="login-required"]');
    await loginGate.waitFor({ timeout: 10_000 });
    const loginButton = loginGate.getByRole('link', { name: '로그인하고 플레이' });
    const shortViewportButton = await loginButton.boundingBox();
    if (!shortViewportButton
      || shortViewportButton.y < -VIEWPORT_TOLERANCE_PX
      || shortViewportButton.y + shortViewportButton.height > 320 + VIEWPORT_TOLERANCE_PX) {
      throw new Error(`Login CTA is clipped at 667x320: ${JSON.stringify(shortViewportButton)}`);
    }

    await page.setViewportSize({ width: 667, height: 240 });
    const gateOverflow = await loginGate.evaluate((element) => {
      const style = getComputedStyle(element);
      return { overflowY: style.overflowY, touchAction: style.touchAction };
    });
    if (gateOverflow.overflowY !== 'auto' || !gateOverflow.touchAction.includes('pan-y')) {
      throw new Error(`Login gate cannot pan in an extreme short viewport: ${JSON.stringify(gateOverflow)}`);
    }
    await loginButton.scrollIntoViewIfNeeded();
    const extremeViewportButton = await loginButton.boundingBox();
    if (!extremeViewportButton
      || extremeViewportButton.y < -VIEWPORT_TOLERANCE_PX
      || extremeViewportButton.y + extremeViewportButton.height > 240 + VIEWPORT_TOLERANCE_PX) {
      throw new Error(`Login CTA cannot be reached at 667x240: ${JSON.stringify(extremeViewportButton)}`);
    }

    await page.setViewportSize({ width: 1280, height: 720 });
    await loginButton.click();
    await page.getByLabel('이메일').fill(smokeUser.email);
    await page.getByLabel('비밀번호').fill(smokeUser.password);
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await page.waitForURL((url) => url.pathname !== '/login', { timeout: 10_000 });
    await page.goto(`${baseUrl}/games/hyosan-memories?authenticated=${Date.now()}`, {
      waitUntil: 'networkidle',
    });

    const game = page.locator('main[data-hyosan-ready="true"]');
    await game.waitFor({ timeout: 20_000 });

    await page.setViewportSize({ width: 667, height: 320 });
    const mobileControls = [
      page.getByLabel('이동 조이스틱', { exact: true }),
      page.getByRole('button', { name: '감각 (K)', exact: true }),
      page.getByRole('button', { name: '대시 (L)', exact: true }),
      page.getByRole('button', { name: '공격 (J)', exact: true }),
    ];
    for (const control of mobileControls) {
      const label = await control.getAttribute('aria-label');
      const box = await control.boundingBox();
      if (!box
        || box.x < -VIEWPORT_TOLERANCE_PX
        || box.y < -VIEWPORT_TOLERANCE_PX
        || box.x + box.width > 667 + VIEWPORT_TOLERANCE_PX
        || box.y + box.height > 320 + VIEWPORT_TOLERANCE_PX) {
        throw new Error(`Mobile control is clipped at 667x320 (${label}): ${JSON.stringify(box)}`);
      }
    }
    await page.setViewportSize({ width: 1280, height: 720 });

    const total = numericAttribute(await game.getAttribute('data-total-zombies'), 'zombie total');
    const active = numericAttribute(await game.getAttribute('data-active-zombies'), 'active zombies');
    if (total < MINIMUM_ZOMBIES || active < MINIMUM_ZOMBIES) {
      throw new Error(`Expected ${MINIMUM_ZOMBIES}+ active zombies, received ${active}/${total}`);
    }

    await page.keyboard.down('d');
    await page.waitForTimeout(500);
    await page.keyboard.up('d');
    if (await game.getAttribute('data-room-started') !== 'true') {
      throw new Error('The zombie wave did not start from keyboard input');
    }
    await page.waitForFunction(() => Number(
      document.querySelector('main[data-hyosan-ready="true"]')?.getAttribute('data-fps'),
    ) > 0);

    const samples = [];
    const activeSamples = [];
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      samples.push(numericAttribute(await game.getAttribute('data-fps'), 'FPS'));
      activeSamples.push(numericAttribute(
        await game.getAttribute('data-active-zombies'),
        'active zombies',
      ));
      await page.waitForTimeout(100);
    }
    const minimum = Math.min(...samples);
    const minimumActive = Math.min(...activeSamples);
    const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    if (minimumActive < MINIMUM_ZOMBIES) {
      throw new Error(`Active zombies dropped below ${MINIMUM_ZOMBIES}: ${activeSamples.join(', ')}`);
    }
    if (minimum < MINIMUM_FPS) {
      throw new Error(`FPS dropped below ${MINIMUM_FPS}: ${samples.join(', ')}`);
    }

    await page.waitForFunction(() => {
      const root = document.querySelector('main[data-hyosan-ready="true"]');
      return root?.getAttribute('data-player-health') === '0'
        || root?.getAttribute('data-room-exited') === 'true';
    }, undefined, { timeout: 20_000 });
    const terminalStep = numericAttribute(
      await game.getAttribute('data-simulation-step'),
      'terminal simulation step',
    );
    await page.waitForTimeout(750);
    const settledStep = numericAttribute(
      await game.getAttribute('data-simulation-step'),
      'settled simulation step',
    );
    if (settledStep !== terminalStep) {
      throw new Error(`Simulation continued after terminal state: ${terminalStep} -> ${settledStep}`);
    }
    await page.getByRole('button', { name: '다시 진입' }).click();
    await page.waitForFunction(() => {
      const root = document.querySelector('main[data-hyosan-ready="true"]');
      const canvases = document.querySelectorAll('canvas[data-testid="hyosan-canvas"]');
      return canvases.length === 1
        && Number(root?.getAttribute('data-simulation-step')) > 0
        && root?.getAttribute('data-player-health') === '5';
    }, undefined, { timeout: 10_000 });

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${baseUrl}/games/hyosan-memories?reduced-motion=${Date.now()}`, {
      waitUntil: 'networkidle',
    });
    const reducedMotionGame = page.locator('main[data-hyosan-ready="true"]');
    await reducedMotionGame.waitFor({ timeout: 20_000 });
    const reducedMotionCanvas = reducedMotionGame.locator('canvas[data-reduced-motion="true"]');
    await reducedMotionCanvas.waitFor({ timeout: 5_000 });
    await page.keyboard.press('k');
    await page.waitForTimeout(150);
    if (consoleErrors.length > 0) {
      throw new Error(`Browser errors: ${consoleErrors.join(' | ')}`);
    }
    if (localSupabaseRequests === 0 || externalSupabaseHosts.size > 0) {
      throw new Error(
        `Browser Supabase boundary mismatch: local=${localSupabaseRequests}, external=${[...externalSupabaseHosts].join(',')}`,
      );
    }

    process.stdout.write(`${JSON.stringify({
      total,
      minimumActive,
      minimumFps: minimum,
      averageFps: Math.round(average),
      reducedMotion: true,
      shortViewportGate: true,
      shortViewportControls: true,
      localSupabaseRequests,
    })}\n`);
    completed = true;
  } catch (error) {
    runError = error;
  }

  const cleanupErrors = [];
  try {
    await signalCleanup.wait();
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await cleanup();
  } catch (error) {
    cleanupErrors.push(error);
  }
  signalCleanup.dispose();
  const cleanupError = cleanupErrors.length > 0
    ? new AggregateError(cleanupErrors, 'Smoke cleanup failed')
    : undefined;
  if (!completed && serverLog) process.stderr.write(serverLog);
  if (receivedSignal) {
    if (cleanupError) console.error(cleanupError);
    return;
  }
  if (runError && cleanupError) {
    throw new AggregateError(
      [runError, cleanupError],
      'Hyosan browser smoke failed and cleanup also failed',
    );
  }
  if (runError) throw runError;
  if (cleanupError) throw cleanupError;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
