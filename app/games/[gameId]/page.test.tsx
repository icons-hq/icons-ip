import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ProfileForOnboarding } from '@/lib/auth/onboarding';
import GamePage, { generateMetadata } from './page';

const mocks = vi.hoisted(() => ({
  auth: {
    isConfigured: false,
    user: null as { id: string; email: string | null } | null,
    profile: null as ProfileForOnboarding | null,
    isStaff: false,
  },
}));

vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: async () => mocks.auth }));
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
    mocks.auth.isConfigured = false;
    mocks.auth.user = null;
    mocks.auth.profile = null;
  });

  /* 카드 리워드 참여형 게임은 2026-11-24 일반 쇼핑몰 전환으로 지웠다(ADR-0052) — 효산의 기억 말고는 404 다. */
  it('returns 404 for any game other than Hyosan', async () => {
    await expect(GamePage({ params: Promise.resolve({ gameId: 'game-1' }) })).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(GamePage({ params: Promise.resolve({ gameId: 'marble-roulette' }) })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('does not publish a title for any game other than Hyosan', async () => {
    await expect(generateMetadata({ params: Promise.resolve({ gameId: 'game-1' }) })).resolves.toEqual({
      title: '엑스스퀘어',
    });
  });

  it('fails closed at the Hyosan login gate when Supabase is not configured', async () => {
    const page = await GamePage({ params: Promise.resolve({ gameId: 'hyosan-memories' }) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain('data-hyosan-access="login-required"');
    expect(html).toContain('href="/login?next=%2Fgames%2Fhyosan-memories"');
    expect(html).not.toContain('data-hyosan-entry="true"');
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
  });

  it('requires onboarding when an authenticated visitor has no trustworthy profile', async () => {
    mocks.auth.isConfigured = true;
    mocks.auth.user = { id: 'user-1', email: 'player@example.com' };

    await expect(
      GamePage({ params: Promise.resolve({ gameId: 'hyosan-memories' }) }),
    ).rejects.toThrow(
      'NEXT_REDIRECT:/onboarding?next=%2Fgames%2Fhyosan-memories',
    );
  });

  it('mounts the Hyosan graybox for an onboarded visitor', async () => {
    mocks.auth.isConfigured = true;
    mocks.auth.user = { id: 'user-1', email: 'player@example.com' };
    mocks.auth.profile = {
      email: 'player@example.com',
      nickname: '절비',
      birth_date: '2000-01-01',
      consents: { terms: true, privacy: true },
      onboarded_at: '2026-08-27T00:00:00.000Z',
      suspended_at: null,
    };

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

  it('publishes the Hyosan title', async () => {
    await expect(
      generateMetadata({ params: Promise.resolve({ gameId: 'hyosan-memories' }) }),
    ).resolves.toEqual({ title: '효산의 기억 — 엑스스퀘어' });
  });
});
