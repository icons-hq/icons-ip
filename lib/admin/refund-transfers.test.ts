import { describe, expect, it } from 'vitest';
import { parseRefundTransferPage, refundTransferDetailHref, refundTransferPageNumber, refundTransferRowKey, refundTransfersHref } from './refund-transfers';

const row = { claimId: 'a1010000-0000-4000-8000-000000000001', orderId: 'a1010000-0000-4000-8000-000000000002',
  reference: 1, claimType: 'return', amount: 12000, confirmedAt: '2026-10-14T06:00:00+00:00', filedAt: null,
  updatedAt: '2026-10-14T06:00:00.123456Z', revision: 3, gift: true, payerName: '결제자', requesterName: '받는 사람' };
const data = () => ({ rows: [{ ...row }], total: 101, limit: 50, offset: 0 });
describe('refund transfer queue boundary', () => {
  it('keeps gift payer and actual requester separate without carrying account details', () => {
    expect(parseRefundTransferPage(data(), 1)?.rows[0]).toEqual(row);
    expect(parseRefundTransferPage({ ...data(), rows: [{ ...row, payerName: null, requesterName: null }] }, 1)?.rows[0].payerName).toBeNull();
  });
  it.each(['accountNumber', 'accountHolder', 'bankName', 'maskedAccount', 'evidence'])('rejects unexpected private %s payloads', key => {
    expect(parseRefundTransferPage({ ...data(), rows: [{ ...row, [key]: 'private' }] }, 1)).toBeNull();
  });
  it.each([{ amount: -1 }, { amount: Number.MAX_SAFE_INTEGER + 1 }, { amount: '12000' }, { revision: 0 },
    { claimType: 'exchange' }, { claimId: '../private' }, { updatedAt: '2026-02-30T00:00:00Z' }, { confirmedAt: null }, { gift: 'true' }])('rejects malformed finance rows %j', patch => {
    expect(parseRefundTransferPage({ ...data(), rows: [{ ...row, ...patch }] }, 1)).toBeNull();
  });
  it('rejects mismatched page receipts and duplicate financial rows', () => {
    expect(parseRefundTransferPage(data(), 2)).toBeNull();
    expect(parseRefundTransferPage({ ...data(), total: 0 }, 1)).toBeNull();
    expect(parseRefundTransferPage({ ...data(), rows: [row, row] }, 1)).toBeNull();
    expect(parseRefundTransferPage({ ...data(), rows: [], offset: 100 }, 3)?.page).toBe(3);
  });
  it('bounds page input and preserves explicit queue routing', () => {
    for (const value of ['0', '-1', '1.2', '1000000', ['2'], undefined]) expect(refundTransferPageNumber(value)).toBe(1);
    expect(refundTransferPageNumber('3')).toBe(3);
    expect(refundTransfersHref(3)).toBe('/admin/sales/claims/refund-transfers?page=3');
  });
});

describe('무통장 재고 부족 부분 취소 송금 대기(ADR-0032)', () => {
  const partial = { kind: 'partial_cancellation', partialCancellationId: 'a1010000-0000-4000-8000-000000000003', orderId: row.orderId,
    orderNumber: null, sequence: 2, amount: 9500, confirmedAt: '2026-10-14T07:00:00Z', filedAt: '2026-10-14T07:00:00Z', updatedAt: '2026-10-14T07:00:00Z',
    gift: false, payerName: '결제자' };
  it('요청 송금 대기와 같은 목록에 섞이고, 한 주문의 요청·부분 취소가 함께 기다릴 수 있다', () => {
    const page = parseRefundTransferPage({ ...data(), rows: [{ ...row }, partial, { ...partial, partialCancellationId: 'a1010000-0000-4000-8000-000000000004', sequence: 3 }] }, 1);
    expect(page?.rows.map(refundTransferRowKey)).toEqual([row.claimId, `partial:${partial.partialCancellationId}`, 'partial:a1010000-0000-4000-8000-000000000004']);
    expect(page?.rows[1]).toEqual({ kind: 'partial_cancellation', partialCancellationId: partial.partialCancellationId, orderId: row.orderId, sequence: 2, amount: 9500,
      confirmedAt: partial.confirmedAt, filedAt: partial.filedAt, updatedAt: partial.updatedAt, gift: false, payerName: '결제자' });
    expect(refundTransferDetailHref(page!.rows[1])).toBe(`/admin/sales/orders/${row.orderId}#partial-cancellation`);
    expect(refundTransferDetailHref(page!.rows[0])).toBe(`/admin/sales/claims/returns/${row.claimId}#claim-process`);
  });
  it.each([{ accountNumber: '1' }, { amount: 0 }, { sequence: 0 }, { kind: 'claim' }, { partialCancellationId: 'x' }])('형식 밖 부분 취소 행은 받지 않는다 %j', patch => {
    expect(parseRefundTransferPage({ ...data(), rows: [{ ...partial, ...patch }] }, 1)).toBeNull();
  });
  it('같은 부분 취소가 두 번 오면 받지 않는다', () => {
    expect(parseRefundTransferPage({ ...data(), rows: [partial, partial] }, 1)).toBeNull();
  });
});
