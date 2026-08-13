import { beforeEach, describe, expect, it, vi } from 'vitest';
import Page, { generateMetadata } from './page';

const mocks = vi.hoisted(() => ({
  enabled: false,
  getCatalogSnapshot: vi.fn(),
  getDrawTicketInventory: vi.fn(),
}));

vi.mock('@/lib/card-rewards/gate.server', () => ({
  readCardRewardsEnabled: () => mocks.enabled,
}));
vi.mock('@/lib/catalog', () => ({ getCatalogSnapshot: mocks.getCatalogSnapshot }));
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
    mocks.getCatalogSnapshot.mockReset();
    mocks.getDrawTicketInventory.mockReset();
  });

  it('returns 404 before reading pack inventory while rewards are disabled', async () => {
    await expect(Page()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.getCatalogSnapshot).not.toHaveBeenCalled();
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
    mocks.getCatalogSnapshot.mockResolvedValue({ source: 'supabase' });
    mocks.getDrawTicketInventory.mockResolvedValue({ source: 'supabase', signedIn: true, groups: [] });

    const page = await Page();

    expect(page.props.catalog).toEqual({ source: 'supabase' });
    expect(page.props.inventory).toEqual({ source: 'supabase', signedIn: true, groups: [] });
    await expect(generateMetadata()).resolves.toMatchObject({ title: '카드팩 — ICONS' });
  });
});
