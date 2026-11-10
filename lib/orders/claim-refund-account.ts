import { isUuid } from '@/lib/uuid';
import { isOrderClaimStage, isOrderClaimType, normalizeRefundAccount, type OrderClaimStage, type OrderClaimType, type RefundAccountInput } from './claims';

export interface ClaimRefundAccountIdentity { actorId: string; sessionId: string; orderId: string; claimId: string }
export interface ClaimRefundAccountRecovery extends ClaimRefundAccountIdentity { version: 1; operationId: string; revision: number }
export interface ClaimRefundAccountRequest extends ClaimRefundAccountRecovery { account: RefundAccountInput }
export interface ClaimRefundAccountContext {
  actorId: string; orderId: string; claimId: string; claimType: OrderClaimType; stage: OrderClaimStage; revision: number;
  allowed: boolean; blocker: string | null; maskedAccount: string | null; maskedHolder: string | null; recordedAt: string | null;
}
export interface ClaimRefundAccountReceipt {
  operationId: string; actorId: string; orderId: string; claimId: string; revision: number; resultRevision: number;
  state: 'saved' | 'sealed'; createdAt: string;
}
export interface ClaimRefundAccountFailure { error: string; uncertain?: boolean; conflict?: boolean; authChanged?: boolean }
export type ClaimRefundAccountResult = { receipt: ClaimRefundAccountReceipt | null } | ClaimRefundAccountFailure;

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
/** Explicit projections never return an account number, request digest, or session token. */
export function parseClaimRefundAccountContext(value: unknown): ClaimRefundAccountContext | null {
  if (!object(value) || !isUuid(value.actorId) || !isUuid(value.orderId) || !isUuid(value.claimId)
    || !isOrderClaimType(value.claimType) || !isOrderClaimStage(value.stage) || !integer(value.revision)
    || typeof value.allowed !== 'boolean' || value.blocker !== null && typeof value.blocker !== 'string'
    || value.allowed !== (value.blocker === null)
    || value.maskedAccount !== null && typeof value.maskedAccount !== 'string'
    || value.maskedHolder !== null && typeof value.maskedHolder !== 'string'
    || value.recordedAt !== null && !date(value.recordedAt)
    || (value.maskedAccount === null) !== (value.maskedHolder === null)
    || (value.maskedAccount === null) !== (value.recordedAt === null)
    || value.allowed && value.maskedAccount !== null) return null;
  return { actorId: value.actorId, orderId: value.orderId, claimId: value.claimId, claimType: value.claimType, stage: value.stage,
    revision: value.revision, allowed: value.allowed, blocker: value.blocker as string | null,
    maskedAccount: value.maskedAccount as string | null, maskedHolder: value.maskedHolder as string | null, recordedAt: value.recordedAt as string | null };
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
    refund_account_already_recorded: '환불계좌가 이미 등록되어 있습니다. 변경이 필요하면 고객지원에 문의해주세요.',
    refund_account_finance_started: '환급 처리가 시작되어 계좌를 추가할 수 없습니다. 고객지원에 문의해주세요.',
    refund_account_request_sealed: '종료한 저장 요청입니다. 최신 상태를 확인한 뒤 새로 입력해주세요.',
    refund_account_request_expired: '계좌 보관 기간이 종료됐습니다. 저장 기록을 확인해주세요.',
    refund_account_request_conflict: '처음 보낸 내용과 다릅니다. 이전 요청의 저장 결과를 확인해주세요.',
  };
  const error = known[message ?? ''];
  if (error) return { error, ...(message === 'refund_account_request_conflict' ? { uncertain: true } : {}) };
  return { error: '저장 결과를 확인하지 못했습니다. 이전 요청의 결과를 먼저 확인해주세요.', uncertain: true };
}
