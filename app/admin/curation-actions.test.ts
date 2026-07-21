import { beforeEach, describe, expect, it, vi } from 'vitest';
import { upsertAdminCurationAction } from './curation-actions';

const OPERATION_ID = '11111111-1111-4111-8111-111111111111';
const CURATION_ID = '22222222-2222-4222-8222-222222222222';
const IMAGE_PATH = 'public-media/catalog/curation/33333333-3333-4333-8333-333333333333.webp';

const mocks = vi.hoisted(() => ({
  auth: {
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

vi.mock('@/lib/admin/curations', async () => await import('../../lib/admin/curations'));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.getCurrentAdminAuthState }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); },
}));

function curationForm(entries: Record<string, string> = {}) {
  const formData = new FormData();
  formData.set('operationId', OPERATION_ID);
  formData.set('id', CURATION_ID);
  formData.set('kind', 'hero');
  formData.set('ipId', '');
  formData.set('title', '  홈 히어로  ');
  formData.set('imagePath', IMAGE_PATH);
  formData.set('linkPath', '  /ip/hwasan  ');
  formData.set('displayOrder', '2');
  formData.set('activeFrom', '2026-07-21T10:30');
  formData.set('activeTo', '');
  formData.set('enabled', 'on');
  for (const [key, value] of Object.entries(entries)) formData.set(key, value);
  return formData;
}

describe('admin curation action', () => {
  beforeEach(() => {
    mocks.auth = {
      isConfigured: true,
      user: { id: 'staff-1', email: 'staff@icons.test' },
      role: 'staff',
      isStaff: true,
    };
    mocks.createClient.mockReset();
    mocks.getCurrentAdminAuthState.mockReset();
    mocks.revalidatePath.mockReset();
    mocks.rpc.mockReset();
    mocks.getCurrentAdminAuthState.mockImplementation(async () => mocks.auth);
    mocks.createClient.mockReturnValue({ rpc: mocks.rpc });
    mocks.rpc.mockResolvedValue({ data: CURATION_ID, error: null });
  });

  it('passes the preserved operation UUID and only normalized target arguments to the upsert RPC', async () => {
    await expect(upsertAdminCurationAction({}, curationForm())).resolves.toEqual({
      message: '홈 큐레이션을 저장했습니다.',
    });

    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith('admin_upsert_home_curation', {
      target_operation_id: OPERATION_ID,
      target_curation_id: CURATION_ID,
      target_kind: 'hero',
      target_ip_id: null,
      target_title: '홈 히어로',
      target_image_path: IMAGE_PATH,
      target_link_path: '/ip/hwasan',
      target_display_order: 2,
      target_active_from: '2026-07-21T01:30:00.000Z',
      target_active_to: null,
      target_enabled: true,
    });
    expect(mocks.revalidatePath.mock.calls).toEqual([['/'], ['/admin']]);
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain('notification');
  });

  it('rejects invalid forms before auth, client, or RPC access', async () => {
    await expect(upsertAdminCurationAction({}, curationForm({
      operationId: 'invalid',
      linkPath: 'https://attacker.example',
    }))).resolves.toEqual({
      errors: {
        operationId: '유효한 저장 요청이 아닙니다.',
        linkPath: '1~2048자의 안전한 내부 경로를 입력해주세요.',
      },
    });
    expect(mocks.getCurrentAdminAuthState).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('redirects signed-out users and rejects non-staff users before RPC access', async () => {
    mocks.auth = { isConfigured: true, user: null, role: null, isStaff: false };
    await expect(upsertAdminCurationAction({}, curationForm())).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fadmin',
    );

    mocks.auth = {
      isConfigured: true,
      user: { id: 'fan-1', email: 'fan@icons.test' },
      role: 'user',
      isStaff: false,
    };
    await expect(upsertAdminCurationAction({}, curationForm())).resolves.toEqual({
      errors: { form: '관리자 권한이 필요합니다.' },
    });

    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ['auth read rejection', () => mocks.getCurrentAdminAuthState.mockRejectedValue(new Error('private auth detail'))],
    ['client creation rejection', () => mocks.createClient.mockRejectedValue(new Error('private client detail'))],
    ['RPC rejection', () => mocks.rpc.mockRejectedValue(new Error('private rpc detail'))],
    ['RPC error', () => mocks.rpc.mockResolvedValue({ data: null, error: { message: 'private db detail' } })],
  ])('returns one generic safe error for %s and does not revalidate', async (_label, arrange) => {
    arrange();

    const result = await upsertAdminCurationAction({}, curationForm());

    expect(result).toEqual({
      errors: { form: '홈 큐레이션을 저장하지 못했습니다. 다시 시도해주세요.' },
    });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
