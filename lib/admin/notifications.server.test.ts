import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAdminNotificationConsoleData } from './notifications.server';

const OPERATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

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
  ipError: null as { message: string } | null,
  ipRows: [] as Array<{ id: string; title: string }>,
  rpc: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/admin', () => ({
  getCurrentAdminAuthState: () => mocks.adminState,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    from: () => {
      const query = {
        select: vi.fn(() => query),
        order: vi.fn(() => Promise.resolve({ data: mocks.ipRows, error: mocks.ipError })),
      };
      return query;
    },
    rpc: mocks.rpc,
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

function estimate(scope: 'all' | 'ip_followers', ipId: string | null, title: string | null, count: number) {
  return [{
    scope,
    ip_id: ipId,
    ip_title: title,
    recipient_count: String(count),
    can_send: count > 0,
  }];
}

describe('getAdminNotificationConsoleData', () => {
  beforeEach(() => {
    mocks.adminState = {
      isConfigured: true,
      user: { id: 'staff-1', email: 'staff@icons.gg' },
      role: 'staff',
      isStaff: true,
    };
    mocks.ipRows = [
      { id: 'hwasan', title: '화산강림' },
      { id: 'rilakkuma', title: '리락쿠마' },
    ];
    mocks.ipError = null;
    mocks.rpc.mockReset();
    mocks.rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
      if (name === 'admin_estimate_notification_recipients') {
        if (args.target_scope === 'all') {
          return Promise.resolve({ data: estimate('all', null, null, 12), error: null });
        }
        const ipId = String(args.target_ip_id);
        const ip = mocks.ipRows.find((entry) => entry.id === ipId);
        return Promise.resolve({
          data: estimate('ip_followers', ipId, ip?.title ?? null, ipId === 'hwasan' ? 3 : 5),
          error: null,
        });
      }
      if (name === 'admin_list_notification_history') {
        return Promise.resolve({
          data: [{
            operation_id: OPERATION_ID,
            actor_name: '운영자',
            scope: 'all',
            ip_id: null,
            ip_title: null,
            title: '점검 안내',
            body: '점검이 종료되었습니다.',
            recipient_count: '12',
            sent_at: '2026-07-16T01:02:03.000Z',
          }],
          error: null,
        });
      }
      throw new Error(`unexpected RPC: ${name}`);
    });
  });

  it('전체와 각 IP 추정치 및 최근 20건 이력을 staff 전용 RPC로 불러온다', async () => {
    await expect(getAdminNotificationConsoleData()).resolves.toEqual({
      audiences: [
        {
          scope: 'all',
          ipId: null,
          ipTitle: null,
          recipientCount: 12,
          canSend: true,
        },
        {
          scope: 'ip_followers',
          ipId: 'hwasan',
          ipTitle: '화산강림',
          recipientCount: 3,
          canSend: true,
        },
        {
          scope: 'ip_followers',
          ipId: 'rilakkuma',
          ipTitle: '리락쿠마',
          recipientCount: 5,
          canSend: true,
        },
      ],
      history: [{
        operationId: OPERATION_ID,
        actorName: '운영자',
        scope: 'all',
        ipId: null,
        ipTitle: null,
        title: '점검 안내',
        body: '점검이 종료되었습니다.',
        recipientCount: 12,
        sentAt: '2026-07-16T01:02:03.000Z',
      }],
    });

    expect(mocks.rpc).toHaveBeenCalledWith('admin_estimate_notification_recipients', {
      target_ip_id: null,
      target_scope: 'all',
    });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_estimate_notification_recipients', {
      target_ip_id: 'hwasan',
      target_scope: 'ip_followers',
    });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_estimate_notification_recipients', {
      target_ip_id: 'rilakkuma',
      target_scope: 'ip_followers',
    });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_list_notification_history', {
      target_limit: 20,
      target_offset: 0,
    });
  });

  it('비로그인은 로그인으로 보내고 어떤 DB 조회도 하지 않는다', async () => {
    mocks.adminState = { isConfigured: true, user: null, role: null, isStaff: false };

    await expect(getAdminNotificationConsoleData()).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fadmin',
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('비staff는 not found로 막고 어떤 DB 조회도 하지 않는다', async () => {
    mocks.adminState = {
      isConfigured: true,
      user: { id: 'fan-1', email: 'fan@icons.gg' },
      role: 'user',
      isStaff: false,
    };

    await expect(getAdminNotificationConsoleData()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('DB 오류 원문을 브라우저 경계로 전달하지 않는다', async () => {
    mocks.rpc.mockImplementation((name: string) => {
      if (name === 'admin_list_notification_history') {
        return Promise.resolve({ data: null, error: { message: 'private schema detail' } });
      }
      return Promise.resolve({ data: estimate('all', null, null, 1), error: null });
    });

    const error = await getAdminNotificationConsoleData().then(
      () => null,
      (caught: unknown) => caught as Error,
    );

    expect(error?.message).toBe('Failed to load admin notification history');
    expect(error?.message).not.toContain('private');
  });
});
