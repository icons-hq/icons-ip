import { isUuid } from '@/lib/uuid';
import { isOrderClaimStage, isOrderClaimType, type OrderClaimStage, type OrderClaimType } from './claims';
export interface ClaimWithdrawalContext {
  claimId: string; orderId: string; claimType: OrderClaimType; stage: OrderClaimStage; revision: number; allowed: boolean; blocker: string | null; orderTotal: number;
  withdrawal: { actorKind: 'customer' | 'operator'; reason: string; createdAt: string } | null;
}
export interface ClaimWithdrawalRequest { id: string; claimId: string; revision: number; reason: string; confirmed: true }
export interface ClaimWithdrawalReceipt { id: string; claimId: string; orderId: string; actorKind: 'customer' | 'operator'; reason: string; createdAt: string; stage: 'withdrawn' }
export type ClaimWithdrawalResult = { context: ClaimWithdrawalContext } | { receipt: ClaimWithdrawalReceipt | null } | { error: string; uncertain?: boolean; conflict?: boolean };
const object = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const kind = (v: unknown): v is 'customer' | 'operator' => v === 'customer' || v === 'operator';
export function parseClaimWithdrawalContext(v: unknown): ClaimWithdrawalContext | null {
  if (!object(v) || !isUuid(v.claimId) || !isUuid(v.orderId) || !isOrderClaimType(v.claimType) || !isOrderClaimStage(v.stage)
    || !integer(v.revision) || !integer(v.orderTotal) || typeof v.allowed !== 'boolean' || v.blocker !== null && typeof v.blocker !== 'string') return null;
  let withdrawal: ClaimWithdrawalContext['withdrawal'] = null;
  if (v.withdrawal !== null) {
    if (!object(v.withdrawal) || !kind(v.withdrawal.actorKind) || typeof v.withdrawal.reason !== 'string' || !date(v.withdrawal.createdAt)) return null;
    withdrawal = { actorKind: v.withdrawal.actorKind, reason: v.withdrawal.reason, createdAt: v.withdrawal.createdAt };
  }
  return { claimId: v.claimId, orderId: v.orderId, claimType: v.claimType, stage: v.stage, revision: v.revision, allowed: v.allowed, blocker: v.blocker as string | null, orderTotal: v.orderTotal, withdrawal };
}
export function parseClaimWithdrawalReceipt(v: unknown): ClaimWithdrawalReceipt | null {
  if (!object(v) || !isUuid(v.id) || !isUuid(v.claimId) || !isUuid(v.orderId) || !kind(v.actorKind) || typeof v.reason !== 'string' || !date(v.createdAt) || v.stage !== 'withdrawn') return null;
  return { id: v.id, claimId: v.claimId, orderId: v.orderId, actorKind: v.actorKind, reason: v.reason, createdAt: v.createdAt, stage: 'withdrawn' };
}
export function normalizeClaimWithdrawalRequest(v: unknown): ClaimWithdrawalRequest | null {
  if (!object(v) || Object.keys(v).some(key => !['id', 'claimId', 'revision', 'reason', 'confirmed'].includes(key)) || !isUuid(v.id) || !isUuid(v.claimId) || !integer(v.revision)
    || typeof v.reason !== 'string' || v.reason.trim().length < 2 || v.reason.trim().length > 500 || /[\u0000-\u001f\u007f]/.test(v.reason) || v.confirmed !== true) return null;
  return { id: v.id.toLowerCase(), claimId: v.claimId.toLowerCase(), revision: v.revision, reason: v.reason.trim(), confirmed: true };
}
export function claimWithdrawalReceiptMatches(receipt: ClaimWithdrawalReceipt, request: ClaimWithdrawalRequest, operator: boolean) {
  return receipt.id === request.id && receipt.claimId === request.claimId && receipt.reason === request.reason && receipt.actorKind === (operator ? 'operator' : 'customer');
}
export function claimWithdrawalError(code?: string, message?: string): string {
  if (code === '42501') return '현재 계정과 처리 권한을 확인해주세요.';
  if (code === 'PT409') return '다른 처리가 먼저 진행됐습니다. 입력을 보존한 채 최신 요청을 확인해주세요.';
  const known: Record<string, string> = {
    auth_required: '로그인한 뒤 다시 확인해주세요.', claim_not_found: '해당 요청을 찾을 수 없습니다.',
    claim_already_withdrawn: '이미 철회된 요청입니다. 철회 이력을 확인해주세요.',
    claim_withdrawal_started: '회수 완료·환급 또는 재출고 처리가 진행되어 직접 철회할 수 없습니다. 고객지원에 문의해주세요.',
    claim_withdrawal_collection_started: '반송·입고 근거가 있어 바로 철회할 수 없습니다. 수거 상태를 고객지원과 확인해주세요.',
    claim_withdrawal_finance_started: '결제 취소나 환급이 이미 진행되어 요청만 철회할 수 없습니다.',
    invalid_claim_withdrawal: '2~500자 사유와 요청 철회 동의를 확인해주세요.',
    claim_withdrawal_request_conflict: '처음 전송한 내용과 다른 결과입니다. 같은 요청의 결과를 확인해주세요.',
  };
  return known[message ?? ''] ?? '결과를 확인하지 못했습니다. 같은 요청의 결과를 조회해주세요.';
}
