import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { RefundTransfersScreen } from './RefundTransfersScreen';
it('separates gift payer from requester and links to existing claim detail', () => {
  const html = renderToStaticMarkup(<RefundTransfersScreen data={{ page: 1, pageSize: 50, total: 51, rows: [{
    claimId: 'a1010000-0000-4000-8000-000000000001', orderId: 'a1010000-0000-4000-8000-000000000002', reference: 45, claimType: 'return', amount: 12000,
    confirmedAt: '2026-10-14T06:00:00Z', filedAt: null, updatedAt: '2026-10-14T06:00:00Z', revision: 1, gift: true, payerName: '결제자별명', requesterName: '수령자별명',
  }] }} />);
  for (const label of ['결제자별명', '수령자별명', '선물 · 반품', '송금 대기 금액', '12,000', '미접수']) expect(html).toContain(label);
  expect(html).toContain('/admin/sales/claims/returns/a1010000-0000-4000-8000-000000000001');
  expect(html).toContain('/admin/sales/claims/refund-transfers?page=2');
  expect(html).not.toContain('계좌번호');
  expect(html).not.toContain('송금 완료 확정');
});
