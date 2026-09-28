import { describe, expect, it } from 'vitest';
import {
  IP_PUBLIC_SLUG_MAX_LENGTH,
  IP_PUBLIC_SLUG_PATTERN,
  RESERVED_IP_PUBLIC_SLUGS,
  internalIpHref,
  normalizeIpPublicSlug,
  publicIpHref,
  validateIpPublicSlug,
} from './ip-identity';

describe('IP public identity', () => {
  it('prefers the current public slug while preserving a legacy id fallback', () => {
    expect(publicIpHref({ id: 'old-ip', publicSlug: 'new-ip' })).toBe('/ip/new-ip');
    expect(publicIpHref({ id: 'legacy ip' })).toBe('/ip/legacy%20ip');
    expect(publicIpHref({ id: 'old-ip', publicSlug: null })).toBe('/ip/old-ip');
  });
  it('normalizes form whitespace without changing the public slug contract', () => {
    expect(normalizeIpPublicSlug('  hwasan  ')).toBe('hwasan');
    expect(validateIpPublicSlug('hwasan')).toBeNull();
    expect(IP_PUBLIC_SLUG_PATTERN.test('a'.repeat(IP_PUBLIC_SLUG_MAX_LENGTH))).toBe(true);
  });

  it.each([
    ['', 'required'],
    ['Hwasan', 'format'],
    ['hwa san', 'format'],
    ['-hwasan', 'format'],
    ['hwasan-', 'format'],
    ['a'.repeat(IP_PUBLIC_SLUG_MAX_LENGTH + 1), 'format'],
    ['aouad', 'reserved'],
  ] as const)('rejects %s with %s', (slug, error) => {
    expect(validateIpPublicSlug(slug)).toBe(error);
  });

  it('keeps static IP routes out of the editable slug namespace', () => {
    expect(RESERVED_IP_PUBLIC_SLUGS.has('aouad')).toBe(true);
    expect(publicIpHref('maple story')).toBe('/ip/maple%20story');
    expect(internalIpHref('maplestory')).toBe('/ip/maplestory');
  });
});
