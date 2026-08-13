import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAuthState } from '@/lib/auth/server';
import Page, { metadata } from './page';

const mocks = vi.hoisted(() => ({
  accountDeletion: vi.fn(),
  auth: null as unknown as CurrentAuthState,
  avatarPresentation: vi.fn(),
  onboarded: true,
  settings: vi.fn<(props: Record<string, unknown>) => null>(() => null),
}));

vi.mock('@/components/screens/Settings', () => ({
  Settings: mocks.settings,
}));
vi.mock('@/lib/account-deletion.server', () => ({
  getAccountDeletionPresentation: mocks.accountDeletion,
}));
vi.mock('@/lib/auth/onboarding', () => ({
  isOnboarded: () => mocks.onboarded,
  onboardingPath: (next: string) => `/onboarding?next=${encodeURIComponent(next)}`,
}));
vi.mock('@/lib/auth/server', () => ({
  getCurrentAuthState: async () => mocks.auth,
}));
vi.mock('@/lib/profile-avatar.server', () => ({
  getProfileAvatarPresentation: mocks.avatarPresentation,
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

function onboardedAuth(avatarPath: string | null): CurrentAuthState {
  return {
    isConfigured: true,
    user: {
      id: '00000000-0000-4000-8000-000000001201',
      email: 'fan@icons.gg',
    },
    profile: {
      avatar_path: avatarPath,
      birth_date: '2000-01-01',
      consents: { terms: true, privacy: true, marketing: false },
      email: 'fan@icons.gg',
      nickname: '아이콘즈 팬',
      onboarded_at: '2026-07-15T00:00:00.000Z',
      role: 'user',
    },
    isStaff: false,
  };
}

describe('/settings page', () => {
  beforeEach(() => {
    mocks.auth = onboardedAuth(
      '00000000-0000-4000-8000-000000001201/profile/22222222-2222-4222-8222-222222222222.png',
    );
    mocks.accountDeletion.mockReset();
    mocks.accountDeletion.mockResolvedValue({
      preview: { available: false, eligible: false, blockers: [
        { code: 'not_available', count: 1, path: '/settings' },
      ] },
      status: { status: 'not_requested', phase: 'none', nextAction: '/settings', blockers: [] },
    });
    mocks.avatarPresentation.mockReset();
    mocks.avatarPresentation.mockResolvedValue({
      avatarInitial: '아',
      avatarUrl: 'https://signed.example/avatar.png',
    });
    mocks.onboarded = true;
    mocks.settings.mockClear();
  });

  it('retains the exact authentication and onboarding return paths', async () => {
    mocks.auth = {
      isConfigured: true,
      user: null,
      profile: null,
      isStaff: false,
    };
    await expect(Page()).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fsettings');
    expect(mocks.avatarPresentation).not.toHaveBeenCalled();

    mocks.auth = onboardedAuth(null);
    mocks.onboarded = false;
    await expect(Page()).rejects.toThrow('NEXT_REDIRECT:/onboarding?next=%2Fsettings');
    expect(mocks.avatarPresentation).not.toHaveBeenCalled();
  });

  it('loads the profile avatar presentation and passes it to Settings', async () => {
    renderToStaticMarkup(await Page());

    expect(mocks.avatarPresentation).toHaveBeenCalledWith({
      avatarPath: '00000000-0000-4000-8000-000000001201/profile/22222222-2222-4222-8222-222222222222.png',
      nickname: '아이콘즈 팬',
    });
    expect(mocks.settings).toHaveBeenCalledWith(expect.objectContaining({
      accountDeletion: expect.objectContaining({
        preview: expect.objectContaining({ available: false }),
        status: expect.objectContaining({ status: 'not_requested' }),
      }),
      accountDeletionRequestKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
      avatarInitial: '아',
      avatarUrl: 'https://signed.example/avatar.png',
    }), undefined);
  });

  it('passes the shared avatar fallback without recomputing it in the page', async () => {
    mocks.avatarPresentation.mockResolvedValue({ avatarInitial: '👩‍🎤', avatarUrl: null });

    renderToStaticMarkup(await Page());
    expect(mocks.settings).toHaveBeenLastCalledWith(expect.objectContaining({
      avatarInitial: '👩‍🎤',
      avatarUrl: null,
    }), undefined);
  });

  it('keeps the settings fallback available when Supabase is not configured', async () => {
    mocks.auth = {
      isConfigured: false,
      user: null,
      profile: null,
      isStaff: false,
    };

    renderToStaticMarkup(await Page());

    expect(mocks.accountDeletion).not.toHaveBeenCalled();
    expect(mocks.settings).toHaveBeenCalledWith(expect.objectContaining({
      accountDeletion: {
        preview: {
          available: false,
          eligible: false,
          blockers: [{ code: 'not_available', count: 1, path: '/settings' }],
        },
        status: {
          status: 'not_requested', phase: 'none', nextAction: '/settings', blockers: [],
        },
      },
      isConfigured: false,
    }), undefined);
  });

  it('describes profile editing in page metadata', () => {
    expect(metadata.description).toContain('편집');
  });
});
