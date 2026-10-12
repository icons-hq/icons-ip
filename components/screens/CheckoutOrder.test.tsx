import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CheckoutOrderSnapshot } from '@/lib/checkout.server';
import type { PreparedCheckout } from '@/lib/payments/gateway';
import {
  CheckoutOrder,
  checkoutStatusCopy,
  effectiveGoodsCheckoutExpiry,
  preparedGoodsCheckoutUsable,
} from './CheckoutOrder';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/app/checkout/reorder-actions', () => ({ restoreCanceledOrderToCartAction: vi.fn() }));

const order: CheckoutOrderSnapshot = {
  id: '7ad4c967-3d48-44da-a665-64731ac33f62',
  status: 'pending',
  total: 15000,
  shippingFee: 3000,
  discountTotal: 0,
  storeCreditTotal: 0,
  address: null,
  expiresAt: '2099-08-07T06:15:00.000Z',
  createdAt: '2026-08-07T06:00:00.000Z',
  paymentStatus: null,
  shipments: [],
  paymentMethod: 'card' as const,
  paymentAttempt: null,
  hasActiveCancellationRequest: false,
  items: [{
    id: 'item-1',
    variantId: '00000000-0000-4000-8000-000000000001', goodId: 'g13',
    name: '홍실 아크릴 블록',
    type: '아크릴',
    qty: 1,
    unitPrice: 12000,
  }],
};

describe('CheckoutOrder 영수증', () => {
  it('서버 원장 금액에서 쿠폰과 적립금을 함께 복원해 굿즈 소계를 표시한다', () => {
    const html = renderToStaticMarkup(<CheckoutOrder order={{ ...order, total: 12500, discountTotal: 1000, storeCreditTotal: 1500 }} />);
    expect(html).toContain('₩12,000');
    expect(html).toContain('−₩1,000');
    expect(html).toContain('−₩1,500');
    expect(html).toContain('₩12,500');
    expect(html).toContain('적립금 사용');
  });
  it('서버가 확정한 배송비를 굿즈 금액과 분리해 보여준다', () => {
    const html = renderToStaticMarkup(
      <CheckoutOrder
        order={order}
      />,
    );

    expect(html).toContain('₩12,000');
    expect(html).toContain('₩3,000');
    expect(html).toContain('₩15,000');
  });

  it('주문과 provider 준비 만료 중 더 이른 시각을 deadline으로 사용한다', () => {
    expect(effectiveGoodsCheckoutExpiry(
      '2099-08-07T06:15:00.000Z',
      '2099-08-07T06:10:00.000Z',
    )).toBe(Date.parse('2099-08-07T06:10:00.000Z'));
    expect(effectiveGoodsCheckoutExpiry(
      '2099-08-07T06:05:00.000Z',
      '2099-08-07T06:10:00.000Z',
    )).toBe(Date.parse('2099-08-07T06:05:00.000Z'));
  });

  it('provider 준비 deadline이 지나면 기존 결제 action을 제거한다', () => {
    const prepared: PreparedCheckout = {
      attemptId: '30000000-0000-4000-8000-000000000205',
      provider: 'korpay',
      action: { kind: 'redirect', url: 'https://payments.example.test/authenticate' },
      callbackNonce: 'opaque-callback-nonce-205',
      expiresAt: '2026-08-13T10:05:00.000Z',
    };

    expect(preparedGoodsCheckoutUsable(
      prepared,
      '2026-08-13T10:10:00.000Z',
      Date.parse('2026-08-13T10:05:00.001Z'),
    )).toBe(false);
  });
});

/*
 * 토스 failUrl은 실패한 주문의 이 화면으로 돌아온다. 안내가 가리키는 "같은
 * 주문"이 지금 보고 있는 주문이라 재시도 경로가 어긋나지 않는다.
 */
