import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHyosanBootWatchdog } from './boot-watchdog';

describe('createHyosanBootWatchdog', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports a renderer that never becomes ready', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();

    createHyosanBootWatchdog(onTimeout, 1_000);
    vi.advanceTimersByTime(999);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it('can be cancelled after Phaser signals readiness', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();

    const cancel = createHyosanBootWatchdog(onTimeout, 1_000);
    cancel();
    vi.runAllTimers();

    expect(onTimeout).not.toHaveBeenCalled();
  });
});
