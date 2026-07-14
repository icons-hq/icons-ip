import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TicketQrPager } from './TicketQrPager';

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => <span data-alt={String(props.alt ?? '')} data-src={String(props.src ?? '')} />,
}));
vi.mock('@/lib/ticketing', async () => await import('../../lib/ticketing'));

const firstId = '19b0d848-7192-4b40-a675-f508822f99c9';
const secondId = '2ab1e959-8203-4c51-b786-0619933a00da';

describe('TicketQrPager', () => {
  it('renders one owner-checked QR image at a time without a token in DOM or URL', () => {
    const html = renderToStaticMarkup(
      <TicketQrPager
        cancellationStatus={null}
        orderStatus="paid"
        tickets={[{ id: firstId, status: 'valid' }, { id: secondId, status: 'valid' }]}
      />,
    );

    expect(html).toContain(`/api/tickets/${firstId}/qr`);
    expect(html).not.toContain(`/api/tickets/${secondId}/qr`);
    expect(html).toContain('1 / 2');
    expect(html).toContain('다음 티켓');
    expect(html).not.toMatch(/qr_token|payment_key|private-qr-token/i);
  });

  it.each([
    ['pending', 'valid', null],
    ['paid', 'used', null],
    ['paid', 'refunded', null],
    ['paid', 'valid', 'requested'],
    ['paid', 'valid', 'processing'],
    ['paid', 'valid', 'needs_review'],
  ] as const)('does not request an image for order=%s ticket=%s cancellation=%s', (orderStatus, status, cancellationStatus) => {
    const html = renderToStaticMarkup(
      <TicketQrPager
        cancellationStatus={cancellationStatus}
        orderStatus={orderStatus}
        tickets={[{ id: firstId, status }]}
      />,
    );

    expect(html).not.toContain('/api/tickets/');
    expect(html).toContain('QR');
  });
});
