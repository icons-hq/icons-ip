import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolvePublicIpIdentity } from './ip-identity.server';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  canonical: null as Record<string, unknown> | null,
  alias: null as Record<string, unknown> | null,
  target: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: true }) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));

function query(table: string) {
  const state: { column?: string; value?: string } = {};
  const api = {
    select: vi.fn(() => api),
    eq: vi.fn((column: string, value: string) => {
      state.column = column;
      state.value = value;
      return api;
    }),
    maybeSingle: vi.fn(async () => {
      if (table === 'ips' && state.column === 'public_slug') return { data: mocks.canonical, error: null };
      if (table === 'ips' && state.column === 'id') return { data: mocks.target, error: null };
      if (table === 'ip_public_slug_aliases') return { data: mocks.alias, error: null };
      return { data: null, error: null };
    }),
  };
  return api;
}

beforeEach(() => {
  mocks.canonical = null;
  mocks.alias = null;
  mocks.target = null;
  mocks.createClient.mockReset().mockResolvedValue({
    from: (table: string) => query(table),
  });
});

describe('public IP identity resolver', () => {
  it('resolves a published canonical slug to the immutable internal id', async () => {
    mocks.canonical = { id: 'ip-internal', public_slug: 'current-ip', archived_at: null, published_at: '2026-09-10T00:00:00Z' };
    await expect(resolvePublicIpIdentity('current-ip')).resolves.toEqual({
      internalId: 'ip-internal', publicSlug: 'current-ip', isAlias: false,
    });
  });

  it.each([
    ['draft', { id: 'ip-draft', public_slug: 'draft-ip', archived_at: null, published_at: null }],
    ['archived', { id: 'ip-archived', public_slug: 'archived-ip', archived_at: '2026-09-10T00:00:00Z', published_at: '2026-09-09T00:00:00Z' }],
  ])('keeps %s IPs out of the public resolver, matching catalog visibility', async (_label, row) => {
    mocks.canonical = row;
    await expect(resolvePublicIpIdentity(String(row.public_slug))).resolves.toBeNull();
  });

  it('resolves an active alias only through its current published target', async () => {
    mocks.alias = { slug: 'old-ip', ip_id: 'ip-internal' };
    mocks.target = { id: 'ip-internal', public_slug: 'current-ip', archived_at: null, published_at: '2026-09-10T00:00:00Z' };
    await expect(resolvePublicIpIdentity('old-ip')).resolves.toEqual({
      internalId: 'ip-internal', publicSlug: 'current-ip', isAlias: true,
    });

    mocks.target = { ...mocks.target, published_at: null };
    await expect(resolvePublicIpIdentity('old-ip')).resolves.toBeNull();
  });
});
