import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminDisplayCampaignsPage from './page';

const mocks = vi.hoisted(() => ({
  authState: {
    isConfigured: true,
    user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' },
    role: 'staff',
    isStaff: true,
  } as {
    isConfigured: boolean;
    user: { id: string; email: string | null } | null;
    role: 'user' | 'staff' | 'admin' | null;
    isStaff: boolean;
  },
  screen: vi.fn(() => null),
  campaigns: vi.fn(async () => ({
    campaigns: [{ id: 'autumn-attendance' }],
    offers: [{ id: '22222222-2222-4222-8222-222222222222' }],
  })),
  catalogRecords: vi.fn(async () => ({
    cardPools: [{ id: '11111111-1111-4111-8111-111111111111', name: '가을 카드풀' }],
  })),
  curations: vi.fn(async () => []),
}));

vi.mock('@/components/admin/screens/CampaignScreen', () => ({ CampaignScreen: mocks.screen }));
vi.mock('@/lib/admin/campaigns.server', () => ({
  getAdminCampaignConsoleData: mocks.campaigns,
}));
vi.mock('@/lib/admin/catalog.server', () => ({ getAdminCatalogRecords: mocks.catalogRecords }));
vi.mock('@/lib/admin/curations.server', () => ({ getAdminCurations: mocks.curations }));
vi.mock('@/lib/auth/admin', () => ({
  getCurrentAdminAuthState: vi.fn(async () => mocks.authState),
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

describe('AdminDisplayCampaignsPage', () => {
  beforeEach(() => {
    mocks.authState = {
      isConfigured: true,
      user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' },
      role: 'staff',
      isStaff: true,
    };
    mocks.screen.mockClear();
    mocks.campaigns.mockClear();
    mocks.catalogRecords.mockClear();
    mocks.curations.mockClear();
  });

  /* draft 캠페인은 준비 중인 편성 그 자체다. 게이트가 로더보다 늦으면 비스태프가
     공개 전 라인업을 조회시키는 창이 열린다 — layout과 page는 병렬로 렌더된다. */
  it('로그인 전에는 캠페인 경로를 next로 실어 로그인으로 보낸다', async () => {
    mocks.authState = { isConfigured: true, user: null, role: null, isStaff: false };

    await expect(AdminDisplayCampaignsPage()).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fadmin%2Fdisplay%2Fcampaigns',
    );
    expect(mocks.campaigns).not.toHaveBeenCalled();
  });

  it('비스태프에게는 화면을 열지 않는다', async () => {
    mocks.authState = {
      isConfigured: true,
      user: { id: 'u1', email: 'fan@icons.gg' },
      role: 'user',
      isStaff: false,
    };

    await expect(AdminDisplayCampaignsPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.campaigns).not.toHaveBeenCalled();
    expect(mocks.catalogRecords).not.toHaveBeenCalled();
  });

  it('캠페인·교환처·카드풀 선택지를 함께 내려보낸다', async () => {
    const screen = await AdminDisplayCampaignsPage();

    expect(screen.type).toBe(mocks.screen);
    expect(screen.props).toMatchObject({
      records: [{ id: 'autumn-attendance' }],
      offers: [{ id: '22222222-2222-4222-8222-222222222222' }],
      pools: [{ id: '11111111-1111-4111-8111-111111111111', name: '가을 카드풀' }],
    });
  });

  /* 카드풀 이름은 한 곳에서만 읽는다 — 교환처 조인으로 한 번 더 읽으면 두 값이
     갈라질 자리가 생긴다. */
  it('쓰는 카탈로그 종류만 요청하고 다른 화면의 로더는 부르지 않는다', async () => {
    await AdminDisplayCampaignsPage();

    expect(mocks.catalogRecords).toHaveBeenCalledWith({ include: ['cardPools'] });
    expect(mocks.curations).not.toHaveBeenCalled();
  });
});
