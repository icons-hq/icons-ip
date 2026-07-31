import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAuthState } from '@/lib/auth/server';
import Page, { metadata } from './page';

const mocks = vi.hoisted(() => ({
  auth: null as unknown as CurrentAuthState,
  avatarPresentation: vi.fn(),
  onboarded: true,
  settings: vi.fn<(props: Record<string, unknown>) => null>(() => null),
}));

vi.mock('@/components/screens/Settings', () => ({
  Settings: mocks.settings,
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

  it('describes profile editing in page metadata', () => {
    expect(metadata.description).toContain('편집');
  });
});
