import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAuthState } from '@/lib/auth/server';
import { setIpNotificationPreferencesAction } from './actions';

const mocks = vi.hoisted(() => ({
  auth: null as unknown as CurrentAuthState,
  revalidatePath: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: () => mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

function onboardedAuth(): CurrentAuthState {
  return {
    isConfigured: true,
    user: { id: 'user-1', email: 'fan@icons.gg' },
    profile: {
      email: 'fan@icons.gg',
      nickname: 'fan',
      birth_date: '2000-01-01',
      consents: { terms: true, privacy: true },
      onboarded_at: '2026-07-01T00:00:00.000Z',
    },
    isStaff: false,
  };
}

function preferenceForm(values: Record<string, string> = {}) {
  const formData = new FormData();
  formData.set('ipId', 'ip-1');
  formData.set('next', '/ip/ip-1');
  for (const [key, value] of Object.entries(values)) formData.set(key, value);
  return formData;
}

beforeEach(() => {
  mocks.auth = onboardedAuth();
  mocks.revalidatePath.mockReset();
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: null, error: null });
});

describe('setIpNotificationPreferencesAction', () => {
  it('treats absent checkboxes as false when the form explicitly sets both channels', async () => {
    const formData = preferenceForm({ setBoth: '1', notifyDrops: 'on' });

    await expect(setIpNotificationPreferencesAction(formData)).rejects.toThrow(
      'NEXT_REDIRECT:/ip/ip-1',
    );
    expect(mocks.rpc).toHaveBeenCalledWith('set_ip_notification_preferences', {
      target_auto_follow: false,
      target_ip_id: 'ip-1',
      target_notify_drops: true,
      target_notify_events: false,
    });
  });

  it('preserves an absent channel when updating one explicit channel', async () => {
    const formData = preferenceForm({ notifyEvents: '0' });

    await expect(setIpNotificationPreferencesAction(formData)).rejects.toThrow(
      'NEXT_REDIRECT:/ip/ip-1',
    );
    expect(mocks.rpc).toHaveBeenCalledWith('set_ip_notification_preferences', {
      target_auto_follow: false,
      target_ip_id: 'ip-1',
      target_notify_drops: null,
      target_notify_events: false,
    });
  });

  it('follows before applying preferences when the CTA opts into auto-follow', async () => {
    const formData = preferenceForm({ autoFollow: '1', notifyEvents: '1' });

    await expect(setIpNotificationPreferencesAction(formData)).rejects.toThrow(
      'NEXT_REDIRECT:/ip/ip-1',
    );
    expect(mocks.rpc.mock.calls).toEqual([
      ['set_ip_notification_preferences', {
        target_auto_follow: true,
        target_ip_id: 'ip-1',
        target_notify_drops: null,
        target_notify_events: true,
      }],
    ]);
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      '/',
      '/ip',
      '/ip/ip-1',
      '/events',
      '/offline-popups',
      '/notifications/settings',
    ]);
  });

  it('refreshes a safe offline pop-up detail pathname before returning to its CTA', async () => {
    const formData = preferenceForm({ notifyEvents: '1' });
    formData.set('next', '/offline-popups/event-1?from=notification#settings');

    await expect(setIpNotificationPreferencesAction(formData)).rejects.toThrow(
      'NEXT_REDIRECT:/offline-popups/event-1?from=notification&notification_saved=1#settings',
    );
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      '/',
      '/ip',
      '/ip/ip-1',
      '/events',
      '/offline-popups',
      '/notifications/settings',
      '/offline-popups/event-1',
    ]);
  });

  it('returns settings saves with visible success feedback', async () => {
    const formData = preferenceForm({ setBoth: '1', notifyDrops: '1' });
    formData.set('next', '/notifications/settings');

    await expect(setIpNotificationPreferencesAction(formData)).rejects.toThrow(
      'NEXT_REDIRECT:/notifications/settings?notification_saved=1',
    );
  });

  it('returns IP and offline pop-up saves with visible success feedback', async () => {
    const ipForm = preferenceForm({ notifyDrops: '1' });
    const popupForm = preferenceForm({ notifyEvents: '1' });
    popupForm.set('next', '/offline-popups/event-1');
    /* 이사 전 저장·공유된 /events/<id> 딥링크도 계속 성공 피드백을 받아야 한다. */
    const legacyForm = preferenceForm({ notifyEvents: '1' });
    legacyForm.set('next', '/events/event-1');

    await expect(setIpNotificationPreferencesAction(ipForm)).rejects.toThrow(
      'NEXT_REDIRECT:/ip/ip-1?notification_saved=1',
    );
    await expect(setIpNotificationPreferencesAction(popupForm)).rejects.toThrow(
      'NEXT_REDIRECT:/offline-popups/event-1?notification_saved=1',
    );
    await expect(setIpNotificationPreferencesAction(legacyForm)).rejects.toThrow(
      'NEXT_REDIRECT:/events/event-1?notification_saved=1',
    );
  });

  it('rechecks authentication and onboarding before writing', async () => {
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };

    await expect(setIpNotificationPreferencesAction(preferenceForm())).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fip%2Fip-1',
    );
    expect(mocks.rpc).not.toHaveBeenCalled();

    mocks.auth = { ...onboardedAuth(), profile: null };
    await expect(setIpNotificationPreferencesAction(preferenceForm())).rejects.toThrow(
      'NEXT_REDIRECT:/onboarding?next=%2Fip%2Fip-1',
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('redirects to a safe generic error without leaking RPC details', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'private database detail' } });
    const formData = preferenceForm({ notifyDrops: '1' });
    formData.set('next', 'https://evil.example/steal');

    await expect(setIpNotificationPreferencesAction(formData)).rejects.toThrow(
      'NEXT_REDIRECT:/?notification_error=1',
    );
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