describe('CheckoutOrder 결제 실패 복귀 안내', () => {
  it('failUrl 복귀 시 검증된 코드는 우리 문구로 안내한다', () => {
    const html = renderToStaticMarkup(
      <CheckoutOrder order={order} paymentFailCode="PAY_PROCESS_CANCELED" />,
    );

    expect(html).toContain('결제를 직접 취소하셨어요');
  });

  it('미지 코드는 provider 문자열 노출 없이 공통 문구로 덮는다', () => {
    const html = renderToStaticMarkup(
      <CheckoutOrder order={order} paymentFailCode="SOME_UNKNOWN_CODE" />,
    );

    expect(html).toContain('결제가 완료되지 않았어요');
    expect(html).not.toContain('SOME_UNKNOWN_CODE');
  });

  it('실패 코드가 없으면 안내를 세우지 않는다', () => {
    const html = renderToStaticMarkup(<CheckoutOrder order={order} />);

    expect(html).not.toContain('결제가 완료되지 않았어요');
  });

  /* 시도가 닫힌 주문에서 "같은 주문에서 다시 시도"는 지킬 수 없는 약속이다(UX-1). */
  it('같은 주문으로 다시 결제할 수 없으면 재시도를 약속하지 않는다', () => {
    const html = renderToStaticMarkup(
      <CheckoutOrder
        order={{ ...order, paymentAttempt: { state: 'declined', expiresAt: '2099-08-07T06:10:00.000Z', provider: 'toss' } }}
        paymentFailCode="PAY_PROCESS_CANCELED"
      />,
    );

    expect(html).toContain('결제를 직접 취소하셨어요.');
    expect(html).not.toContain('같은 주문에서 다시 시도');
  });
});

describe('CheckoutOrder 닫힌 결제 안내', () => {
  it('승인 거절된 주문에는 결제 준비 버튼 대신 다시 결제할 수 없다는 안내를 띄운다', () => {
    const html = renderToStaticMarkup(
      <CheckoutOrder
        order={{ ...order, paymentAttempt: { state: 'declined', expiresAt: '2099-08-07T06:10:00.000Z', provider: 'toss' } }}
      />,
    );

    expect(html).toContain('이 주문은 다시 결제할 수 없어요');
    expect(html).not.toContain('결제 준비하기');
    expect(html).not.toContain('결제 환경을 준비 중');
  });

  it('처리 중인 취소 요청이 있으면 결제 대신 주문 상세로 안내한다', () => {
    const html = renderToStaticMarkup(
      <CheckoutOrder order={{ ...order, hasActiveCancellationRequest: true }} />,
    );

    expect(html).toContain('취소 요청을 처리하고 있어요');
    expect(html).toContain(`href="/orders/${order.id}"`);
    expect(html).not.toContain('결제 준비하기');
  });

  /* 웹훅·재정합 비밀이 없으면 확인은 자동으로 계속되지 않는다(UX-4). */
  it('확인 중 화면은 자동 확인을 약속하지 않고 주문 상세와 1:1 문의로 잇는다', () => {
    const html = renderToStaticMarkup(
      <CheckoutOrder order={{ ...order, paymentStatus: 'pending' }} />,
    );

    expect(html).toContain('결제를 확인하고 있어요');
    expect(html).not.toContain('확인은 계속됩니다');
    expect(html).toContain(`href="/orders/${order.id}"`);
    expect(html).toContain('href="/my/inquiries"');
  });

  it('취소된 카드 주문은 만료가 아니라 취소로 안내하고 같은 굿즈를 다시 담게 한다', () => {
    const html = renderToStaticMarkup(
      <CheckoutOrder order={{ ...order, status: 'canceled', expiresAt: null }} />,
    );

    expect(html).toContain('취소된 주문이에요');
    expect(html).not.toContain('결제 가능한 시간이 지났어요');
    expect(html).toContain('같은 굿즈 다시 담기');
    expect(html).not.toContain('이 주문 취소하고 다시 주문하기');
  });

  it('승인 거절된 주문은 한 번에 취소하고 다시 주문하게 한다', () => {
    const html = renderToStaticMarkup(
      <CheckoutOrder
        order={{ ...order, paymentAttempt: { state: 'declined', expiresAt: '2099-08-07T06:10:00.000Z', provider: 'toss' } }}
      />,
    );

    expect(html).toContain('이 주문 취소하고 다시 주문하기');
  });

  /* 남은 prepared 시도가 있으면 고객 취소가 청약철회 요청으로 접수된다 — 즉시 정리를
     약속하는 대신 만료 sweep을 기다리라고 안내한다. (시각에 기대는 상태라 정적 렌더
     대신 문구 선택 함수로 본다.) */
  it('결제 기한이 지난 주문은 즉시 취소 가능 여부에 맞춰 다음 일을 안내한다', () => {
    const base = { state: 'closed' as const, closedCopy: null, isBankTransfer: false, orderStatus: 'pending' };
    expect(checkoutStatusCopy({ ...base, reorderMode: null })?.body).toContain('몇 분 안에 자동으로 취소');
    expect(checkoutStatusCopy({ ...base, reorderMode: 'cancel_then_reorder' })?.body).toContain('주문을 취소하면');
  });

  it('무통장 주문에는 카드 주문 정리 액션을 띄우지 않는다', () => {
    const html = renderToStaticMarkup(
      <CheckoutOrder order={{ ...order, paymentMethod: 'bank_transfer', status: 'canceled', expiresAt: null }} />,
    );

    expect(html).not.toContain('같은 굿즈 다시 담기');
    expect(html).not.toContain('이 주문 취소하고 다시 주문하기');
  });
});

