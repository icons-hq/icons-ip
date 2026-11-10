import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurrentAdminAuthState } from './admin';
import { configuredOperatorAccessFixture, legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  profile: null as Record<string, unknown> | null,
  select: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: () => ({ isConfigured: true }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: mocks.getUser },
    rpc: mocks.rpc,
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
    mocks.rpc.mockReset().mockResolvedValue({ data: legacyOperatorAccessFixture(), error: null });
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
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('uses the current DB assignment instead of granting the raw profile role', async () => {
    mocks.profile = { role: 'staff', suspended_at: null };
    const access = configuredOperatorAccessFixture('logistics');
    mocks.rpc.mockResolvedValue({ data: access, error: null });
    expect(await getCurrentAdminAuthState()).toMatchObject({ isStaff: true, operatorAccess: access });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_current_operator_access');
  });
  it.each([{ data: null, error: { message: 'offline' } }, { data: { mode: 'legacy' }, error: null }])('fails closed for missing or invalid capability responses', async response => {
    mocks.profile = { role: 'admin', suspended_at: null };
    mocks.rpc.mockResolvedValue(response);
    expect(await getCurrentAdminAuthState()).toMatchObject({ isStaff: false, operatorAccess: { mode: 'none', capabilities: [] } });
  });
  it('does not restore raw admin authority after a network failure', async () => {
    mocks.profile = { role: 'admin', suspended_at: null };
    mocks.rpc.mockRejectedValue(new Error('unavailable'));
    expect(await getCurrentAdminAuthState()).toMatchObject({ isStaff: false, operatorAccess: { mode: 'none' } });
  });
});
