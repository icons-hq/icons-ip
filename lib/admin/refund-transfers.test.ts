import { describe, expect, it } from 'vitest';
import { parseRefundTransferPage, refundTransferPageNumber, refundTransfersHref } from './refund-transfers';

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
