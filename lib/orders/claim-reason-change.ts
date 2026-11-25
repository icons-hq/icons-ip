import { isUuid } from '@/lib/uuid';
import { isOrderWithdrawalReasonType, type OrderWithdrawalReasonType } from '@/lib/orders';
import { isOrderClaimStage, isOrderClaimType, type OrderClaimStage, type OrderClaimType } from './claims';
import { krwAmountWords } from '@/lib/format';

export interface ClaimReasonHistory {
  id: string; claimId: string; fromReasonType: OrderWithdrawalReasonType; fromReason: string;
  toReasonType: OrderWithdrawalReasonType; toReason: string; requestedAt: string; createdAt: string;
}
export interface ClaimReasonStaffHistory extends ClaimReasonHistory { actorId: string; agreement: string }
/**
 * 반품의 반품배송비 차감(ADR-0031·0047, CLM-029). 차감은 지금 사유로 다시 계산된다 — 하자·오배송이면 0원이다.
 * deductionAmount: 지금 사유로 정한 차감액(환불 접수 전). 정정할 수 없거나 부분 반품 계산이 막히면 null.
 */
export interface ClaimReasonReturnFee {
  enabled: boolean; oneWayAmount: number | null; partialReturn: boolean; deductionAmount: number | null; feeInvoiceOpen: boolean;
}
export interface ClaimReasonContext {
  actorId: string; claimId: string; orderId: string; claimType: OrderClaimType; stage: OrderClaimStage; revision: number;
  reasonType: OrderWithdrawalReasonType; reason: string; originalReasonType: OrderWithdrawalReasonType; originalReason: string;
  requestedAt: string; deliveredAt: string | null; allowed: boolean; blocker: string | null;
  canUseChangeOfMind: boolean; canUseDefect: boolean;
  fee: { kind: 'return_shipping' | 'exchange_shipping' | 'other'; amount: number; note: string; confirmedAt: string } | null;
  /** 반품만. 교환·이 기능 전 응답은 null. */
  returnFee: ClaimReasonReturnFee | null;
  history: ClaimReasonStaffHistory[];
}
export interface ClaimReasonRequest {
  id: string; actorId: string; claimId: string; revision: number; reasonType: OrderWithdrawalReasonType;
  reason: string; agreement: string; confirmed: true; feeReviewed: boolean;
}
export interface ClaimReasonReceipt extends ClaimReasonStaffHistory {
  orderId: string; revision: number; resultRevision: number; feeReviewed: boolean; changed: boolean; stage: OrderClaimStage;
  /** 정정한 요청의 유형. 이 기능 전 영수증은 null(그때는 교환만 정정했다). */
  claimType: OrderClaimType | null;
  /** 반품의 반품배송비 차감액 정정 전후. 교환이거나 계산할 수 없으면 null. */
  fromReturnFeeDeduction: number | null; toReturnFeeDeduction: number | null;
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
  let returnFee: ClaimReasonReturnFee | null = null;
  if (value.returnFee !== undefined && value.returnFee !== null) {
    const raw = value.returnFee;
    if (!object(raw) || typeof raw.enabled !== 'boolean' || typeof raw.partialReturn !== 'boolean' || typeof raw.feeInvoiceOpen !== 'boolean'
      || raw.oneWayAmount !== null && !integer(raw.oneWayAmount) || raw.deductionAmount !== null && !integer(raw.deductionAmount)
      || value.claimType !== 'return') return null;
    returnFee = { enabled: raw.enabled, oneWayAmount: raw.oneWayAmount as number | null, partialReturn: raw.partialReturn,
      deductionAmount: raw.deductionAmount as number | null, feeInvoiceOpen: raw.feeInvoiceOpen };
  }
  return { actorId: value.actorId, claimId: value.claimId, orderId: value.orderId, claimType: value.claimType, stage: value.stage,
    revision: value.revision, reasonType: value.reasonType, reason: value.reason, originalReasonType: value.originalReasonType, originalReason: value.originalReason,
    requestedAt: value.requestedAt, deliveredAt: value.deliveredAt as string | null, allowed: value.allowed, blocker: value.blocker as string | null,
    canUseChangeOfMind: value.canUseChangeOfMind, canUseDefect: value.canUseDefect, fee, returnFee, history: staffHistory };
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
  const claimType = value.claimType === undefined || value.claimType === null ? null : isOrderClaimType(value.claimType) ? value.claimType : undefined;
  const fromFee = value.fromReturnFeeDeduction ?? null; const toFee = value.toReturnFeeDeduction ?? null;
  if (claimType === undefined || fromFee !== null && !integer(fromFee) || toFee !== null && !integer(toFee)) return null;
  return { ...history[0], actorId: value.actorId, orderId: value.orderId, revision: value.revision, resultRevision: value.resultRevision,
    agreement: value.agreement, feeReviewed: value.feeReviewed, changed: value.changed, stage: value.stage,
    claimType, fromReturnFeeDeduction: fromFee as number | null, toReturnFeeDeduction: toFee as number | null };
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
    claim_reason_type_unavailable: '반품·교환 요청의 사유만 정정할 수 있습니다. 취소 요청은 사유를 바꾸지 않습니다.',
    claim_reason_stage_unavailable: '접수·검토·수거중·입고완료 단계(보류 포함)에서만 사유를 정정할 수 있습니다. 반품은 [환불 접수] 전까지 정정합니다.',
    claim_reason_reshipped: '교환품 재출고가 시작되어 사유를 정정할 수 없습니다.',
    claim_reason_finance_started: '환불 접수나 주문 취소·환급 처리가 시작되어 사유를 정정할 수 없습니다. 환불 금액은 접수할 때 정해져 바뀌지 않습니다.',
    claim_reason_fee_review_required: '기존 비용 기록과 정정할 사유의 정합성을 확인해주세요.',
    claim_reason_original_deadline_expired: '원래 접수일을 기준으로 새 사유의 신청 기한을 벗어납니다. 기존 사유를 유지하고 별도로 상담해주세요.',
    claim_reason_request_conflict: '처음 보낸 내용과 다른 요청입니다. 같은 요청의 저장 결과를 확인해주세요.',
  };
  return known[message ?? ''] ?? '저장 결과를 확인하지 못했습니다. 같은 요청의 결과를 확인해주세요.';
}

