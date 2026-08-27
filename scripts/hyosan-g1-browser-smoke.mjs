import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';

import { chromium } from 'playwright-core';

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
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid ${name}: ${value}`);
  return number;
}

async function main() {
  if (!existsSync('.next/BUILD_ID')) {
    throw new Error('Run `npm run build` before the Hyosan browser smoke test');
  }

  const port = await openPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const environment = { ...process.env };
  delete environment.NEXT_PUBLIC_SUPABASE_URL;
  delete environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete environment.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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
    if (!completed && serverLog) {
      process.stderr.write(serverLog);
    }
  }
}

await main();
