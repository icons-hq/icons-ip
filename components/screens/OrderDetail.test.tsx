import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { OrderDetail as OrderDetailData } from '@/lib/orders';
import { OrderDetail } from './OrderDetail';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));

const ORDER_ID = '11111111-1111-4111-8111-111111111111';

function order(overrides: Partial<OrderDetailData> = {}): OrderDetailData {
  return {
    id: ORDER_ID,
    status: 'shipping',
    total: 30000,
    shippingFee: 3000,
    paymentMethod: 'card',
    expiresAt: null,
    address: {
      recipientName: '김팬',
      phone: '01012345678',
      postalCode: '04799',
      address1: '서울 성동구 성수이로 1',
      address2: '101호',
      deliveryNote: '',
    },
    createdAt: '2026-08-01T06:00:00.000Z',
    deliveredAt: null,
    items: [{ goodId: 'g13', name: '홍실 아크릴 블록', type: '아크릴 블록', qty: 1, unitPrice: 27000 }],
    payment: { amount: 30000, status: 'paid', createdAt: '2026-08-01T06:01:00.000Z' },
    refund: null,
    cancellationRequest: null,
    shipment: {
      carrier: 'hanjin',
      carrierLabel: '한진택배',
      trackingNumber: '123456789012',
      trackingUrl: 'https://carrier.example.test/track?no=123456789012',
    },
    cardPacks: { issuedCount: 0, availableCount: 0 },
    ...overrides,
  };
}

describe('OrderDetail', () => {
  it('운송장이 등록되면 택배사·운송장번호와 배송조회 링크를 노출한다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order()} />);

    expect(html).toContain('한진택배');
    expect(html).toContain('운송장번호');
    expect(html).toContain('123456789012');
    expect(html).toContain('href="https://carrier.example.test/track?no=123456789012"');
    expect(html).toContain('rel="noreferrer"');
  });

  it('운송장이 없으면 배송조회를 지어내지 않는다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order({ shipment: null })} />);

    expect(html).not.toContain('배송조회');
    expect(html).not.toContain('운송장번호');
  });

  it('굿즈 금액과 배송비를 분리해 스냅샷 그대로 보여준다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order()} />);

    expect(html).toContain('₩27,000');
    expect(html).toContain('₩3,000');
    expect(html).toContain('₩30,000');
  });

  /* 배송비 스냅샷은 주문 시점 값이다 — 정책이 바뀌어도 과거 영수증은 변하지 않는다. */
  it('배송비 스냅샷이 0인 과거 주문은 무료로 남는다', () => {
    const html = renderToStaticMarkup(
      <OrderDetail order={order({ shippingFee: 0, total: 27000, payment: null })} />,
    );

    expect(html).toContain('무료');
    expect(html).not.toContain('₩3,000');
  });

  /* 사다리 표기(#250). 상태 배지 하나로는 지금이 어느 칸인지 알 수 없다. */
  it('진행 단계를 사다리 순서대로 보여주고 현재 칸을 표시한다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order({ status: 'confirmed' })} />);

    expect(html).toContain('aria-label="주문 진행 단계"');
    expect(html).toContain('order-status--confirmed');
    expect(html).toContain('aria-current="step"');
    // 지나온 칸 · 현재 칸 · 남은 칸이 구분돼야 한다.
    expect(html).toContain('data-state="done"');
    expect(html).toContain('data-state="current"');
    expect(html).toContain('data-state="upcoming"');
  });

  /* pending은 결제가 끝나지 않은 선점, canceled는 사다리를 벗어난 종결이다.
     지나갈 일이 없는 단계를 남은 단계로 그리면 잘못된 약속이 된다. */
  it.each(['pending', 'canceled'] as const)('%s 주문에는 진행 사다리를 그리지 않는다', (status) => {
    const html = renderToStaticMarkup(<OrderDetail order={order({ status })} />);

    expect(html).not.toContain('aria-label="주문 진행 단계"');
  });

  /* 기산점은 delivered_at이다 — 주문일도 발송일도 아니다(#189). 공급 전에 남은
     일수를 지어내면 아직 시작하지 않은 창을 카운트다운하게 된다. */
  it('배송완료 전에는 청약철회 기한이 아직 시작하지 않았다고 말한다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order({ status: 'shipping' })} />);

    expect(html).toContain('배송이 완료된 날부터 시작됩니다');
    expect(html).not.toContain('일 남음');
  });

  it('배송완료 주문에는 공급받은 날 기준 변심 7일 기한과 남은 일수를 보여준다', () => {
    const html = renderToStaticMarkup(
      <OrderDetail
        now={new Date('2026-08-06T06:00:00.000Z')}
        order={order({ status: 'delivered', deliveredAt: '2026-08-03T06:00:00.000Z' })}
      />,
    );

    expect(html).toContain('dateTime="2026-08-03T06:00:00.000Z"');
    expect(html).toContain('dateTime="2026-08-10T06:00:00.000Z"');
    expect(html).toContain('약 4일 남음');
  });

  it('변심 기한이 지나면 남은 일수 대신 하자 3개월 경로를 안내한다', () => {
    const html = renderToStaticMarkup(
      <OrderDetail
        now={new Date('2026-08-20T06:00:00.000Z')}
        order={order({ status: 'done', deliveredAt: '2026-08-03T06:00:00.000Z' })}
      />,
    );

    expect(html).toContain('단순 변심 청약철회 기한이 지났습니다');
    expect(html).toContain('공급받은 날부터 3개월');
    expect(html).not.toContain('일 남음');
  });
});

describe('OrderDetail 무통장 입금 대기', () => {
  /*
   * 지금까지 입금 안내로 돌아가는 길은 알림 링크와 결제 화면뿐이었다. 구매자가
   * "얼마를 어디로 보내야 하지"를 다시 찾는 자리는 주문 내역이다.
   */
  it('아직 입금이 안 된 무통장 주문에 안내로 가는 길을 연다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order({ status: 'pending', paymentMethod: 'bank_transfer', total: 23000 })} />);

    expect(html).toContain('입금을 기다리고 있어요');
    expect(html).toContain('23,000');
    expect(html).toContain(`href="/checkout/${ORDER_ID}"`);
  });

  /* 계좌 값은 서버 설정에서만 읽는다(#255). 주문 내역이 두 번째 출처가 되면 안 된다. */
  it('계좌 정보를 주문 내역에 복제하지 않는다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order({ status: 'pending', paymentMethod: 'bank_transfer' })} />);

    expect(html).not.toContain('예금주');
    expect(html).not.toContain('계좌번호');
  });

  it('확정된 무통장 주문에는 입금 안내를 남기지 않는다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order({ status: 'paid', paymentMethod: 'bank_transfer' })} />);

    expect(html).not.toContain('입금을 기다리고 있어요');
  });

  it('카드 주문은 그대로다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order({ status: 'pending' })} />);

    expect(html).not.toContain('입금을 기다리고 있어요');
  });
});
