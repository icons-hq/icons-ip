import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadUnreadNotificationCount,
  NotificationBell,
  NotificationBellView,
  notificationNavigationKey,
} from './NotificationBell';
import { Nav } from './Nav';
import { Atmos } from './Atmos';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  from: vi.fn(),
  is: vi.fn(),
  pathname: '/notifications',
  presence: 'signed-in' as 'unknown' | 'signed-in' | 'signed-out',
  search: '',
  select: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: mocks.createClient }));
vi.mock('./AuthPresenceProvider', () => ({ useAuthPresence: () => mocks.presence }));
vi.mock('./AuthButton', () => ({ AuthButton: () => <span>ACCOUNT</span> }));
vi.mock('./CartProvider', () => ({ useCart: () => ({ count: 0 }) }));
vi.mock('./useGo', () => ({ useGo: () => vi.fn() }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => <span aria-hidden /> }));

beforeEach(() => {
  mocks.createClient.mockReset();
  mocks.from.mockReset();
  mocks.is.mockReset();
  mocks.pathname = '/notifications';
  mocks.presence = 'signed-in';
  mocks.search = '';
  mocks.select.mockReset();

  mocks.is.mockResolvedValue({ count: 3, error: null });
  mocks.select.mockReturnValue({ is: mocks.is });
  mocks.from.mockReturnValue({ select: mocks.select });
  mocks.createClient.mockReturnValue({ from: mocks.from });
});

describe('loadUnreadNotificationCount', () => {
  it('uses an owner-RLS count-only query without loading notification rows', async () => {
    await expect(loadUnreadNotificationCount(mocks.createClient())).resolves.toBe(3);

    expect(mocks.from).toHaveBeenCalledWith('notifications');
    expect(mocks.select).toHaveBeenCalledWith('id', { count: 'exact', head: true });
    expect(mocks.is).toHaveBeenCalledWith('read_at', null);
  });

  it('does not disguise a failed or indeterminate count as zero', async () => {
    mocks.is.mockResolvedValue({ count: null, error: { message: 'private count error' } });
    await expect(loadUnreadNotificationCount(mocks.createClient())).rejects.toThrow(
      'Failed to load unread notification count',
    );

    mocks.is.mockResolvedValue({ count: null, error: null });
    await expect(loadUnreadNotificationCount(mocks.createClient())).rejects.toThrow(
      'Failed to load unread notification count',
    );
  });
});

describe('NotificationBellView', () => {
  it('renders a neutral 44px placeholder while auth is unresolved', () => {
    const html = renderToStaticMarkup(
      <NotificationBellView countState={{ status: 'loading' }} pathname="/" presence="unknown" />,
    );

    expect(html).toContain('notification-bell-placeholder');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('href="/notifications"');
  });

  it('renders nothing for a signed-out visitor', () => {
    expect(renderToStaticMarkup(
      <NotificationBellView countState={{ status: 'loading' }} pathname="/" presence="signed-out" />,
    )).toBe('');
  });

  it('caps the visual badge while preserving the exact accessible count and active state', () => {
    const html = renderToStaticMarkup(
      <NotificationBellView
        countState={{ status: 'ready', count: 120 }}
        pathname="/notifications/settings"
        presence="signed-in"
      />,
    );

    expect(html).toContain('href="/notifications"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('aria-label="알림함, 안 읽은 알림 120개"');
    expect(html).toContain('>99+</span>');
  });

  it('exposes a count failure instead of claiming the inbox is empty', () => {
    const html = renderToStaticMarkup(
      <NotificationBellView countState={{ status: 'error' }} pathname="/" presence="signed-in" />,
    );

    expect(html).toContain('안 읽은 알림 수를 확인하지 못했습니다');
    expect(html).toContain('notification-bell-error');
    expect(html).not.toContain('안 읽은 알림 없음');
  });
});

describe('NotificationBell', () => {
  it('changes the count refresh key when a same-path notification open is signaled', () => {
    expect(notificationNavigationKey('/notifications', null)).not.toBe(
      notificationNavigationKey(
        '/notifications',
        '11111111-1111-4111-8111-111111111111',
      ),
    );
  });

  it('uses AuthPresence to avoid a signed-out count request', () => {
    mocks.presence = 'signed-out';

    expect(renderToStaticMarkup(<NotificationBell />)).toBe('');
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('uses the notification atmosphere for the inbox and its settings route', () => {
    mocks.pathname = '/notifications/settings';

    expect(renderToStaticMarkup(<Atmos />)).toContain('bg-atmos--notifications');
  });

  it('uses registered bell and settings glyphs instead of empty SVG paths', async () => {
    const { Icon } = await vi.importActual<typeof import('../ui/Icon')>(
      '../ui/Icon',
    );
    const html = renderToStaticMarkup(
      <><Icon name="bell" /><Icon name="settings" /></>,
    );

    expect(html.match(/<path d="[^"]+"/g)).toHaveLength(2);
  });

  it('sits between search and cart in the shared top navigation', () => {
    mocks.presence = 'signed-in';
    mocks.pathname = '/ip';

    const html = renderToStaticMarkup(<Nav />);
    const search = html.indexOf('aria-label="검색"');
    const bell = html.indexOf('href="/notifications"');
    const cart = html.indexOf('aria-label="장바구니"');

    expect(search).toBeGreaterThan(-1);
    expect(bell).toBeGreaterThan(search);
    expect(cart).toBeGreaterThan(bell);
  });
});
