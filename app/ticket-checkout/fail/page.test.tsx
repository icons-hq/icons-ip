import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import Page from './page';

vi.mock('@/lib/payments/toss', async () => await import('../../../lib/payments/toss'));
vi.mock('@/lib/ticketing', async () => await import('../../../lib/ticketing'));

const referenceId = '7ad4c967-3d48-44da-a665-64731ac33f62';

describe('ticket checkout fail page', () => {
  it('returns a failed ticket payment to the same booking', async () => {
    const html = renderToStaticMarkup(await Page({
      searchParams: Promise.resolve({
        code: 'PAY_PROCESS_CANCELED',
        orderId: `ticket_${referenceId}`,
      }),
    }));

    expect(html).toContain(`href="/ticket-checkout/${referenceId}"`);
    expect(html).toContain('같은 예매에서 다른 결제수단으로 다시 시도할 수 있습니다.');
  });

  it('does not treat an order provider reference as a ticket booking', async () => {
    const html = renderToStaticMarkup(await Page({
      searchParams: Promise.resolve({ orderId: `order_${referenceId}` }),
    }));

    expect(html).toContain('href="/events"');
    expect(html).not.toContain(`/ticket-checkout/${referenceId}`);
  });
});
