import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Page from './page';

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
    expect(html).toContain('예매 상태와 정원 복원 여부를 확인해주세요.');
  });

  it('does not treat an order provider reference as a ticket booking', async () => {
    const html = renderToStaticMarkup(await Page({
      searchParams: Promise.resolve({ orderId: `order_${referenceId}` }),
    }));

    expect(html).toContain('href="/offline-popups"');
    expect(html).not.toContain(`/ticket-checkout/${referenceId}`);
  });

  it('warns an ambiguous provider failure against duplicate payment', async () => {
    const html = renderToStaticMarkup(await Page({
      searchParams: Promise.resolve({
        code: 'PAY_PROCESS_ABORTED',
        ref: referenceId,
      }),
    }));

    expect(html).toContain('예매 상태가 확정될 때까지 중복 결제를 피해주세요.');
    expect(html).toContain('예매 상태 확인');
  });
});