const REASON_LABELS: Record<OrderWithdrawalReasonType, string> = { change_of_mind: '단순 변심', defect: '상품 하자·오배송' };

/**
 * 반품배송비 안내 한 줄(반품만). 지금 사유로 정한 차감과, 정정하면 어떻게 바뀌는지를 말한다. 교환·정보 없음은 null.
 * 하자·오배송은 언제나 차감하지 않는다. 단순 변심의 금액은 정책(편도, 최초 무료배송 주문은 왕복)·결제 수단에 달려 있어 저장 뒤 다시 계산된다.
 */
export function claimReasonReturnFeeNote(context: Pick<ClaimReasonContext, 'reasonType' | 'returnFee'>): string | null {
  const fee = context.returnFee;
  if (!fee) return null;
  if (!fee.enabled) return '반품배송비 차감 설정이 꺼져 있어 사유와 상관없이 차감하지 않습니다.';
  const current = fee.deductionAmount === null ? '지금 차감 예정액은 환불 접수 때 정해집니다.'
    : fee.deductionAmount > 0 ? `지금 사유로는 환불 금액에서 반품배송비 ${krwAmountWords(fee.deductionAmount)}을 뺍니다.`
      : '지금 사유로는 반품배송비를 빼지 않습니다.';
  const policy = fee.oneWayAmount !== null ? `편도 ${krwAmountWords(fee.oneWayAmount)}, 최초 무료배송 주문은 왕복` : '편도, 최초 무료배송 주문은 왕복';
  return `${current} 하자·오배송으로 정정하면 빼지 않고, 단순 변심으로 정정하면 반품배송비(${policy})를 뺄 수 있습니다. 금액은 저장하면 다시 계산되어 환불 단계에 보입니다.`;
}

/** 정정 확인창 문구. 저장 순간 한 번 묻는다 — 고객 협의·기존 비용 확인·반품배송비 변화·배송비 청구 취소를 함께 말한다. */
export function claimReasonConfirmMessage(context: ClaimReasonContext, input: { reasonType: OrderWithdrawalReasonType; reason: string }): string {
  const lines = [`${REASON_LABELS[context.reasonType]} → ${REASON_LABELS[input.reasonType]}`, `고객에게 보일 설명: ${input.reason.trim()}`];
  if (context.claimType === 'return' && context.returnFee?.enabled && input.reasonType !== context.reasonType) {
    const before = context.returnFee.deductionAmount;
    lines.push(input.reasonType === 'defect'
      ? `반품배송비를 빼지 않습니다${before ? `(지금 차감 예정 ${krwAmountWords(before)} → 0원)` : ''}.`
      : '단순 변심 반품배송비를 환불 금액에서 뺄 수 있습니다. 금액은 저장하면 다시 계산되어 환불 단계와 고객 알림에 보입니다.');
  }
  if (context.returnFee?.feeInvoiceOpen) lines.push('이 요청의 배송비 청구는 사유를 바꾸면 취소됩니다(입금 확인된 청구는 돌려줄 금액으로 바뀝니다). 필요하면 배송비 청구에서 다시 발행합니다.');
  if (context.fee) lines.push(`기존 운영 확인액 ${krwAmountWords(context.fee.amount)}(${context.fee.note})은 바뀌지 않습니다. 새 사유와 맞지 않으면 운영 확인액에서 따로 고칩니다.`);
  lines.push('고객과 확인한 내용으로 저장하고 고객에게 앱 알림을 보냅니다.');
  return lines.join('\n');
}

/** 저장 결과 한 줄. 반품이면 반품배송비 차감 전후를 함께 말한다. */
export function claimReasonSavedMessage(receipt: ClaimReasonReceipt): string {
  const kind = receipt.claimType === 'return' ? '반품' : '교환';
  if (!receipt.changed) return '기존 사유와 설명이 같아 변경하지 않았습니다. 고객 알림을 추가하지 않았습니다.';
  const fee = receipt.claimType === 'return' && receipt.fromReturnFeeDeduction !== null && receipt.toReturnFeeDeduction !== null
    && receipt.fromReturnFeeDeduction !== receipt.toReturnFeeDeduction
    ? ` 반품배송비 차감이 ${krwAmountWords(receipt.fromReturnFeeDeduction)}에서 ${krwAmountWords(receipt.toReturnFeeDeduction)}으로 바뀌었습니다.` : '';
  return `${kind} 사유를 정정하고 고객에게 앱 알림을 남겼습니다.${fee}`;
}
