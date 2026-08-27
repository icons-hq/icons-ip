import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';

import { chromium } from 'playwright-core';
import { createClient } from '@supabase/supabase-js';

const MINIMUM_ZOMBIES = 20;
const MINIMUM_FPS = 30;
const SAMPLE_COUNT = 20;

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

async function waitForServer(url, process) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`Next server exited with ${process.exitCode}`);
    try {
      const response = await fetch(url);
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

  return {
    email,
    password,
    async cleanup() {
      const { error: deleteError } = await admin.auth.admin.deleteUser(data.user.id);
      if (deleteError) throw new Error(`Could not delete the local smoke-test user: ${deleteError.message}`);
    },
  };
}

async function main() {
  if (!existsSync('.next/BUILD_ID')) {
    throw new Error('Run `npm run build` before the Hyosan browser smoke test');
  }

  const port = await openPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const supabaseEnvironment = readLocalSupabaseEnvironment();
  const smokeUser = await createSmokeUser(supabaseEnvironment);
  const environment = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: supabaseEnvironment.url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabaseEnvironment.publishableKey,
    SUPABASE_SERVICE_ROLE_KEY: supabaseEnvironment.serviceRoleKey,
  };

  const nextProcess = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)],
    { env: environment, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let serverLog = '';
  nextProcess.stdout.on('data', (chunk) => { serverLog += chunk; });
  nextProcess.stderr.on('data', (chunk) => { serverLog += chunk; });

  let browser;
  let completed = false;
  try {
    await waitForServer(`${baseUrl}/games/hyosan-memories`, nextProcess);
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    await page.goto(`${baseUrl}/games/hyosan-memories?smoke=${Date.now()}`, {
      waitUntil: 'networkidle',
    });
    const loginGate = page.locator('main[data-hyosan-access="login-required"]');
    await loginGate.waitFor({ timeout: 10_000 });
    await loginGate.getByRole('link', { name: '로그인하고 플레이' }).click();
    await page.getByLabel('이메일').fill(smokeUser.email);
    await page.getByLabel('비밀번호').fill(smokeUser.password);
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await page.waitForURL((url) => url.pathname !== '/login', { timeout: 10_000 });
    await page.goto(`${baseUrl}/games/hyosan-memories?authenticated=${Date.now()}`, {
      waitUntil: 'networkidle',
    });

    const game = page.locator('main[data-hyosan-ready="true"]');
    await game.waitFor({ timeout: 20_000 });

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

    process.stdout.write(`${JSON.stringify({
      total,
      minimumActive,
      minimumFps: minimum,
      averageFps: Math.round(average),
      reducedMotion: true,
    })}\n`);
    completed = true;
  } finally {
    await browser?.close();
    if (nextProcess.exitCode === null) nextProcess.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => nextProcess.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 3_000)),
    ]);
    await smokeUser.cleanup();
    if (!completed && serverLog) {
      process.stderr.write(serverLog);
    }
  }
}

await main();
