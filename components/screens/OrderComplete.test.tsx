import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CheckoutOrderSnapshot } from '@/lib/checkout.server';
import { bankTransferDepositName } from '@/lib/payments/bank-transfer';
import { OrderComplete, orderCompleteDestination } from './OrderComplete';

vi.mock('@/components/shell/ListingReturn', () => ({
  ListingReturnLink: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <a className={className} data-listing-return="">{children}</a>
  ),
}));

const order: CheckoutOrderSnapshot = {
  id: '7ad4c967-3d48-44da-a665-64731ac33f62',
  orderNumber: '2026102710000001',
  status: 'paid',
  total: 15000,
  shippingFee: 3000,
  discountTotal: 0,
  storeCreditTotal: 0,
  address: { recipientName: '아이콘즈', phone: '01012345678', postalCode: '12345', address1: '서울시' },
  expiresAt: null,
  createdAt: '2026-10-27T05:00:00.000Z',
  paymentStatus: 'paid',
  paidAt: '2026-10-27T05:03:00.000Z',
  shipments: [],
  paymentMethod: 'card',
  paymentAttempt: null,
  hasActiveCancellationRequest: false,
  items: [{ id: 'item-1', variantId: '00000000-0000-4000-8000-000000000001', variantName: '블루', goodId: 'g13', name: '홍실 아크릴 블록', type: '아크릴', qty: 2, unitPrice: 6000 }],
};

describe('orderCompleteDestination', () => {
  it('결제 완료 카드 주문과 무통장 입금 대기 주문만 완료 화면을 그린다', () => {
    expect(orderCompleteDestination(order)).toEqual({ kind: 'paid' });
    expect(orderCompleteDestination({ ...order, status: 'confirmed' })).toEqual({ kind: 'paid' });
    const now = Date.parse('2026-10-27T06:00:00.000Z');
    expect(orderCompleteDestination({ ...order, status: 'pending', paymentMethod: 'bank_transfer', paymentStatus: null, expiresAt: '2026-10-28T05:00:00.000Z' }, now))
      .toEqual({ kind: 'deposit', deadlinePassed: false });
    expect(orderCompleteDestination({ ...order, status: 'pending', paymentMethod: 'bank_transfer', paymentStatus: null, expiresAt: '2026-10-27T05:00:00.000Z' }, now))
      .toEqual({ kind: 'deposit', deadlinePassed: true });
  });

  it('결제 전 카드 주문·결제 취소 진행·취소 주문은 주문 상세로, 선물은 선물함으로 보낸다', () => {
    const detail = { kind: 'redirect', href: `/orders/${order.id}` };
    expect(orderCompleteDestination({ ...order, status: 'pending', paymentStatus: null })).toEqual(detail);
    expect(orderCompleteDestination({ ...order, status: 'pending', paymentStatus: 'paid' })).toEqual(detail);
    expect(orderCompleteDestination({ ...order, status: 'canceled' })).toEqual(detail);
    expect(orderCompleteDestination({ ...order, giftId: 'gift-1' })).toEqual({ kind: 'redirect', href: '/gifts/gift-1' });
  });
});

describe('OrderComplete', () => {
  it('주문번호·품목·최종 결제 금액·결제 일시와 주문 상세·쇼핑 계속을 보인다(D12)', () => {
    const html = renderToStaticMarkup(<OrderComplete order={order} bankTransferAccount={null} />);
    expect(html).toContain('주문이 완료됐어요');
    expect(html).toContain('2026102710000001');
    expect(html).not.toContain(order.id + '<');
    expect(html).toContain('홍실 아크릴 블록');
    expect(html).toContain('2개');
    expect(html).toContain('최종 결제 금액</dt><dd>₩15,000');
    expect(html).toContain('결제 일시');
    expect(html).toContain(`href="/orders/${order.id}"`);
    expect(html).toContain('주문 상세');
    expect(html).toContain('data-listing-return=""');
    expect(html).toContain('쇼핑 계속');
  });

  it('무통장 접수 뒤에는 같은 화면에 계좌·기한·입금자명을 안내한다', () => {
    const html = renderToStaticMarkup(
      <OrderComplete
        order={{ ...order, status: 'pending', paymentMethod: 'bank_transfer', paymentStatus: null, paidAt: null, expiresAt: '2026-10-28T05:00:00.000Z' }}
        bankTransferAccount={{ bank: '국민은행', accountNumber: '123456-01-789012', holder: '아이콘즈' }}
      />,
    );
    expect(html).toContain('주문이 접수됐어요');
    expect(html).toContain('입금 기한');
    expect(html).toContain('국민은행');
    expect(html).toContain('123456-01-789012');
    expect(html).toContain('입금자명');
    expect(html).toContain(bankTransferDepositName('아이콘즈', '2026102710000001'));
    expect(html).toContain('입금할 금액</dt><dd>₩15,000');
  });

  it('기한이 지났지만 아직 정리 전인 무통장 주문에는 계좌 대신 기한 만료를 안내한다', () => {
    const html = renderToStaticMarkup(
      <OrderComplete
        order={{ ...order, status: 'pending', paymentMethod: 'bank_transfer', paymentStatus: null, paidAt: null, expiresAt: '2026-10-27T05:00:00.000Z' }}
        bankTransferAccount={{ bank: '국민은행', accountNumber: '123456-01-789012', holder: '아이콘즈' }}
        depositDeadlinePassed
      />,
    );
    expect(html).toContain('입금 기한이 지났어요');
    expect(html).not.toContain('123456-01-789012');
    expect(html).not.toContain('주문이 접수됐어요');
  });
});
