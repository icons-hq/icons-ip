import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAuthState } from '@/lib/auth/server';
import { openNotificationAction } from './actions';

const mocks = vi.hoisted(() => ({
  auth: null as unknown as CurrentAuthState,
  createClient: vi.fn(),
  onboarded: true,
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  revalidatePath: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/auth/onboarding', () => ({
  isOnboarded: () => mocks.onboarded,
  onboardingPath: (next: string) => `/onboarding?next=${encodeURIComponent(next)}`,
}));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: async () => mocks.auth }));
vi.mock('@/lib/notifications', async () => await import('../../lib/notifications'));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

const USER_ID = '00000000-0000-4000-8000-000000001401';
const NOTIFICATION_ID = '11111111-1111-4111-8111-111111111111';

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
  mocks.createClient.mockReset();
  mocks.onboarded = true;
  mocks.redirect.mockClear();
  mocks.revalidatePath.mockReset();
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: '/orders/order-1', error: null });
  mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
});

describe('openNotificationAction', () => {
  it('authenticates again and preserves the exact login return path', async () => {
    mocks.auth = {
      isConfigured: true,
      user: null,
      profile: null,
      isStaff: false,
    };

    await expect(openNotificationAction(NOTIFICATION_ID)).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fnotifications',
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('checks onboarding again before opening an inbox row', async () => {
    mocks.onboarded = false;

    await expect(openNotificationAction(NOTIFICATION_ID)).rejects.toThrow(
      'NEXT_REDIRECT:/onboarding?next=%2Fnotifications',
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects a non-canonical notification id before the RPC', async () => {
    await expect(openNotificationAction('not-a-notification')).rejects.toThrow(
      'NEXT_REDIRECT:/notifications?open_error=1',
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('opens the full row through the owner-scoped RPC and redirects to its internal link', async () => {
    await expect(openNotificationAction(NOTIFICATION_ID)).rejects.toThrow(
      /^NEXT_REDIRECT:\/orders\/order-1\?notification_opened=[0-9a-f-]{36}$/,
    );

    expect(mocks.rpc).toHaveBeenCalledWith('open_notification', {
      target_notification_id: NOTIFICATION_ID,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/notifications');
  });

  it('uses a fresh count refresh signal every time the same row is opened', async () => {
    const redirects: string[] = [];

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await openNotificationAction(NOTIFICATION_ID);
      } catch (error) {
        redirects.push((error as Error).message);
      }
    }

    expect(redirects).toHaveLength(2);
    expect(redirects[0]).not.toBe(redirects[1]);
  });

  it.each([
    [{ data: 'https://evil.example/path', error: null }],
    [{ data: '//evil.example/path', error: null }],
    [{ data: null, error: { message: 'private rpc detail' } }],
  ])('returns an unsafe or failed RPC result to a generic inbox error', async (result) => {
    mocks.rpc.mockResolvedValue(result);

    await expect(openNotificationAction(NOTIFICATION_ID)).rejects.toThrow(
      'NEXT_REDIRECT:/notifications?open_error=1',
    );
  });
});
