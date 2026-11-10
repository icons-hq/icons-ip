import { CLAIM_FEE_STATES, type ClaimFeeState } from '@/lib/orders/claim-fees';
import { transactionExactKeys as keys, transactionInteger as integer, transactionRecord as record } from '@/lib/goods-transaction-values';
import { isUuid } from '@/lib/uuid';
import { isCommerceNumber } from '@/lib/commerce-number';
export const CLAIM_FEES_PATH = '/admin/sales/claims/returns/fees';
export const CLAIM_FEE_FILTERS = { open: '처리 대기', all: '전체', ...CLAIM_FEE_STATES } as const;
export type ClaimFeeFilter = keyof typeof CLAIM_FEE_FILTERS;
export type ClaimFeeQueueRow = { orderNumber?: string; id: string; claimId: string; orderId: string; claimType: 'return' | 'exchange'; amount: number; state: ClaimFeeState; payerRole: 'buyer' | 'requester'; issuedAt: string; receivedAt: string | null; refundedAt: string | null };
export type ClaimFeeQueue = { state: ClaimFeeFilter; page: number; pageSize: number; total: number; counts: Partial<Record<ClaimFeeState, number>>; rows: ClaimFeeQueueRow[] };
export const claimFeeQueueHref = (state: ClaimFeeFilter, page = 1) => `${CLAIM_FEES_PATH}?state=${state}&page=${page}`;
export function claimFeeQueueFilters(params: Record<string, string | string[] | undefined>) {
 const state = typeof params.state === 'string' && Object.hasOwn(CLAIM_FEE_FILTERS, params.state) ? params.state as ClaimFeeFilter : 'open';
 const page = typeof params.page === 'string' && /^[1-9][0-9]*$/.test(params.page) && Number(params.page) <= 50000 ? Number(params.page) : 1;
 return { state, page };
}
export function parseClaimFeeQueue(v: unknown): ClaimFeeQueue | null {
 const time = (a: unknown) => typeof a === 'string' && Number.isFinite(Date.parse(a));
 if (!record(v) || !keys(v, ['state', 'page', 'pageSize', 'total', 'counts', 'rows']) || typeof v.state !== 'string' || !Object.hasOwn(CLAIM_FEE_FILTERS, v.state)
  || !integer(v.page, 1, 50000) || v.pageSize !== 50 || !integer(v.total, 0) || !record(v.counts) || !Array.isArray(v.rows)
  || Object.entries(v.counts).some(([key, value]) => !Object.hasOwn(CLAIM_FEE_STATES, key) || !integer(value, 0))) return null;
 if (v.rows.length > 50 || v.rows.some(r => !record(r) || !keys(r, ['id', 'claimId', 'orderId', 'claimType', 'amount', 'state', 'payerRole', 'issuedAt', 'receivedAt', 'refundedAt', ...(Object.hasOwn(r, 'orderNumber') ? ['orderNumber'] : [])])
  || (r.orderNumber !== undefined && !isCommerceNumber(r.orderNumber, 'order')) || !isUuid(r.id) || !isUuid(r.claimId) || !isUuid(r.orderId) || !['return', 'exchange'].includes(r.claimType as string) || !integer(r.amount, 1, 1000000)
  || typeof r.state !== 'string' || !Object.hasOwn(CLAIM_FEE_STATES, r.state) || !['buyer', 'requester'].includes(r.payerRole as string)
  || !time(r.issuedAt) || ![r.receivedAt, r.refundedAt].every(a => a === null || time(a)))) return null;
 return v as ClaimFeeQueue;
}
