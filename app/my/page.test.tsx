import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAuthState } from '@/lib/auth/server';
import Page, { metadata } from './page';

const mocks = vi.hoisted(() => ({
  auth: null as unknown as CurrentAuthState,
  avatarPresentation: vi.fn(),
  myPage: vi.fn<(props: Record<string, unknown>) => null>(() => null),
  onboarded: true,
}));

vi.mock('@/components/screens/MyPage', () => ({ MyPage: mocks.myPage }));
vi.mock('@/lib/auth/onboarding', () => ({
  isOnboarded: () => mocks.onboarded,
  onboardingPath: (next: string) => `/onboarding?next=${encodeURIComponent(next)}`,
}));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: async () => mocks.auth }));
vi.mock('@/lib/profile-avatar.server', () => ({
  getProfileAvatarPresentation: mocks.avatarPresentation,
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); },
}));

function onboardedAuth(): CurrentAuthState {
  return {
    isConfigured: true,
    user: {
      id: '00000000-0000-4000-8000-000000001201',
      email: 'fan@icons.gg',
    },
    profile: {
      avatar_path:
        '00000000-0000-4000-8000-000000001201/profile/22222222-2222-4222-8222-222222222222.png',
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

beforeEach(() => {
  mocks.auth = onboardedAuth();
  mocks.avatarPresentation.mockReset();
  mocks.avatarPresentation.mockResolvedValue({
    avatarInitial: '아',
    avatarUrl: 'https://signed.example/avatar.png',
  });
  mocks.myPage.mockClear();
  mocks.onboarded = true;
});

describe('/my page', () => {
  it('is a private account hub in metadata', () => {
    expect(metadata).toMatchObject({
      title: '마이페이지 — ICONS',
      robots: { index: false, follow: false },
    });
    expect(metadata.description).toContain('주문');
    expect(metadata.description).toContain('티켓');
  });

  it('requires authentication with the exact return path before loading profile media', async () => {
    mocks.auth = {
      isConfigured: true,
      user: null,
      profile: null,
      isStaff: false,
    };

    await expect(Page()).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fmy');
    expect(mocks.avatarPresentation).not.toHaveBeenCalled();
    expect(mocks.myPage).not.toHaveBeenCalled();
  });

  it('requires onboarding with the exact return path before loading profile media', async () => {
    mocks.onboarded = false;

    await expect(Page()).rejects.toThrow('NEXT_REDIRECT:/onboarding?next=%2Fmy');
    expect(mocks.avatarPresentation).not.toHaveBeenCalled();
    expect(mocks.myPage).not.toHaveBeenCalled();
  });

  it('passes only the profile presentation needed by the hub', async () => {
    renderToStaticMarkup(await Page());

    expect(mocks.avatarPresentation).toHaveBeenCalledWith({
      avatarPath:
        '00000000-0000-4000-8000-000000001201/profile/22222222-2222-4222-8222-222222222222.png',
      nickname: '아이콘즈 팬',
    });
    expect(mocks.myPage).toHaveBeenCalledWith({
      avatarInitial: '아',
      avatarUrl: 'https://signed.example/avatar.png',
      nickname: '아이콘즈 팬',
    }, undefined);
  });
});
