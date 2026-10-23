import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAuthState } from '@/lib/auth/server';
import Page, { metadata } from './page';

const mocks = vi.hoisted(() => ({
  auth: null as unknown as CurrentAuthState,
  avatarPresentation: vi.fn(),
  dashboard: vi.fn(),
  discovery: vi.fn(),
  loyaltyStatus: vi.fn(),
  myPage: vi.fn<(props: Record<string, unknown>) => null>(() => null),
  onboarded: true,
}));

const DASHBOARD = {
  orders: { counts: { paid: 0, confirmed: 0, shipping: 0, delivered: 0, done: 0 }, recent: [] },
  wishlist: { count: 2, goods: [] },
  follows: { count: 0, ips: [] },
  coupons: { usable: 1 },
  storeCredit: null,
};

vi.mock('@/components/screens/MyPage', () => ({ MyPage: mocks.myPage }));
vi.mock('@/lib/auth/onboarding', () => ({
  isOnboarded: () => mocks.onboarded,
  onboardingPath: (next: string) => `/onboarding?next=${encodeURIComponent(next)}`,
}));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: async () => mocks.auth }));
vi.mock('@/lib/profile-avatar.server', () => ({
  getProfileAvatarPresentation: mocks.avatarPresentation,
}));
vi.mock('@/lib/coupons.server', () => ({
  loadLoyaltyStatus: mocks.loyaltyStatus,
}));
vi.mock('@/lib/mypage-dashboard.server', () => ({ loadMypageDashboard: mocks.dashboard }));
vi.mock('@/lib/product-detail-experiences.server', () => ({ loadPublicDetailExperienceConfig: mocks.discovery }));
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
  mocks.loyaltyStatus.mockReset();
  mocks.loyaltyStatus.mockResolvedValue(null);
  mocks.dashboard.mockReset();
  mocks.dashboard.mockResolvedValue(DASHBOARD);
  mocks.discovery.mockReset();
  mocks.discovery.mockResolvedValue({ interests: false, shippingSavings: false });
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
    expect(mocks.dashboard).not.toHaveBeenCalled();
    expect(mocks.myPage).not.toHaveBeenCalled();
  });

  it('requires onboarding with the exact return path before loading profile media', async () => {
    mocks.onboarded = false;

    await expect(Page()).rejects.toThrow('NEXT_REDIRECT:/onboarding?next=%2Fmy');
    expect(mocks.avatarPresentation).not.toHaveBeenCalled();
    expect(mocks.dashboard).not.toHaveBeenCalled();
    expect(mocks.myPage).not.toHaveBeenCalled();
  });

  /* 대시보드(L6 · MY-02)는 로그인 회원 자신의 조회만 싣는다 — 이메일 같은 계정 식별 정보는 넘기지 않는다. */
  it('passes the profile presentation and the member dashboard without account identifiers', async () => {
    renderToStaticMarkup(await Page());

    expect(mocks.avatarPresentation).toHaveBeenCalledWith({
      avatarPath:
        '00000000-0000-4000-8000-000000001201/profile/22222222-2222-4222-8222-222222222222.png',
      nickname: '아이콘즈 팬',
    });
    expect(mocks.dashboard).toHaveBeenCalledWith('00000000-0000-4000-8000-000000001201');
    expect(mocks.myPage).toHaveBeenCalledWith({
      avatarInitial: '아',
      avatarUrl: 'https://signed.example/avatar.png',
      dashboard: DASHBOARD,
      nickname: '아이콘즈 팬',
      loyalty: null,
      recentGoodsEnabled: false,
      viewerId: '00000000-0000-4000-8000-000000001201',
    }, undefined);
    expect(JSON.stringify(mocks.myPage.mock.calls[0][0])).not.toContain('fan@icons.gg');
  });

  /* 최근 본 굿즈 블록은 상세 경험 interests 스위치를 따른다(LD-16). */
  it('lets the detail interests switch decide the recently viewed block', async () => {
    mocks.discovery.mockResolvedValue({ interests: true, shippingSavings: false });
    renderToStaticMarkup(await Page());

    expect(mocks.myPage).toHaveBeenCalledWith(expect.objectContaining({ recentGoodsEnabled: true }), undefined);
  });

  it('shapes the loyalty status into display strings for the profile strip', async () => {
    mocks.loyaltyStatus.mockResolvedValue({
      grade: 'silver',
      windowSpend: 150000,
      windowItemCount: 2,
      nextNote: 'GOLD까지 150,000원 또는 굿즈 주문 항목 3건',
    });

    renderToStaticMarkup(await Page());

    expect(mocks.myPage).toHaveBeenCalledWith(expect.objectContaining({
      loyalty: {
        grade: 'silver',
        label: 'SILVER',
        nextNote: 'GOLD까지 150,000원 또는 굿즈 주문 항목 3건',
      },
    }), undefined);
  });

  it('labels the top grade without a next-grade note', async () => {
    mocks.loyaltyStatus.mockResolvedValue({
      grade: 'platinum',
      windowSpend: 2000000,
      windowItemCount: 20,
      nextNote: null,
    });

    renderToStaticMarkup(await Page());

    expect(mocks.myPage).toHaveBeenCalledWith(expect.objectContaining({
      loyalty: expect.objectContaining({ label: 'PLATINUM', nextNote: null }),
    }), undefined);
  });
});
