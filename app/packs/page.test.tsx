import { beforeEach, describe, expect, it, vi } from 'vitest';
import Page, { generateMetadata } from './page';

const mocks = vi.hoisted(() => ({
  enabled: false,
  getCardsByIds: vi.fn(),
  getDrawTicketInventory: vi.fn(),
}));

vi.mock('@/lib/card-rewards/gate.server', () => ({
  readCardRewardsEnabled: () => mocks.enabled,
}));
vi.mock('@/lib/catalog', () => ({ getCatalogSource: () => 'supabase' }));
/* 카드 전량이 아니라 보유 팩의 라인업만 읽는다(규모 후속). */
vi.mock('@/lib/storefront.server', () => ({ getStorefrontCardsByIds: mocks.getCardsByIds }));
vi.mock('@/lib/draw-tickets', () => ({ getDrawTicketInventory: mocks.getDrawTicketInventory }));
vi.mock('@/components/screens/CardPacks', () => ({ CardPacks: () => null }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

describe('card packs page gate', () => {
  beforeEach(() => {
    mocks.enabled = false;
    mocks.getCardsByIds.mockReset();
    mocks.getCardsByIds.mockResolvedValue({ cards: [], ips: [] });
    mocks.getDrawTicketInventory.mockReset();
  });

  it('returns 404 before reading pack inventory while rewards are disabled', async () => {
    await expect(Page()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.getCardsByIds).not.toHaveBeenCalled();
    expect(mocks.getDrawTicketInventory).not.toHaveBeenCalled();
  });

  it('does not advertise disabled card packs through metadata', async () => {
    await expect(generateMetadata()).resolves.toEqual({
      title: 'ICONS',
      robots: { index: false, follow: false },
    });
  });

  it('renders the existing inventory only after the database capability is enabled', async () => {
    mocks.enabled = true;
    mocks.getDrawTicketInventory.mockResolvedValue({ source: 'supabase', signedIn: true, groups: [] });

    const page = await Page();

    /* 라인업이 비면 조회도 빈 목록으로 답한다 — 카드 전량을 대신 읽지 않는다. */
    expect(mocks.getCardsByIds).toHaveBeenCalledWith([]);
    expect(page.props.catalog).toEqual({ source: 'supabase', cards: [], ips: [] });
    expect(page.props.inventory).toEqual({ source: 'supabase', signedIn: true, groups: [] });
    await expect(generateMetadata()).resolves.toMatchObject({ title: '카드팩 — ICONS' });
  });
});
