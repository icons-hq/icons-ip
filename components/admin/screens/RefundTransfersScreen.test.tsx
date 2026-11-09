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
it('보낼 돈 합계와 오래 기다린 요청·이름 없는 결제자를 주의로 보이고 송금 처리는 요청 상세로 잇는다', () => {
  const row = { claimId: 'a1010000-0000-4000-8000-000000000001', orderId: 'a1010000-0000-4000-8000-000000000002', reference: 45, claimType: 'cancel' as const, amount: 12000,
    confirmedAt: '2026-10-10T06:00:00Z', filedAt: '2026-10-10T06:00:00Z', updatedAt: '2026-10-10T06:00:00Z', revision: 1, gift: false, payerName: null, requesterName: '요청자' };
  const html = renderToStaticMarkup(<RefundTransfersScreen now={new Date('2026-10-14T06:00:00Z')} data={{ page: 1, pageSize: 50, total: 2, rows: [row, { ...row, claimId: 'a1010000-0000-4000-8000-000000000003', orderId: 'a1010000-0000-4000-8000-000000000004', amount: 3000, confirmedAt: '2026-10-14T01:00:00Z', payerName: '결제자' }] }} />);
  expect(html).toContain('보낼 돈 합계');
  expect(html).toContain('₩15,000');
  expect(html).toContain('3일 이상 기다린 요청 1건');
  expect(html).toMatch(/data-tone="warning"[^>]*>4일째</);
  expect(html).toMatch(/data-tone="warning"[^>]*>이름 미등록</);
  expect(html).toContain('href="/admin/sales/claims/cancels/a1010000-0000-4000-8000-000000000001#claim-process"');
  expect(html).toContain('>송금 처리<');
  /* 다른 페이지가 남아 있으면 전체 합계로 부르지 않는다. */
  const partial = renderToStaticMarkup(<RefundTransfersScreen now={new Date('2026-10-14T06:00:00Z')} data={{ page: 1, pageSize: 50, total: 51, rows: [row] }} />);
  expect(partial).toContain('이 페이지 보낼 돈 합계');
  expect(partial).toContain('전체 51건 중 이 페이지 1건');
});
