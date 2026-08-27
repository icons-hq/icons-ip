import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import {
  cleanupSmokeResources,
  createIdempotentCleanup,
  installSmokeSignalCleanup,
  prepareSmokeTarget,
  runNextBuild,
  terminateNextProcess,
  waitForServer,
} from './hyosan-g1-browser-smoke.mjs';

function completedProcess(exitCode) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  queueMicrotask(() => child.emit('close', exitCode));
  return child;
}

describe('Hyosan browser smoke build boundary', () => {
  it('builds Next with the same local Supabase values used by the smoke user', async () => {
    const spawnProcess = vi.fn(() => completedProcess(0));
    const environment = {
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    };

    await runNextBuild(environment, spawnProcess);

    expect(spawnProcess).toHaveBeenCalledWith(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['run', 'build'],
      { env: environment, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  });

  it('fails before login when the matching Next build fails', async () => {
    const child = completedProcess(1);
    child.stderr.end('build failed');
    const spawnProcess = vi.fn(() => child);

    await expect(runNextBuild({}, spawnProcess)).rejects.toThrow(
      'npm run build exited with 1',
    );
  });

  it('does not create a user or start later resources after the matching build fails', async () => {
    const build = vi.fn().mockRejectedValue(new Error('build failed'));
    const createUser = vi.fn();

    await expect(prepareSmokeTarget({
      ambientEnvironment: {},
      readEnvironment: () => ({
        url: 'http://127.0.0.1:54321',
        publishableKey: 'publishable-key',
        serviceRoleKey: 'service-role-key',
      }),
      build,
      createUser,
    })).rejects.toThrow('build failed');

    expect(build).toHaveBeenCalledOnce();
    expect(createUser).not.toHaveBeenCalled();
  });
});

describe('Hyosan browser smoke cleanup', () => {
  it('fails immediately when the Next server already exited from a signal', async () => {
    const fetchPage = vi.fn();
    const nextProcess = { exitCode: null, signalCode: 'SIGTERM' };

    await expect(waitForServer(
      'http://127.0.0.1:3000/games/hyosan-memories',
      nextProcess,
      fetchPage,
    )).rejects.toThrow('Next server exited with SIGTERM');

    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('continues cleanup when closing the browser fails', async () => {
    const browser = { close: vi.fn().mockRejectedValue(new Error('browser close failed')) };
    const nextProcess = { exitCode: 0, signalCode: null, kill: vi.fn() };
    const smokeUser = { cleanup: vi.fn().mockResolvedValue(undefined) };

    await expect(cleanupSmokeResources({
      browser,
      nextProcess,
      smokeUser,
    })).rejects.toThrow('Smoke cleanup failed');

    expect(smokeUser.cleanup).toHaveBeenCalledOnce();
    expect(nextProcess.kill).not.toHaveBeenCalled();
  });

  it('force-kills a Next process that ignores graceful shutdown', async () => {
    const nextProcess = Object.assign(new EventEmitter(), {
      exitCode: null,
      signalCode: null,
      kill: vi.fn(() => true),
    });

    await expect(terminateNextProcess(nextProcess, 0, 0)).rejects.toThrow(
      'Next server did not exit after SIGKILL',
    );

    expect(nextProcess.kill).toHaveBeenNthCalledWith(1, 'SIGTERM');
    expect(nextProcess.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
  });

  it('runs the same cleanup once when a termination signal interrupts the smoke', async () => {
    const signals = new EventEmitter();
    const cleanupTask = vi.fn().mockResolvedValue(undefined);
    const cleanup = createIdempotentCleanup(cleanupTask);
    const onSignal = vi.fn();
    const signalCleanup = installSmokeSignalCleanup({
      cleanup,
      emitter: signals,
      onSignal,
    });

    signals.emit('SIGTERM');
    signals.emit('SIGINT');
    await signalCleanup.wait();
    await cleanup();
    signalCleanup.dispose();

    expect(onSignal).toHaveBeenCalledOnce();
    expect(onSignal).toHaveBeenCalledWith('SIGTERM');
    expect(cleanupTask).toHaveBeenCalledOnce();
    expect(signals.listenerCount('SIGINT')).toBe(0);
    expect(signals.listenerCount('SIGTERM')).toBe(0);
  });

  it('allows a later cleanup pass for a resource acquired after the signal', async () => {
    const signals = new EventEmitter();
    let cleanupLateResource = () => Promise.resolve();
    const cleanup = () => cleanupLateResource();
    const signalCleanup = installSmokeSignalCleanup({ cleanup, emitter: signals });

    signals.emit('SIGINT');
    await signalCleanup.wait();

    const lateCleanupTask = vi.fn().mockResolvedValue(undefined);
    cleanupLateResource = createIdempotentCleanup(lateCleanupTask);
    await cleanup();
    signalCleanup.dispose();

    expect(lateCleanupTask).toHaveBeenCalledOnce();
  });
});
