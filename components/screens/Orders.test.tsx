import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { OrderListItem } from '@/lib/orders';
import { Orders } from './Orders';

function orderItem(overrides: Partial<OrderListItem> = {}): OrderListItem {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    status: 'paid',
    total: 30000,
    createdAt: '2026-08-01T06:00:00.000Z',
    itemLabel: '홍실 아크릴 블록',
    itemCount: 1,
    paymentMethod: 'card',
    ...overrides,
  };
}

describe('Orders', () => {
  it('payment 결과가 없으면 결제 배너를 렌더하지 않는다', () => {
    const html = renderToStaticMarkup(<Orders orders={[orderItem()]} />);

    expect(html).not.toContain('orders-payment-banner');
    expect(html).toContain('홍실 아크릴 블록');
  });

  it('approved면 결제 확인 안내를 status로 렌더한다', () => {
    const html = renderToStaticMarkup(<Orders orders={[orderItem()]} paymentResult="approved" />);

    expect(html).toContain('orders-payment-banner--approved');
    expect(html).toContain('role="status"');
    expect(html).toContain('결제가 확인됐어요');
  });

  it('approved라도 결제 완료 국면 주문이 없으면 쿼리만으로 승인 배너를 만들지 않는다', () => {
    expect(
      renderToStaticMarkup(<Orders orders={[]} paymentResult="approved" />),
    ).not.toContain('orders-payment-banner');
    expect(
      renderToStaticMarkup(
        <Orders orders={[orderItem({ status: 'canceled' })]} paymentResult="approved" />,
      ),
    ).not.toContain('orders-payment-banner');
  });

  it('checking이면 새로고침을 약속하지 않고 고객센터 1:1 문의로 안내한다', () => {
    const html = renderToStaticMarkup(<Orders orders={[orderItem()]} paymentResult="checking" />);

    expect(html).toContain('orders-payment-banner--checking');
    expect(html).toContain('role="status"');
    expect(html).toContain('결제를 확인하고 있어요');
    expect(html).toContain('고객센터');
    expect(html).toContain('href="/my/inquiries"');
    expect(html).not.toContain('새로고침');
  });

  it('failed면 실패 안내를 alert로 렌더하고 재주문 경로만 안내한다', () => {
    const html = renderToStaticMarkup(<Orders orders={[]} paymentResult="failed" />);

    expect(html).toContain('orders-payment-banner--failed');
    expect(html).toContain('role="alert"');
    expect(html).toContain('결제가 완료되지 않았어요');
    expect(html).toContain('href="/shop"');
    expect(html).not.toContain('주문 상세에서 결제를 다시 시도');
    expect(html).toContain('아직 주문 내역이 없어요');
  });
});
