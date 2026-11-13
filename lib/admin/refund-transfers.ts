import { isUuid } from '../uuid';
import { isCommerceNumber } from '../commerce-number';
import { transactionExactKeys, transactionInstant, transactionInteger, transactionRecord } from '../goods-transaction-values';

export const REFUND_TRANSFERS_PATH = '/admin/sales/claims/refund-transfers';
export const REFUND_TRANSFERS_PAGE_SIZE = 50;
/** 취소·반품 요청의 무통장 환불 송금 대기(T03). */
export interface RefundTransferClaimRow {
  kind?: undefined;
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
/** 무통장 주문의 재고 부족 부분 취소 송금 대기(ADR-0032). 요청이 아니라 주문 상세의 부분 취소 기록에서 송금 완료를 적는다. */
export interface RefundTransferPartialCancellationRow {
  kind: 'partial_cancellation';
  partialCancellationId: string;
  orderId: string;
  orderNumber?: string;
  sequence: number;
  amount: number;
  /** 부분 취소 적용 시각(재고·배송 건 반영). */
  confirmedAt: string;
  filedAt: string | null;
  updatedAt: string;
  gift: boolean;
  payerName: string | null;
}
export type RefundTransferRow = RefundTransferClaimRow | RefundTransferPartialCancellationRow;
/** 목록·엑셀에서 한 줄을 가르는 키(요청 id 또는 부분 취소 id). */
export function refundTransferRowKey(row: RefundTransferRow): string {
  return row.kind === 'partial_cancellation' ? `partial:${row.partialCancellationId}` : row.claimId;
}
/** 송금 처리 화면: 요청은 요청 상세의 무통장 환불 칸, 부분 취소는 주문 상세의 부분 취소 기록. */
export function refundTransferDetailHref(row: RefundTransferRow): string {
  return row.kind === 'partial_cancellation' ? `/admin/sales/orders/${row.orderId}#partial-cancellation`
    : `/admin/sales/claims/${row.claimType === 'cancel' ? 'cancels' : 'returns'}/${row.claimId}#claim-process`;
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
    if (transactionRecord(row) && row.kind === 'partial_cancellation') {
      if (!transactionExactKeys(row, ['kind', 'partialCancellationId', 'orderId', 'orderNumber', 'sequence', 'amount', 'confirmedAt', 'filedAt', 'updatedAt', 'gift', 'payerName'])
        || (row.orderNumber !== null && !isCommerceNumber(row.orderNumber, 'order'))
        || !isUuid(row.partialCancellationId) || !isUuid(row.orderId) || !transactionInteger(row.sequence, 1) || !transactionInteger(row.amount, 1)
        || !transactionInstant(row.confirmedAt) || !nullableInstant(row.filedAt) || !transactionInstant(row.updatedAt)
        || typeof row.gift !== 'boolean' || !name(row.payerName)) return null;
      rows.push({ kind: 'partial_cancellation', partialCancellationId: row.partialCancellationId, orderId: row.orderId,
        ...(row.orderNumber ? { orderNumber: row.orderNumber as string } : {}), sequence: row.sequence, amount: row.amount,
        confirmedAt: row.confirmedAt, filedAt: row.filedAt as string | null, updatedAt: row.updatedAt, gift: row.gift, payerName: row.payerName as string | null });
      continue;
    }
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
  // 한 주문의 요청 송금 대기는 하나뿐이다(T03). 부분 취소는 한 주문에 여러 차례가 함께 기다릴 수 있다.
  const claims = rows.filter((row): row is RefundTransferClaimRow => row.kind !== 'partial_cancellation');
  if (new Set(rows.map(refundTransferRowKey)).size !== rows.length || new Set(claims.map(row => row.orderId)).size !== claims.length) return null;
  return { rows, total: value.total, page, pageSize: REFUND_TRANSFERS_PAGE_SIZE };
}
