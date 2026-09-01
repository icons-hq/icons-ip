import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  archiveAdminCatalogRecordAction,
  unarchiveAdminCatalogRecordAction,
} from './archive-actions';

const RECORD_ID = 'catalog-record-1';

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

function archiveForm(kind = 'ip', id = RECORD_ID) {
  const formData = new FormData();
  formData.set('kind', kind);
  formData.set('id', id);
  return formData;
}

const broadRevalidationCalls = [
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
];

describe('admin catalog archive actions', () => {
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
    mocks.rpc.mockResolvedValue({ data: null, error: null });
  });

  it.each([
    ['archive', 'ip', 'admin_archive_ip', archiveAdminCatalogRecordAction, '카탈로그 항목을 보관했습니다.'],
    ['archive', 'good', 'admin_archive_good', archiveAdminCatalogRecordAction, '카탈로그 항목을 보관했습니다.'],
    ['archive', 'card', 'admin_archive_card', archiveAdminCatalogRecordAction, '카탈로그 항목을 보관했습니다.'],
    ['archive', 'event', 'admin_archive_event', archiveAdminCatalogRecordAction, '카탈로그 항목을 보관했습니다.'],
    ['unarchive', 'ip', 'admin_unarchive_ip', unarchiveAdminCatalogRecordAction, '카탈로그 항목을 복원했습니다.'],
    ['unarchive', 'good', 'admin_unarchive_good', unarchiveAdminCatalogRecordAction, '카탈로그 항목을 복원했습니다.'],
    ['unarchive', 'card', 'admin_unarchive_card', unarchiveAdminCatalogRecordAction, '카탈로그 항목을 복원했습니다.'],
    ['unarchive', 'event', 'admin_unarchive_event', unarchiveAdminCatalogRecordAction, '카탈로그 항목을 복원했습니다.'],
  ] as const)('%s %s calls the exact audited RPC and revalidates catalog surfaces', async (
    _operation,
    kind,
    rpcName,
    action,
    message,
  ) => {
    await expect(action({}, archiveForm(kind))).resolves.toEqual({ message, changed: true });

    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith(rpcName, { target_id: RECORD_ID });
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ...broadRevalidationCalls,
      ...(kind === 'ip' ? [[`/ip/${RECORD_ID}`]] : []),
    ]);
  });

  it.each([
    ['missing kind', archiveForm('', RECORD_ID), { kind: '지원하지 않는 카탈로그 유형입니다.' }],
    ['unknown kind', archiveForm('banner', RECORD_ID), { kind: '지원하지 않는 카탈로그 유형입니다.' }],
    ['missing id', archiveForm('ip', ''), { id: '올바른 카탈로그 ID가 필요합니다.' }],
    ['uppercase id', archiveForm('ip', 'Catalog-1'), { id: '올바른 카탈로그 ID가 필요합니다.' }],
    ['spaced id', archiveForm('ip', 'catalog record'), { id: '올바른 카탈로그 ID가 필요합니다.' }],
  ])('rejects %s before auth or RPC access', async (_label, formData, errors) => {
    await expect(archiveAdminCatalogRecordAction({}, formData)).resolves.toEqual({ errors });

    expect(mocks.getCurrentAdminAuthState).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('returns a configuration error without redirecting or creating a client', async () => {
    mocks.adminState = { isConfigured: false, user: null, role: null, isStaff: false };

    await expect(archiveAdminCatalogRecordAction({}, archiveForm())).resolves.toEqual({
      errors: {
        form: 'Supabase 환경변수를 설정한 뒤 카탈로그 보관 상태를 변경할 수 있습니다.',
      },
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('redirects an unauthenticated request to the exact admin login path', async () => {
    mocks.adminState = { isConfigured: true, user: null, role: null, isStaff: false };

    await expect(archiveAdminCatalogRecordAction({}, archiveForm())).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fadmin',
    );
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('rejects a signed-in non-staff user before RPC access', async () => {
    mocks.adminState = {
      isConfigured: true,
      user: { id: 'fan-1', email: 'fan@icons.test' },
      role: 'user',
      isStaff: false,
    };

    await expect(archiveAdminCatalogRecordAction({}, archiveForm())).resolves.toEqual({
      errors: { form: '관리자 권한이 필요합니다.' },
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('fails closed when the auth state cannot be read', async () => {
    mocks.getCurrentAdminAuthState.mockRejectedValue(new Error('private auth detail'));

    const result = await archiveAdminCatalogRecordAction({}, archiveForm());

    expect(result).toEqual({
      errors: { form: '카탈로그 보관 상태를 변경하지 못했습니다. 다시 시도해주세요.' },
    });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it.each([
    ['client creation', () => mocks.createClient.mockRejectedValue(new Error('private client detail'))],
    ['RPC rejection', () => mocks.rpc.mockRejectedValue(new Error('private rpc detail'))],
  ])('maps a %s failure to a safe retryable error', async (_label, arrange) => {
    arrange();

    const result = await archiveAdminCatalogRecordAction({}, archiveForm());

    expect(result).toEqual({
      errors: { form: '카탈로그 보관 상태를 변경하지 못했습니다. 다시 시도해주세요.' },
    });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ['catalog_not_found', '카탈로그 항목을 찾을 수 없습니다.'],
    ['ip_has_active_children', '운영 중인 하위 굿즈·카드·이벤트를 먼저 보관해주세요.'],
    ['ip_has_active_operations', '진행 중인 카드풀·리워드·게임 운영을 먼저 종료해주세요.'],
    ['good_has_stock', '판매 가능한 재고가 남아 있어 굿즈를 보관할 수 없습니다.'],
    ['good_has_active_policy', '활성 리워드 정책에 연결된 굿즈는 보관할 수 없습니다.'],
    ['card_has_open_pool', '운영 중인 카드풀에 연결된 카드는 보관할 수 없습니다.'],
    ['card_has_open_tickets', '미개봉 카드팩에서 발급될 수 있는 카드는 보관할 수 없습니다.'],
    ['event_has_open_ticketing', '진행 중인 예매가 있는 이벤트는 보관할 수 없습니다.'],
    ['event_has_open_game', '운영 중인 게임에 연결된 이벤트는 보관할 수 없습니다.'],
    ['parent_archived', '상위 IP를 먼저 복원해주세요.'],
  ])('maps the %s guard without exposing DB details', async (token, message) => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: `private prefix: ${token}` },
    });

    const result = await archiveAdminCatalogRecordAction({}, archiveForm());

    expect(result).toEqual({ errors: { form: message } });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: '42501', message: 'private permission detail' }, '관리자 권한이 필요합니다.'],
    [{ code: 'P0001', message: 'forbidden: private detail' }, '관리자 권한이 필요합니다.'],
    [
      { code: 'XX000', message: 'private unexpected detail' },
      '카탈로그 보관 상태를 변경하지 못했습니다. 최신 상태를 확인해주세요.',
    ],
  ])('maps DB code/message to a safe action error %#', async (error, message) => {
    mocks.rpc.mockResolvedValue({ data: null, error });

    const result = await unarchiveAdminCatalogRecordAction({}, archiveForm('card'));

    expect(result).toEqual({ errors: { form: message } });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