describe('CheckoutOrder 무통장 입금 안내', () => {
  const bankOrder: CheckoutOrderSnapshot = {
    ...order,
    paymentMethod: 'bank_transfer',
    address: {
      recipientName: '홍길동',
      phone: '01012345678',
      postalCode: '06236',
      address1: '서울시 강남구',
      address2: '',
      deliveryNote: '',
    },
  };
  const account = {
    bank: '국민은행',
    accountNumber: '123456-01-789012',
    holder: '주식회사 아이콘스',
  };

  it('계좌·금액·입금자명·기한을 한 화면에 모아 보여준다', () => {
    const html = renderToStaticMarkup(
      <CheckoutOrder bankTransferAccount={account} order={bankOrder} />,
    );

    expect(html).toContain('국민은행');
    expect(html).toContain('123456-01-789012');
    expect(html).toContain('주식회사 아이콘스');
    expect(html).toContain('15,000');
    /* 입금자명 코드는 DB private.bank_transfer_deposit_code와 같은 규칙이다. */
    expect(html).toContain('홍길동7AD4C967');
  });

  /*
   * 카드 결제 준비 버튼이 무통장 주문에 뜨면 구매자가 카드 창을 열고, 열리지
   * 않는 결제 action 앞에서 이체를 미룬다.
   */
  it('무통장 주문에는 카드 결제 준비 버튼을 띄우지 않는다', () => {
    const html = renderToStaticMarkup(
      <CheckoutOrder bankTransferAccount={account} order={bankOrder} />,
    );

    expect(html).not.toContain('결제 준비하기');
  });

  /* #255 전 상태다. 계좌 없이 "입금해주세요"만 띄우면 돈이 어디로도 안 간다. */
  it('계좌 설정이 없으면 안내 대신 문의를 요청한다', () => {
    const html = renderToStaticMarkup(
      <CheckoutOrder bankTransferAccount={null} order={bankOrder} />,
    );

    expect(html).toContain('입금 계좌 안내를 불러오지 못했어요');
    expect(html).not.toContain('입금 은행');
  });

  /*
   * 확정 뒤에도 계좌가 남아 있으면 이미 입금한 구매자가 한 번 더 보낸다.
   * (기한 만료 문구는 마운트 뒤 시각이 채워져야 갈리므로 정적 렌더로 볼 수 없다.)
   */
  it('결제가 확정되면 입금 계좌를 더 이상 보여주지 않는다', () => {
    const html = renderToStaticMarkup(
      <CheckoutOrder
        bankTransferAccount={account}
        order={{ ...bankOrder, status: 'paid', paymentStatus: 'paid' }}
      />,
    );

    expect(html).toContain('결제가 확인됐어요');
    expect(html).not.toContain('123456-01-789012');
  });
});
