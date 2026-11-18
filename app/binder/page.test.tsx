import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card, Ip } from '@/lib/data';
import Page from './page';

const mocks = vi.hoisted(() => ({
  binderEnabled: true,
  exchangeEnabled: false,
  cardRewardsEnabled: false,
  getBinderCatalogOverlay: vi.fn(),
  getCatalogSnapshot: vi.fn(),
}));

vi.mock('@/components/screens/Binder', () => ({ Binder: () => null }));
vi.mock('@/lib/catalog', () => ({
  getBinderCatalogOverlay: mocks.getBinderCatalogOverlay,
  getCatalogSnapshot: mocks.getCatalogSnapshot,
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@/lib/collectible-features.server', () => ({
  readCollectibleFeatures: async () => ({ binder: mocks.binderEnabled, market: false, exchange: mocks.exchangeEnabled }),
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
    mocks.binderEnabled = true;
    mocks.exchangeEnabled = false;
    mocks.getCatalogSnapshot.mockReset();
    mocks.getBinderCatalogOverlay.mockReset();
    mocks.getCatalogSnapshot.mockResolvedValue({
      source: 'supabase',
      verticals: [],
      ips: [],
      goods: [],
      cards: [activeCard],
      events: [],
    });
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

  it('passes the card trade switch to the binder screen', async () => {
    mocks.getBinderCatalogOverlay.mockResolvedValue(null);
    expect(((await Page()).props as { exchangeEnabled: boolean }).exchangeEnabled).toBe(false);
    mocks.exchangeEnabled = true;
    expect(((await Page()).props as { exchangeEnabled: boolean }).exchangeEnabled).toBe(true);
  });

  /* 카드 바인더는 운영하지 않는다 — 공개 스위치가 꺼져 있으면(기본) 누구에게나 404이고, 보유 카드를 읽기 전에 닫는다. */
  it('is not found for everyone while the card binder is hidden, before reading any card data', async () => {
    mocks.binderEnabled = false;

    await expect(Page()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.getCatalogSnapshot).not.toHaveBeenCalled();
    expect(mocks.getBinderCatalogOverlay).not.toHaveBeenCalled();
  });
});
