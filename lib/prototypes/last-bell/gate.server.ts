import 'server-only';

/** The Last Bell prototype is intentionally unavailable unless explicitly enabled. */
export function isLastBellPrototypeEnabled(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return environment.ICONS_LAST_BELL_PROTOTYPE === '1';
}
