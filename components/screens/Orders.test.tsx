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

  /* 원장 결과가 있으면 쿼리보다 그것을 믿는다. 늦게 끝낸 인증은 checking으로 돌아오지만
     실제로는 청구 없이 끝난 결제다(UX-2·AMT-5). */
  describe('원장에서 읽은 결제 결과', () => {
    const orderId = '22222222-2222-4222-8222-222222222222';

    it('시도 만료는 확인 중이 아니라 청구 없음과 다시 주문으로 안내한다', () => {
      const html = renderToStaticMarkup(
        <Orders orders={[]} paymentResult="checking" paymentFocus={{ orderId, outcome: 'attempt_expired' }} />,
      );

      expect(html).toContain('결제 가능 시간이 지났어요');
      expect(html).toContain('청구된 금액은 없어요');
      expect(html).not.toContain('결제를 확인하고 있어요');
      expect(html).toContain(`href="/checkout/${orderId}"`);
    });

    it('확인 중이면 자동 확정을 약속하지 않고 그 주문의 결제 화면과 1:1 문의로 잇는다', () => {
      const html = renderToStaticMarkup(
        <Orders orders={[]} paymentResult="checking" paymentFocus={{ orderId, outcome: 'checking' }} />,
      );

      expect(html).toContain('결제를 확인하고 있어요');
      expect(html).not.toContain('확인이 끝나면');
      expect(html).toContain(`href="/checkout/${orderId}"`);
      expect(html).toContain('href="/my/inquiries"');
    });

    it('승인 거절은 그 주문을 정리하고 다시 주문하는 화면으로 보낸다', () => {
      const html = renderToStaticMarkup(
        <Orders orders={[]} paymentResult="failed" paymentFocus={{ orderId, outcome: 'not_approved' }} />,
      );

      expect(html).toContain('결제가 승인되지 않았어요');
      expect(html).toContain('주문 정리하고 다시 주문하기');
      expect(html).toContain('role="alert"');
    });

    it('아직 유효한 시도만 같은 주문 재시도를 안내한다', () => {
      const retryable = renderToStaticMarkup(
        <Orders orders={[]} paymentResult="failed" paymentFocus={{ orderId, outcome: 'retryable' }} />,
      );
      expect(retryable).toContain('같은 주문에서 다시 시도');

      const closed = renderToStaticMarkup(
        <Orders orders={[]} paymentResult="failed" paymentFocus={{ orderId, outcome: 'not_approved' }} />,
      );
      expect(closed).not.toContain('같은 주문에서 다시 시도');
    });

    it('처리 중인 취소 요청이 있으면 재시도를 약속하지 않고 주문 상세로 잇는다', () => {
      const html = renderToStaticMarkup(
        <Orders orders={[]} paymentResult="checking" paymentFocus={{ orderId, outcome: 'cancellation_requested' }} />,
      );

      expect(html).toContain('취소 요청을 처리하고 있어요');
      expect(html).not.toContain('같은 주문에서 다시 시도');
      expect(html).not.toContain('결제 이어가기');
      expect(html).toContain(`href="/orders/${orderId}"`);
    });

    /* 콜백 리다이렉트에는 주문이 없어 원장 결과가 나중에 준비만 해 둔 다른 주문을 짚을
       수 있다. 승인 콜백을 그 주문의 미결 상태로 덮지 않는다(E-2). */
    it('승인 콜백인데 원장 결과가 다른 미결 주문이면 결제 완료 주문이 있을 때 승인 안내를 지킨다', () => {
      const html = renderToStaticMarkup(
        <Orders orders={[orderItem()]} paymentResult="approved" paymentFocus={{ orderId, outcome: 'retryable' }} />,
      );

      expect(html).toContain('결제가 확인됐어요');
      expect(html).not.toContain('결제가 완료되지 않았어요');
      expect(html).not.toContain('결제 이어가기');
    });

    it('승인 콜백이라도 결제 완료 주문이 없으면 원장 결과를 따른다', () => {
      const html = renderToStaticMarkup(
        <Orders orders={[]} paymentResult="approved" paymentFocus={{ orderId, outcome: 'retryable' }} />,
      );

      expect(html).toContain('결제가 완료되지 않았어요');
      expect(html).not.toContain('결제가 확인됐어요');
    });

    it('쿼리가 checking이어도 원장이 결제 완료면 승인 안내와 주문 상세 링크를 보인다', () => {
      const html = renderToStaticMarkup(
        <Orders orders={[]} paymentResult="checking" paymentFocus={{ orderId, outcome: 'approved' }} />,
      );

      expect(html).toContain('결제가 확인됐어요');
      expect(html).toContain(`href="/orders/${orderId}"`);
    });
  });
});
