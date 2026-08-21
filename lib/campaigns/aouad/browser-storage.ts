/**
 * Browser storage is an optional local presentation layer. Some privacy modes
 * expose `window` but throw while evaluating the `localStorage` getter, so the
 * getter itself stays behind this seam.
 */
export function getOptionalStorage(
  host: { readonly localStorage: Storage } | undefined = typeof window === 'undefined' ? undefined : window,
): Storage | null {
  if (!host) return null;
  try {
    return host.localStorage;
  } catch {
    return null;
  }
}
