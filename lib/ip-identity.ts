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

/** 공개 URL 칸의 오류 문구. 새 IP 등록과 공개 URL 변경이 같은 문구를 쓴다. */
export const IP_PUBLIC_SLUG_ERROR_MESSAGES: Record<IpPublicSlugValidationError, string> = {
  required: '공개 URL을 입력해주세요.',
  format: '공개 URL은 영문 소문자·숫자·하이픈만 사용할 수 있습니다.',
  reserved: '이 공개 URL은 시스템 경로로 예약되어 있습니다.',
};

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

export interface PublicIpReference {
  id: string;
  publicSlug?: string | null;
}

export function publicIpHref(ip: string | PublicIpReference): string {
  const slug = typeof ip === 'string' ? ip : ip.publicSlug || ip.id;
  return `/ip/${encodeURIComponent(slug)}`;
}

export function internalIpHref(internalId: string): string {
  return publicIpHref(internalId);
}
