const { configuredOperatorAccessFixture, legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminDisplayCampaignsPage from './page';

const mocks = vi.hoisted(() => ({
  authState: {
    isConfigured: true,
    user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' },
    role: 'staff',
    isStaff: true, operatorAccess: legacyOperatorAccessFixture(),
  } as {
    isConfigured: boolean;
    user: { id: string; email: string | null } | null;
    role: 'user' | 'staff' | 'admin' | null;
    isStaff: boolean; operatorAccess?: ReturnType<typeof legacyOperatorAccessFixture>;
  },
  screen: vi.fn(() => null),
  campaigns: vi.fn(async () => ({
    campaigns: [{ id: 'autumn-attendance' }],
  })),
  catalogRecords: vi.fn(async () => ({})),
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
      isStaff: true, operatorAccess: legacyOperatorAccessFixture(),
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

  /* 카드팩 교환처·카드풀 선택지는 2026-11-24 일반 쇼핑몰 전환으로 지웠다(ADR-0052) — 캠페인만 내려보낸다. */
  it('캠페인만 내려보내고 카드풀·교환처나 다른 화면의 로더는 부르지 않는다', async () => {
    const screen = await AdminDisplayCampaignsPage();

    expect(screen.type).toBe(mocks.screen);
    expect(screen.props).toEqual({ records: [{ id: 'autumn-attendance' }] });
    expect(mocks.catalogRecords).not.toHaveBeenCalled();
    expect(mocks.curations).not.toHaveBeenCalled();
  });

  it('프로모션 역할도 같은 캠페인 화면을 연다', async () => {
    mocks.authState.operatorAccess = configuredOperatorAccessFixture('deputy');
    const screen = await AdminDisplayCampaignsPage();
    expect(mocks.campaigns).toHaveBeenCalledWith();
    expect(screen.props).toEqual({ records: [{ id: 'autumn-attendance' }] });
  });

});
