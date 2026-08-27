import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { runNextBuild } from './hyosan-g1-browser-smoke.mjs';

function completedProcess(exitCode) {
  const process = new EventEmitter();
  process.stdout = new PassThrough();
  process.stderr = new PassThrough();
  queueMicrotask(() => process.emit('close', exitCode));
  return process;
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
      process.execPath,
      ['node_modules/next/dist/bin/next', 'build'],
      { env: environment, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  });

  it('fails before login when the matching Next build fails', async () => {
    const child = completedProcess(1);
    child.stderr.end('build failed');
    const spawnProcess = vi.fn(() => child);

    await expect(runNextBuild({}, spawnProcess)).rejects.toThrow(
      'Next build exited with 1',
    );
  });
});
