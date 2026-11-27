import { isUuid } from '@/lib/uuid';
import {
  CLAIM_CHANGE_CONFLICT_MESSAGE, CLAIM_CHANGE_NOT_FOUND_MESSAGE, CLAIM_CHANGE_PERMISSION_MESSAGE,
  CLAIM_CHANGE_REQUEST_MISMATCH_MESSAGE, CLAIM_CHANGE_UNKNOWN_MESSAGE,
} from '@/lib/admin/claim-change-copy';
import { isOrderClaimStage, isOrderClaimType, type OrderClaimStage, type OrderClaimType } from './claims';

export type ClaimHoldDecision = 'hold' | 'resume';
export interface ClaimHoldContext {
  actorId: string;
  claimId: string;
  orderId: string;
  claimType: OrderClaimType;
  stage: OrderClaimStage;
  revision: number;
  heldFrom: OrderClaimStage | null;
  holdReason: string | null;
  canHold: boolean;
  canResume: boolean;
}
export interface ClaimHoldRequest {
  id: string;
  actorId: string;
  claimId: string;
  claimType: OrderClaimType;
  revision: number;
  decision: ClaimHoldDecision;
  note: string | null;
  confirmed: true;
}
export interface ClaimHoldReceipt extends Omit<ClaimHoldRequest, 'confirmed'> {
  orderId: string;
  fromStage: OrderClaimStage;
  stage: OrderClaimStage;
  resultRevision: number;
  createdAt: string;
}
export type ClaimHoldResult =
  | { context: ClaimHoldContext }
  | { receipt: ClaimHoldReceipt | null }
  | { error: string; uncertain?: boolean; conflict?: boolean };

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const revision = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const controls = /[\u0000-\u001f\u007f]/;
/** 보류 사유 글자 수. DB(`admin_change_order_claim_hold`)가 같은 범위를 요구하고, 화면 칸의 제한도 이 값이다. */
export const CLAIM_HOLD_NOTE_MIN = 10;
export const CLAIM_HOLD_NOTE_MAX = 200;
export const CLAIM_HOLD_NOTE_ERROR = `보류 사유는 ${CLAIM_HOLD_NOTE_MIN}~${CLAIM_HOLD_NOTE_MAX}자로 적어 주세요. 줄바꿈은 넣을 수 없습니다.`;
const noteValid = (value: unknown): value is string => typeof value === 'string'
  && value.length >= CLAIM_HOLD_NOTE_MIN && value.length <= CLAIM_HOLD_NOTE_MAX && value.trim() === value && !controls.test(value);

export function parseClaimHoldContext(value: unknown): ClaimHoldContext | null {
  if (!object(value) || !isUuid(value.actorId) || !isUuid(value.claimId) || !isUuid(value.orderId)
    || !isOrderClaimType(value.claimType) || !isOrderClaimStage(value.stage) || !revision(value.revision)
    || value.heldFrom !== null && !isOrderClaimStage(value.heldFrom)
    || value.holdReason !== null && typeof value.holdReason !== 'string'
    || typeof value.canHold !== 'boolean' || typeof value.canResume !== 'boolean'
    || value.canHold && value.canResume) return null;
  return {
    actorId: value.actorId, claimId: value.claimId, orderId: value.orderId,
    claimType: value.claimType, stage: value.stage, revision: value.revision,
    heldFrom: value.heldFrom as OrderClaimStage | null, holdReason: value.holdReason as string | null,
    canHold: value.canHold, canResume: value.canResume,
  };
}

export function normalizeClaimHoldRequest(value: unknown): ClaimHoldRequest | null {
  if (!object(value) || Object.keys(value).some(key => !['id', 'actorId', 'claimId', 'claimType', 'revision', 'decision', 'note', 'confirmed'].includes(key))
    || !isUuid(value.id) || !isUuid(value.actorId) || !isUuid(value.claimId) || !isOrderClaimType(value.claimType)
    || !revision(value.revision) || value.confirmed !== true || !['hold', 'resume'].includes(String(value.decision))) return null;
  const note = typeof value.note === 'string' ? value.note.trim() : value.note;
  if (value.decision === 'hold' ? !noteValid(note) : note !== null) return null;
  return {
    id: value.id.toLowerCase(), actorId: value.actorId.toLowerCase(), claimId: value.claimId.toLowerCase(),
    claimType: value.claimType, revision: value.revision, decision: value.decision as ClaimHoldDecision,
    note: note as string | null, confirmed: true,
  };
}

