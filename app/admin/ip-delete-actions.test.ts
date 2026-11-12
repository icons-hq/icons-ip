const { configuredOperatorAccessFixture, legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteAdminDraftIpAction } from './ip-delete-actions';

const mocks = vi.hoisted(() => ({
  adminState: {} as Record<string, unknown>,
  getCurrentAdminAuthState: vi.fn(),
  createClient: vi.fn(),
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.getCurrentAdminAuthState }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  RedirectType: { push: 'push', replace: 'replace' },
  redirect: (path: string, type?: string) => { throw new Error(`NEXT_REDIRECT:${type ?? 'push'}:${path}`); },
  unstable_rethrow: (error: unknown) => { if (error instanceof Error && error.message.startsWith('NEXT_REDIRECT')) throw error; },
}));

function form(id = 'hwasan') {
  const formData = new FormData();
  formData.set('id', id);
  return formData;
}

function signedIn(role: 'staff' | 'admin', operatorAccess = legacyOperatorAccessFixture(role)) {
  mocks.adminState = { isConfigured: true, user: { id: `${role}-1`, email: `${role}@icons.test` }, role, isStaff: true, operatorAccess };
}

beforeEach(() => {
  signedIn('admin');
  mocks.getCurrentAdminAuthState.mockReset().mockImplementation(async () => mocks.adminState);
  mocks.createClient.mockReset().mockResolvedValue({ rpc: mocks.rpc });
  mocks.rpc.mockReset().mockResolvedValue({ data: true, error: null });
  mocks.revalidatePath.mockReset();
});

describe('deleteAdminDraftIpAction', () => {
  it('deletes through the audited RPC and returns to the IP list with the retired ID', async () => {
    await expect(deleteAdminDraftIpAction({}, form())).rejects.toThrow('NEXT_REDIRECT:replace:/admin/catalog/ips?deleted=hwasan');
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_delete_draft_ip', { target_id: 'hwasan' });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/catalog/ips');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/catalog/ips/hwasan');
  });

  it('lets a configured primary manager delete', async () => {
    signedIn('staff', configuredOperatorAccessFixture('primary'));
    await expect(deleteAdminDraftIpAction({}, form())).rejects.toThrow('NEXT_REDIRECT:replace:');
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it.each([
    ['legacy staff', () => signedIn('staff')],
    ['a configured deputy', () => signedIn('staff', configuredOperatorAccessFixture('deputy'))],
  ])('keeps the irreversible delete away from %s', async (_label, arrange) => {
    arrange();
    await expect(deleteAdminDraftIpAction({}, form())).resolves.toEqual({
      errors: { form: '미사용 IP 삭제는 통합 매니저·계정 주매니저(권한 전환 전에는 기존 관리자)만 할 수 있습니다.' },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('sends a signed-out operator to login and validates the ID before any read', async () => {
    mocks.adminState = { isConfigured: true, user: null, role: null, isStaff: false };
    await expect(deleteAdminDraftIpAction({}, form())).rejects.toThrow('NEXT_REDIRECT:push:/login?next=%2Fadmin%2Fcatalog%2Fips%2Fhwasan');
    await expect(deleteAdminDraftIpAction({}, form('Bad Id'))).resolves.toEqual({
      errors: { form: 'IP를 확인하지 못했습니다. 새로고침한 뒤 다시 시도해주세요.' },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('keeps the operator on the IP with the reason when the DB refuses', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '23514', message: 'ip_has_references' } });
    await expect(deleteAdminDraftIpAction({}, form())).resolves.toEqual({
      errors: { form: '그사이 연결된 항목이 생겨 삭제하지 않았습니다. 새로고침해 연결을 확인해주세요.' },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('does not leak transport details', async () => {
    mocks.rpc.mockRejectedValue(new Error('private-provider-token'));
    const result = await deleteAdminDraftIpAction({}, form());
    expect(result).toEqual({ errors: { form: 'IP를 삭제하지 못했습니다. 잠시 후 다시 시도해주세요.' } });
  });
});
