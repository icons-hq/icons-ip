export const HYOSAN_BOOT_TIMEOUT_MS = 10_000;

interface DestroyableHyosanPhaserGame {
  destroy(removeCanvas: boolean, noReturn?: boolean): void;
  loop: {
    readonly started: boolean;
    wake(): void;
  };
}

export function createHyosanBootWatchdog(
  onTimeout: () => void,
  timeoutMs = HYOSAN_BOOT_TIMEOUT_MS,
) {
  let active = true;
  const timer = globalThis.setTimeout(() => {
    if (!active) return;
    active = false;
    onTimeout();
  }, timeoutMs);

  return () => {
    active = false;
    globalThis.clearTimeout(timer);
  };
}

export function scheduleHyosanPhaserDestroy(game: DestroyableHyosanPhaserGame) {
  game.destroy(true);
  // Phaser processes pendingDestroy from Game.step. A started-but-sleeping loop
  // must be woken; waking a loop that has not started would run its NOOP boot
  // callback and strand an empty RAF instead of advancing Game.step.
  if (game.loop.started) game.loop.wake();
}
