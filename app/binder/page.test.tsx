import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card, Ip } from '@/lib/data';
import Page from './page';

const mocks = vi.hoisted(() => ({
  cardRewardsEnabled: false,
  getBinderCatalogOverlay: vi.fn(),
  getCardsPage: vi.fn(),
  getOverview: vi.fn(),
  getIpProgress: vi.fn(),
}));

vi.mock('@/components/screens/Binder', () => ({ Binder: () => null }));
vi.mock('@/lib/catalog', () => ({
  getBinderCatalogOverlay: mocks.getBinderCatalogOverlay,
  getCatalogSource: () => 'supabase',
}));
/* 목록은 서버가 자른 한 페이지, 수치는 서버가 전량을 센다(규모 후속) — 전량 스냅샷을 쓰지 않는다. */
vi.mock('@/lib/storefront.server', () => ({
  STOREFRONT_CARD_PAGE_SIZE: 120,
  getStorefrontCardsPage: mocks.getCardsPage,
  getBinderOverview: mocks.getOverview,
  getBinderIpProgress: mocks.getIpProgress,
}));
vi.mock('@/lib/card-rewards/gate.server', () => ({
  readCardRewardsEnabled: () => mocks.cardRewardsEnabled,
}));

const activeCard: Card = {
  id: 'c-active',
  ip: 'ip-1',
  name: '운영 카드',
  no: '001',
  rarity: 'N',
  owned: false,
  bg: 'active-bg',
};

const archivedOwnedCard: Card = {
  ...activeCard,
  id: 'c-archived',
  ip: 'ip-archived',
  name: '보관된 보유 카드',
};

const archivedIp: Ip = {
  id: 'ip-archived',
  title: '보관된 IP',
  sub: '종료된 시리즈',
  v: { key: 'rofan', label: '로맨스판타지', color: '#8B5CFF' },
  glyph: '보관',
  bg: 'archived-ip-bg',
  fans: 0,
  goods: 0,
  cards: 1,
  featured: false,
  tagline: '',
  synopsis: '',
};

describe('binder page', () => {
  beforeEach(() => {
    mocks.getBinderCatalogOverlay.mockReset();
    mocks.getCardsPage.mockReset();
    mocks.getCardsPage.mockResolvedValue({ cards: [activeCard], ips: [], total: 1 });
    mocks.getOverview.mockReset();
    mocks.getOverview.mockResolvedValue({
      totalCards: 1, ownedCards: 0, totalIps: 1, ownedIps: 0, holoCards: 0, holoOwned: 0, ssrCards: 0, signedIn: false,
    });
    mocks.getIpProgress.mockReset();
    mocks.getIpProgress.mockResolvedValue(new Map());
  });

  it('merges owned archived cards into the authenticated binder only', async () => {
    mocks.getBinderCatalogOverlay.mockResolvedValue({
      ownedCardIds: ['c-active', 'c-archived'],
      cards: [activeCard, archivedOwnedCard],
      ips: [archivedIp],
    });

    const page = await Page();
    const props = page.props as {
      catalog: { cards: Card[]; ips: Ip[] };
      ownedCardIds: string[] | null;
    };

    expect(props.catalog.cards.map((card) => card.id)).toEqual(['c-active', 'c-archived']);
    expect(props.catalog.ips).toEqual([archivedIp]);
    expect(props.ownedCardIds).toEqual(['c-active', 'c-archived']);
    /* IP 별 진행은 화면에 오른 IP(보관된 것 포함)만 묻는다. */
    expect(mocks.getIpProgress).toHaveBeenCalledWith(['ip-archived']);
    expect((page.props as { cardRewardsEnabled: boolean }).cardRewardsEnabled).toBe(false);
  });

  it('keeps the public catalog unchanged for a signed-out viewer', async () => {
    mocks.getBinderCatalogOverlay.mockResolvedValue(null);

    const page = await Page();
    const props = page.props as {
      catalog: { cards: Card[] };
      ownedCardIds: string[] | null;
    };

    expect(props.catalog.cards).toEqual([activeCard]);
    expect(props.ownedCardIds).toBeNull();
  });

  /* 목록은 페이지로 잘린다 — 2페이지를 열면 offset 으로 묻고, 페이지 수는 total 로 센다. */
  it('reads one page of the catalog and derives paging from the server total', async () => {
    mocks.getBinderCatalogOverlay.mockResolvedValue(null);
    mocks.getCardsPage.mockResolvedValue({ cards: [activeCard], ips: [], total: 250 });

    const page = await Page({ searchParams: Promise.resolve({ page: '2' }) });
    const props = page.props as { paging: { page: number; pageCount: number; basePath: string } };

    expect(mocks.getCardsPage).toHaveBeenCalledWith({ limit: 120, offset: 120 });
    /* 함수는 넘기지 않는다 — 서버→클라이언트 경계에서 렌더가 죽는다. 데이터만 넘긴다. */
    expect(props.paging).toEqual({ page: 2, pageCount: 3, basePath: '/binder' });
  });
});
