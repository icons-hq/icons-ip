import { describe, expect, it, vi } from 'vitest';
import Page from './page';

const mocks = vi.hoisted(() => ({ redirect: vi.fn((path: string) => path) }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

const referenceId = '7ad4c967-3d48-44da-a665-64731ac33f62';

describe('ticket checkout success page', () => {
  it('strips provider query data by redirecting the result to its booking state', async () => {
    await Page({
      searchParams: Promise.resolve({
        amount: '25000',
        orderId: `ticket_${referenceId}`,
        paymentKey: 'payment-key',
        paymentType: 'NORMAL',
        ref: referenceId,
      }),
    });

    expect(mocks.redirect).toHaveBeenLastCalledWith(`/ticket-checkout/${referenceId}`);
  });

  it('does not infer a ticket destination from an order provider reference', async () => {
    await Page({
      searchParams: Promise.resolve({ orderId: `order_${referenceId}` }),
    });

    expect(mocks.redirect).toHaveBeenLastCalledWith('/offline-popups');
  });
});
