import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ClaimFeesScreen } from './ClaimFeesScreen';
import { claimFeeQueueFilters, parseClaimFeeQueue } from '@/lib/admin/claim-fees';
const queue = { state: 'refund_due' as const, page: 1, pageSize: 50, total: 51, counts: { refund_due: 51 }, rows: [{ id: 'a1010000-0000-4000-8000-000000000001', claimId: 'a1010000-0000-4000-8000-000000000002', orderId: 'a1010000-0000-4000-8000-000000000003', claimType: 'exchange' as const, amount: 3000, state: 'refund_due' as const, payerRole: 'requester' as const, issuedAt: '2026-10-16T06:00:00Z', receivedAt: '2026-10-16T06:01:00Z', refundedAt: null }] };
it('shows fee refund duties, correct claim detail and filtered pagination without payment account data', () => {
 expect(parseClaimFeeQueue(queue)).toEqual(queue);
 const html = renderToStaticMarkup(<ClaimFeesScreen data={queue} />);
 for (const text of ['배송비 반환 대기', '반품·교환 요청자', '3,000', '/admin/sales/claims/exchanges/a1010000-0000-4000-8000-000000000002', 'state=refund_due&amp;page=2']) expect(html).toContain(text);
 expect(html).not.toContain('accountNumber'); expect(html).not.toContain('실제 반환 완료 저장');
 expect(parseClaimFeeQueue({ ...queue, rows: [{ ...queue.rows[0], bankAccount: {} }] })).toBeNull();
});
it('normalizes unsupported filters and page numbers', () => {
 expect(claimFeeQueueFilters({ state: 'wire_sent', page: '0' })).toEqual({ state: 'open', page: 1 });
 expect(claimFeeQueueFilters({ state: 'paid', page: '2' })).toEqual({ state: 'paid', page: 2 });
});
