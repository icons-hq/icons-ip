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
  it('2단계 인증 요구가 켜졌는데 세션이 기준을 못 넘으면 운영자 권한을 주지 않고 대기만 알린다(OPS-006)', async () => {
    mocks.profile = { role: 'staff', suspended_at: null };
    mocks.rpc.mockResolvedValue({ data: { ...configuredOperatorAccessFixture('primary'), mfa: { required: true, satisfied: false } }, error: null });
    expect(await getCurrentAdminAuthState()).toMatchObject({ isStaff: false, mfaPending: true, mfaRequired: true, operatorAccess: { mode: 'none', capabilities: [] } });
    mocks.rpc.mockResolvedValue({ data: { ...configuredOperatorAccessFixture('primary'), mfa: 'broken' }, error: null });
    expect(await getCurrentAdminAuthState()).toMatchObject({ isStaff: false, mfaPending: true });
  });
  it('기준을 넘은 세션과 스위치가 꺼진(또는 키를 모르는 옛 DB) 응답은 지금처럼 운영자다', async () => {
    mocks.profile = { role: 'staff', suspended_at: null };
    const access = configuredOperatorAccessFixture('deputy');
    mocks.rpc.mockResolvedValue({ data: { ...access, mfa: { required: true, satisfied: true } }, error: null });
    const satisfied = await getCurrentAdminAuthState();
    expect(satisfied).toMatchObject({ isStaff: true, mfaRequired: true, operatorAccess: access });
    expect(satisfied.mfaPending).toBeUndefined();
    for (const data of [{ ...access, mfa: { required: false, satisfied: true } }, access]) {
      mocks.rpc.mockResolvedValue({ data, error: null });
      const state = await getCurrentAdminAuthState();
      expect(state).toMatchObject({ isStaff: true, operatorAccess: access });
      expect(state.mfaPending).toBeUndefined();
      expect(state.mfaRequired).toBeUndefined();
    }
  });
  it('운영자가 아니면 MFA 응답이 와도 대기로 보지 않는다', async () => {
    mocks.profile = { role: 'staff', suspended_at: null };
    mocks.rpc.mockResolvedValue({ data: { mode: 'none', managerRole: null, capabilities: [], revision: 2, setupRequired: false, mfa: { required: false, satisfied: false } }, error: null });
    const state = await getCurrentAdminAuthState();
    expect(state).toMatchObject({ isStaff: false });
    expect(state.mfaPending).toBeUndefined();
  });
  it('does not restore raw admin authority after a network failure', async () => {
    mocks.profile = { role: 'admin', suspended_at: null };
    mocks.rpc.mockRejectedValue(new Error('unavailable'));
    expect(await getCurrentAdminAuthState()).toMatchObject({ isStaff: false, operatorAccess: { mode: 'none' } });
  });
});
