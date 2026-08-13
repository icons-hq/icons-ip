import 'server-only';

export const CANONICAL_AUTH_ORIGIN = 'https://iconsip.com';

const STATIC_AUTH_ORIGINS = new Set([
  CANONICAL_AUTH_ORIGIN,
  'https://www.iconsip.com',
  'https://icons-ip.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

function normalizedOrigin(value: string | null) {
  if (!value) return undefined;

  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function currentVercelOrigin() {
  const host = process.env.VERCEL_URL?.trim();
  if (!host || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.vercel\.app$/i.test(host)) return undefined;
  return `https://${host.toLowerCase()}`;
}

export function trustedAuthOrigin(value: string | null) {
  const origin = normalizedOrigin(value);
  if (!origin) return undefined;
  if (STATIC_AUTH_ORIGINS.has(origin) || origin === currentVercelOrigin()) return origin;
  return undefined;
}
