import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMypageMenuGroups } from '@/components/wc/MypageShell';
import { MENU_SHEET_GROUPS, hrefFor } from '@/lib/routes';
import { SiteFooter } from './SiteFooter';

const mocks = vi.hoisted(() => ({ pathname: '/offline-popups' }));

vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }));
vi.mock('./StaffPreviewAvailability', () => ({
  useSecondaryMarketDemoVisible: () => false,
  useCommunityStaffPreviewVisible: () => false,
}));
vi.mock('@/components/shell/CardRewardAvailability', () => ({ useCardRewardsEnabled: () => true }));
vi.mock('@/components/shell/CollectibleFeatures', () => ({ useCollectibleFeatures: () => ({ binder: false, market: false, exchange: false }) }));
vi.mock('@/components/subscriptions/SubscriptionMenuAvailability', () => ({ useSubscriptionMenuAvailable: () => true }));
vi.mock('@/components/gifts/GiftMenuAvailability', () => ({ useGiftMenuAvailable: () => true }));
vi.mock('@/components/identity/AdultVerificationMenuAvailability', () => ({ useAdultVerificationMenuAvailable: () => true }));

beforeEach(() => {
  mocks.pathname = '/offline-popups';
});

/* 티켓 진입점은 푸터가 유일한 상시 표면이었다. X SQUARE 푸터(ADR-0043)는 Figma 구성(약관·안내·고객센터·SNS·사업자 정보)이라
   내 티켓 링크가 빠지고, 진입은 마이페이지 메뉴와 모바일 전체 메뉴 시트가 맡는다 — 이 시험이 그 두 진입점을 잠근다. */
describe('ticket shell entrypoints', () => {
  it('maps the protected my-tickets surface', () => {
    expect(hrefFor('tickets')).toBe('/tickets');
  });

  it('links to my tickets from the mypage menu', () => {
    const items = useMypageMenuGroups().flatMap((group) => group.items);

    expect(items.find((item) => item.href === '/tickets')?.label).toBe('내 티켓');
  });

  it('links to my tickets from the mobile full menu sheet', () => {
    const sheetItems = MENU_SHEET_GROUPS.flatMap((group) => group.items);

    expect(sheetItems.find((item) => item.id === 'tickets')?.label).toBe('내 티켓');
    expect(hrefFor('tickets')).toBe('/tickets');
  });

  it('does not list my tickets in the Figma footer', () => {
    const html = renderToStaticMarkup(<SiteFooter copyrightYear={2026} />);

    expect(html).not.toContain('href="/tickets"');
    expect(html).not.toContain('내 티켓');
  });
});
