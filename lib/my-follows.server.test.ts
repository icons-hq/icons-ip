import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMyFollowedIpIds } from './my-follows.server';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  configured: true,
  result: { data: [] as unknown, error: null as { message: string } | null },
  calls: [] as unknown[][],
}));

vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: mocks.configured }) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from(table: string) {
      mocks.calls.push(['from', table]);
      const query = {
        select: (columns: string) => { mocks.calls.push(['select', columns]); return query; },
        eq: (column: string, value: unknown) => { mocks.calls.push(['eq', column, value]); return query; },
        order: (column: string, options: unknown) => { mocks.calls.push(['order', column, options]); return query; },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(mocks.result).then(resolve),
      };
      return query;
    },
  }),
}));

describe('loadMyFollowedIpIds', () => {
  beforeEach(() => {
    mocks.configured = true;
    mocks.calls = [];
    mocks.result = { data: [{ ip_id: 'ip-new', created_at: '2026-10-02' }, { ip_id: 'ip-old', created_at: '2026-09-01' }], error: null };
  });

  it("reads the member's own follows, most recent first", async () => {
    expect(await loadMyFollowedIpIds('user-1')).toEqual(['ip-new', 'ip-old']);
    expect(mocks.calls).toContainEqual(['from', 'ip_follows']);
    expect(mocks.calls).toContainEqual(['eq', 'user_id', 'user-1']);
    expect(mocks.calls).toContainEqual(['order', 'created_at', { ascending: false }]);
  });

  /* 못 읽음과 없음은 다른 값이다 — 화면이 "아직 없어요"라고 거짓말하지 않게 한다. */
  it('returns null on a read error and an empty list without a backend', async () => {
    mocks.result = { data: null, error: { message: 'down' } };
    expect(await loadMyFollowedIpIds('user-1')).toBeNull();

    mocks.configured = false;
    expect(await loadMyFollowedIpIds('user-1')).toEqual([]);
  });
});
