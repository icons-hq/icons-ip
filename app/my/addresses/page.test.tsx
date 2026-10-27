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
vi.mock('@/lib/address-book.server', () => ({ loadMyAddressBook: mocks.load }));
vi.mock('@/components/screens/MyAddresses', () => ({ MyAddresses: mocks.screen }));

describe('/my/addresses page', () => {
  beforeEach(() => {
    mocks.auth = { isConfigured: true, user: { id: 'user-1', email: 'fan@icons.gg' }, profile: { onboarded_at: '2026-08-01T00:00:00.000Z' }, isStaff: false };
    mocks.onboarded = true;
    mocks.load.mockReset().mockResolvedValue([]);
    mocks.screen.mockClear();
  });

  it('is a private account page in metadata', () => {
    expect(metadata).toMatchObject({ title: '배송지 관리 — ICONS', robots: { index: false, follow: false } });
  });

  it('requires login and onboarding with the exact return path before reading the address book', async () => {
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };
    await expect(Page()).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fmy%2Faddresses');

    mocks.auth = { isConfigured: true, user: { id: 'user-1', email: 'fan@icons.gg' }, profile: null, isStaff: false };
    mocks.onboarded = false;
    await expect(Page()).rejects.toThrow('NEXT_REDIRECT:/onboarding?next=%2Fmy%2Faddresses');
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("reads only the signed-in member's book and passes it (or the read failure) to the screen", async () => {
    const entries = [{ id: 'a', label: '집', recipientName: '홍길동', phone: '01012345678', postalCode: '04524', address1: '서울', address2: null, isDefault: true }];
    mocks.load.mockResolvedValueOnce(entries);
    renderToStaticMarkup(await Page());
    expect(mocks.load).toHaveBeenCalledWith('user-1');
    expect(mocks.screen).toHaveBeenLastCalledWith({ entries }, undefined);

    mocks.load.mockResolvedValueOnce(null);
    renderToStaticMarkup(await Page());
    expect(mocks.screen).toHaveBeenLastCalledWith({ entries: null }, undefined);
  });
});
