import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurrentAdminAuthState } from './admin';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  profile: null as Record<string, unknown> | null,
  select: vi.fn(),
}));

vi.mock('server-only', () => ({}));
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

describe('getCurrentAdminAuthState', () => {
  beforeEach(() => {
    mocks.getUser.mockReset();
    mocks.select.mockReset();
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'admin@icons.gg' } },
      error: null,
    });
    mocks.profile = {
      role: 'admin',
      suspended_at: '2026-07-17T00:00:00.000Z',
    };
  });

  it('loads suspension state and denies suspended admin access', async () => {
    const state = await getCurrentAdminAuthState();

    expect(mocks.select).toHaveBeenCalledWith('role,suspended_at');
    expect(state.role).toBe('admin');
    expect(state.isStaff).toBe(false);
  });
});
