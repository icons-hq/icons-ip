export const HYOSAN_BOOT_TIMEOUT_MS = 10_000;

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
