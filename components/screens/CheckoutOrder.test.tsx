import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CheckoutOrderSnapshot } from '@/lib/checkout.server';
import type { PreparedCheckout } from '@/lib/payments/gateway';
import {
  CheckoutOrder,
  effectiveGoodsCheckoutExpiry,
  preparedGoodsCheckoutUsable,
} from './CheckoutOrder';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const order: CheckoutOrderSnapshot = {
  id: '7ad4c967-3d48-44da-a665-64731ac33f62',
  status: 'pending',
  total: 15000,
  shippingFee: 3000,
  discountTotal: 0,
  address: null,
  expiresAt: '2099-08-07T06:15:00.000Z',
  createdAt: '2026-08-07T06:00:00.000Z',
  paymentStatus: null,
  paymentMethod: 'card' as const,
  items: [{
    goodId: 'g13',
    name: '홍실 아크릴 블록',
    type: '아크릴',
    qty: 1,
    unitPrice: 12000,
  }],
};

describe('CheckoutOrder 영수증', () => {
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
