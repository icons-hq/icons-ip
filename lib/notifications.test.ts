import { describe, expect, it } from 'vitest';
import {
  isSafeNotificationLink,
  notificationOpenedPath,
  notificationDisplayCopy,
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
  it('DB가 생성하는 Q&A·교환 시스템 문장만 고객 어휘로 표시한다', () => {
    expect(notificationDisplayCopy({ type: 'product_question_answered', title: '상품 Q&A에 답변이 등록됐어요', body: '상품명 질문에 ICONS 운영자가 답변을 남겼습니다.' }))
      .toEqual({ title: '굿즈 Q&A에 답변이 등록됐어요', body: '상품명 질문에 ICONS 운영자가 답변을 남겼습니다.' });
    expect(notificationDisplayCopy({ type: 'claim_updated', title: '교환 상품이 재출고됐어요', body: '교환 상품을 새 운송장으로 발송했습니다.' }))
      .toEqual({ title: '교환 굿즈가 재출고됐어요', body: '교환 굿즈를 새 운송장으로 발송했습니다.' });
    expect(notificationDisplayCopy({ type: 'claim_updated', title: '반송한 굿즈가 입고됐어요', body: '입고가 확인됐습니다. 교환 상품 재출고를 준비합니다.' }).body)
      .toBe('입고가 확인됐습니다. 교환 굿즈 재출고를 준비합니다.');
  });
  it('같은 단어가 있어도 작성자 공지·상품명·임의 문구와 DB 원본은 보존한다', () => {
    const input = { type: 'announcement' as const, title: '상품 Q&A에 답변이 등록됐어요', body: '교환 상품을 새 운송장으로 발송했습니다.' };
    expect(notificationDisplayCopy(input)).toEqual({ title: input.title, body: input.body });
    expect(notificationDisplayCopy({ ...input, type: 'claim_updated', title: '상품 선물 안내', body: '상품명: 추가상품' }))
      .toEqual({ title: '상품 선물 안내', body: '상품명: 추가상품' });
    expect(notificationDisplayCopy({ ...input, type: 'product_question_answered', title: '__proto__', body: 'constructor' }))
      .toEqual({ title: '__proto__', body: 'constructor' });
    expect(input.title).toBe('상품 Q&A에 답변이 등록됐어요');
  });
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
