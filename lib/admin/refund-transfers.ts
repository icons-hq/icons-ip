import { isUuid } from '../uuid';
import { isCommerceNumber } from '../commerce-number';
import { transactionExactKeys, transactionInstant, transactionInteger, transactionRecord } from '../goods-transaction-values';

export const REFUND_TRANSFERS_PATH = '/admin/sales/claims/refund-transfers';
export const REFUND_TRANSFERS_PAGE_SIZE = 50;
export interface RefundTransferRow {
  orderNumber?: string;
  claimId: string;
  orderId: string;
  reference: number;
  claimType: 'cancel' | 'return';
  amount: number;
  confirmedAt: string;
  filedAt: string | null;
  updatedAt: string;
  revision: number;
  gift: boolean;
  payerName: string | null;
  requesterName: string | null;
}
export interface RefundTransferPage { rows: RefundTransferRow[]; total: number; page: number; pageSize: number }
export function refundTransferPageNumber(value: unknown): number {
  return typeof value === 'string' && /^[1-9][0-9]{0,5}$/.test(value) ? Number(value) : 1;
}
export function refundTransfersHref(page = 1): string {
  return `${REFUND_TRANSFERS_PATH}${page > 1 ? `?page=${page}` : ''}`;
}
const nullableInstant = (value: unknown) => value === null || transactionInstant(value);
const name = (value: unknown) => value === null || typeof value === 'string' && value.length <= 200;

/** The queue never carries account numbers, account holders or completion evidence. */
export function parseRefundTransferPage(value: unknown, page: number): RefundTransferPage | null {
  if (!transactionInteger(page, 1, 999999) || !transactionRecord(value)
    || !transactionExactKeys(value, ['rows', 'total', 'limit', 'offset'])
    || !Array.isArray(value.rows) || value.rows.length > REFUND_TRANSFERS_PAGE_SIZE
    || !transactionInteger(value.total) || value.total < value.rows.length
    || value.limit !== REFUND_TRANSFERS_PAGE_SIZE || value.offset !== (page - 1) * REFUND_TRANSFERS_PAGE_SIZE) return null;
  const rows: RefundTransferRow[] = [];
  for (const row of value.rows) {
    if (!transactionRecord(row) || !transactionExactKeys(row, ['claimId', 'orderId', 'reference', 'claimType', 'amount', 'confirmedAt', 'filedAt', 'updatedAt', 'revision', 'gift', 'payerName', 'requesterName', ...(Object.hasOwn(row, 'orderNumber') ? ['orderNumber'] : [])])
      || (row.orderNumber !== undefined && !isCommerceNumber(row.orderNumber, 'order'))
      || !isUuid(row.claimId) || !isUuid(row.orderId) || !transactionInteger(row.reference, 1)
      || !['cancel', 'return'].includes(String(row.claimType)) || !transactionInteger(row.amount, 1)
      || !transactionInstant(row.confirmedAt) || !nullableInstant(row.filedAt) || !transactionInstant(row.updatedAt)
      || !transactionInteger(row.revision, 1) || typeof row.gift !== 'boolean' || !name(row.payerName) || !name(row.requesterName)) return null;
    rows.push({ claimId: row.claimId, orderId: row.orderId, ...(row.orderNumber ? { orderNumber: row.orderNumber as string } : {}), reference: row.reference, claimType: row.claimType as 'cancel' | 'return',
      amount: row.amount, confirmedAt: row.confirmedAt, filedAt: row.filedAt as string | null,
      updatedAt: row.updatedAt, revision: row.revision, gift: row.gift, payerName: row.payerName as string | null, requesterName: row.requesterName as string | null });
  }
  if (new Set(rows.map(row => row.claimId)).size !== rows.length || new Set(rows.map(row => row.orderId)).size !== rows.length) return null;
  return { rows, total: value.total, page, pageSize: REFUND_TRANSFERS_PAGE_SIZE };
}
