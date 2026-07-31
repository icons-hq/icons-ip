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

describe('ticket checkout success page', () => {
  it('routes a ticket payment result back to its booking', async () => {
    const element = await Page({
      searchParams: Promise.resolve({
        amount: '25000',
        orderId: `ticket_${referenceId}`,
        paymentKey: 'payment-key',
        paymentType: 'NORMAL',
        ref: referenceId,
      }),
    });
    renderToStaticMarkup(element);

    expect(mocks.confirmation.mock.calls[0]?.[0]).toMatchObject({
      amount: 25000,
      destinationPath: `/tickets/${referenceId}`,
      fallbackHref: '/events',
      fallbackLabel: '이벤트 목록으로',
      orderId: `ticket_${referenceId}`,
      paymentKey: 'payment-key',
      paymentType: 'NORMAL',
      subject: '예매',
    });
  });

  it('does not infer a ticket destination from an order provider reference', async () => {
    const element = await Page({
      searchParams: Promise.resolve({ orderId: `order_${referenceId}` }),
    });
    renderToStaticMarkup(element);

    expect(mocks.confirmation.mock.calls.at(-1)?.[0]).toMatchObject({
      destinationPath: null,
      subject: '예매',
    });
  });
});
