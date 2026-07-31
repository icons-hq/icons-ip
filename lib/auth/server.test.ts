import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurrentAuthState } from './server';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  profile: null as Record<string, unknown> | null,
  select: vi.fn(),
}));

vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: () => ({ isConfigured: true }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: mocks.getUser },
    from: () => {
      const query = {
        select: mocks.select,
        eq: () => query,
        maybeSingle: async () => ({ data: mocks.profile, error: null }),
      };
      mocks.select.mockImplementation(() => query);
      return query;
    },
  }),
}));

describe('getCurrentAuthState', () => {
  beforeEach(() => {
    mocks.getUser.mockReset();
    mocks.select.mockReset();
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'staff@icons.gg' } },
      error: null,
    });
    mocks.profile = {
      email: 'staff@icons.gg',
      nickname: 'staff',
      birth_date: '2000-01-01',
      avatar_path: null,
      consents: { terms: true, privacy: true },
      onboarded_at: '2026-07-01T00:00:00.000Z',
      role: 'staff',
      suspended_at: '2026-07-17T00:00:00.000Z',
    };
  });

  it('loads suspension state and never treats suspended staff as staff', async () => {
    const state = await getCurrentAuthState();

    expect(mocks.select).toHaveBeenCalledWith(
      'email,nickname,birth_date,avatar_path,consents,onboarded_at,role,suspended_at',
    );
    expect(state.profile?.suspended_at).toBe('2026-07-17T00:00:00.000Z');
    expect(state.isStaff).toBe(false);
  });
});
