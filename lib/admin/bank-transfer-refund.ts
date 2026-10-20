import { isUuid } from '@/lib/uuid';
import { transactionExactKeys, transactionInstant, transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';
import { normalizeClaimRefundAccountIdentity, type ClaimRefundAccountIdentity } from '@/lib/orders/claim-refund-account';
import { isOrderClaimStage, type OrderClaimStage } from '@/lib/orders/claims';

export type BankRefundIdentity = ClaimRefundAccountIdentity;
export const BANK_REFUND_KINDS = ['confirm_cancellation', 'file_transfer', 'complete_transfer'] as const;
export type BankRefundKind = typeof BANK_REFUND_KINDS[number];
export const BANK_REFUND_LABELS: Record<BankRefundKind, string> = {
  confirm_cancellation: '취소 확정 · 재고 복원', file_transfer: '계좌 송금 접수 기록', complete_transfer: '송금 완료 확정',
};
export const BANK_REFUND_RECOVERY_PREFIX = 'icons:bank-refund:operation:v1:';
export interface BankRefundRecovery extends BankRefundIdentity { version: 1; operationId: string; revision: number; amount: number; kind: BankRefundKind }
export interface BankRefundRequest extends BankRefundRecovery { occurredAt: string; evidence: string; note: string; confirmed: true }
export interface BankRefundContext {
  actorId: string; orderId: string; claimId: string; claimType: 'cancel' | 'return' | 'exchange'; revision: number; amount: number;
  stage: OrderClaimStage; phase: 'not_confirmed' | 'awaiting_transfer' | 'completed'; gift: boolean;
  filedAt: string | null; confirmedAt: string | null; transferredAt: string | null;
  confirmationNotBefore: string | null; transferNotBefore: string | null;
  maskedAccount: string | null; maskedHolder: string | null;
  confirmBlocker: string | null; fileBlocker: string | null; completeBlocker: string | null; viewBlocker: string | null;
}
export interface BankRefundReceipt {
  operationId: string; actorId: string; orderId: string; claimId: string; kind: BankRefundKind;
  revision: number; resultRevision: number; amount: number; state: 'recorded' | 'sealed'; createdAt: string;
}
/** Never serialize this value to storage, telemetry, errors, logs or receipts. */
export interface BankRefundAccountView {
  viewId: string; actorId: string; orderId: string; claimId: string; revision: number;
  bankName: string; accountNumber: string; accountHolder: string; viewedAt: string;
}
export interface BankRefundFailure { error: string; uncertain?: boolean; conflict?: boolean; authChanged?: boolean }
export type BankRefundResult = { receipt: BankRefundReceipt | null } | BankRefundFailure;
const recoveryKeys = ['version', 'actorId', 'sessionId', 'orderId', 'claimId', 'operationId', 'revision', 'amount', 'kind'];
const kind = (v: unknown): v is BankRefundKind => BANK_REFUND_KINDS.includes(v as BankRefundKind);
const nullableText = (v: unknown) => v === null || typeof v === 'string';
const nullableInstant = (v: unknown) => v === null || transactionInstant(v);
const evidence = (v: unknown): v is string => typeof v === 'string' && v === v.trim() && [...v].length >= 2 && [...v].length <= 300 && !/[\u0000-\u001f\u007f]/.test(v);
export const bankRefundRecoveryKey = (identity: BankRefundIdentity) => `${BANK_REFUND_RECOVERY_PREFIX}${identity.actorId}:${identity.sessionId}:${identity.orderId}:${identity.claimId}`;
export function bankRefundMetadata(request: BankRefundRequest): BankRefundRecovery {
  const { actorId, sessionId, orderId, claimId, operationId, revision, amount, kind } = request;
  return { version: 1, actorId, sessionId, orderId, claimId, operationId, revision, amount, kind };
}
export function parseBankRefundRecovery(value: unknown, expected?: BankRefundIdentity): BankRefundRecovery | null {
  const identity = normalizeClaimRefundAccountIdentity(value);
  if (!identity || !transactionRecord(value) || !transactionExactKeys(value, recoveryKeys) || value.version !== 1
    || !isUuid(value.operationId) || !transactionInteger(value.revision) || !transactionInteger(value.amount, 1) || !kind(value.kind)
    || expected && (identity.actorId !== expected.actorId || identity.sessionId !== expected.sessionId || identity.orderId !== expected.orderId || identity.claimId !== expected.claimId)) return null;
  return { ...identity, version: 1, operationId: value.operationId.toLowerCase(), revision: value.revision, amount: value.amount, kind: value.kind };
}
export function normalizeBankRefundRequest(value: unknown): BankRefundRequest | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, [...recoveryKeys, 'occurredAt', 'evidence', 'note', 'confirmed'])
    || value.confirmed !== true || !transactionInstant(value.occurredAt) || !evidence(value.evidence) || !evidence(value.note)) return null;
  const { occurredAt, evidence: proof, note } = value;
  const metadata = Object.fromEntries(recoveryKeys.map(key => [key, value[key]]));
  const recovery = parseBankRefundRecovery(metadata);
  return recovery ? { ...recovery, occurredAt: new Date(occurredAt).toISOString(), evidence: proof, note, confirmed: true } : null;
}
export function parseBankRefundContext(value: unknown): BankRefundContext | null {
  const nullableTimes = ['filedAt', 'confirmedAt', 'transferredAt', 'confirmationNotBefore', 'transferNotBefore'];
  const texts = ['maskedAccount', 'maskedHolder', 'confirmBlocker', 'fileBlocker', 'completeBlocker', 'viewBlocker'];
  if (!transactionRecord(value) || !transactionExactKeys(value, ['actorId', 'orderId', 'claimId', 'claimType', 'revision', 'amount', 'stage', 'phase', 'gift', ...nullableTimes, ...texts])
    || !isUuid(value.actorId) || !isUuid(value.orderId) || !isUuid(value.claimId) || !['cancel', 'return', 'exchange'].includes(String(value.claimType))
    || !transactionInteger(value.revision) || !transactionInteger(value.amount) || !isOrderClaimStage(value.stage)
    || !['not_confirmed', 'awaiting_transfer', 'completed'].includes(String(value.phase)) || typeof value.gift !== 'boolean'
    || nullableTimes.some(key => !nullableInstant(value[key])) || texts.some(key => !nullableText(value[key]))) return null;
  return value as unknown as BankRefundContext;
}
export function parseBankRefundReceipt(value: unknown): BankRefundReceipt | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['operationId', 'actorId', 'orderId', 'claimId', 'kind', 'revision', 'resultRevision', 'amount', 'state', 'createdAt'])
    || ![value.operationId, value.actorId, value.orderId, value.claimId].every(isUuid) || !kind(value.kind)
    || !transactionInteger(value.revision) || !transactionInteger(value.resultRevision) || !transactionInteger(value.amount, 1)
    || !['recorded', 'sealed'].includes(String(value.state)) || !transactionInstant(value.createdAt)
    || (value.state === 'sealed' ? value.resultRevision !== value.revision : value.resultRevision <= value.revision)) return null;
  return value as unknown as BankRefundReceipt;
}
export function bankRefundReceiptMatches(receipt: BankRefundReceipt, request: BankRefundRecovery): boolean {
  return receipt.operationId === request.operationId && receipt.actorId === request.actorId && receipt.orderId === request.orderId
    && receipt.claimId === request.claimId && receipt.kind === request.kind && receipt.revision === request.revision && receipt.amount === request.amount;
}
export function parseBankRefundAccountView(value: unknown): BankRefundAccountView | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['viewId', 'actorId', 'orderId', 'claimId', 'revision', 'bankName', 'accountNumber', 'accountHolder', 'viewedAt'])
    || ![value.viewId, value.actorId, value.orderId, value.claimId].every(isUuid) || !transactionInteger(value.revision) || !transactionInstant(value.viewedAt)
    || typeof value.bankName !== 'string' || !value.bankName || [...value.bankName].length > 40
    || typeof value.accountHolder !== 'string' || !value.accountHolder || [...value.accountHolder].length > 40
    || typeof value.accountNumber !== 'string' || !/^(?=.*[0-9])[0-9-]{8,30}$/.test(value.accountNumber)) return null;
  return value as unknown as BankRefundAccountView;
}
export function bankRefundError(code?: string, message?: string): BankRefundFailure {
  if (code === '42501' || code === '28000') return { error: '로그인 세션 또는 결제 처리 권한이 바뀌었습니다. 현재 계정으로 요청을 다시 열어주세요.', authChanged: true };
  if (code === 'PT409') return { error: '요청 상태나 금액이 바뀌었습니다. 최신 상태를 확인해주세요.', conflict: true };
  const errors: Record<string, string> = {
    claim_not_found: '주문에 연결된 요청을 찾을 수 없습니다.',
    invalid_bank_refund_operation: '확인 일시, 증빙, 메모와 확인 항목을 모두 입력해주세요.',
    bank_refund_occurred_at_invalid: '확인 일시는 결제와 선행 처리 이후이며 현재 시각 이전이어야 합니다.',
    bank_refund_payment_unavailable: '전액 무통장 결제 1건이 확인되지 않아 처리할 수 없습니다.',
    bank_refund_gift_parties_invalid: '선물 구매자와 요청자 기록을 확인해야 합니다.',
    bank_refund_claim_unavailable: '현재 요청 단계에서는 처리할 수 없습니다. 최신 상태를 확인해주세요.',
    bank_refund_ledger_unavailable: '환불 원장의 금액·수단·요청 연결을 확인해야 합니다.',
    bank_refund_confirmation_required: '먼저 취소를 확정하고 재고 복원을 확인해주세요.',
    bank_refund_filing_required: '먼저 계좌 송금 접수를 기록해주세요.',
    bank_refund_approval_required: '승인된 취소 요청이 필요합니다.',
    bank_refund_already_filed: '계좌 송금 접수가 이미 기록되어 있습니다.',
    bank_refund_already_confirmed: '취소 확정이 이미 기록되어 있습니다.',
    bank_refund_evidence_required: '송금 완료 증빙이 확인되어야 환불을 종결할 수 있습니다.',
    bank_refund_transfer_pending: '실제 송금 완료를 기록하기 전에는 요청을 종결할 수 없습니다.',
    claim_refund_account_missing: '구매자의 환불계좌가 필요합니다. 결제한 분이 주문 또는 선물 요청 화면에서 등록해주세요.',
    claim_collections_incomplete: '모든 출고지의 상품 회수를 확인한 뒤 진행해주세요.',
    order_not_cancelable: '현재 배송 상태에서는 취소를 확정할 수 없습니다.',
    bank_refund_request_sealed: '종료한 처리 요청입니다. 최신 상태를 확인한 뒤 다시 입력해주세요.',
    bank_refund_request_conflict: '처음 보낸 요청과 내용이 다릅니다. 이전 처리 결과를 확인해주세요.',
  };
  if (message && Object.hasOwn(errors, message)) return { error: errors[message], ...(message === 'bank_refund_request_conflict' ? { uncertain: true } : {}) };
  return { error: '처리 결과를 확인하지 못했습니다. 이전 처리 결과를 먼저 확인해주세요.', uncertain: true };
}
