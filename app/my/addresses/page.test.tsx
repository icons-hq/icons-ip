import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Page, { metadata } from './page';

const mocks = vi.hoisted(() => ({
  auth: null as unknown,
  onboarded: true,
  load: vi.fn(),
  screen: vi.fn<(props: Record<string, unknown>) => null>(() => null),
  notOpen: vi.fn<(props: Record<string, unknown>) => null>(() => null),
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
vi.mock('@/components/screens/MyAddresses', () => ({ MyAddresses: mocks.screen, MyAddressesNotOpen: mocks.notOpen }));

describe('/my/addresses page', () => {
  beforeEach(() => {
    /* 주소록을 여는 날(처리방침 주소록 개정 시행일, KST) 이후를 기준으로 한다. */
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-06T00:00:00+09:00'));
    mocks.auth = { isConfigured: true, user: { id: 'user-1', email: 'fan@icons.gg' }, profile: { onboarded_at: '2026-08-01T00:00:00.000Z' }, isStaff: false };
    mocks.onboarded = true;
    mocks.load.mockReset().mockResolvedValue([]);
    mocks.screen.mockClear();
    mocks.notOpen.mockClear();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('여는 날 전에는 일반 회원에게 주소록을 읽지 않고 여는 날 안내만, staff/admin 에게는 미리보기를 보인다', async () => {
    vi.setSystemTime(new Date('2026-11-05T23:59:59+09:00'));
    renderToStaticMarkup(await Page());
    expect(mocks.notOpen).toHaveBeenCalledTimes(1);
    expect(mocks.screen).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();

    mocks.auth = { ...(mocks.auth as object), isStaff: true };
    renderToStaticMarkup(await Page());
    expect(mocks.load).toHaveBeenCalledWith('user-1');
    expect(mocks.screen).toHaveBeenLastCalledWith({ entries: [] }, undefined);
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
