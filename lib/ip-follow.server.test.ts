import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getIpFollowState, getIpNotificationPreferencesForUser } from './ip-follow.server';

const mocks = vi.hoisted(() => ({
  authGetUser: vi.fn(),
  createClient: vi.fn(),
  getProfileForUser: vi.fn(),
  getSupabaseConfig: vi.fn(),
  rows: [] as Record<string, unknown>[],
  queryError: null as { message: string } | null,
  records: [] as Array<{
    eq: Array<[string, unknown]>;
    select: string;
  }>,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/onboarding', () => ({ isOnboarded: () => true }));
vi.mock('@/lib/auth/server', () => ({ getProfileForUser: mocks.getProfileForUser }));
vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: mocks.getSupabaseConfig }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));

function createQuery() {
  const record = { eq: [] as Array<[string, unknown]>, select: '' };
  mocks.records.push(record);

  const result = () => ({ data: mocks.rows, error: mocks.queryError });
  const query = {
    select(columns: string) {
      record.select = columns;
      return query;
    },
    eq(column: string, value: unknown) {
      record.eq.push([column, value]);
      return query;
    },
    maybeSingle() {
      return Promise.resolve({ data: mocks.rows[0] ?? null, error: mocks.queryError });
    },
    then<TResult1 = ReturnType<typeof result>, TResult2 = never>(
      onfulfilled?: ((value: ReturnType<typeof result>) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve(result()).then(onfulfilled, onrejected);
    },
  };
  return query;
}

beforeEach(() => {
  mocks.authGetUser.mockReset();
  mocks.createClient.mockReset();
  mocks.getProfileForUser.mockReset();
  mocks.getSupabaseConfig.mockReset();
  mocks.rows = [];
  mocks.queryError = null;
  mocks.records = [];

  mocks.getSupabaseConfig.mockReturnValue({ isConfigured: true });
  mocks.authGetUser.mockResolvedValue({
    data: { user: { id: 'user-1', email: 'fan@icons.gg' } },
    error: null,
  });
  mocks.getProfileForUser.mockResolvedValue({
    email: 'fan@icons.gg',
    nickname: 'fan',
    birth_date: '2000-01-01',
    consents: { terms: true, privacy: true },
    onboarded_at: '2026-07-01T00:00:00.000Z',
  });
  mocks.createClient.mockResolvedValue({
    auth: { getUser: mocks.authGetUser },
    from: () => createQuery(),
  });
});

describe('getIpFollowState', () => {
  it('returns a non-followed, disabled-channel state for guests', async () => {
    mocks.getSupabaseConfig.mockReturnValue({ isConfigured: false });

    await expect(getIpFollowState('ip-1')).resolves.toEqual({
      isFollowed: false,
      notifyDrops: false,
      notifyEvents: false,
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('loads both channel preferences for the current followed IP', async () => {
    mocks.rows = [{ ip_id: 'ip-1', notify_drops: false, notify_events: true }];

    await expect(getIpFollowState('ip-1')).resolves.toEqual({
      isFollowed: true,
      notifyDrops: false,
      notifyEvents: true,
    });
    expect(mocks.records[0]).toEqual({
      select: 'ip_id,notify_drops,notify_events',
      eq: [['user_id', 'user-1'], ['ip_id', 'ip-1']],
    });
  });
});

describe('getIpNotificationPreferencesForUser', () => {
  it('maps every followed row to the shared settings DTO', async () => {
    mocks.rows = [
      { ip_id: 'ip-1', notify_drops: true, notify_events: false },
      { ip_id: 'ip-2', notify_drops: false, notify_events: true },
    ];

    await expect(getIpNotificationPreferencesForUser('user-1')).resolves.toEqual([
      { ipId: 'ip-1', notifyDrops: true, notifyEvents: false },
      { ipId: 'ip-2', notifyDrops: false, notifyEvents: true },
    ]);
    expect(mocks.records[0]).toEqual({
      select: 'ip_id,notify_drops,notify_events',
      eq: [['user_id', 'user-1']],
    });
  });

  it('throws instead of disguising a query failure as empty preferences', async () => {
    mocks.queryError = { message: 'private database detail' };

    await expect(getIpNotificationPreferencesForUser('user-1')).rejects.toThrow(
      'Failed to load IP notification preferences',
    );
  });
});
