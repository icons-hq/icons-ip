import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import Page from './page';

const mocks = vi.hoisted(() => ({
  confirmation: vi.fn<(props: Record<string, unknown>) => null>(() => null),
}));

vi.mock('@/components/payments/PaymentConfirmation', () => ({
  PaymentConfirmation: mocks.confirmation,
}));

const referenceId = '7ad4c967-3d48-44da-a665-64731ac33f62';

describe('checkout success page', () => {
  it('keeps the order destination and fallback contract', async () => {
    const element = await Page({
      searchParams: Promise.resolve({
        amount: '25000',
        orderId: `order_${referenceId}`,
        paymentKey: 'payment-key',
        paymentType: 'NORMAL',
        ref: referenceId,
      }),
    });
    renderToStaticMarkup(element);

    expect(mocks.confirmation.mock.calls[0]?.[0]).toMatchObject({
      amount: 25000,
      destinationPath: `/checkout/${referenceId}`,
      fallbackHref: '/checkout',
      fallbackLabel: '진행 중인 주문 찾기',
      orderId: `order_${referenceId}`,
      paymentKey: 'payment-key',
      paymentType: 'NORMAL',
      subject: '주문',
    });
  });
});