export function parseClaimHoldReceipt(value: unknown): ClaimHoldReceipt | null {
  if (!object(value)) return null;
  const request = normalizeClaimHoldRequest({ id: value.id, actorId: value.actorId, claimId: value.claimId,
    claimType: value.claimType, revision: value.revision, decision: value.decision, note: value.note, confirmed: true });
  if (!request || !isUuid(value.orderId) || !isOrderClaimStage(value.fromStage) || !isOrderClaimStage(value.stage)
    || !revision(value.resultRevision) || value.resultRevision !== request.revision + 1
    || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))
    || request.decision === 'hold' && (value.stage !== 'on_hold' || value.fromStage === 'on_hold')
    || request.decision === 'resume' && (value.fromStage !== 'on_hold' || value.stage === 'on_hold')) return null;
  return {
    id: request.id, actorId: request.actorId, claimId: request.claimId, claimType: request.claimType,
    revision: request.revision, decision: request.decision, note: request.note, orderId: value.orderId,
    fromStage: value.fromStage, stage: value.stage, resultRevision: value.resultRevision, createdAt: value.createdAt,
  };
}

export function claimHoldReceiptMatches(receipt: ClaimHoldReceipt, request: ClaimHoldRequest): boolean {
  return receipt.id === request.id && receipt.actorId === request.actorId && receipt.claimId === request.claimId
    && receipt.claimType === request.claimType && receipt.revision === request.revision
    && receipt.decision === request.decision && receipt.note === request.note;
}

export function claimHoldError(code?: string, message?: string): string {
  if (code === '42501') return CLAIM_CHANGE_PERMISSION_MESSAGE;
  if (code === 'PT409') return CLAIM_CHANGE_CONFLICT_MESSAGE;
  const messages: Record<string, string> = {
    claim_not_found: CLAIM_CHANGE_NOT_FOUND_MESSAGE,
    invalid_claim_hold: '보류할 내용이 올바르지 않습니다. 창을 닫고 다시 열어 주세요.',
    'invalid hold reason': CLAIM_HOLD_NOTE_ERROR,
    claim_hold_unavailable: '끝난 요청은 보류하거나 보류를 풀 수 없습니다.',
    claim_already_held: '이미 보류 중입니다. 창을 닫고 지금 상태를 다시 확인해 주세요.',
    claim_not_held: '보류 중인 요청이 아닙니다. 창을 닫고 지금 상태를 다시 확인해 주세요.',
    claim_hold_version_required: '창을 닫고 다시 열어 지금 상태를 확인해 주세요.',
    claim_hold_request_conflict: CLAIM_CHANGE_REQUEST_MISMATCH_MESSAGE,
  };
  return messages[message ?? ''] ?? CLAIM_CHANGE_UNKNOWN_MESSAGE;
}

/** 보류 설정·해제 창의 이름과 버튼. 진입 버튼·창 제목은 옛 이름 그대로이고(화면·가이드가 인용한다), 확인하는 버튼만 하는 일로 부른다. */
export const CLAIM_HOLD_LABELS: Record<ClaimHoldDecision, { title: string; action: string }> = {
  hold: { title: '보류 설정', action: '보류하기' },
  resume: { title: '보류 해제', action: '보류 풀기' },
};

/**
 * 보류하기·보류 풀기를 누르면 뜨는 확인창 문구. 고객 알림과 멈추는 일을 말한다.
 * `stageLabel`은 지금 단계, `resumeLabel`은 보류를 풀면 돌아가는 단계(보류를 풀 때만 쓴다)로 화면이 쓰는 이름이다.
 * 보류 사유는 알림 본문에 그대로 담긴다(`private.decide_order_claim`). 선물 주문은 사유 없이 상태가 바뀌었다는 알림만 간다(`private.notify_order_claim`).
 */
export function claimHoldConfirmMessage(input: { decision: ClaimHoldDecision; typeLabel: string; stageLabel: string; resumeLabel: string; note: string | null }): string {
  if (input.decision === 'resume') {
    return [
      `${input.typeLabel} 요청의 보류를 풉니다. 보류 전 단계(${input.resumeLabel})로 돌아갑니다.`,
      '고객에게 처리가 다시 시작됐다는 앱 알림이 갑니다. 선물 주문은 상태가 바뀌었다는 알림만 갑니다.',
    ].join('\n');
  }
  return [
    `${input.typeLabel} 요청을 보류합니다. (지금 단계: ${input.stageLabel})`,
    `고객에게 보일 보류 사유: ${input.note ?? ''}`,
    '이 사유를 넣은 앱 알림이 고객에게 바로 갑니다. 선물 주문은 사유 없이 상태가 바뀌었다는 알림만 갑니다.',
    '보류를 풀 때까지 승인·회수 확인·환불 같은 다음 단계 처리를 할 수 없습니다.',
  ].join('\n');
}
