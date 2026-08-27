import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createHyosanBootWatchdog,
  scheduleHyosanPhaserDestroy,
} from './boot-watchdog';

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

describe('scheduleHyosanPhaserDestroy', () => {
  it('wakes a started loop so Phaser can process pending destruction', () => {
    const game = {
      destroy: vi.fn(),
      loop: { started: true, wake: vi.fn() },
    };

    scheduleHyosanPhaserDestroy(game);

    expect(game.destroy).toHaveBeenCalledWith(true);
    expect(game.loop.wake).toHaveBeenCalledOnce();
  });

  it('does not start a no-op RAF while Phaser is still booting', () => {
    const game = {
      destroy: vi.fn(),
      loop: { started: false, wake: vi.fn() },
    };

    scheduleHyosanPhaserDestroy(game);

    expect(game.destroy).toHaveBeenCalledWith(true);
    expect(game.loop.wake).not.toHaveBeenCalled();
  });
});
