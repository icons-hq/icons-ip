import { transactionExactKeys as keys, transactionInteger as integer, transactionRecord as record } from '@/lib/goods-transaction-values';
import { isUuid } from '@/lib/uuid';
export const CLAIM_FEE_POLICY_PATH = '/admin/sales/claims/returns/fee-policy';
export const CLAIM_FEE_STATES = { unpaid: '입금 대기', reported: '고객 입금 알림 · 확인 전', paid: '입금 확인', waived: '청구 면제', voided: '청구 취소', refund_due: '배송비 반환 대기', refunded: '배송비 반환 완료' } as const;
export const CLAIM_FEE_ACTIONS = { issue: '배송비 청구', report_payment: '입금했어요', confirm_payment: '실제 입금 확인', waive: '청구 면제', cancel: '청구 취소', refund: '실제 반환 완료', basis_changed: '요청·사유 변경에 따른 청구 취소' } as const;
export type ClaimFeeState = keyof typeof CLAIM_FEE_STATES;
export type ClaimFeeKind = Exclude<keyof typeof CLAIM_FEE_ACTIONS, 'basis_changed'>;
export type ClaimFeePolicy = { revision: number; enabled: boolean; returnAmount: number | null; exchangeAmount: number | null; evidence: string; updatedAt: string; accountReady: boolean };
export type ClaimFeeInvoice = { id: string; amount: number; state: ClaimFeeState; payerRole: 'buyer' | 'requester'; bankAccount: { bank: string; accountNumber: string; holder: string } | null; customerNote: string; agreementEvidence: string; issuedAt: string; receivedAt: string | null; refundedAt: string | null };
export type ClaimFeeDocument = { claimId: string; orderId: string; claimRevision: number; revision: number; claimType: string; policy: ClaimFeePolicy | null; canIssue: boolean; invoices: ClaimFeeInvoice[]; history: { id: string; invoiceId: string; kind: keyof typeof CLAIM_FEE_ACTIONS; at: string; evidence: string }[] };
export type ClaimFeeValues = { confirmed: true; amount?: number; payerRole?: 'buyer' | 'requester'; customerNote?: string; evidence?: string; occurredAt?: string };
const instant = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const note = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length >= 2 && v.length <= max && !/[\u0000-\u001f\u007f]/u.test(v);
export function normalizeClaimFeeValues(kind: unknown, v: unknown): ClaimFeeValues | null {
 if (typeof kind !== 'string' || !Object.hasOwn(CLAIM_FEE_ACTIONS, kind) || kind === 'basis_changed' || !record(v) || v.confirmed !== true) return null;
 const expected = kind === 'issue' ? ['amount', 'payerRole', 'customerNote', 'evidence', 'confirmed'] : ['confirm_payment', 'refund'].includes(kind) ? ['amount', 'occurredAt', 'evidence', 'confirmed'] : kind === 'report_payment' ? ['confirmed'] : ['evidence', 'confirmed'];
 if (!keys(v, expected) || kind !== 'report_payment' && !note(v.evidence, 1000)) return null;
 if (['issue', 'confirm_payment', 'refund'].includes(kind) && !integer(v.amount, 1, 1000000)) return null;
 if (kind === 'issue' && (!['buyer', 'requester'].includes(v.payerRole as string) || !note(v.customerNote, 500))) return null;
 if (['confirm_payment', 'refund'].includes(kind) && !instant(v.occurredAt)) return null;
 return { ...v, ...(typeof v.evidence === 'string' ? { evidence: v.evidence.trim() } : {}), ...(typeof v.customerNote === 'string' ? { customerNote: v.customerNote.trim() } : {}) } as ClaimFeeValues;
}
export function parseClaimFeePolicy(v: unknown): ClaimFeePolicy | null {
 return record(v) && keys(v, ['revision', 'enabled', 'returnAmount', 'exchangeAmount', 'evidence', 'updatedAt', 'accountReady'])
  && integer(v.revision, 1) && typeof v.enabled === 'boolean' && typeof v.accountReady === 'boolean' && typeof v.evidence === 'string' && instant(v.updatedAt)
  && [v.returnAmount, v.exchangeAmount].every(a => a === null || integer(a, 1, 1000000)) ? v as ClaimFeePolicy : null;
}
export function parseClaimFeeDocument(v: unknown): ClaimFeeDocument | null {
 if (!record(v) || !keys(v, ['claimId', 'orderId', 'claimRevision', 'revision', 'claimType', 'policy', 'canIssue', 'invoices', 'history']) || !isUuid(v.claimId) || !isUuid(v.orderId)
  || !integer(v.claimRevision, 0) || !integer(v.revision, 0) || typeof v.claimType !== 'string' || typeof v.canIssue !== 'boolean' || v.policy !== null && !parseClaimFeePolicy(v.policy)
  || !Array.isArray(v.invoices) || !Array.isArray(v.history)) return null;
 if (v.invoices.some(i => !record(i) || !keys(i, ['id', 'amount', 'state', 'payerRole', 'bankAccount', 'customerNote', 'agreementEvidence', 'issuedAt', 'receivedAt', 'refundedAt'])
  || !isUuid(i.id) || !integer(i.amount, 1, 1000000) || typeof i.state !== 'string' || !Object.hasOwn(CLAIM_FEE_STATES, i.state) || !['buyer', 'requester'].includes(i.payerRole as string)
  || typeof i.customerNote !== 'string' || typeof i.agreementEvidence !== 'string' || !instant(i.issuedAt) || ![i.receivedAt, i.refundedAt].every(a => a === null || instant(a))
  || i.bankAccount !== null && (!record(i.bankAccount) || !keys(i.bankAccount, ['bank', 'accountNumber', 'holder']) || !Object.values(i.bankAccount).every(a => typeof a === 'string' && a.length > 0)))) return null;
 if (v.history.some(e => !record(e) || !keys(e, ['id', 'invoiceId', 'kind', 'at', 'evidence']) || !isUuid(e.id) || !isUuid(e.invoiceId) || !instant(e.at)
  || typeof e.kind !== 'string' || !Object.hasOwn(CLAIM_FEE_ACTIONS, e.kind) || typeof e.evidence !== 'string')) return null;
 return v as ClaimFeeDocument;
}
export function claimFeeError(code?: string, message = '') {
 if (code === '42501') return '로그인 상태나 판매 관리 권한이 바뀌었습니다. 다시 열어주세요.';
 if (code === 'P0002') return '이 배송비 청구를 확인할 수 없습니다.';
 if (message.includes('account_missing')) return '먼저 운영 설정에 입금 받을 법인계좌를 등록해주세요.';
 if (code === '22023') return '금액·실제 처리시각·근거·확인 항목을 확인해주세요.';
 if (code === 'PT409') return '요청 또는 배송비 상태가 바뀌었습니다. 현재 청구 내역을 다시 확인해주세요.';
 return '처리 결과를 확인하지 못했습니다. 같은 요청으로 결과를 확인해주세요.';
}
