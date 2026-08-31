import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { NotificationItem } from '@/lib/notifications';
import { Notifications } from './Notifications';

vi.mock('@/components/ui/Icon', () => ({ Icon: () => <span aria-hidden /> }));

const unread: NotificationItem = {
  id: '11111111-1111-4111-8111-111111111111',
  type: 'order_paid',
  title: '결제를 확인했어요',
  body: '주문 상품을 준비하고 있어요.',
  linkPath: '/orders/order-1',
  readAt: null,
  createdAt: '2026-07-16T01:02:03.000Z',
  isUnread: true,
};

const read: NotificationItem = {
  ...unread,
  id: '22222222-2222-4222-8222-222222222222',
  type: 'order_shipping',
  title: '배송을 시작했어요',
  readAt: '2026-07-16T02:00:00.000Z',
  isUnread: false,
};

function render(items: NotificationItem[], error = false) {
  return renderToStaticMarkup(
    <Notifications error={error} notifications={items} openAction={vi.fn()} />,
  );
}

describe('Notifications', () => {
  it('renders a semantic private inbox and its settings entrypoint', () => {
    const html = render([unread]);

    expect(html).toContain('<main');
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('>알림함</h1>');
    expect(html).toContain('href="/notifications/settings"');
    expect(html).toContain('IP 알림 설정');
  });

  it('renders an honest empty state without mock notifications', () => {
    const html = render([]);

    expect(html).toContain('아직 받은 알림이 없어요');
    expect(html).toContain('주문, 카드팩, 팔로우한 IP의 새 소식');
    expect(html).not.toContain('wc-notif__row');
  });

  it('distinguishes unread and read ledger rows beyond color', () => {
    const html = render([unread, read]);

    expect(html).toContain('wc-notif__row is-unread');
    expect(html).toContain('안 읽은 알림');
    expect(html).toContain('읽은 알림');
    expect(html).toContain('wc-notif__dot');
    expect(html).toContain(`dateTime="${unread.createdAt}"`);
  });

  it('opens each full row through a form action instead of trusting the stored link in markup', () => {
    const html = render([unread, read]);

    expect(html.match(/<form/g)).toHaveLength(2);
    expect(html.match(/class="wc-notif__open"/g)).toHaveLength(2);
    expect(html).toContain('결제를 확인했어요');
    expect(html).toContain('배송을 시작했어요');
    expect(html).not.toContain(`href="${unread.linkPath}"`);
  });

  it('shows a generic open failure without provider details', () => {
    expect(render([unread], true)).toContain(
      '알림을 열지 못했습니다. 잠시 후 다시 시도해주세요.',
    );
  });
});
