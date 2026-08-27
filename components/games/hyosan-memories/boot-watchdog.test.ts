import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createHyosanBootWatchdog,
  recoverFromHyosanBootFailure,
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
      scene: { isBooted: true },
      step: vi.fn(),
      loop: { started: true, wake: vi.fn() },
    };

    const result = scheduleHyosanPhaserDestroy(game);

    expect(game.destroy).toHaveBeenCalledWith(true);
    expect(game.loop.wake).toHaveBeenCalledOnce();
    expect(game.step).not.toHaveBeenCalled();
    expect(result).toBe('next-frame');
  });

  it('advances a booted scene once when create failed before the loop started', () => {
    let destroyEvents = 0;
    const game = {
      destroy: vi.fn(),
      scene: { isBooted: true },
      step: vi.fn(() => { destroyEvents += 1; }),
      loop: { started: false, wake: vi.fn() },
    };

    const result = scheduleHyosanPhaserDestroy(game);

    expect(game.destroy).toHaveBeenCalledWith(true);
    expect(game.loop.wake).not.toHaveBeenCalled();
    expect(game.step).toHaveBeenCalledWith(0, 0);
    expect(destroyEvents).toBe(1);
    expect(result).toBe('immediate');
  });

  it('does not run Phaser teardown before its system scene is safe', () => {
    const game = {
      destroy: vi.fn(),
      scene: { isBooted: false },
      step: vi.fn(),
      loop: { started: false, wake: vi.fn() },
    };

    const result = scheduleHyosanPhaserDestroy(game);

    expect(game.destroy).toHaveBeenCalledWith(true);
    expect(game.loop.wake).not.toHaveBeenCalled();
    expect(game.step).not.toHaveBeenCalled();
    expect(result).toBe('boot-pending');
  });
});

describe('recoverFromHyosanBootFailure', () => {
  it('uses full-document navigation so a partial boot cannot accumulate', () => {
    const location = { reload: vi.fn(), assign: vi.fn() };

    recoverFromHyosanBootFailure('retry', location);
    expect(location.reload).toHaveBeenCalledOnce();

    recoverFromHyosanBootFailure('exit', location);
    expect(location.assign).toHaveBeenCalledWith('/');
  });
});
