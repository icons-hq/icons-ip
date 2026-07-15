import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAuthState } from '@/lib/auth/server';
import Page, { metadata } from './page';

const mocks = vi.hoisted(() => ({
  auth: null as unknown as CurrentAuthState,
  createSignedUrl: vi.fn(),
  onboarded: true,
  settings: vi.fn<(props: Record<string, unknown>) => null>(() => null),
  storageFrom: vi.fn(),
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
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    storage: { from: mocks.storageFrom },
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

function onboardedAuth(avatarPath: string | null): CurrentAuthState {
  return {
    isConfigured: true,
    user: { id: 'user-1', email: 'fan@icons.gg' },
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
    mocks.auth = onboardedAuth('user-1/profile/avatar.png');
    mocks.createSignedUrl.mockReset();
    mocks.createSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://signed.example/avatar.png' },
      error: null,
    });
    mocks.onboarded = true;
    mocks.settings.mockClear();
    mocks.storageFrom.mockReset();
    mocks.storageFrom.mockImplementation((bucket: string) => {
      if (bucket !== 'user-uploads') throw new Error(`Unexpected bucket ${bucket}`);
      return { createSignedUrl: mocks.createSignedUrl };
    });
  });

  it('retains the exact authentication and onboarding return paths', async () => {
    mocks.auth = {
      isConfigured: true,
      user: null,
      profile: null,
      isStaff: false,
    };
    await expect(Page()).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fsettings');
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();

    mocks.auth = onboardedAuth(null);
    mocks.onboarded = false;
    await expect(Page()).rejects.toThrow('NEXT_REDIRECT:/onboarding?next=%2Fsettings');
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
  });

  it('signs the stored avatar path for one hour and passes its URL to Settings', async () => {
    renderToStaticMarkup(await Page());

    expect(mocks.storageFrom).toHaveBeenCalledWith('user-uploads');
    expect(mocks.createSignedUrl).toHaveBeenCalledWith('user-1/profile/avatar.png', 3600);
    expect(mocks.settings).toHaveBeenCalledWith(expect.objectContaining({
      avatarUrl: 'https://signed.example/avatar.png',
    }), undefined);
  });

  it('falls back to no avatar when Storage cannot sign the path', async () => {
    mocks.createSignedUrl.mockResolvedValue({
      data: null,
      error: { message: 'signing failed' },
    });

    await expect(Page()).resolves.toBeTruthy();
    renderToStaticMarkup(await Page());

    expect(mocks.settings).toHaveBeenCalledWith(expect.objectContaining({
      avatarUrl: null,
    }), undefined);
  });

  it('describes profile editing in page metadata', () => {
    expect(metadata.description).toContain('프로필');
  });
});
