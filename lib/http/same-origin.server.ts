import 'server-only';

/** Host is the browser destination; Next can normalize its internal URL to localhost. */
export function isSameOriginRequest(request: Request): boolean {
  const host = request.headers.get('host'), origin = request.headers.get('origin');
  if (!host || !origin || /[\\/@?#,%\s]/.test(host) || request.headers.get('sec-fetch-site') === 'cross-site') return false;
  try {
    const protocol = new URL(request.url).protocol;
    if (protocol !== 'http:' && protocol !== 'https:') return false;
    // Forwarded headers are intentionally ignored: browser scripts cannot choose
    // Host, whereas an upstream must explicitly sanitize forwarded host values.
    return origin === new URL(`${protocol}//${host}`).origin;
  } catch { return false; }
}
