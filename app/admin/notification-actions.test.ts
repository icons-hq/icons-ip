import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendAdminNotificationAction } from './notification-actions';

const OPERATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NEXT_OPERATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const mocks = vi.hoisted(() => ({
  adminState: {
    isConfigured: true,
    user: { id: 'staff-1', email: 'staff@icons.gg' },
    role: 'staff' as 'user' | 'staff' | 'admin',
    isStaff: true,
  } as {
    isConfigured: boolean;
    user: { id: string; email: string | null } | null;
    role: 'user' | 'staff' | 'admin' | null;
    isStaff: boolean;
  },
  randomUUID: vi.fn(),
  revalidatePath: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('node:crypto', () => ({ randomUUID: mocks.randomUUID }));
vi.mock('@/lib/auth/admin', () => ({
  getCurrentAdminAuthState: () => mocks.adminState,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

function notificationForm(entries: Record<string, string> = {}) {
  const formData = new FormData();
  formData.set('operationId', OPERATION_ID);
  formData.set('scope', 'ip_followers');
  formData.set('ipId', 'rilakkuma');
  formData.set('title', '  신규 카드팩 안내  ');
  formData.set('body', '  알림함에서 새 소식을 확인해주세요.  ');
  formData.set('linkPath', 'https://attacker.example');
  formData.set('recipientCount', '999999');
  for (const [key, value] of Object.entries(entries)) formData.set(key, value);
  return formData;
}

describe('sendAdminNotificationAction', () => {
  beforeEach(() => {
    mocks.adminState = {
      isConfigured: true,
      user: { id: 'staff-1', email: 'staff@icons.gg' },
      role: 'staff',
      isStaff: true,
    };
    mocks.randomUUID.mockReset();
    mocks.randomUUID.mockReturnValue(NEXT_OPERATION_ID);
    mocks.revalidatePath.mockReset();
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({
      data: [{ recipient_count: '9', sent_at: '2026-07-16T01:02:03.000Z' }],
      error: null,
    });
  });

  it('비로그인은 로그인으로 보내고 발송 RPC를 호출하지 않는다', async () => {
    mocks.adminState = { isConfigured: true, user: null, role: null, isStaff: false };

    await expect(sendAdminNotificationAction({}, notificationForm())).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fadmin',
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('비staff는 앱과 DB 양쪽 경계 전에 차단한다', async () => {
    mocks.adminState = {
      isConfigured: true,
      user: { id: 'fan-1', email: 'fan@icons.gg' },
      role: 'user',
      isStaff: false,
    };

    await expect(sendAdminNotificationAction({}, notificationForm())).resolves.toEqual({
      errors: { form: '관리자 권한이 필요합니다.' },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('폼을 서버에서 검증하고 잘못된 입력은 발송하지 않는다', async () => {
    await expect(sendAdminNotificationAction({}, notificationForm({
      operationId: 'invalid',
      title: '',
    }))).resolves.toEqual({
      errors: {
        operationId: '올바른 발송 요청 ID가 필요합니다.',
        title: '제목은 1자 이상 120자 이하로 입력해주세요.',
      },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('같은 operation ID와 정규화된 입력만 audited 발송 RPC에 넘긴다', async () => {
    await expect(sendAdminNotificationAction({}, notificationForm())).resolves.toEqual({
      message: '9명에게 인앱 공지를 발송했습니다.',
      recipientCount: 9,
      nextOperationId: NEXT_OPERATION_ID,
    });

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_send_notification', {
      target_body: '알림함에서 새 소식을 확인해주세요.',
      target_ip_id: 'rilakkuma',
      target_operation_id: OPERATION_ID,
      target_scope: 'ip_followers',
      target_title: '신규 카드팩 안내',
    });
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain('attacker.example');
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain('999999');
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ['/admin'],
      ['/notifications'],
    ]);
    expect(mocks.randomUUID).toHaveBeenCalledOnce();
  });

  it('DB 오류 원문을 숨기고 현재 operation ID를 재시도할 수 있게 보존한다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'private db detail' } });

    const result = await sendAdminNotificationAction({}, notificationForm());

    expect(result).toEqual({
      errors: { form: '공지를 발송하지 못했습니다. 대상과 최신 수신자 수를 확인해주세요.' },
    });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(result).not.toHaveProperty('nextOperationId');
    expect(mocks.randomUUID).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('DB가 실제 수신자 수를 반환하지 않으면 성공으로 보고하지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });

    await expect(sendAdminNotificationAction({}, notificationForm())).resolves.toEqual({
      errors: { form: '공지를 발송하지 못했습니다. 최신 발송 이력을 확인해주세요.' },
    });
    expect(mocks.randomUUID).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('DB가 확정한 전체 대상 수를 임의 상한 없이 성공 결과로 사용한다', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ recipient_count: '10001', sent_at: '2026-07-16T01:02:03.000Z' }],
      error: null,
    });

    await expect(sendAdminNotificationAction({}, notificationForm({ scope: 'all' })))
      .resolves.toMatchObject({
        message: '10,001명에게 인앱 공지를 발송했습니다.',
        recipientCount: 10001,
      });
  });
});
