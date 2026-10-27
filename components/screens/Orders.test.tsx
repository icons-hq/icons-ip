import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { OrderListItem } from '@/lib/orders';
import type { PublicReviewEvent } from '@/lib/review-events';
import { Orders } from './Orders';

function reviewEvent(overrides: Partial<PublicReviewEvent> = {}): PublicReviewEvent {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    title: '첫 리뷰 이벤트',
    description: '사진 리뷰를 남겨주세요',
    startsOn: '2026-10-20',
    endsOn: '2026-10-31',
    announcesOn: '2026-11-05',
    plannedWinners: 10,
    creditAmount: 3000,
    creditValidityDays: 30,
    bannerStyle: 'basic',
    state: 'active',
    announcedAt: null,
    nextChangeAt: null,
    ...overrides,
  } as PublicReviewEvent;
}

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
      /* 2026-10-12 QA-1: 거절 주문과 같은 정리 흐름 — 결제 기한 뒤 자동 취소를 기다리게
         하지 않는다. */
      expect(html).toContain('주문 정리하고 다시 주문하기');
      expect(html).toContain('이 주문을 취소하고 같은 굿즈로 다시 주문할 수 있어요');
      expect(html).not.toContain('몇 분 안에 자동으로 취소');
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

    it('장바구니가 남은 주문의 결제 실패는 다시 담지 않고 주문서에서 다시 결제하게 한다(ADR-0026)', () => {
      const html = renderToStaticMarkup(
        <Orders orders={[]} paymentResult="failed" paymentFocus={{ orderId, outcome: 'not_approved', cartRetained: true }} />,
      );
      expect(html).toContain('장바구니는 그대로 있으니');
      expect(html).toContain('href="/checkout"');
      expect(html).not.toContain('주문 정리하고 다시 주문하기');
      const canceled = renderToStaticMarkup(
        <Orders orders={[]} paymentResult="failed" paymentFocus={{ orderId, outcome: 'canceled', cartRetained: true }} />,
      );
      expect(canceled).toContain('href="/cart"');
      expect(canceled).not.toContain('같은 굿즈 다시 담기');
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

    /* 승인을 기다리는 사이 다른 탭에서 취소했다(C race 케이스 A). 콜백은 approved로 돌아오고
       원장은 결제 paid·주문 pending·요청 processing이다. 승인은 확정됐고 결제 취소가 진행
       중이다 — '승인 결과를 아직 확정하지 못했어요'는 사실과 다르다(INT-5). */
    it('승인된 결제를 취소 요청에 따라 취소하는 중이면 확인 중이 아니라 결제 취소 진행으로 안내한다', () => {
      const html = renderToStaticMarkup(
        <Orders orders={[]} paymentResult="approved" paymentFocus={{ orderId, outcome: 'refund_in_progress' }} />,
      );

      expect(html).toContain('결제 취소를 진행하고 있어요');
      expect(html).toContain('결제는 승인됐고, 취소 요청에 따라 결제 취소를 진행하고 있어요');
      expect(html).not.toContain('결제를 확인하고 있어요');
      expect(html).not.toContain('아직 확정하지 못했어요');
      expect(html).not.toContain('결제가 확인됐어요');
      expect(html).toContain(`href="/orders/${orderId}"`);
      expect(html).toContain('주문 상세 보기');
      expect(html).toContain('role="status"');
    });

    it('결제 완료 주문이 따로 있어도 결제 취소 진행 안내를 승인 안내로 덮지 않는다', () => {
      const html = renderToStaticMarkup(
        <Orders orders={[orderItem()]} paymentResult="approved" paymentFocus={{ orderId, outcome: 'refund_in_progress' }} />,
      );

      expect(html).toContain('결제 취소를 진행하고 있어요');
      expect(html).not.toContain('결제가 확인됐어요');
    });

    it('결제사 취소까지 끝난 주문은 주문과 결제가 취소됐다고 안내하고 승인 안내로 덮지 않는다', () => {
      const html = renderToStaticMarkup(
        <Orders orders={[orderItem()]} paymentResult="approved" paymentFocus={{ orderId, outcome: 'refunded' }} />,
      );

      expect(html).toContain('주문과 결제가 취소됐어요');
      expect(html).not.toContain('결제가 확인됐어요');
      expect(html).toContain(`href="/orders/${orderId}"`);
    });

    it('쿼리가 checking이어도 원장이 결제 완료면 승인 안내와 주문 상세 링크를 보인다', () => {
      const html = renderToStaticMarkup(
        <Orders orders={[]} paymentResult="checking" paymentFocus={{ orderId, outcome: 'approved' }} />,
      );

      expect(html).toContain('결제가 확인됐어요');
      expect(html).toContain(`href="/orders/${orderId}"`);
    });
  });

  /* MY-01(10/14 S16): 주문 목록도 마이페이지 셸 안에 선다 — 영수증 어휘는 셸 콘텐츠 안에서 그대로다. */
  it('sits inside the mypage shell with orders as the current menu and the shell heading grammar', () => {
    const html = renderToStaticMarkup(<Orders orders={[orderItem()]} />);
    const aside = html.slice(html.indexOf('aria-label="마이페이지 메뉴"'), html.indexOf('wc-mypage__content'));

    expect(html).toContain('<main class="wc-root wc-mypage">');
    expect(aside).toMatch(/aria-current="page" href="\/orders"|href="\/orders"[^>]*aria-current="page"/);
    expect(html).toContain('class="wc-receipt orders-page"');
    expect(html).toContain('<h1 class="wc-mypage__headbar-title">주문 내역</h1>');
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  /* MY-08: 내 주문 굿즈에 진행 중 리뷰 이벤트가 있을 때만 기존 리뷰 이벤트 배너를 보인다 — 보상은 이벤트가 말한다. */
  it('shows the existing review event banners only when the page passes ongoing events', () => {
    expect(renderToStaticMarkup(<Orders orders={[orderItem()]} />)).not.toContain('wc-review-event-banner');

    const html = renderToStaticMarkup(<Orders orders={[orderItem()]} reviewEvents={[reviewEvent(), reviewEvent({ id: '44444444-4444-4444-8444-444444444444', title: '두 번째 이벤트', creditAmount: 1000 })]} />);
    expect(html.match(/class="wc-review-event-banner"/g)).toHaveLength(2);
    expect(html).toContain('href="/review-events/33333333-3333-4333-8333-333333333333"');
    expect(html).toContain('선정 시 적립금 <b>3,000원</b>');
    expect(html.indexOf('wc-review-event-banner')).toBeLessThan(html.indexOf('id="orders-list-heading"'));
  });

  it('explains the delivery process with what can be done at each step', () => {
    const html = renderToStaticMarkup(<Orders orders={[]} />);
    const flow = html.slice(html.indexOf('orders-flow-heading'));

    expect(flow).toContain('주문 후 배송 과정');
    for (const label of ['결제완료', '발주확인', '배송중', '배송완료', '거래확정']) expect(flow).toContain(`<strong>${label}</strong>`);
    expect(flow).toContain('발주확인 전에는 주문 상세에서 직접 취소할 수 있어요.');
    expect(flow).toContain('배송 중부터 주문 전체로 반품·교환을 신청할 수 있어요.');
    expect(flow).toContain('단순 변심은 공급받은 날부터 7일, 하자·오배송은 공급받은 날부터 3개월 안에 신청해주세요.');
  });
});
