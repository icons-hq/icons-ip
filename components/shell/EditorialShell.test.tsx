import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { closeEditorialMenu, Nav, shouldHideEditorialHeader } from './Nav';
import { SiteFooter } from './SiteFooter';

const mocks = vi.hoisted(() => ({ pathname: '/', count: 4, cardRewardsEnabled: true }));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
}));
vi.mock('@/components/ui/Icon', () => ({ Icon: ({ name }: { name: string }) => <span data-icon={name} /> }));
vi.mock('./CartProvider', () => ({ useCart: () => ({ count: mocks.count }) }));
vi.mock('./useGo', () => ({ useGo: () => vi.fn() }));
vi.mock('./AuthButton', () => ({ AuthButton: () => <span>ACCOUNT</span> }));
vi.mock('./NotificationBell', () => ({ NotificationBell: () => <span>NOTIFICATIONS</span> }));
vi.mock('./CardRewardAvailability', () => ({
  useCardRewardsEnabled: () => mocks.cardRewardsEnabled,
}));

describe('Living IP Editorial shell', () => {
  it('leaves the root route chrome to the exact preview home', () => {
    expect(renderToStaticMarkup(<Nav />)).toBe('');
    expect(renderToStaticMarkup(<SiteFooter />)).toBe('');
  });

  it('renders the product shell with real routes away from the preview home', () => {
    mocks.pathname = '/shop';
    const html = renderToStaticMarkup(<Nav />);

    expect(html).toContain('class="editorial-header"');
    expect(html).toContain('class="editorial-header__capsule"');
    expect(html).toMatch(/class="editorial-header__brand"[^>]*><span>ICONS<\/span><\/a>/);
    expect(html).not.toContain('editorial-header__brand-mark');
    expect(html).toContain('aria-label="전체 메뉴 열기"');
    expect(html).toContain('aria-controls="editorial-global-menu"');
    expect(html).toContain('id="editorial-global-menu"');
    expect(html).toContain('aria-label="전체 메뉴"');
    expect(html).toContain('href="/ip"');
    expect(html).toContain('href="/shop"');
    expect(html).toContain('href="/packs"');
    expect(html).toContain('href="/events"');
    expect(html).toContain('href="/community"');
    expect(html).toContain('href="/my"');
    expect(html).toContain('href="/notifications"');
    expect(html).toContain('aria-label="장바구니, 4개"');
    expect(renderToStaticMarkup(<SiteFooter />)).toContain('class="site-footer-editorial"');
    mocks.pathname = '/';
  });

  it('removes card-pack navigation from both header and footer while the gate is disabled', () => {
    mocks.pathname = '/shop';
    mocks.cardRewardsEnabled = false;

    expect(renderToStaticMarkup(<Nav />)).not.toContain('href="/packs"');
    expect(renderToStaticMarkup(<SiteFooter />)).not.toContain('href="/packs"');

    mocks.cardRewardsEnabled = true;
    mocks.pathname = '/';
  });

  it('keeps the header visible near the top and only hides after a meaningful downward delta', () => {
    expect(shouldHideEditorialHeader({ currentY: 80, previousY: 0, hidden: true })).toBe(false);
    expect(shouldHideEditorialHeader({ currentY: 300, previousY: 294, hidden: false })).toBe(false);
    expect(shouldHideEditorialHeader({ currentY: 320, previousY: 300, hidden: false })).toBe(true);
    expect(shouldHideEditorialHeader({ currentY: 280, previousY: 300, hidden: true })).toBe(false);
  });

  it('closes the fullscreen menu even when the selected route is already current', () => {
    expect(closeEditorialMenu('/')).toEqual({ open: false, pathname: '/' });

    mocks.pathname = '/shop';
    const html = renderToStaticMarkup(<Nav />);
    expect(html).toContain('data-close-menu="true"');
    expect(html).toMatch(
      /class="editorial-menu__secondary-group editorial-menu__account"[^>]*data-close-menu="true"/,
    );
    mocks.pathname = '/';
  });

  it('does not render the product shell on auth, game, immersive experience, or admin routes', () => {
    for (const pathname of ['/login', '/games/roulette', '/experiences/all-of-us-are-dead/last-bell', '/admin']) {
      mocks.pathname = pathname;
      expect(renderToStaticMarkup(<Nav />)).toBe('');
    }
    mocks.pathname = '/';
  });
});
