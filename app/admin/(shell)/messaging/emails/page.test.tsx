import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminMessagingEmailsPage from './page';

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
  emailSection: vi.fn(() => null),
  emails: vi.fn(async () => [{ id: 'delivery-1' }]),
  notifications: vi.fn(async () => ({ audiences: [], history: [] })),
  orders: vi.fn(async () => ({})),
}));

vi.mock('@/components/admin/sections/EmailDeliverySection', () => ({
  EmailDeliverySection: mocks.emailSection,
}));
vi.mock('@/lib/email/deliveries.server', () => ({ loadEmailDeliveries: mocks.emails }));
vi.mock('@/lib/admin/notifications.server', () => ({
  getAdminNotificationConsoleData: mocks.notifications,
}));
vi.mock('@/lib/admin/orders.server', () => ({ getAdminOrderRecords: mocks.orders }));
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

describe('AdminMessagingEmailsPage', () => {
  beforeEach(() => {
    mocks.authState = {
      isConfigured: true,
      user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' },
      role: 'staff',
      isStaff: true,
    };
    mocks.emailSection.mockClear();
    mocks.emails.mockClear();
    mocks.notifications.mockClear();
    mocks.orders.mockClear();
  });

  it('로그인 전에는 메일 이력 경로를 next로 실어 로그인으로 보낸다', async () => {
    mocks.authState = { isConfigured: true, user: null, role: null, isStaff: false };

    await expect(AdminMessagingEmailsPage()).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fadmin%2Fmessaging%2Femails',
    );
    expect(mocks.emails).not.toHaveBeenCalled();
  });

  it('staff에게 발송 이력을 전달한다', async () => {
    const screen = await AdminMessagingEmailsPage();

    expect(screen.type).toBe(mocks.emailSection);
    expect(screen.props).toEqual({ deliveries: [{ id: 'delivery-1' }] });
  });

  it('다른 화면의 로더는 부르지 않는다', async () => {
    await AdminMessagingEmailsPage();

    expect(mocks.notifications).not.toHaveBeenCalled();
    expect(mocks.orders).not.toHaveBeenCalled();
  });
});
