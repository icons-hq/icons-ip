import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthButton } from './AuthButton';
import { Atmos } from './Atmos';
import { MobNav } from './MobNav';

const mocks = vi.hoisted(() => ({
  count: 3,
  pathname: '/my',
  presence: 'signed-in' as 'unknown' | 'signed-in' | 'signed-out',
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/app/login/actions', () => ({ signOutAction: vi.fn() }));
vi.mock('@/lib/auth/onboarding', () => ({
  nextPathWithSearch: () => '/my',
}));
vi.mock('@/lib/routes', async () => await import('../../lib/routes'));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  }),
}));
vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: () => ({ isConfigured: true }),
}));
vi.mock('./AuthPresenceProvider', () => ({
  useAuthPresence: () => mocks.presence,
}));
vi.mock('./CartProvider', () => ({
  useCart: () => ({ count: mocks.count, resetForSignOut: vi.fn() }),
}));

beforeEach(() => {
  mocks.count = 3;
  mocks.pathname = '/my';
  mocks.presence = 'signed-in';
});

describe('account shell entrypoints', () => {
  it('uses the account atmosphere on the my hub', () => {
    const html = renderToStaticMarkup(<Atmos />);
    expect(html).toContain('bg-atmos--my');
  });

  it('replaces the signed-in desktop settings shortcut with the active my link', () => {
    const html = renderToStaticMarkup(<AuthButton />);

    expect(html).toContain('href="/my"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('account-my-link');
    expect(html).toContain('>마이</a>');
    expect(html).toContain('로그아웃');
    expect(html).not.toContain('설정');
  });

  it('keeps the anonymous desktop login calls to action', () => {
    mocks.presence = 'signed-out';
    const html = renderToStaticMarkup(<AuthButton />);

    expect(html).toContain('로그인');
    expect(html).toContain('시작하기');
    expect(html).not.toContain('href="/my"');
    expect(html).not.toContain('로그아웃');
  });

  it('shows my instead of the cart in the signed-in mobile tabs', () => {
    const html = renderToStaticMarkup(<MobNav />);

    expect(html).toContain('href="/my"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('>마이</a>');
    expect(html).not.toContain('href="/cart"');
    expect(html).not.toContain('mobnav-cart-count');
  });

  it('keeps the counted cart tab and no my link for anonymous mobile users', () => {
    mocks.presence = 'signed-out';
    mocks.pathname = '/cart';
    const html = renderToStaticMarkup(<MobNav />);

    expect(html).toContain('href="/cart"');
    expect(html).toContain('aria-label="장바구니, 3개"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('mobnav-cart-count');
    expect(html).not.toContain('href="/my"');
  });

  it('renders neutral shell placeholders while authentication is unresolved', () => {
    mocks.presence = 'unknown';

    const desktop = renderToStaticMarkup(<AuthButton />);
    const mobile = renderToStaticMarkup(<MobNav />);

    expect(desktop).toContain('auth-presence-placeholder');
    expect(desktop).not.toContain('로그인');
    expect(desktop).not.toContain('로그아웃');
    expect(mobile).toContain('aria-busy="true"');
    expect(mobile).toContain('mobnav-presence-placeholder');
    expect(mobile).not.toContain('href="/cart"');
    expect(mobile).not.toContain('href="/my"');
  });
});
