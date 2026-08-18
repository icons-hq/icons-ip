import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminMessagingNotificationsPage from './page';

const mocks = vi.hoisted(() => ({
  authState: {
    isConfigured: true,
    user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' },
    role: 'staff',
    isStaff: true,
  } as {
    isConfigured: boolean;
    user: { id: string; email: string | null } | null;
    role: 'user' | 'staff' | 'admin' | null;
    isStaff: boolean;
  },
  notificationSection: vi.fn(() => null),
  notifications: vi.fn(async () => ({ audiences: [], history: [] })),
  curations: vi.fn(async () => []),
  emails: vi.fn(async () => []),
  randomUuid: vi.fn(),
}));

vi.mock('node:crypto', () => ({ randomUUID: mocks.randomUuid }));
vi.mock('@/components/admin/sections/NotificationSection', () => ({
  NotificationSection: mocks.notificationSection,
}));
vi.mock('@/lib/admin/notifications.server', () => ({
  getAdminNotificationConsoleData: mocks.notifications,
}));
vi.mock('@/lib/admin/curations.server', () => ({ getAdminCurations: mocks.curations }));
vi.mock('@/lib/email/deliveries.server', () => ({ loadEmailDeliveries: mocks.emails }));
vi.mock('@/lib/auth/admin', () => ({
  getCurrentAdminAuthState: vi.fn(async () => mocks.authState),
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

describe('AdminMessagingNotificationsPage', () => {
  beforeEach(() => {
    mocks.authState = {
      isConfigured: true,
      user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' },
      role: 'staff',
      isStaff: true,
    };
    mocks.notificationSection.mockClear();
    mocks.notifications.mockClear();
    mocks.curations.mockClear();
    mocks.emails.mockClear();
    mocks.randomUuid.mockReset();
    mocks.randomUuid
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
      .mockReturnValueOnce('33333333-3333-4333-8333-333333333333');
  });

  it('일반 사용자에게는 발송 콘솔을 읽기 전에 화면을 감춘다', async () => {
    mocks.authState = {
      isConfigured: true,
      user: { id: '44444444-4444-4444-8444-444444444444', email: 'fan@icons.gg' },
      role: 'user',
      isStaff: false,
    };

    await expect(AdminMessagingNotificationsPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.notifications).not.toHaveBeenCalled();
  });

  it('콘솔 데이터와 새 발송 멱등키를 전달한다', async () => {
    const screen = await AdminMessagingNotificationsPage();

    expect(screen.type).toBe(mocks.notificationSection);
    expect(screen.props).toEqual({
      data: { audiences: [], history: [] },
      operationId: '22222222-2222-4222-8222-222222222222',
    });
  });

  /* 같은 멱등키가 재사용되면 새로고침이 같은 공지를 다시 보내는 창이 생긴다. */
  it('요청마다 새 멱등키를 만든다', async () => {
    const first = await AdminMessagingNotificationsPage();
    const second = await AdminMessagingNotificationsPage();

    expect(first.props.operationId).toBe('22222222-2222-4222-8222-222222222222');
    expect(second.props.operationId).toBe('33333333-3333-4333-8333-333333333333');
  });

  it('다른 화면의 로더는 부르지 않는다', async () => {
    await AdminMessagingNotificationsPage();

    expect(mocks.curations).not.toHaveBeenCalled();
    expect(mocks.emails).not.toHaveBeenCalled();
  });
});
