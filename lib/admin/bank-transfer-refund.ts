import { isUuid } from '@/lib/uuid';
import { transactionExactKeys, transactionInstant, transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';
import { normalizeClaimRefundAccountIdentity, type ClaimRefundAccountIdentity } from '@/lib/orders/claim-refund-account';
import { isOrderClaimStage, type OrderClaimStage } from '@/lib/orders/claims';
import { parseReturnFeeDeduction, type ReturnFeeDeduction } from '@/lib/claims/return-fee-deduction';
import { formatOrderDateTime } from '@/lib/orders';
import { krwAmountWords } from '@/lib/format';
import type { AdminConfirmRequest } from './confirm';
import { SAVE_CHECK_LABEL, SAVE_STOP_LABEL, SAVE_UNKNOWN_MESSAGE } from './goods-template-save';

export type BankRefundIdentity = ClaimRefundAccountIdentity;
export const BANK_REFUND_KINDS = ['confirm_cancellation', 'file_transfer', 'complete_transfer'] as const;
export type BankRefundKind = typeof BANK_REFUND_KINDS[number];
export const BANK_REFUND_LABELS: Record<BankRefundKind, string> = {
  confirm_cancellation: '취소 확정 · 재고 복원', file_transfer: '환불 접수 기록', complete_transfer: '송금 완료 기록',
};
/** 결과를 모를 때 화면이 아직 보낸 내용을 들고 있으면 누르는 버튼. 같은 번호로 다시 보내 두 번 저장되지 않는다. */
export const BANK_REFUND_RESEND_LABEL = '같은 내용으로 다시 저장';
/** 결과를 모르는 기록을 그만두는 버튼(화면이 보낸 내용을 잃었을 때). 그만둔 기록은 뒤늦게도 저장되지 않는다. */
export const BANK_REFUND_ABANDON_LABEL = SAVE_STOP_LABEL;
export const BANK_REFUND_RELOAD_LABEL = '최신 환불 상태 확인';
export const BANK_REFUND_CUSTOM_TIME_LABEL = '다른 시각 적기';
export const BANK_REFUND_VIEW_ACCOUNT_LABEL = '계좌번호 전체 보기';
/** 최신 상태·계좌를 읽지 못했을 때(저장과 무관한 읽기 실패). */
export const BANK_REFUND_LOAD_FAILED = `최신 환불 상태를 불러오지 못했습니다. [${BANK_REFUND_RELOAD_LABEL}]을 눌러 다시 불러와주세요.`;
export const BANK_REFUND_ACCOUNT_FAILED = `환불계좌를 불러오지 못했습니다. 잠시 뒤 [${BANK_REFUND_VIEW_ACCOUNT_LABEL}]를 다시 눌러주세요.`;
/**
 * 단계마다 적는 칸의 이름·예시 글·기록이 남는 곳. DB(admin_record_bank_transfer_refund)가 세 단계 모두 시각·근거·메모(2~300자)를 받는다.
 * 근거(p_evidence)는 송금 기록에만 남고 화면에 다시 나오지 않는다. 메모(p_note)는 접수·완료 단계에서 환불 기록의 메모로 요청 상세에 보인다.
 */
export const BANK_REFUND_FIELDS: Record<BankRefundKind, { time: string; evidence: string; evidenceExample: string; note: string; noteExample: string; kept: string; missing: string }> = {
  confirm_cancellation: {
    time: '취소 확정 시각 (KST)', evidence: '취소 확정 근거', evidenceExample: '예: 11/26 고객 전화 확인', note: '메모', noteExample: '예: 특이사항 없음',
    kept: '근거와 메모는 기록으로만 남고 화면에 다시 보이지 않습니다.', missing: '취소 확정 근거와 메모를 2자 이상 적어 주세요.',
  },
  file_transfer: {
    time: '접수 시각 (KST)', evidence: '접수 근거', evidenceExample: '예: 등록된 환불계좌와 금액 확인', note: '환불 메모', noteExample: '예: 11/27 오전 송금 예정',
    kept: '환불 메모는 요청 상세의 환불 기록에 보입니다. 접수 근거는 기록으로만 남습니다.', missing: '접수 근거와 환불 메모를 2자 이상 적어 주세요.',
  },
  complete_transfer: {
    time: '송금한 시각 (KST)', evidence: '송금 증빙', evidenceExample: '예: 11/26 14:05 기업뱅킹 이체 완료 화면 확인', note: '환불 메모', noteExample: '예: 특이사항 없음',
    kept: '환불 메모는 요청 상세의 환불 기록에 보이고 접수 때 적은 메모를 대신합니다. 송금 증빙은 기록으로만 남습니다.', missing: '송금 증빙과 환불 메모를 2자 이상 적어 주세요.',
  },
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
  /** 반품배송비 차감(ADR-0031). 송금액은 refundAmount다(amount는 주문 금액 그대로 — 요청의 대조 값). 없으면 지금 그대로 전액. */
  refundDeduction?: ReturnFeeDeduction;
  /**
   * 앞선 재고 부족 부분 취소(ADR-0032)가 있을 때만 실린다. refundedAmount는 부분 취소로 이미 돌려준 금액,
   * refundAmount는 송금 원장에 들어갈 금액(결제액 − 부분 취소 환불 − 반품배송비 차감)이다. 0원이면 송금 없이 닫힌다.
   */
  partialRefund?: BankRefundPartialRefund;
}
export interface BankRefundPartialRefund { refundedAmount: number; refundAmount: number }
/** 이 칸이 실제로 송금할 금액. 차감 결정·부분 취소가 없으면 주문 금액 전액이다. */
export function bankRefundTransferAmount(context: BankRefundContext): number {
  const deduction = context.refundDeduction?.applicable && context.refundDeduction.refundAmount !== null ? context.refundDeduction.refundAmount : null;
  return deduction ?? context.partialRefund?.refundAmount ?? context.amount;
}
/** 앞선 부분 취소가 결제액을 모두 돌려줘 송금할 돈이 없는 취소(송금 없이 환불 0원으로 닫힌다). */
export function bankRefundWithoutTransfer(context: BankRefundContext): boolean {
  return context.partialRefund !== undefined && context.partialRefund.refundAmount === 0;
}
/** 이 단계에서 보일 칸 이름. 돌려줄 잔액이 없는 취소 확정은 그 자리에서 환불 기록까지 닫아, 메모가 환불 기록에 보인다. */
export function bankRefundFields(kind: BankRefundKind, context: BankRefundContext | null): typeof BANK_REFUND_FIELDS[BankRefundKind] {
  const fields = BANK_REFUND_FIELDS[kind];
  return kind === 'confirm_cancellation' && context && bankRefundWithoutTransfer(context)
    ? { ...fields, note: '환불 메모', kept: '환불 메모는 요청 상세의 환불 기록에 보입니다. 취소 확정 근거는 기록으로만 남습니다.', missing: '취소 확정 근거와 환불 메모를 2자 이상 적어 주세요.' }
    : fields;
}
/** 이 단계의 시각이 넘어야 하는 앞 시각(결제·요청, 송금 완료는 앞 단계 기록까지). */
export function bankRefundNotBefore(context: BankRefundContext, kind: BankRefundKind): string | null {
  return kind === 'complete_transfer' ? context.transferNotBefore : context.confirmationNotBefore;
}
/**
 * 기록할 시각(ISO). custom이 null이면 누른 시각(now)이다. 직접 적은 시각은 분 단위라, 앞 단계와 같은 분이면 앞 단계 바로 뒤로 맞춘다
 * — 초 차이로 거절되지 않게 한다. PC 시계가 늦어 누른 시각이 앞 단계보다 이르게 나올 때도 같다. 읽을 수 없는 값이면 null.
 */
export function bankRefundOccurredAt(input: { custom: string | null; now: Date; notBefore: string | null }): string | null {
  const floor = input.notBefore ? Date.parse(input.notBefore) : Number.NaN;
  const earliest = Number.isFinite(floor) ? Math.floor(floor) + 1 : null;
  if (input.custom === null) {
    const pressed = input.now.getTime();
    return new Date(earliest !== null && pressed < earliest ? earliest : pressed).toISOString();
  }
  const chosen = new Date(input.custom).getTime();
  if (!Number.isFinite(chosen)) return null;
  return new Date(earliest !== null && chosen < earliest && chosen + 60_000 > earliest ? earliest : chosen).toISOString();
}
/** datetime-local 칸의 가장 이른 값(브라우저 시간대의 분). 앞 시각이 없으면 undefined. */
export function bankRefundTimeInputMin(notBefore: string | null): string | undefined {
  const at = notBefore ? Date.parse(notBefore) : Number.NaN;
  if (!Number.isFinite(at)) return undefined;
  return new Date(at - new Date(at).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
export interface BankRefundStep { kind: BankRefundKind; label: string; state: 'done' | 'current' | 'waiting'; at: string | null }
/* 목록의 '취소 확정일'·'환불 접수일'과 같은 낱말을 쓴다. */
const STEP_LABELS: Record<BankRefundKind, string> = { confirm_cancellation: '취소 확정', file_transfer: '환불 접수', complete_transfer: '은행에서 송금한 뒤 완료 기록' };
/**
 * 화면에 보이는 순서. 취소는 취소 확정 → 환불 접수 → 송금 완료, 반품은 환불 접수가 먼저다(DB 순서: 반품의 취소 확정은 접수 뒤에만 열린다).
 * 돌려줄 잔액이 없는 취소는 취소 확정 하나로 끝난다.
 */
export function bankRefundSteps(context: BankRefundContext, nextKind: BankRefundKind | null): BankRefundStep[] {
  const completed = context.phase === 'completed';
  const done: Record<BankRefundKind, boolean> = {
    confirm_cancellation: completed || context.phase === 'awaiting_transfer' || context.confirmedAt !== null,
    file_transfer: completed || context.filedAt !== null, complete_transfer: completed,
  };
  const at: Record<BankRefundKind, string | null> = { confirm_cancellation: context.confirmedAt, file_transfer: context.filedAt, complete_transfer: context.transferredAt };
  const order: BankRefundKind[] = bankRefundWithoutTransfer(context) ? ['confirm_cancellation']
    : context.claimType === 'return' ? ['file_transfer', 'confirm_cancellation', 'complete_transfer'] : ['confirm_cancellation', 'file_transfer', 'complete_transfer'];
  return order.map(kind => ({ kind, label: STEP_LABELS[kind], state: done[kind] ? 'done' : kind === nextKind ? 'current' : 'waiting', at: done[kind] ? at[kind] : null }));
}
/** 기록에 성공한 뒤 한 줄. 다음에 누를 버튼을 말한다(취소와 반품은 순서가 다르다). */
export function bankRefundRecordedMessage(kind: BankRefundKind, context: BankRefundContext | null): string {
  const afterTransfer = `은행에서 송금한 뒤 [${BANK_REFUND_LABELS.complete_transfer}]을 남겨주세요.`;
  if (kind === 'complete_transfer') return '송금 완료를 기록했습니다. 환불이 끝났습니다.';
  if (kind === 'confirm_cancellation') {
    if (context && bankRefundWithoutTransfer(context)) return '취소를 확정하고 재고를 복원했습니다. 돌려줄 잔액이 없어 송금 없이 환불을 마쳤습니다.';
    return `취소를 확정하고 재고를 복원했습니다. ${context?.claimType === 'return' ? afterTransfer : `다음은 [${BANK_REFUND_LABELS.file_transfer}]입니다.`}`;
  }
  return `환불 접수를 기록했습니다. ${context?.claimType === 'return' ? `다음은 [${BANK_REFUND_LABELS.confirm_cancellation}]입니다.` : afterTransfer}`;
}
/**
 * 단계 버튼의 확인창. 금액은 화면에 보이는 송금할 금액과 같은 계산(bankRefundTransferAmount)이고, 계좌는 가린 값 그대로다.
 * 체크 칸이 하던 말(재고 복원·고객 알림·되돌릴 수 없음)을 여기서 한 번 말한다.
 */
export function bankRefundConfirm(context: BankRefundContext, kind: BankRefundKind, occurredAt: string): AdminConfirmRequest {
  const amount = bankRefundTransferAmount(context);
  const withoutTransfer = bankRefundWithoutTransfer(context);
  const deduction = context.refundDeduction?.applicable && context.refundDeduction.refundAmount !== null ? context.refundDeduction : null;
  const amountDetail = deduction ? ` (결제 ${krwAmountWords(deduction.paymentAmount ?? context.amount)} − 반품배송비 ${krwAmountWords(deduction.deductionAmount)})`
    : context.partialRefund ? ` (앞선 부분 취소로 ${krwAmountWords(context.partialRefund.refundedAmount)}은 이미 환불)` : '';
  const account = context.maskedAccount ? `받는 계좌: ${context.maskedAccount}${context.maskedHolder ? ` (예금주 ${context.maskedHolder})` : ''}` : null;
  const gift = context.gift ? '선물 주문입니다. 선물 받은 분이 아니라 결제한 분에게 환불합니다.' : null;
  const time = formatOrderDateTime(occurredAt);
  const lines = (...values: (string | null | false)[]) => values.filter((value): value is string => typeof value === 'string').join('\n');
  if (kind === 'confirm_cancellation') {
    return {
      title: '취소를 확정할까요?', confirmLabel: '취소 확정', cancelLabel: '돌아가기', destructive: true,
      message: withoutTransfer
        ? lines(`앞선 부분 취소로 결제 ${krwAmountWords(context.amount)}을 이미 모두 환불했습니다.`, `취소 확정 시각: ${time}`, gift, '',
          '주문이 취소되고 재고가 복원됩니다. 더 보낼 돈이 없어 송금 없이 환불 0원으로 끝납니다. 되돌릴 수 없습니다.')
        : lines(`송금할 금액: ${krwAmountWords(amount)}${amountDetail}`, account, `취소 확정 시각: ${time}`, gift, '',
          '주문이 취소되고 재고가 복원됩니다. 되돌릴 수 없습니다.', '환불금은 아직 보내지 않았으므로 환불 송금 대기에 남습니다.'),
    };
  }
  if (kind === 'file_transfer') {
    return {
      title: '환불 접수를 기록할까요?', confirmLabel: BANK_REFUND_LABELS.file_transfer, cancelLabel: '돌아가기',
      message: lines(`송금할 금액: ${krwAmountWords(amount)}${amountDetail}`, account, gift, '',
        "고객에게 '환불 접수가 완료됐어요' 알림이 갑니다. 돈은 아직 보내지 않습니다.",
        deduction?.source === 'plan' && '반품배송비를 뺀 금액이 지금 정해집니다.',
        context.stage === 'collected' && '접수한 뒤에는 이 요청을 거부할 수 없습니다.'),
    };
  }
  return {
    title: '송금을 마쳤다고 기록할까요?', confirmLabel: BANK_REFUND_LABELS.complete_transfer, cancelLabel: '돌아가기', destructive: true,
    message: lines(`보낸 금액: ${krwAmountWords(amount)}${amountDetail}`, account, `송금한 시각: ${time}`, gift, '',
      '은행에서 송금을 마친 뒤에만 누릅니다. 이 버튼은 돈을 보내지 않고 기록만 남깁니다.',
      "기록하면 환불이 끝나고 고객에게 '환불이 완료됐어요' 알림이 갑니다. 되돌릴 수 없습니다."),
  };
}
function parsePartialRefund(value: unknown): BankRefundPartialRefund | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['refundedAmount', 'refundAmount'])
    || !transactionInteger(value.refundedAmount, 1) || !transactionInteger(value.refundAmount)) return null;
  return { refundedAmount: value.refundedAmount, refundAmount: value.refundAmount };
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
/** notice: 영수증은 성공했지만 따라붙은 불량 재고 기록이 끝나지 않았다는 경고(QNA-035). 영수증 성공은 그대로다. */
export type BankRefundResult = { receipt: BankRefundReceipt | null; notice?: string } | BankRefundFailure;
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
export function parseBankRefundContext(input: unknown): BankRefundContext | null {
  const nullableTimes = ['filedAt', 'confirmedAt', 'transferredAt', 'confirmationNotBefore', 'transferNotBefore'];
  const texts = ['maskedAccount', 'maskedHolder', 'confirmBlocker', 'fileBlocker', 'completeBlocker', 'viewBlocker'];
  /* 반품배송비 차감 필드는 판정·결정이 있을 때만 실린다(스위치 OFF면 없음 — 지금 모양 그대로). 있으면 모양까지 맞아야 한다. */
  if (!transactionRecord(input)) return null;
  const { refundDeduction: rawDeduction, partialRefund: rawPartial, ...value } = input;
  const refundDeduction = rawDeduction === undefined ? undefined : parseReturnFeeDeduction(rawDeduction);
  if (refundDeduction === null) return null;
  /* 부분 취소 필드도 앞선 부분 취소가 있을 때만 실린다(스위치 OFF면 없음). 있으면 모양까지 맞아야 한다. */
  const partialRefund = rawPartial === undefined ? undefined : parsePartialRefund(rawPartial);
  if (partialRefund === null) return null;
  if (!transactionExactKeys(value, ['actorId', 'orderId', 'claimId', 'claimType', 'revision', 'amount', 'stage', 'phase', 'gift', ...nullableTimes, ...texts])
    || !isUuid(value.actorId) || !isUuid(value.orderId) || !isUuid(value.claimId) || !['cancel', 'return', 'exchange'].includes(String(value.claimType))
    || !transactionInteger(value.revision) || !transactionInteger(value.amount) || !isOrderClaimStage(value.stage)
    || !['not_confirmed', 'awaiting_transfer', 'completed'].includes(String(value.phase)) || typeof value.gift !== 'boolean'
    || nullableTimes.some(key => !nullableInstant(value[key])) || texts.some(key => !nullableText(value[key]))) return null;
  return { ...value, ...(refundDeduction ? { refundDeduction } : {}), ...(partialRefund ? { partialRefund } : {}) } as unknown as BankRefundContext;
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
  if (code === '42501' || code === '28000') return { error: '로그인 상태나 결제 처리 권한이 바뀌었습니다. 새로고침해 현재 계정으로 요청을 다시 열어주세요.', authChanged: true };
  if (code === 'PT409') return { error: `화면을 연 뒤에 이 요청의 단계나 금액이 바뀌었습니다. [${BANK_REFUND_RELOAD_LABEL}]을 눌러 바뀐 내용을 본 뒤 다시 적어 주세요.`, conflict: true };
  const errors: Record<string, string> = {
    claim_not_found: '이 주문에서 요청을 찾지 못했습니다. 새로고침해 요청이 그대로 있는지 확인해주세요.',
    invalid_bank_refund_operation: `근거와 메모를 2~300자로 적어 주세요. [${BANK_REFUND_CUSTOM_TIME_LABEL}]로 시각을 적었다면 날짜와 시간을 모두 채워 주세요.`,
    bank_refund_occurred_at_invalid: `기록할 시각이 맞지 않습니다. 결제와 앞 단계(취소 확정·환불 접수)보다 늦고 지금보다 이른 시각이어야 합니다. [${BANK_REFUND_CUSTOM_TIME_LABEL}]를 눌러 시각을 고쳐 주세요.`,
    bank_refund_payment_unavailable: '이 주문의 결제가 무통장 전액 결제 1건으로 확인되지 않아 이 화면에서 처리할 수 없습니다. 주문통합검색에서 결제 내역을 확인해주세요.',
    bank_refund_gift_parties_invalid: '선물 주문의 결제한 분·요청한 분 기록이 맞지 않아 처리할 수 없습니다. 요청 상세의 주문정보에서 선물 정보를 확인해주세요.',
    bank_refund_claim_unavailable: `지금 단계에서는 기록할 수 없습니다. [${BANK_REFUND_RELOAD_LABEL}]을 눌러 단계를 다시 확인해주세요.`,
    bank_refund_ledger_unavailable: '환불 기록(금액·환불 수단)이 이 요청과 맞지 않아 처리할 수 없습니다. 요청 상세의 환불 기록을 확인해주세요.',
    bank_refund_confirmation_required: `먼저 [${BANK_REFUND_LABELS.confirm_cancellation}]을 눌러 취소를 확정해주세요.`,
    bank_refund_filing_required: `먼저 [${BANK_REFUND_LABELS.file_transfer}]을 남겨주세요.`,
    bank_refund_approval_required: '아직 승인하지 않은 요청입니다. 처리 칸에서 요청을 먼저 승인해주세요.',
    bank_refund_already_filed: '환불 접수는 이미 기록했습니다.',
    bank_refund_already_confirmed: '취소는 이미 확정했습니다.',
    bank_refund_evidence_required: `[${BANK_REFUND_LABELS.complete_transfer}]으로 송금 증빙을 먼저 남겨야 환불을 끝낼 수 있습니다.`,
    bank_refund_transfer_pending: `[${BANK_REFUND_LABELS.complete_transfer}]을 남기기 전에는 요청을 끝낼 수 없습니다.`,
    claim_refund_account_missing: '환불계좌가 없습니다. 결제한 분에게 주문 상세(선물 주문은 선물 요청 화면)에서 환불계좌를 등록해 달라고 안내해주세요.',
    claim_collections_incomplete: '모든 출고지의 상품 회수를 확인한 뒤 진행해주세요.',
    order_not_cancelable: '지금 배송 상태에서는 취소를 확정할 수 없습니다. 주문 상세에서 배송 상태를 확인해주세요.',
    bank_refund_request_sealed: `그만두기로 한 기록입니다. [${BANK_REFUND_RELOAD_LABEL}]을 누른 뒤 다시 적어 주세요.`,
    bank_refund_request_conflict: `처음 보낸 내용과 달라 저장하지 않았습니다. [${SAVE_CHECK_LABEL}]으로 처음 보낸 내용이 저장됐는지 먼저 확인해주세요.`,
  };
  if (message && Object.hasOwn(errors, message)) return { error: errors[message], ...(message === 'bank_refund_request_conflict' ? { uncertain: true } : {}) };
  return { error: SAVE_UNKNOWN_MESSAGE, uncertain: true };
}
