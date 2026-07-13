import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateMarketingConsentAction } from './actions';
import type { OnboardingConsents } from '@/lib/auth/onboarding';
import type { CurrentAuthState } from '@/lib/auth/server';

const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: null, profile: null, isStaff: false } as CurrentAuthState,
  update: vi.fn(),
  eq: vi.fn(),
  updateResult: { data: { id: 'user-1' }, error: null } as { data: { id: string } | null; error: { message: string } | null },
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({
  getCurrentAuthState: () => mocks.auth,
}));
vi.mock('@/lib/auth/onboarding', async () => await import('../../lib/auth/onboarding'));
vi.mock('@/lib/settings', async () => await import('../../lib/settings'));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table !== 'profiles') throw new Error(`Unexpected table ${table}`);
      return { update: mocks.update };
    },
  }),
}));
vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

function onboardedAuth(consents: OnboardingConsents): CurrentAuthState {
  return {
    isConfigured: true,
    user: { id: 'user-1', email: 'fan@icons.gg' },
    profile: {
      email: 'fan@icons.gg',
      nickname: 'fan',
      birth_date: '2000-01-01',
      consents,
      onboarded_at: '2026-06-23T00:00:00.000Z',
    },
    isStaff: false,
  };
}

function marketingForm(marketing: boolean) {
  const formData = new FormData();
  if (marketing) formData.set('marketing', 'on');
  return formData;
}

describe('updateMarketingConsentAction', () => {
  beforeEach(() => {
    mocks.auth = onboardedAuth({ terms: true, privacy: true, marketing: false });
    mocks.updateResult = { data: { id: 'user-1' }, error: null };
    mocks.update.mockReset();
    mocks.eq.mockReset();
    mocks.revalidatePath.mockReset();
    mocks.update.mockImplementation(() => ({ eq: mocks.eq }));
    mocks.eq.mockImplementation(() => ({
      select: () => ({
        single: async () => mocks.updateResult,
      }),
    }));
  });

  it('returns a disabled notice without writing when Supabase is not configured', async () => {
    mocks.auth = { isConfigured: false, user: null, profile: null, isStaff: false };

    await expect(updateMarketingConsentAction({}, marketingForm(true))).resolves.toEqual({
      errors: { form: 'Supabase 환경변수를 설정한 뒤 설정을 변경할 수 있습니다.' },
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('redirects unauthenticated users to login with the settings path', async () => {
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };

    await expect(updateMarketingConsentAction({}, marketingForm(true))).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fsettings',
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('redirects users who have not completed onboarding to onboarding', async () => {
    mocks.auth = {
      isConfigured: true,
      user: { id: 'user-1', email: 'fan@icons.gg' },
      profile: null,
      isStaff: false,
    };

    await expect(updateMarketingConsentAction({}, marketingForm(true))).rejects.toThrow(
      'NEXT_REDIRECT:/onboarding?next=%2Fsettings',
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('updates only the marketing key while preserving DB consents, then confirms', async () => {
    await expect(updateMarketingConsentAction({}, marketingForm(true))).resolves.toEqual({
      message: '마케팅 정보 수신 동의 설정을 저장했어요.',
    });

    expect(mocks.update).toHaveBeenCalledWith({
      consents: { terms: true, privacy: true, marketing: true },
    });
    expect(mocks.eq).toHaveBeenCalledWith('id', 'user-1');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/settings');
  });

  it('turns marketing consent off when the checkbox is not submitted', async () => {
    mocks.auth = onboardedAuth({ terms: true, privacy: true, marketing: true });

    await expect(updateMarketingConsentAction({}, marketingForm(false))).resolves.toEqual({
      message: '마케팅 정보 수신 동의 설정을 저장했어요.',
    });

    expect(mocks.update).toHaveBeenCalledWith({
      consents: { terms: true, privacy: true, marketing: false },
    });
  });

  it('ignores client attempts to tamper with required consents', async () => {
    const formData = marketingForm(true);
    formData.set('terms', 'off');
    formData.set('privacy', 'off');
    formData.set('consents', JSON.stringify({ terms: false, privacy: false, marketing: true }));

    await expect(updateMarketingConsentAction({}, formData)).resolves.toEqual({
      message: '마케팅 정보 수신 동의 설정을 저장했어요.',
    });

    expect(mocks.update).toHaveBeenCalledWith({
      consents: { terms: true, privacy: true, marketing: true },
    });
  });

  it('returns a form error when the profile update fails', async () => {
    mocks.updateResult = { data: null, error: { message: 'boom' } };

    await expect(updateMarketingConsentAction({}, marketingForm(true))).resolves.toEqual({
      errors: { form: '설정을 저장하지 못했습니다. 다시 시도해주세요.' },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
