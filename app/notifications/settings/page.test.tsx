import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAuthState } from '@/lib/auth/server';
import Page, { metadata } from './page';

const mocks = vi.hoisted(() => ({
  action: vi.fn(),
  auth: null as unknown as CurrentAuthState,
  catalog: { ips: [{ id: 'hwasan', title: '화산강림' }] },
  getCatalogSnapshot: vi.fn(),
  getPreferences: vi.fn(),
  onboarded: true,
  screen: vi.fn<(props: Record<string, unknown>) => null>(() => null),
}));

vi.mock('@/app/ip/actions', () => ({
  setIpNotificationPreferencesAction: mocks.action,
}));
vi.mock('@/components/screens/NotificationSettings', () => ({
  NotificationSettings: mocks.screen,
}));
vi.mock('@/lib/auth/onboarding', () => ({
  isOnboarded: () => mocks.onboarded,
  onboardingPath: (next: string) => `/onboarding?next=${encodeURIComponent(next)}`,
}));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: async () => mocks.auth }));
vi.mock('@/lib/catalog', () => ({ getCatalogSnapshot: mocks.getCatalogSnapshot }));
vi.mock('@/lib/ip-follow.server', () => ({
  getIpNotificationPreferencesForUser: mocks.getPreferences,
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); },
}));

const USER_ID = '00000000-0000-4000-8000-000000001401';

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
  mocks.getCatalogSnapshot.mockReset();
  mocks.getCatalogSnapshot.mockResolvedValue(mocks.catalog);
  mocks.getPreferences.mockReset();
  mocks.getPreferences.mockResolvedValue([
    { ipId: 'hwasan', notifyDrops: true, notifyEvents: false },
    { ipId: 'retired-ip', notifyDrops: false, notifyEvents: true },
  ]);
  mocks.onboarded = true;
  mocks.screen.mockClear();
});

describe('/notifications/settings page', () => {
  it('is a private noindex preference surface in metadata', () => {
    expect(metadata).toMatchObject({
      title: 'IP 알림 설정 — ICONS',
      robots: { index: false, follow: false },
    });
  });

  it('requires authentication before reading preference data', async () => {
    mocks.auth = {
      isConfigured: true,
      user: null,
      profile: null,
      isStaff: false,
    };

    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fnotifications%2Fsettings',
    );
    expect(mocks.getPreferences).not.toHaveBeenCalled();
    expect(mocks.getCatalogSnapshot).not.toHaveBeenCalled();
  });

  it('requires onboarding before reading preference data', async () => {
    mocks.onboarded = false;

    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_REDIRECT:/onboarding?next=%2Fnotifications%2Fsettings',
    );
    expect(mocks.getPreferences).not.toHaveBeenCalled();
  });

  it('joins followed preference rows to catalog titles and passes the shared action', async () => {
    renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));

    expect(mocks.getPreferences).toHaveBeenCalledWith(USER_ID);
    expect(mocks.screen).toHaveBeenCalledWith({
      action: mocks.action,
      error: false,
      preferences: [
        { ipId: 'hwasan', title: '화산강림', notifyDrops: true, notifyEvents: false },
        { ipId: 'retired-ip', title: 'retired-ip', notifyDrops: false, notifyEvents: true },
      ],
      saved: false,
    }, undefined);
  });

  it('passes the shared action failure query to the visible screen error', async () => {
    renderToStaticMarkup(await Page({
      searchParams: Promise.resolve({ notification_error: '1' }),
    }));

    expect(mocks.screen).toHaveBeenLastCalledWith(
      expect.objectContaining({ error: true }),
      undefined,
    );
  });

  it('passes successful save feedback to the screen', async () => {
    renderToStaticMarkup(await Page({
      searchParams: Promise.resolve({ notification_saved: '1' }),
    }));

    expect(mocks.screen).toHaveBeenLastCalledWith(
      expect.objectContaining({ saved: true }),
      undefined,
    );
  });
});
