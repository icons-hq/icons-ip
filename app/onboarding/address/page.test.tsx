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
vi.mock('@/lib/auth/onboarding', async () => ({
  ...await vi.importActual<typeof import('@/lib/auth/onboarding')>('@/lib/auth/onboarding'),
  isOnboarded: () => mocks.onboarded,
}));
vi.mock('@/lib/address-book.server', () => ({ loadMyAddressBook: mocks.load }));
vi.mock('@/components/screens/OnboardingAddress', () => ({ OnboardingAddress: mocks.screen }));

const page = (next?: string) => Page({ searchParams: Promise.resolve(next === undefined ? {} : { next }) });

describe('/onboarding/address — 온보딩 뒤 배송지 등록 안내(건너뛸 수 있음)', () => {
  beforeEach(() => {
    mocks.auth = { isConfigured: true, user: { id: 'user-1', email: 'fan@icons.gg' }, profile: { onboarded_at: '2026-10-27T00:00:00.000Z' }, isStaff: false };
    mocks.onboarded = true;
    mocks.load.mockReset().mockResolvedValue([]);
    mocks.screen.mockClear();
  });

  it('검색에 노출하지 않는 개인 화면이다', () => {
    expect(metadata).toMatchObject({ title: '배송지 등록 — ICONS', robots: { index: false, follow: false } });
  });

  it('빈 주소록이면 안내를 보이고, 건너뛰면 갈 곳(next)은 안전한 경로로만 넘긴다', async () => {
    renderToStaticMarkup(await page('/checkout'));
    expect(mocks.screen).toHaveBeenLastCalledWith({ next: '/checkout' }, undefined);
    renderToStaticMarkup(await page('//evil.example'));
    expect(mocks.screen).toHaveBeenLastCalledWith({ next: '/' }, undefined);
    expect(mocks.load).toHaveBeenCalledWith('user-1');
  });

  it('가입·주문을 막지 않는다 — 이미 주소가 있거나 주소록을 읽지 못하면 바로 next 로 보낸다', async () => {
    mocks.load.mockResolvedValueOnce([{ id: 'a' }]);
    await expect(page('/checkout')).rejects.toThrow('NEXT_REDIRECT:/checkout');
    mocks.load.mockResolvedValueOnce(null);
    await expect(page('/shop')).rejects.toThrow('NEXT_REDIRECT:/shop');
    expect(mocks.screen).not.toHaveBeenCalled();
  });

  it('운영 화면으로 가는 길에는 안내를 끼우지 않는다', async () => {
    await expect(page('/admin/orders')).rejects.toThrow('NEXT_REDIRECT:/admin/orders');
    await expect(page('/manager-invitation?token=x')).rejects.toThrow('NEXT_REDIRECT:/manager-invitation?token=x');
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it('로그인·온보딩이 먼저다', async () => {
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };
    await expect(page('/checkout')).rejects.toThrow(`NEXT_REDIRECT:/login?next=${encodeURIComponent('/onboarding/address?next=%2Fcheckout')}`);
    mocks.auth = { isConfigured: true, user: { id: 'user-1', email: 'fan@icons.gg' }, profile: null, isStaff: false };
    mocks.onboarded = false;
    await expect(page('/checkout')).rejects.toThrow('NEXT_REDIRECT:/onboarding?next=%2Fcheckout');
    expect(mocks.load).not.toHaveBeenCalled();
  });
});
