import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  estimateAdminNotificationAudience,
  getAdminNotificationConsoleData,
} from './notifications.server';

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
  ipArchivedFilter: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/auth/admin', () => ({
  getCurrentAdminAuthState: () => mocks.adminState,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    from: () => {
      const query = {
        select: vi.fn(() => query),
        is: vi.fn((column: string, value: unknown) => {
          mocks.ipArchivedFilter(column, value);
          return query;
        }),
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
    mocks.ipArchivedFilter.mockReset();
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
      if (name === 'admin_pick_ips') {
        return Promise.resolve({
          data: mocks.ipRows.map((ip, index) => ({
            id: ip.id,
            title: ip.title,
            vertical_key: 'blgl',
            archived_at: null,
            fans_count: 0,
            rank: index + 1,
          })),
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

  it('전체 추정치·IP 후보·최근 20건 이력만 부르고, IP 별 추정은 하지 않는다', async () => {
    await expect(getAdminNotificationConsoleData()).resolves.toEqual({
      allAudience: {
        scope: 'all',
        ipId: null,
        ipTitle: null,
        recipientCount: 12,
        canSend: true,
      },
      ipOptions: [
        { id: 'hwasan', title: '화산강림', archivedAt: null },
        { id: 'rilakkuma', title: '리락쿠마', archivedAt: null },
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
    expect(mocks.rpc).toHaveBeenCalledWith('admin_list_notification_history', {
      target_limit: 20,
      target_offset: 0,
    });

    /* 화면을 여는 것만으로 IP 수만큼 왕복하면 IP 가 늘수록 화면이 못 열린다 —
       IP 별 추정은 **고른 뒤에** 한 번만 한다. */
    const perIpCalls = mocks.rpc.mock.calls.filter(
      ([name, args]) => name === 'admin_estimate_notification_recipients'
        && (args as { target_ip_id: string | null }).target_ip_id !== null,
    );
    expect(perIpCalls).toHaveLength(0);
  });

  it('IP 후보는 검색형 선택기 RPC 로 상한을 두고 받는다', async () => {
    await getAdminNotificationConsoleData();

    expect(mocks.rpc).toHaveBeenCalledWith('admin_pick_ips', {
      p_query: null,
      p_selected_id: null,
      p_limit: 50,
    });
  });

  it('고른 IP 하나만 그때 센다', async () => {
    await expect(estimateAdminNotificationAudience('hwasan')).resolves.toEqual({
      scope: 'ip_followers',
      ipId: 'hwasan',
      ipTitle: '화산강림',
      recipientCount: 3,
      canSend: true,
    });

    expect(mocks.rpc).toHaveBeenCalledWith('admin_estimate_notification_recipients', {
      target_ip_id: 'hwasan',
      target_scope: 'ip_followers',
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
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
