import { beforeEach, describe, expect, it, vi } from 'vitest';
import GamePage, { generateMetadata } from './page';

const mocks = vi.hoisted(() => ({
  enabled: false,
  getGameCatalogEntry: vi.fn(),
}));

vi.mock('@/lib/card-rewards/gate.server', () => ({
  readCardRewardsEnabled: () => mocks.enabled,
}));
vi.mock('@/lib/games/catalog', () => ({ getGameCatalogEntry: mocks.getGameCatalogEntry }));
vi.mock('@/components/games/GameScreen', () => ({ GameScreen: () => null }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

describe('public game route gate', () => {
  beforeEach(() => {
    mocks.enabled = false;
    mocks.getGameCatalogEntry.mockReset();
  });

  it('returns 404 without reading the game catalog while rewards are disabled', async () => {
    await expect(GamePage({ params: Promise.resolve({ gameId: 'game-1' }) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.getGameCatalogEntry).not.toHaveBeenCalled();
  });

  it('does not leak a disabled game title through metadata', async () => {
    await expect(generateMetadata({ params: Promise.resolve({ gameId: 'game-1' }) })).resolves.toEqual({
      title: 'ICONS',
    });
    expect(mocks.getGameCatalogEntry).not.toHaveBeenCalled();
  });

  it('renders the existing game only after the database capability is enabled', async () => {
    mocks.enabled = true;
    mocks.getGameCatalogEntry.mockResolvedValue({
      source: 'supabase',
      game: { id: 'game-1' },
      cards: [],
    });

    const page = await GamePage({ params: Promise.resolve({ gameId: 'game-1' }) });
    expect(page.props.game).toEqual({ id: 'game-1' });
  });
});
