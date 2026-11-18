import 'server-only';

import { CANONICAL_SITE_ORIGIN, PRODUCTION_SITE_HOSTS } from '@/lib/site-domains.mjs';

export const CANONICAL_AUTH_ORIGIN = CANONICAL_SITE_ORIGIN;

const STATIC_AUTH_ORIGINS = new Set([
  CANONICAL_AUTH_ORIGIN,
  ...PRODUCTION_SITE_HOSTS.map((host) => `https://${host}`),
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
