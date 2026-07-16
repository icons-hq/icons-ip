import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAuthState } from '@/lib/auth/server';
import type { NotificationItem } from '@/lib/notifications';
import Page, { metadata } from './page';

const mocks = vi.hoisted(() => ({
  auth: null as unknown as CurrentAuthState,
  loadNotifications: vi.fn(),
  notifications: vi.fn<(props: Record<string, unknown>) => null>(() => null),
  onboarded: true,
  openAction: vi.fn(),
}));

vi.mock('@/components/screens/Notifications', () => ({
  Notifications: mocks.notifications,
}));
vi.mock('@/lib/auth/onboarding', () => ({
  isOnboarded: () => mocks.onboarded,
  onboardingPath: (next: string) => `/onboarding?next=${encodeURIComponent(next)}`,
}));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: async () => mocks.auth }));
vi.mock('@/lib/notifications.server', () => ({
  loadNotifications: mocks.loadNotifications,
}));
vi.mock('./actions', () => ({ openNotificationAction: mocks.openAction }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); },
}));

const USER_ID = '00000000-0000-4000-8000-000000001401';
const items: NotificationItem[] = [{
  id: '11111111-1111-4111-8111-111111111111',
  type: 'order_paid',
  title: '결제를 확인했어요',
  body: '주문 상품을 준비하고 있어요.',
  linkPath: '/orders/order-1',
  readAt: null,
  createdAt: '2026-07-16T01:02:03.000Z',
  isUnread: true,
}];

function onboardedAuth(): CurrentAuthState {
  return {
    isConfigured: true,
    user: { id: USER_ID, email: 'fan@icons.test' },
    profile: {
      avatar_path: null,
      birth_date: '2000-01-01',
      consents: { terms: true, privacy: true, marketing: false },
      email: 'fan@icons.test',
      nickname: 'fan',
      onboarded_at: '2026-07-16T00:00:00.000Z',
      role: 'user',
    },
    isStaff: false,
  };
}

beforeEach(() => {
  mocks.auth = onboardedAuth();
  mocks.loadNotifications.mockReset();
  mocks.loadNotifications.mockResolvedValue(items);
  mocks.notifications.mockClear();
  mocks.onboarded = true;
  mocks.openAction.mockReset();
});

describe('/notifications page', () => {
  it('is a private noindex inbox in metadata', () => {
    expect(metadata).toMatchObject({
      title: '알림함 — ICONS',
      robots: { index: false, follow: false },
    });
    expect(metadata.description).toContain('인앱 알림');
  });

  it('requires authentication before reading user data', async () => {
    mocks.auth = {
      isConfigured: true,
      user: null,
      profile: null,
      isStaff: false,
    };

    await expect(Page()).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fnotifications');
    expect(mocks.loadNotifications).not.toHaveBeenCalled();
  });

  it('requires onboarding before reading user data', async () => {
    mocks.onboarded = false;

    await expect(Page()).rejects.toThrow('NEXT_REDIRECT:/onboarding?next=%2Fnotifications');
    expect(mocks.loadNotifications).not.toHaveBeenCalled();
  });

  it('loads the owner inbox and passes the open server action to the screen', async () => {
    renderToStaticMarkup(await Page({
      searchParams: Promise.resolve({ open_error: '1' }),
    }));

    expect(mocks.loadNotifications).toHaveBeenCalledWith(USER_ID);
    expect(mocks.notifications).toHaveBeenCalledWith({
      error: true,
      notifications: items,
      openAction: mocks.openAction,
    }, undefined);
  });
});
