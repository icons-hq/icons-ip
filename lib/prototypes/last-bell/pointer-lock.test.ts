import { describe, expect, it, vi } from 'vitest';
import { requestLastBellPointerLock } from './pointer-lock';

describe('Last Bell pointer lock request', () => {
  it('keeps playing when pointer lock is unsupported', async () => {
    await expect(requestLastBellPointerLock(null)).resolves.toBe(false);
    await expect(requestLastBellPointerLock({})).resolves.toBe(false);
  });

  it('absorbs a synchronous browser exception', async () => {
    const requestPointerLock = vi.fn(() => { throw new Error('denied'); });
    await expect(requestLastBellPointerLock({ requestPointerLock })).resolves.toBe(false);
  });

  it('absorbs an asynchronous browser rejection without an unhandled promise', async () => {
    const requestPointerLock = vi.fn(() => Promise.reject(new Error('denied')));
    await expect(requestLastBellPointerLock({ requestPointerLock })).resolves.toBe(false);
  });
});
