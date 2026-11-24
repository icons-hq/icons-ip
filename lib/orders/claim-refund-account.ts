import { isUuid } from '@/lib/uuid';
import { isOrderClaimStage, isOrderClaimType, normalizeRefundAccount, type OrderClaimStage, type OrderClaimType, type RefundAccountInput } from './claims';

export interface ClaimRefundAccountIdentity { actorId: string; sessionId: string; orderId: string; claimId: string }
export interface ClaimRefundAccountRecovery extends ClaimRefundAccountIdentity { version: 1; operationId: string; revision: number }
export interface ClaimRefundAccountRequest extends ClaimRefundAccountRecovery { account: RefundAccountInput }
/**
 * bank_transfer = 회사 계좌로 받은 무통장 주문(빠진 계좌를 한 번 보완, ADR-0010). virtual_account = 입금된 토스 가상계좌 주문(ADR-0049 결정 5
 * 보강) — 입력한 계좌로 결제대행사가 환급하고, 결제대행사가 계좌를 거절하면 바꿀 수 있다.
 */
export type ClaimRefundAccountMode = 'bank_transfer' | 'virtual_account';
/**
 * 가상계좌 환불의 계좌 문제 — required: 계좌 없음, invalid: 결제대행사가 계좌를 거절,
 * unusable: 입력된 계좌를 결제대행사에 그대로 보낼 수 없다(DB 판정 private.virtual_account_refund_account_usable — 바꿔야 환불된다).
 */
export type ClaimRefundAccountIssue = 'required' | 'invalid' | 'unusable';
export interface ClaimRefundAccountCheckoutAccount { bankCode: string; maskedAccount: string; maskedHolder: string }
export interface ClaimRefundAccountContext {
  actorId: string; orderId: string; claimId: string; claimType: OrderClaimType; stage: OrderClaimStage; revision: number;
  allowed: boolean; blocker: string | null; maskedAccount: string | null; maskedHolder: string | null; recordedAt: string | null;
  mode: ClaimRefundAccountMode; refundAccountIssue: ClaimRefundAccountIssue | null; checkoutAccount: ClaimRefundAccountCheckoutAccount | null;
}
/** 저장 뒤 가상계좌 환불 재시도 결과(lib/orders/virtual-account-refund-retry.server.ts). */
export type ClaimRefundAccountRetry = 'started' | 'operator_required' | 'account_missing' | 'account_invalid' | 'not_applicable' | 'failed';
export interface ClaimRefundAccountReceipt {
  operationId: string; actorId: string; orderId: string; claimId: string; revision: number; resultRevision: number;
  state: 'saved' | 'sealed'; createdAt: string;
}
export interface ClaimRefundAccountFailure { error: string; uncertain?: boolean; conflict?: boolean; authChanged?: boolean }
export type ClaimRefundAccountResult = { receipt: ClaimRefundAccountReceipt | null; refundRetry?: ClaimRefundAccountRetry } | ClaimRefundAccountFailure;

const object = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const identityKeys = ['actorId', 'sessionId', 'orderId', 'claimId'];
const recoveryKeys = [...identityKeys, 'version', 'operationId', 'revision'];
const controls = /[\u0000-\u001f\u007f]/;
export const CLAIM_REFUND_ACCOUNT_RECOVERY_PREFIX = 'icons:claim-refund-account:operation:v1:';

