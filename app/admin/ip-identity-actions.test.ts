import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateAdminIpIdentityAction } from './ip-identity-actions';

const mocks = vi.hoisted(() => ({
  adminState: {
    isConfigured: true,
    user: { id: 'staff-1', email: 'staff@icons.test' } as { id: string; email: string } | null,
    role: 'staff' as 'user' | 'staff' | 'admin',
    isStaff: true,
  },
  getCurrentAdminAuthState: vi.fn(),
  createClient: vi.fn(),
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.getCurrentAdminAuthState }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); },
  unstable_rethrow: (error: unknown) => { throw error; },
}));

function identityForm(overrides: Record<string, string> = {}) {
  const form = new FormData();
  form.set('previousId', overrides.previousId ?? 'hwasan');
  form.set('id', overrides.id ?? 'hwasan');
  form.set('publicSlug', overrides.publicSlug ?? 'mountain-fire');
  form.set('expectedPublicSlug', overrides.expectedPublicSlug ?? 'hwasan');
  return form;
}

beforeEach(() => {
  mocks.adminState = {
    isConfigured: true,
    user: { id: 'staff-1', email: 'staff@icons.test' },
    role: 'staff',
    isStaff: true,
  };
  mocks.getCurrentAdminAuthState.mockReset().mockResolvedValue(mocks.adminState);
  mocks.createClient.mockReset().mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockReset().mockResolvedValue({ data: true, error: null });
  mocks.revalidatePath.mockReset();
});

describe('admin IP identity action', () => {
  it('validates the editable slug before auth or RPC access and preserves input', async () => {
    const form = identityForm({ publicSlug: 'Mountain Fire' });
    await expect(updateAdminIpIdentityAction({}, form)).resolves.toMatchObject({
      errors: { publicSlug: '공개 URL은 영문 소문자·숫자·하이픈만 사용할 수 있습니다.' },
      values: { publicSlug: 'Mountain Fire', expectedPublicSlug: 'hwasan' },
      attempt: 1,
    });
    expect(mocks.getCurrentAdminAuthState).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('calls the staff audited RPC with an expected slug and revalidates old and new paths', async () => {
    await expect(updateAdminIpIdentityAction({}, identityForm())).resolves.toEqual({
      message: 'IP 공개 URL을 저장했습니다. 이전 URL은 별칭으로 유지됩니다.',
      changed: true,
    });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_update_ip_identity', {
      target_id: 'hwasan',
      target_public_slug: 'mountain-fire',
      target_expected_public_slug: 'hwasan',
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/ip/hwasan');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/ip/mountain-fire');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/ip/[id]', 'page');
  });

  it('accepts a legacy expected slug while keeping the newly chosen slug strict', async () => {
    const legacySlug = `${'legacy-'.repeat(14)}-`;
    await expect(updateAdminIpIdentityAction({}, identityForm({
      expectedPublicSlug: legacySlug,
      publicSlug: 'current-legacy-ip',
    }))).resolves.toMatchObject({ message: 'IP 공개 URL을 저장했습니다. 이전 URL은 별칭으로 유지됩니다.' });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_update_ip_identity', expect.objectContaining({
      target_expected_public_slug: legacySlug,
      target_public_slug: 'current-legacy-ip',
    }));
  });

  it('keeps a stale concurrent write recoverable', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'ip_public_slug_conflict' } });
    await expect(updateAdminIpIdentityAction({}, identityForm())).resolves.toMatchObject({
      errors: { form: '다른 운영자가 IP 공개 URL을 변경했습니다. 최신 내용을 확인한 뒤 다시 시도해주세요.' },
      values: { publicSlug: 'mountain-fire' },
      attempt: 1,
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ['non staff', { user: { id: 'user-1', email: 'user@icons.test' }, role: 'user', isStaff: false }, '관리자 권한이 필요합니다.'],
    ['duplicate', null, '이미 사용 중인 공개 URL입니다. 다른 슬러그를 입력해주세요.'],
  ] as const)('maps %s to an operator result', async (_label, state, message) => {
    if (state) {
      mocks.adminState = { ...mocks.adminState, ...state };
      mocks.getCurrentAdminAuthState.mockResolvedValue(mocks.adminState);
    } else {
      mocks.rpc.mockResolvedValue({ data: null, error: { message: 'ip_public_slug_taken' } });
    }
    await expect(updateAdminIpIdentityAction({}, identityForm())).resolves.toMatchObject({ errors: { form: message } });
    expect(mocks.rpc).toHaveBeenCalledTimes(state ? 0 : 1);
  });

  it('redirects an unauthenticated operator to this workspace', async () => {
    mocks.adminState = { isConfigured: true, user: null, role: 'user', isStaff: false };
    mocks.getCurrentAdminAuthState.mockResolvedValue(mocks.adminState);
    await expect(updateAdminIpIdentityAction({}, identityForm())).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fadmin%2Fcatalog%2Fips%2Fhwasan',
    );
  });
});
