import { isUuid } from '@/lib/uuid';
import { isOrderWithdrawalReasonType, type OrderWithdrawalReasonType } from '@/lib/orders';
import { isOrderClaimStage, isOrderClaimType, type OrderClaimStage, type OrderClaimType } from './claims';

export interface ClaimReasonHistory {
  id: string; claimId: string; fromReasonType: OrderWithdrawalReasonType; fromReason: string;
  toReasonType: OrderWithdrawalReasonType; toReason: string; requestedAt: string; createdAt: string;
}
export interface ClaimReasonStaffHistory extends ClaimReasonHistory { actorId: string; agreement: string }
export interface ClaimReasonContext {
  actorId: string; claimId: string; orderId: string; claimType: OrderClaimType; stage: OrderClaimStage; revision: number;
  reasonType: OrderWithdrawalReasonType; reason: string; originalReasonType: OrderWithdrawalReasonType; originalReason: string;
  requestedAt: string; deliveredAt: string | null; allowed: boolean; blocker: string | null;
  canUseChangeOfMind: boolean; canUseDefect: boolean;
  fee: { kind: 'return_shipping' | 'exchange_shipping' | 'other'; amount: number; note: string; confirmedAt: string } | null;
  history: ClaimReasonStaffHistory[];
}
export interface ClaimReasonRequest {
  id: string; actorId: string; claimId: string; revision: number; reasonType: OrderWithdrawalReasonType;
  reason: string; agreement: string; confirmed: true; feeReviewed: boolean;
}
export interface ClaimReasonReceipt extends ClaimReasonStaffHistory {
  orderId: string; revision: number; resultRevision: number; feeReviewed: boolean; changed: boolean; stage: OrderClaimStage;
}
export type ClaimReasonResult = { context: ClaimReasonContext } | { receipt: ClaimReasonReceipt | null } | { error: string; uncertain?: boolean; conflict?: boolean };

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const reasonType = (value: unknown): value is OrderWithdrawalReasonType => typeof value === 'string' && isOrderWithdrawalReasonType(value);
const controls = /[\u0000-\u001f\u007f]/;
const text = (value: unknown, max: number): value is string => typeof value === 'string' && [...value].length >= 1 && [...value].length <= max;
const clean = (value: unknown, min: number, max: number): value is string => text(value, max) && [...value].length >= min && value.trim() === value && !controls.test(value);

