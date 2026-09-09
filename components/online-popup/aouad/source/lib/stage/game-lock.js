export const LOCK_MS = 5 * 60 * 1000;
export const GAME_LOCK_RESET_EVENT = "aouad:game-lock-reset";
const GAMES = ["cafeteria", "broadcast", "library"];
export const gameLockKey = (game) => `aouad:gameLock:${game}`;

export function gameLockStorage() {
  try { return globalThis.localStorage; } catch { return undefined; }
}

export function readGameLock(game, now = Date.now(), storage = gameLockStorage()) {
  try {
    const until = Number(storage?.getItem(gameLockKey(game)) || 0);
    // Stale/corrupt storage and a clock correction must not trap the demo.
    return Number.isFinite(until) && until > now && until <= now + LOCK_MS ? until : 0;
  } catch { return 0; }
}

export function resetGameLocks(storage = gameLockStorage()) {
  for (const game of GAMES) {
    try { storage?.removeItem(gameLockKey(game)); } catch { /* Storage may be unavailable. */ }
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(GAME_LOCK_RESET_EVENT));
}
