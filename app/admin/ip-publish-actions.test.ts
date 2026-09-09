import { beforeEach, describe, expect, it, vi } from 'vitest';
import { publishAdminIpAction, unpublishAdminIpAction } from './ip-publish-actions';

const IP_ID = 'publish-target-ip';

const mocks = vi.hoisted(() => ({
  adminState: {
    isConfigured: true,
    user: { id: 'staff-1', email: 'staff@icons.test' },
    role: 'staff' as 'user' | 'staff' | 'admin',
    isStaff: true,
  } as {
    isConfigured: boolean;
    user: { id: string; email: string | null } | null;
    role: 'user' | 'staff' | 'admin' | null;
    isStaff: boolean;
  },
  createClient: vi.fn(),
  getCurrentAdminAuthState: vi.fn(),
  revalidatePath: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/auth/admin', () => ({
  getCurrentAdminAuthState: mocks.getCurrentAdminAuthState,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

function publishForm(id = IP_ID) {
  const formData = new FormData();
  formData.set('id', id);
  formData.set('confirmUnpublish', 'yes');
  return formData;
}

const revalidationCalls = [
  ['/'],
  ['/ip'],
  ['/shop'],
  ['/binder'],
  ['/events'],
  ['/offline-popups'],
  ['/search'],
  ['/cart'],
  ['/checkout'],
  ['/packs'],
  ['/admin'],
  ['/ip/[id]', 'page'],
  ['/events/[eventId]', 'page'],
  ['/offline-popups/[eventId]', 'page'],
  ['/games/[gameId]', 'page'],
  [`/ip/${IP_ID}`],
  ['/admin/catalog/ips'],
  [`/admin/catalog/ips/${IP_ID}`],
];

describe('admin IP publish actions', () => {
  it('requires explicit acknowledgement before reverting a published IP', async () => {
    const form = publishForm();
    form.delete('confirmUnpublish');
    await expect(unpublishAdminIpAction({}, form)).resolves.toEqual({
      errors: { form: '초안 전환의 영향을 확인한 뒤 다시 시도해주세요.' },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    mocks.adminState = {
      isConfigured: true,
      user: { id: 'staff-1', email: 'staff@icons.test' },
      role: 'staff',
      isStaff: true,
    };
    mocks.getCurrentAdminAuthState.mockReset();
    mocks.getCurrentAdminAuthState.mockImplementation(async () => mocks.adminState);
    mocks.createClient.mockReset();
    mocks.createClient.mockReturnValue({ rpc: mocks.rpc });
    mocks.revalidatePath.mockReset();
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({ data: true, error: null });
  });

  it.each([
    ['publish', publishAdminIpAction, true, 'IP를 공개로 전환했습니다.'],
    ['unpublish', unpublishAdminIpAction, false, 'IP를 초안으로 되돌렸습니다.'],
  ] as const)('%s calls the audited RPC and revalidates every public IP surface', async (
    _operation,
    action,
    published,
    message,
  ) => {
    await expect(action({}, publishForm())).resolves.toEqual({ message, changed: true });

    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith('admin_set_ip_published', {
      target_id: IP_ID,
      target_published: published,
    });
    expect(mocks.revalidatePath.mock.calls).toEqual(revalidationCalls);
  });

  it('reports an idempotent replay as unchanged without treating it as a failure', async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });

    await expect(publishAdminIpAction({}, publishForm())).resolves.toEqual({
      message: 'IP를 공개로 전환했습니다.',
      changed: false,
    });
  });

  it.each([
    ['missing id', publishForm('')],
    ['uppercase id', publishForm('Hwasan')],
    ['spaced id', publishForm('hwa san')],
  ])('rejects %s before auth or RPC access', async (_label, formData) => {
    await expect(publishAdminIpAction({}, formData)).resolves.toEqual({
      errors: { id: '올바른 IP ID가 필요합니다.' },
    });

    expect(mocks.getCurrentAdminAuthState).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('redirects unauthenticated callers and blocks non-staff without writing', async () => {
    mocks.adminState = { isConfigured: true, user: null, role: null, isStaff: false };
    await expect(publishAdminIpAction({}, publishForm())).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fadmin');

    mocks.adminState = {
      isConfigured: true,
      user: { id: 'user-1', email: 'fan@icons.test' },
      role: 'user',
      isStaff: false,
    };
    await expect(unpublishAdminIpAction({}, publishForm())).resolves.toEqual({
      errors: { form: '관리자 권한이 필요합니다.' },
    });

    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('explains when Supabase is not configured', async () => {
    mocks.adminState = { isConfigured: false, user: null, role: null, isStaff: false };

    await expect(publishAdminIpAction({}, publishForm())).resolves.toEqual({
      errors: { form: 'Supabase 환경변수를 설정한 뒤 IP 게시 상태를 변경할 수 있습니다.' },
    });
  });

  it.each([
    ['catalog_not_found', 'IP를 찾을 수 없습니다. 목록을 새로고침한 뒤 다시 시도해주세요.'],
    ['catalog_item_archived', '보관된 IP는 게시 상태를 바꿀 수 없습니다. 먼저 복원해주세요.'],
    ['ip_publish_incomplete', 'IP 이름을 채운 뒤 공개해주세요.'],
    ['forbidden', '관리자 권한이 필요합니다.'],
    ['something else', 'IP 게시 상태를 변경하지 못했습니다. 최신 상태를 확인해주세요.'],
  ])('maps the RPC guard %s to operator language', async (token, message) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: token } });

    await expect(publishAdminIpAction({}, publishForm())).resolves.toEqual({
      errors: { form: message },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('turns a thrown client failure into a retry message', async () => {
    mocks.createClient.mockImplementation(() => {
      throw new Error('boom');
    });

    await expect(unpublishAdminIpAction({}, publishForm())).resolves.toEqual({
      errors: { form: 'IP 게시 상태를 변경하지 못했습니다. 다시 시도해주세요.' },
    });
  });
});