export function normalizeClaimRefundAccountIdentity(value: unknown): ClaimRefundAccountIdentity | null {
  if (!object(value) || !identityKeys.every(key => isUuid(value[key]))) return null;
  return { actorId: String(value.actorId).toLowerCase(), sessionId: String(value.sessionId).toLowerCase(),
    orderId: String(value.orderId).toLowerCase(), claimId: String(value.claimId).toLowerCase() };
}
export function claimRefundAccountRecoveryKey(identity: ClaimRefundAccountIdentity) {
  return `${CLAIM_REFUND_ACCOUNT_RECOVERY_PREFIX}${identity.actorId}:${identity.sessionId}:${identity.orderId}:${identity.claimId}`;
}
export function claimRefundAccountRequestMetadata(request: ClaimRefundAccountRequest): ClaimRefundAccountRecovery {
  return { version: 1, operationId: request.operationId, revision: request.revision, actorId: request.actorId,
    sessionId: request.sessionId, orderId: request.orderId, claimId: request.claimId };
}
export function parseClaimRefundAccountRecovery(value: unknown, expected?: ClaimRefundAccountIdentity): ClaimRefundAccountRecovery | null {
  const identity = normalizeClaimRefundAccountIdentity(value);
  if (!identity || !object(value) || Object.keys(value).some(key => !recoveryKeys.includes(key))
    || value.version !== 1 || !isUuid(value.operationId) || !integer(value.revision)
    || expected && identityKeys.some(key => identity[key as keyof ClaimRefundAccountIdentity] !== expected[key as keyof ClaimRefundAccountIdentity])) return null;
  return { ...identity, version: 1, operationId: value.operationId.toLowerCase(), revision: value.revision };
}
export function normalizeClaimRefundAccountRequest(value: unknown): ClaimRefundAccountRequest | null {
  if (!object(value) || Object.keys(value).some(key => ![...recoveryKeys, 'account'].includes(key)) || !object(value.account)
    || Object.keys(value.account).some(key => !['bankName', 'accountNumber', 'accountHolder'].includes(key))
    || !['bankName', 'accountNumber', 'accountHolder'].every(key => typeof (value.account as Record<string, unknown>)[key] === 'string')
    || Object.values(value.account).some(text => controls.test(String(text)))) return null;
  const { account: raw, ...metadata } = value;
  const recovery = parseClaimRefundAccountRecovery(metadata);
  const account = normalizeRefundAccount(raw as unknown as RefundAccountInput);
  if (!recovery || !account.ok || !account.value || !/[0-9]/.test(account.value.accountNumber)
    || [...account.value.bankName].length > 40 || [...account.value.accountHolder].length > 40) return null;
  return { ...recovery, account: account.value };
}
function parseCheckoutAccount(value: unknown): ClaimRefundAccountCheckoutAccount | null | undefined {
  if (value === null || value === undefined) return null;
  if (!object(value) || typeof value.bankCode !== 'string' || !/^[0-9]{2,3}$/.test(value.bankCode)
    || typeof value.maskedAccount !== 'string' || typeof value.maskedHolder !== 'string') return undefined;
  return { bankCode: value.bankCode, maskedAccount: value.maskedAccount, maskedHolder: value.maskedHolder };
}
/** Explicit projections never return an account number, request digest, or session token. */
export function parseClaimRefundAccountContext(value: unknown): ClaimRefundAccountContext | null {
  if (!object(value)) return null;
  const mode = value.mode === undefined ? 'bank_transfer' : value.mode;
  const issue = value.refundAccountIssue ?? null;
  const checkoutAccount = parseCheckoutAccount(value.checkoutAccount);
  if (!isUuid(value.actorId) || !isUuid(value.orderId) || !isUuid(value.claimId)
    || !isOrderClaimType(value.claimType) || !isOrderClaimStage(value.stage) || !integer(value.revision)
    || typeof value.allowed !== 'boolean' || value.blocker !== null && typeof value.blocker !== 'string'
    || value.allowed !== (value.blocker === null)
    || value.maskedAccount !== null && typeof value.maskedAccount !== 'string'
    || value.maskedHolder !== null && typeof value.maskedHolder !== 'string'
    || value.recordedAt !== null && !date(value.recordedAt)
    || (value.maskedAccount === null) !== (value.maskedHolder === null)
    || (value.maskedAccount === null) !== (value.recordedAt === null)
    || (mode !== 'bank_transfer' && mode !== 'virtual_account')
    || (issue !== null && issue !== 'required' && issue !== 'invalid' && issue !== 'unusable')
    || checkoutAccount === undefined
    // 회사 계좌 무통장은 계좌를 한 번만 받는다 — 이미 있으면 입력이 열리지 않는다. 가상계좌는 계좌를 바꿀 수 있다.
    || mode === 'bank_transfer' && (value.allowed && value.maskedAccount !== null || issue !== null || checkoutAccount !== null)) return null;
  return { actorId: value.actorId, orderId: value.orderId, claimId: value.claimId, claimType: value.claimType, stage: value.stage,
    revision: value.revision, allowed: value.allowed, blocker: value.blocker as string | null,
    maskedAccount: value.maskedAccount as string | null, maskedHolder: value.maskedHolder as string | null, recordedAt: value.recordedAt as string | null,
    mode, refundAccountIssue: issue as ClaimRefundAccountIssue | null, checkoutAccount };
}
export function parseClaimRefundAccountReceipt(value: unknown): ClaimRefundAccountReceipt | null {
  if (!object(value) || !isUuid(value.operationId) || !isUuid(value.actorId) || !isUuid(value.orderId) || !isUuid(value.claimId)
    || !integer(value.revision) || !integer(value.resultRevision) || !['saved', 'sealed'].includes(String(value.state))
    || value.resultRevision !== value.revision + (value.state === 'saved' ? 1 : 0) || !date(value.createdAt)) return null;
  return { operationId: value.operationId, actorId: value.actorId, orderId: value.orderId, claimId: value.claimId,
    revision: value.revision, resultRevision: value.resultRevision, state: value.state as 'saved' | 'sealed', createdAt: value.createdAt };
}
export function claimRefundAccountReceiptMatches(receipt: ClaimRefundAccountReceipt, request: ClaimRefundAccountRecovery) {
  return receipt.operationId === request.operationId && receipt.actorId === request.actorId && receipt.orderId === request.orderId
    && receipt.claimId === request.claimId && receipt.revision === request.revision;
}
export function claimRefundAccountError(code?: string, message?: string): ClaimRefundAccountFailure {
  if (code === '42501') return { error: '로그인 계정 또는 세션이 바뀌었습니다. 현재 계정으로 주문을 다시 열어주세요.', authChanged: true };
  if (code === 'PT409') return { error: '요청 처리 상태가 바뀌었습니다. 최신 상태를 확인한 뒤 다시 입력해주세요.', conflict: true };
  const known: Record<string, string> = {
    claim_not_found: '이 주문의 요청을 찾을 수 없습니다.',
    invalid_claim_refund_account: '은행, 계좌번호, 예금주를 모두 확인해주세요.',
    refund_account_gift_order: '선물 주문의 환불계좌는 선물 요청 화면에서 확인해주세요.',
    refund_account_payment_unavailable: '현재 결제 내역에서는 환불계좌를 추가할 수 없습니다. 고객지원에 문의해주세요.',
    refund_account_claim_closed: '이미 종료됐거나 환불계좌를 추가할 수 없는 요청입니다.',
    refund_account_not_needed: '앞선 부분 취소로 결제 금액을 모두 돌려드려 송금할 환불 금액이 없어요. 환불계좌를 입력하지 않아도 됩니다.',
    refund_account_already_recorded: '환불계좌가 이미 등록되어 있습니다. 변경이 필요하면 고객지원에 문의해주세요.',
    refund_account_finance_started: '환급 처리가 시작되어 계좌를 추가할 수 없습니다. 고객지원에 문의해주세요.',
    refund_account_refund_in_progress: '지금 환불을 처리하고 있어 계좌를 바꿀 수 없어요. 처리 결과가 나오면 이 화면에서 다시 확인해주세요.',
    invalid_virtual_account_refund_account: '은행은 목록에서 고르고, 계좌번호는 숫자 6~20자리(하이픈 제외)로 입력해주세요.',
    refund_account_request_sealed: '종료한 저장 요청입니다. 최신 상태를 확인한 뒤 새로 입력해주세요.',
    refund_account_request_expired: '계좌 보관 기간이 종료됐습니다. 저장 기록을 확인해주세요.',
    refund_account_request_conflict: '처음 보낸 내용과 다릅니다. 이전 요청의 저장 결과를 확인해주세요.',
  };
  const error = known[message ?? ''];
  if (error) return { error, ...(message === 'refund_account_request_conflict' ? { uncertain: true } : {}) };
  return { error: '저장 결과를 확인하지 못했습니다. 이전 요청의 결과를 먼저 확인해주세요.', uncertain: true };
}
