import { isUuid } from '@/lib/uuid';
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
const noteValid = (value: unknown): value is string => typeof value === 'string'
  && value.length >= 10 && value.length <= 200 && value.trim() === value && !controls.test(value);

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
  if (code === '42501') return '현재 계정과 판매관리 권한을 확인해주세요. 다른 계정에서 연 요청은 다시 열어야 합니다.';
  if (code === 'PT409') return '다른 처리가 먼저 진행됐습니다. 최신 요청의 유형과 상태를 다시 확인해주세요.';
  const messages: Record<string, string> = {
    claim_not_found: '해당 요청을 찾을 수 없습니다.',
    invalid_claim_hold: '요청 유형과 처리 내용을 확인해주세요.',
    'invalid hold reason': '보류 사유를 10자 이상 200자 이하로 입력해주세요.',
    claim_hold_unavailable: '이미 종결된 요청은 보류하거나 보류를 해제할 수 없습니다.',
    claim_already_held: '이미 보류 중입니다. 최신 요청 상태를 확인해주세요.',
    claim_not_held: '보류 상태가 아닙니다. 최신 요청 상태를 확인해주세요.',
    claim_hold_version_required: '보류·해제 화면을 다시 열어 최신 요청을 확인해주세요.',
    claim_hold_request_conflict: '처음 보낸 내용과 다른 요청입니다. 기존 저장 결과를 확인해주세요.',
  };
  return messages[message ?? ''] ?? '저장 결과를 확인하지 못했습니다. 같은 요청의 결과를 확인해주세요.';
}