/** Explicit projection prevents private staff evidence from crossing customer props. */
export function parseClaimReasonHistory(value: unknown): ClaimReasonHistory[] | null {
  if (!Array.isArray(value)) return null;
  const result: ClaimReasonHistory[] = [];
  for (const row of value) {
    if (!object(row) || !isUuid(row.id) || !isUuid(row.claimId) || !reasonType(row.fromReasonType) || !text(row.fromReason, 200)
      || !reasonType(row.toReasonType) || !clean(row.toReason, 1, 200) || !date(row.requestedAt) || !date(row.createdAt)) return null;
    result.push({ id: row.id, claimId: row.claimId, fromReasonType: row.fromReasonType, fromReason: row.fromReason,
      toReasonType: row.toReasonType, toReason: row.toReason, requestedAt: row.requestedAt, createdAt: row.createdAt });
  }
  return result;
}
export function parseClaimReasonContext(value: unknown): ClaimReasonContext | null {
  if (!object(value) || !isUuid(value.actorId) || !isUuid(value.claimId) || !isUuid(value.orderId) || !isOrderClaimType(value.claimType)
    || !isOrderClaimStage(value.stage) || !integer(value.revision) || !reasonType(value.reasonType) || !text(value.reason, 200)
    || !reasonType(value.originalReasonType) || !text(value.originalReason, 200) || !date(value.requestedAt)
    || value.deliveredAt !== null && !date(value.deliveredAt) || typeof value.allowed !== 'boolean'
    || value.blocker !== null && typeof value.blocker !== 'string' || typeof value.canUseChangeOfMind !== 'boolean' || typeof value.canUseDefect !== 'boolean') return null;
  const history = parseClaimReasonHistory(value.history); if (!history || history.some(row => row.claimId !== value.claimId)) return null;
  const staffHistory: ClaimReasonStaffHistory[] = [];
  for (const [index, row] of (value.history as unknown[]).entries()) {
    if (!object(row) || !isUuid(row.actorId) || !clean(row.agreement, 2, 500)) return null;
    staffHistory.push({ ...history[index], actorId: row.actorId, agreement: row.agreement });
  }
  let fee: ClaimReasonContext['fee'] = null;
  if (value.fee !== null) {
    const raw = value.fee;
    if (!object(raw) || !['return_shipping', 'exchange_shipping', 'other'].includes(String(raw.kind))
      || !integer(raw.amount) || raw.amount > 1_000_000 || !text(raw.note, 500) || !date(raw.confirmedAt)) return null;
    fee = { kind: raw.kind as NonNullable<ClaimReasonContext['fee']>['kind'], amount: raw.amount, note: raw.note, confirmedAt: raw.confirmedAt };
  }
  return { actorId: value.actorId, claimId: value.claimId, orderId: value.orderId, claimType: value.claimType, stage: value.stage,
    revision: value.revision, reasonType: value.reasonType, reason: value.reason, originalReasonType: value.originalReasonType, originalReason: value.originalReason,
    requestedAt: value.requestedAt, deliveredAt: value.deliveredAt as string | null, allowed: value.allowed, blocker: value.blocker as string | null,
    canUseChangeOfMind: value.canUseChangeOfMind, canUseDefect: value.canUseDefect, fee, history: staffHistory };
}
export function normalizeClaimReasonRequest(value: unknown): ClaimReasonRequest | null {
  if (!object(value) || Object.keys(value).some(key => !['id', 'actorId', 'claimId', 'revision', 'reasonType', 'reason', 'agreement', 'confirmed', 'feeReviewed'].includes(key))
    || !isUuid(value.id) || !isUuid(value.actorId) || !isUuid(value.claimId) || !integer(value.revision) || !reasonType(value.reasonType)
    || value.confirmed !== true || typeof value.feeReviewed !== 'boolean' || typeof value.reason !== 'string' || typeof value.agreement !== 'string'
    || controls.test(value.reason) || controls.test(value.agreement)) return null;
  const reason = value.reason.trim(); const agreement = value.agreement.trim();
  if (!clean(reason, 1, 200) || !clean(agreement, 2, 500)) return null;
  return { id: value.id.toLowerCase(), actorId: value.actorId.toLowerCase(), claimId: value.claimId.toLowerCase(), revision: value.revision,
    reasonType: value.reasonType, reason, agreement, confirmed: true, feeReviewed: value.feeReviewed };
}
export function parseClaimReasonReceipt(value: unknown): ClaimReasonReceipt | null {
  const history = parseClaimReasonHistory([value]);
  if (!object(value) || !history || !isUuid(value.actorId) || !isUuid(value.orderId) || !integer(value.revision) || !integer(value.resultRevision)
    || typeof value.changed !== 'boolean' || value.resultRevision !== value.revision + (value.changed ? 1 : 0)
    || value.changed !== (value.fromReasonType !== value.toReasonType || value.fromReason !== value.toReason)
    || !clean(value.agreement, 2, 500) || typeof value.feeReviewed !== 'boolean' || !isOrderClaimStage(value.stage)) return null;
  return { ...history[0], actorId: value.actorId, orderId: value.orderId, revision: value.revision, resultRevision: value.resultRevision,
    agreement: value.agreement, feeReviewed: value.feeReviewed, changed: value.changed, stage: value.stage };
}
export function claimReasonReceiptMatches(receipt: ClaimReasonReceipt, request: ClaimReasonRequest) {
  return receipt.id === request.id && receipt.actorId === request.actorId && receipt.claimId === request.claimId && receipt.revision === request.revision
    && receipt.toReasonType === request.reasonType && receipt.toReason === request.reason && receipt.agreement === request.agreement && receipt.feeReviewed === request.feeReviewed;
}
export function claimReasonError(code?: string, message?: string): string {
  if (code === '42501') return '현재 계정과 판매관리 권한을 확인해주세요. 다른 계정에서 연 요청은 다시 열어야 합니다.';
  if (code === 'PT409') return '다른 처리가 먼저 진행됐습니다. 입력을 보존한 채 최신 요청을 확인해주세요.';
  const known: Record<string, string> = {
    claim_not_found: '해당 요청을 찾을 수 없습니다.', invalid_claim_reason_change: '고객용 설명 1~200자, 협의 근거 2~500자와 확인 항목을 입력해주세요.',
    claim_reason_type_unavailable: '교환 요청의 사유만 정정할 수 있습니다.',
    claim_reason_stage_unavailable: '현재 처리 단계에서는 교환 사유를 정정할 수 없습니다.',
    claim_reason_reshipped: '교환품 재출고가 시작되어 사유를 정정할 수 없습니다.',
    claim_reason_finance_started: '주문 취소나 환급 처리가 시작되어 사유를 정정할 수 없습니다.',
    claim_reason_fee_review_required: '기존 비용 기록과 정정할 사유의 정합성을 확인해주세요.',
    claim_reason_original_deadline_expired: '원래 접수일을 기준으로 새 사유의 신청 기한을 벗어납니다. 기존 사유를 유지하고 별도로 상담해주세요.',
    claim_reason_request_conflict: '처음 보낸 내용과 다른 요청입니다. 같은 요청의 저장 결과를 확인해주세요.',
  };
  return known[message ?? ''] ?? '저장 결과를 확인하지 못했습니다. 같은 요청의 결과를 확인해주세요.';
}
