export const HYOSAN_BOOT_TIMEOUT_MS = 10_000;

interface DestroyableHyosanPhaserGame {
  destroy(removeCanvas: boolean, noReturn?: boolean): void;
  scene: { readonly isBooted: boolean };
  step(time: number, delta: number): void;
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
  if (game.loop.started) {
    game.loop.wake();
    return 'next-frame' as const;
  }
  // SceneManager boot creates the system scene and TextureManager stamp before
  // user Scene.create. If create then throws before Game.start, one public step
  // can safely consume pendingDestroy without starting an RAF.
  if (game.scene.isBooted) {
    game.step(0, 0);
    return 'immediate' as const;
  }
  // Phaser has no safe public teardown before its system scene exists. Keep the
  // pending flag; boot failure actions use full-document navigation so this
  // partial browsing context can never accumulate through an in-page retry.
  return 'boot-pending' as const;
}

interface HyosanRecoveryLocation {
  reload(): void;
  assign(url: string): void;
}

export function recoverFromHyosanBootFailure(
  action: 'retry' | 'exit',
  location: HyosanRecoveryLocation = window.location,
) {
  if (action === 'retry') location.reload();
  else location.assign('/');
}
