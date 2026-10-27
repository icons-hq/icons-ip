import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Page, { metadata } from './page';

const mocks = vi.hoisted(() => ({
  auth: null as unknown,
  onboarded: true,
  load: vi.fn(),
  screen: vi.fn<(props: Record<string, unknown>) => null>(() => null),
}));

vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); },
}));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: async () => mocks.auth }));
vi.mock('@/lib/auth/onboarding', () => ({
  isOnboarded: () => mocks.onboarded,
  onboardingPath: (next: string) => `/onboarding?next=${encodeURIComponent(next)}`,
}));
vi.mock('@/lib/loyalty-benefits.server', () => ({ loadLoyaltyBenefitsPage: mocks.load }));
vi.mock('@/components/screens/MyGradeBenefits', () => ({ MyGradeBenefits: mocks.screen }));

describe('/my/grade-benefits page', () => {
  beforeEach(() => {
    mocks.auth = { isConfigured: true, user: { id: 'user-1', email: 'fan@icons.gg' }, profile: { onboarded_at: '2026-08-01T00:00:00.000Z' }, isStaff: false };
    mocks.onboarded = true;
    mocks.load.mockReset();
    mocks.load.mockResolvedValue({ standing: null, benefits: null });
    mocks.screen.mockClear();
  });

  it('is a private account page in metadata', () => {
    expect(metadata).toMatchObject({ title: '회원 등급 혜택 — ICONS', robots: { index: false, follow: false } });
  });

  it('requires login and onboarding with the exact return path before reading benefits', async () => {
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };
    await expect(Page()).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fmy%2Fgrade-benefits');

    mocks.auth = { isConfigured: true, user: { id: 'user-1', email: 'fan@icons.gg' }, profile: null, isStaff: false };
    mocks.onboarded = false;
    await expect(Page()).rejects.toThrow('NEXT_REDIRECT:/onboarding?next=%2Fmy%2Fgrade-benefits');
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it('passes both reads to the screen as-is', async () => {
    const standing = { grade: 'gold', windowSpend: 1, windowItemCount: 1, nextNote: null, tiers: [] };
    const benefits = { creditRatesEnabled: false, grades: [] };
    mocks.load.mockResolvedValue({ standing, benefits });

    renderToStaticMarkup(await Page());

    expect(mocks.screen).toHaveBeenCalledWith({ benefits, standing }, undefined);
  });
});
