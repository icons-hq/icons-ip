/**
 * Public IP URL identity is deliberately separate from the internal catalog id.
 * Keep this module free of Supabase/server imports so forms, links and tests share
 * exactly the same validation and path construction rules.
 */

export const IP_PUBLIC_SLUG_MAX_LENGTH = 80;
export const IP_PUBLIC_SLUG_PATTERN = new RegExp(
  `^[a-z0-9](?:[a-z0-9-]{0,${IP_PUBLIC_SLUG_MAX_LENGTH - 2}}[a-z0-9])?$`,
);

/** Static routes under /ip take precedence over the dynamic [id] segment. */
export const RESERVED_IP_PUBLIC_SLUGS = new Set(['aouad']);

export type IpPublicSlugValidationError = 'required' | 'format' | 'reserved';

export interface AdminIpIdentity {
  internalId: string;
  publicSlug: string;
  aliases: string[];
}

export function normalizeIpPublicSlug(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function validateIpPublicSlug(value: unknown): IpPublicSlugValidationError | null {
  const slug = normalizeIpPublicSlug(value);
  if (!slug) return 'required';
  if (!IP_PUBLIC_SLUG_PATTERN.test(slug)) return 'format';
  if (RESERVED_IP_PUBLIC_SLUGS.has(slug)) return 'reserved';
  return null;
}

export function publicIpHref(publicSlug: string): string {
  return `/ip/${encodeURIComponent(publicSlug)}`;
}

export function internalIpHref(internalId: string): string {
  return publicIpHref(internalId);
}
