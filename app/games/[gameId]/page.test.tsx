import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import GamePage, { generateMetadata } from './page';

const mocks = vi.hoisted(() => ({
  enabled: false,
  getGameCatalogEntry: vi.fn(),
  auth: {
    isConfigured: false,
    user: null as { id: string; email: string | null } | null,
    profile: null as { suspended_at: string | null } | null,
    isStaff: false,
  },
}));

vi.mock('@/lib/card-rewards/gate.server', () => ({
  readCardRewardsEnabled: () => mocks.enabled,
}));
vi.mock('@/lib/games/catalog', () => ({ getGameCatalogEntry: mocks.getGameCatalogEntry }));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: async () => mocks.auth }));
vi.mock('@/components/games/GameScreen', () => ({ GameScreen: () => null }));
vi.mock('@/components/games/hyosan-memories/HyosanMemoriesEntry.client', () => ({
  HyosanMemoriesEntry: () => <main data-hyosan-entry="true" />,
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

describe('public game route gate', () => {
  beforeEach(() => {
    mocks.enabled = false;
    mocks.getGameCatalogEntry.mockReset();
    mocks.auth.isConfigured = false;
    mocks.auth.user = null;
    mocks.auth.profile = null;
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

  it('fails closed at the Hyosan login gate when Supabase is not configured', async () => {
    const page = await GamePage({ params: Promise.resolve({ gameId: 'hyosan-memories' }) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain('data-hyosan-access="login-required"');
    expect(html).toContain('href="/login?next=%2Fgames%2Fhyosan-memories"');
    expect(html).not.toContain('data-hyosan-entry="true"');
    expect(mocks.getGameCatalogEntry).not.toHaveBeenCalled();
  });

  it('requires login before mounting the Hyosan graybox when Supabase is configured', async () => {
    mocks.auth.isConfigured = true;

    const page = await GamePage({ params: Promise.resolve({ gameId: 'hyosan-memories' }) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain('data-hyosan-access="login-required"');
    expect(html).toContain('href="/login?next=%2Fgames%2Fhyosan-memories"');
    expect(html).toContain('보호된 참여 기능입니다');
    expect(html).not.toContain('data-hyosan-entry="true"');
    expect(html).not.toContain('플레이 기록');
    expect(mocks.getGameCatalogEntry).not.toHaveBeenCalled();
  });

  it('mounts the Hyosan graybox for an authenticated visitor', async () => {
    mocks.auth.isConfigured = true;
    mocks.auth.user = { id: 'user-1', email: 'player@example.com' };

    const page = await GamePage({ params: Promise.resolve({ gameId: 'hyosan-memories' }) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain('data-hyosan-entry="true"');
    expect(html).not.toContain('data-hyosan-access="login-required"');
  });

  it('blocks a suspended visitor before mounting the Hyosan graybox', async () => {
    mocks.auth.isConfigured = true;
    mocks.auth.user = { id: 'user-1', email: 'player@example.com' };
    mocks.auth.profile = { suspended_at: '2026-08-27T00:00:00.000Z' };

    await expect(
      GamePage({ params: Promise.resolve({ gameId: 'hyosan-memories' }) }),
    ).rejects.toThrow('NEXT_REDIRECT:/account-suspended');
  });

  it('publishes the Hyosan title without consulting the gated card game catalog', async () => {
    await expect(
      generateMetadata({ params: Promise.resolve({ gameId: 'hyosan-memories' }) }),
    ).resolves.toEqual({ title: '효산의 기억 — ICONS' });
    expect(mocks.getGameCatalogEntry).not.toHaveBeenCalled();
  });
});
