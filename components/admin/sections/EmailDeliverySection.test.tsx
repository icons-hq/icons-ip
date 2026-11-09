import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { EmailDeliveryRecord } from '@/lib/email/deliveries.server';
import { EmailDeliverySection } from './EmailDeliverySection';

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useActionState: (_action: unknown, initial: unknown) => [initial, vi.fn(), false],
  };
});
vi.mock('@/app/admin/order-actions', () => ({ resendOrderEmailAction: vi.fn() }));

const ORDER_ID = 'b2f8a1c4-3d5e-4f6a-8b7c-9d0e1f2a3b4c';

const failedDelivery: EmailDeliveryRecord = {
  dedupeKey: `order_confirmation:${ORDER_ID}`,
  template: 'order_confirmation',
  templateLabel: '주문 확인',
  orderId: ORDER_ID,
  recipient: 'buyer@example.com',
  subject: '[ICONS] 주문이 접수됐어요',
  status: 'failed',
  attemptCount: 2,
  lastError: 'resend 429',
  claimedAt: '2026-08-07T02:30:00.000Z',
  completedAt: '2026-08-07T02:30:01.000Z',
  createdAt: '2026-08-07T02:00:00.000Z',
  resendable: true,
};

/* 문의 답변 메일은 주문 상태로 사실성을 판정할 수 없어 재발송 게이트가 거절한다(#253).
   누르면 반드시 실패하는 버튼을 그리는 대신 이유를 적는다. */
const inquiryDelivery: EmailDeliveryRecord = {
  ...failedDelivery,
  dedupeKey: 'inquiry_answered:5f2b9c11-3d5e-4f6a-8b7c-9d0e1f2a3b4c',
  template: 'inquiry_answered',
  templateLabel: '문의 답변',
  orderId: null,
  subject: '[ICONS] 문의에 답변이 등록됐어요',
  resendable: false,
};

describe('EmailDeliverySection', () => {
  // SQL 콘솔 없이 실패를 보고 다시 보낼 수 있어야 한다.
  it('실패한 발송을 사유와 재발송 버튼과 함께 보여준다', () => {
    const html = renderToStaticMarkup(<EmailDeliverySection deliveries={[failedDelivery]} />);

    expect(html).toContain('주문 확인');
    expect(html).toContain('buyer@example.com');
    expect(html).toContain('resend 429');
    expect(html).toContain('2회 시도');
    expect(html).toContain('다시 보내기');
    expect(html).toContain(`value="order_confirmation:${ORDER_ID}"`);
  });

  it('다시 보낼 건이 없으면 빈 상태를 알린다', () => {
    const html = renderToStaticMarkup(<EmailDeliverySection deliveries={[]} />);

    expect(html).toContain('다시 보낼 메일이 없습니다');
    expect(html).not.toContain('다시 보내기');
  });
});

describe('EmailDeliverySection · 주문에 매이지 않는 메일', () => {
  it('문의 답변 메일에는 재발송 버튼 대신 이유를 보여준다', () => {
    const html = renderToStaticMarkup(<EmailDeliverySection deliveries={[inquiryDelivery]} />);

    expect(html).toContain('문의 답변');
    expect(html).not.toContain('다시 보내기');
    expect(html).toContain('1:1 문의 화면에서 답변을 다시 등록해주세요');
  });

  /* DB가 원문을 가린 값(legacy_*·masked)은 코드 그대로 보이지 않고, 줄마다의 안내는 메일 종류를 따른다. */
  it('가려진 코드를 사람 말로 바꾸고 주문 메일에 문의 답변 안내를 붙이지 않는다', () => {
    const redacted: EmailDeliveryRecord = {
      ...failedDelivery,
      dedupeKey: 'order_shipped:legacy-key',
      template: 'order_shipped',
      templateLabel: '배송 시작',
      orderId: null,
      recipient: 'masked',
      subject: 'legacy_order_shipped',
      lastError: 'legacy_unverified',
      resendable: false,
    };
    const html = renderToStaticMarkup(<EmailDeliverySection deliveries={[redacted]} />);

    for (const code of ['legacy_order_shipped', 'legacy_unverified', '받는 사람 masked']) expect(html).not.toContain(code);
    expect(html).toContain('상세 사유는 개인정보 보호로 저장하지 않습니다.');
    expect(html).toContain('대상 주문을 확인할 수 없어');
    expect(html).not.toContain('1:1 문의 화면');
    expect(html).not.toContain('다시 보내기');
  });

  it('실패 건수를 위에 보이고 실패한 건을 먼저 보여준다', () => {
    const pending: EmailDeliveryRecord = { ...failedDelivery, dedupeKey: `order_shipped:${ORDER_ID}`, template: 'order_shipped', templateLabel: '배송 시작', status: 'pending', lastError: null, claimedAt: '2026-08-08T02:30:00.000Z' };
    const html = renderToStaticMarkup(<EmailDeliverySection deliveries={[pending, failedDelivery]} />);

    expect(html).toContain('발송 실패');
    expect(html.indexOf('data-email-delivery-summary')).toBeLessThan(html.indexOf('메일 발송 이력 목록'));
    expect(html.indexOf('주문 확인 메일은')).toBeLessThan(html.indexOf('메일 발송 이력 목록'));
    expect(html.indexOf(`order_confirmation:${ORDER_ID}`)).toBeLessThan(html.indexOf(`order_shipped:${ORDER_ID}`));
  });
});
