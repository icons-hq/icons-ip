import { describe, expect, it } from 'vitest';
import {
  isSafeNotificationLink,
  notificationOpenedPath,
  toNotificationItem,
  type NotificationRow,
} from './notifications';

const row: NotificationRow = {
  id: '11111111-1111-4111-8111-111111111111',
  type: 'order_paid',
  title: '결제를 확인했어요',
  body: '주문 상품을 준비하고 있어요.',
  link_path: '/orders/22222222-2222-4222-8222-222222222222',
  read_at: null,
  created_at: '2026-07-16T01:02:03.000Z',
};

describe('notification DTO', () => {
  it('maps the selected database row to a safe unread inbox item', () => {
    expect(toNotificationItem(row)).toEqual({
      id: row.id,
      type: 'order_paid',
      title: '결제를 확인했어요',
      body: '주문 상품을 준비하고 있어요.',
      linkPath: row.link_path,
      readAt: null,
      createdAt: row.created_at,
      isUnread: true,
    });
  });

  it('derives a read item without exposing database ownership or source fields', () => {
    const item = toNotificationItem({
      ...row,
      read_at: '2026-07-16T01:05:00.000Z',
    });

    expect(item.isUnread).toBe(false);
    expect(item).not.toHaveProperty('userId');
    expect(item).not.toHaveProperty('sourceType');
    expect(item).not.toHaveProperty('sourceId');
  });

  it.each([
    ['https://evil.example/path'],
    ['//evil.example/path'],
    ['/orders\\evil'],
    ['orders/relative'],
    [''],
  ])('fails an unsafe link %s closed to the inbox', (linkPath) => {
    expect(isSafeNotificationLink(linkPath)).toBe(false);
    expect(toNotificationItem({ ...row, link_path: linkPath }).linkPath).toBe('/notifications');
  });

  it.each(['/notifications', '/orders/123', '/offline-popups/event-1?source=notification']) (
    'accepts the internal link %s',
    (linkPath) => {
      expect(isSafeNotificationLink(linkPath)).toBe(true);
    },
  );

  it('adds a navigation signal without losing an existing query or fragment', () => {
    expect(notificationOpenedPath(
      '/notifications?source=inbox#latest',
      '11111111-1111-4111-8111-111111111111',
    )).toBe(
      '/notifications?source=inbox&notification_opened=11111111-1111-4111-8111-111111111111#latest',
    );
  });
});
