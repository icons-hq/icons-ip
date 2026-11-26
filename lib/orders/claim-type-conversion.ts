import { isUuid } from '@/lib/uuid';
import {
  CLAIM_CHANGE_CONFLICT_MESSAGE, CLAIM_CHANGE_NOT_FOUND_MESSAGE, CLAIM_CHANGE_PERMISSION_MESSAGE,
  CLAIM_CHANGE_REQUEST_MISMATCH_MESSAGE, CLAIM_CHANGE_UNKNOWN_MESSAGE,
} from '@/lib/admin/claim-change-copy';
import { CHANGED_BY_OTHER } from '@/lib/admin/goods-template-save';
import { isOrderClaimStage, isOrderClaimType, normalizeRefundAccount, ORDER_CLAIM_TYPE_LABELS, type OrderClaimStage, type OrderClaimType, type RefundAccountInput } from './claims';
export type ConvertibleClaimType = 'return' | 'exchange';
export interface ClaimTypeHistory { id: string; claimId: string; fromType: ConvertibleClaimType; toType: ConvertibleClaimType; createdAt: string; agreement?: string }
export interface ClaimTypeContext {
  claimId: string; orderId: string; claimType: OrderClaimType; stage: OrderClaimStage; revision: number; allowed: boolean; blocker: string | null;
  bankRequired: boolean; savedAccount: { account: string; holder: string } | null; history: ClaimTypeHistory[];
}
export interface ClaimTypeRequest { id: string; claimId: string; revision: number; toType: ConvertibleClaimType; agreement: string; confirmed: true; refundAccount: RefundAccountInput | null }
export interface ClaimTypeReceipt extends ClaimTypeHistory { orderId: string; revision: number; stage: OrderClaimStage; agreement: string; accountSupplied: boolean }
export type ClaimTypeResult = { context: ClaimTypeContext } | { receipt: ClaimTypeReceipt | null } | { error: string; uncertain?: boolean; conflict?: boolean };
const object = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const type = (v: unknown): v is ConvertibleClaimType => v === 'return' || v === 'exchange';
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const controls = /[\u0000-\u001f\u007f]/;
export function parseClaimTypeHistory(v: unknown): ClaimTypeHistory[] | null {
  if (!Array.isArray(v)) return null;
  const result: ClaimTypeHistory[] = [];
  for (const row of v) {
    if (!object(row) || !isUuid(row.id) || !isUuid(row.claimId) || !type(row.fromType) || !type(row.toType) || row.fromType === row.toType || !date(row.createdAt)
      || row.agreement !== undefined && typeof row.agreement !== 'string') return null;
    result.push({ id: row.id, claimId: row.claimId, fromType: row.fromType, toType: row.toType, createdAt: row.createdAt, ...(row.agreement === undefined ? {} : { agreement: row.agreement }) });
  }
  return result;
}
export function parseClaimTypeContext(v: unknown): ClaimTypeContext | null {
  if (!object(v) || !isUuid(v.claimId) || !isUuid(v.orderId) || !isOrderClaimType(v.claimType) || !isOrderClaimStage(v.stage) || !integer(v.revision)
    || typeof v.allowed !== 'boolean' || v.blocker !== null && typeof v.blocker !== 'string' || typeof v.bankRequired !== 'boolean') return null;
  if (v.savedAccount !== null && (!object(v.savedAccount) || typeof v.savedAccount.account !== 'string' || typeof v.savedAccount.holder !== 'string')) return null;
  const history = parseClaimTypeHistory(v.history); if (!history || history.some(row => row.claimId !== v.claimId)) return null;
  return { claimId: v.claimId, orderId: v.orderId, claimType: v.claimType, stage: v.stage, revision: v.revision, allowed: v.allowed, blocker: v.blocker as string | null,
    bankRequired: v.bankRequired, savedAccount: v.savedAccount === null ? null : { account: String(v.savedAccount.account), holder: String(v.savedAccount.holder) }, history };
}
export function parseClaimTypeReceipt(v: unknown): ClaimTypeReceipt | null {
  const history = parseClaimTypeHistory([v]);
  if (!history || !object(v) || !isUuid(v.orderId) || !integer(v.revision) || !isOrderClaimStage(v.stage) || typeof v.agreement !== 'string' || typeof v.accountSupplied !== 'boolean') return null;
  return { ...history[0], orderId: v.orderId, revision: v.revision, stage: v.stage, agreement: v.agreement, accountSupplied: v.accountSupplied };
}
/** 고객 합의 근거 글자 수. DB(`admin_convert_order_claim_type`)가 같은 범위를 요구하고, 화면 칸의 제한도 이 값이다. */
export const CLAIM_TYPE_AGREEMENT_MIN = 2;
export const CLAIM_TYPE_AGREEMENT_MAX = 500;
export const CLAIM_TYPE_AGREEMENT_ERROR = `고객 합의 근거를 ${CLAIM_TYPE_AGREEMENT_MIN}~${CLAIM_TYPE_AGREEMENT_MAX}자로 적어 주세요. 줄바꿈은 넣을 수 없습니다.`;
/** 고객 합의 근거(2~500자, 제어문자 없음). 단건 전환과 목록 일괄 전환이 같은 규칙을 쓴다. */
export function normalizeClaimTypeAgreement(v: unknown): string | null {
  if (typeof v !== 'string' || controls.test(v)) return null;
  const agreement = v.trim();
  return agreement.length >= CLAIM_TYPE_AGREEMENT_MIN && agreement.length <= CLAIM_TYPE_AGREEMENT_MAX ? agreement : null;
}
/** 입력이 요청으로 만들어지지 않을 때 어느 칸이 왜 안 되는지. 요청이 만들어지는 입력이면 null. */
export function claimTypeInputError(input: { agreement: string; toType: ConvertibleClaimType; bankName: string; accountNumber: string; accountHolder: string }): string | null {
  if (normalizeClaimTypeAgreement(input.agreement) === null) return CLAIM_TYPE_AGREEMENT_ERROR;
  if (input.toType !== 'return') return null;
  const account = normalizeRefundAccount({ bankName: input.bankName, accountNumber: input.accountNumber, accountHolder: input.accountHolder });
  if (!account.ok) return account.error;
  return account.value && Object.values(account.value).some(value => controls.test(value)) ? '환불계좌에는 줄바꿈을 넣을 수 없습니다.' : null;
}
export function normalizeClaimTypeRequest(v: unknown): ClaimTypeRequest | null {
  const agreement = object(v) ? normalizeClaimTypeAgreement(v.agreement) : null;
  if (!object(v) || Object.keys(v).some(key => !['id','claimId','revision','toType','agreement','confirmed','refundAccount'].includes(key))
    || !isUuid(v.id) || !isUuid(v.claimId) || !integer(v.revision) || !type(v.toType) || v.confirmed !== true || agreement === null) return null;
  if (v.refundAccount !== null && (!object(v.refundAccount) || Object.keys(v.refundAccount).some(key => !['bankName','accountNumber','accountHolder'].includes(key))
    || !['bankName','accountNumber','accountHolder'].every(key => typeof v.refundAccount === 'object' && v.refundAccount !== null && typeof (v.refundAccount as Record<string, unknown>)[key] === 'string'))) return null;
  const account = normalizeRefundAccount(v.refundAccount === null ? {} : {
    bankName: String(v.refundAccount.bankName), accountNumber: String(v.refundAccount.accountNumber), accountHolder: String(v.refundAccount.accountHolder),
  });
  if (!account.ok || account.value && (v.toType !== 'return' || Object.values(account.value).some(value => controls.test(value)))) return null;
  return { id: v.id.toLowerCase(), claimId: v.claimId.toLowerCase(), revision: v.revision, toType: v.toType, agreement, confirmed: true, refundAccount: account.value };
}
export function claimTypeReceiptMatches(receipt: ClaimTypeReceipt, request: ClaimTypeRequest) {
  return receipt.id === request.id && receipt.claimId === request.claimId && receipt.revision === request.revision && receipt.toType === request.toType
    && receipt.agreement === request.agreement && receipt.accountSupplied === Boolean(request.refundAccount);
}
export function claimTypeError(code?: string, message?: string): string {
  if (code === '42501') return CLAIM_CHANGE_PERMISSION_MESSAGE;
  if (code === 'PT409') return CLAIM_CHANGE_CONFLICT_MESSAGE;
  const known: Record<string, string> = {
    claim_not_found: CLAIM_CHANGE_NOT_FOUND_MESSAGE,
    invalid_claim_conversion: CLAIM_TYPE_AGREEMENT_ERROR,
    invalid_claim_conversion_account: '환불계좌의 은행, 계좌번호, 예금주를 확인해 주세요. 계좌번호는 숫자와 하이픈(-)으로 8~30자입니다.',
    claim_conversion_account_required: '무통장 주문을 반품으로 바꾸려면 환불계좌가 필요합니다.',
    claim_conversion_same_type: '이미 같은 유형입니다. 창을 닫고 지금 상태를 다시 확인해 주세요.',
    claim_conversion_type_unavailable: '반품과 교환 요청만 서로 바꿀 수 있습니다.',
    claim_conversion_partial_return: '일부 상품만 반품하는 요청은 교환으로 바꿀 수 없습니다.',
    claim_conversion_stage_unavailable: '환불이나 재출고를 시작했거나 끝난 요청은 유형을 바꿀 수 없습니다.',
    claim_conversion_reshipped: '교환품을 이미 재출고해서 반품으로 바꿀 수 없습니다.',
    claim_conversion_finance_started: '결제 취소나 환불 처리가 이미 시작돼서 유형을 바꿀 수 없습니다.',
    digital_exchange_unavailable: '디지털 파일이 있는 주문은 교환으로 바꿀 수 없습니다. 디지털 파일은 교환하지 않습니다.',
    claim_conversion_request_conflict: CLAIM_CHANGE_REQUEST_MISMATCH_MESSAGE,
  };
  return known[message ?? ''] ?? CLAIM_CHANGE_UNKNOWN_MESSAGE;
}
/** DB가 전환을 거절했다고 확정해 준 오류 코드. 그 밖의 오류는 저장됐는지 알 수 없다. */
export const CLAIM_TYPE_DEFINITE_ERROR_CODES: readonly string[] = ['PT409', '42501', '22023', '23514', 'P0002'];
/** 목록 일괄 전환 결과표의 사유. 입력을 들고 있는 상세 전환 창과 달리 다음 행동을 목록 기준으로 적는다. */
export function claimTypeBulkError(code?: string, message?: string): string {
  if (code === 'PT409') return `${CHANGED_BY_OTHER} 목록을 새로고침한 뒤 다시 실행해 주세요.`;
  if (message === 'claim_conversion_account_required') return `${claimTypeError(undefined, message)} 요청번호를 눌러 상세에서 입력해 주세요.`;
  return CLAIM_TYPE_DEFINITE_ERROR_CODES.includes(code ?? '') ? claimTypeError(code, message) : '저장됐는지 확인하지 못했습니다. 요청번호를 눌러 지금 유형을 확인해 주세요.';
}

/**
 * 반품 ↔ 교환 전환 확인창 문구. 전환하면 무엇이 그대로이고 무엇이 달라지는지를 말한다(`admin_convert_order_claim_type`과 그 트리거 기준).
 * - 접수일·회수 기록은 그대로다. 다만 회수 생략을 결정한 출고지는 유형에 따라 효력이 달라져 단계가 바뀔 수 있다(`reopen_ineffective_collection_waivers`·`sync_claim_collection_completion`).
 * - 이 요청의 배송비 청구는 취소되고 입금 확인된 청구는 돌려줄 금액이 된다(`invalidate_claim_fee_basis`).
 * - 저장해 둔 품목별 재고 처리는 어느 쪽으로 바꾸든 지워진다(반품의 불량 선택·교환 출고지의 회수품 재고 처리).
 * - 주문제작 상품의 교환품 제작은 교환으로 가면 입고 확인 뒤 열리고, 반품으로 가면 취소된다(`production_claim_changed`).
 * - 교환으로 가면 저장된 환불계좌는 30일 뒤 지워진다. 그 전에 반품으로 돌아오면 계속 쓴다(`admin_convert_order_claim_type`).
 * - 고객에게 앱 알림이 간다. 환불·재출고를 시작하기 전에는 다시 바꿀 수 있다(`order_claim_type_change_blocker`).
 * `stageLabel`은 지금 단계의 화면 이름이다.
 */
export function claimTypeConfirmMessage(
  context: Pick<ClaimTypeContext, 'claimType' | 'savedAccount'>,
  request: Pick<ClaimTypeRequest, 'toType' | 'refundAccount'>,
  stageLabel: string,
): string {
  const from = ORDER_CLAIM_TYPE_LABELS[context.claimType]; const to = ORDER_CLAIM_TYPE_LABELS[request.toType];
  const lines = [
    `고객과 합의한 대로 ${from} 요청을 ${to} 요청으로 바꿉니다. (지금 단계: ${stageLabel})`,
    '· 접수일과 회수 기록은 그대로입니다. 다만 회수 생략을 결정한 출고지가 있으면 바뀐 유형에서 그 결정의 효력이 달라져 단계가 바뀔 수 있습니다.',
    request.toType === 'exchange'
      ? '· 환불 대신 교환품 재출고로 마무리합니다. 주문제작 상품은 입고가 확인되면 교환품 제작이 열립니다.'
      : '· 교환품 재출고 대신 환불로 마무리합니다. 환불은 승인·회수 확인 뒤에 따로 처리하고, 열려 있던 교환품 제작은 취소됩니다.',
    '· 이 요청의 배송비 청구가 있으면 취소됩니다(입금이 확인된 청구는 돌려줄 금액으로 바뀝니다). 필요하면 배송비 청구에서 다시 발행합니다.',
    `· 저장해 둔 품목별 재고 처리(반품의 불량 선택, 교환 출고지의 회수품 재고 처리)가 있으면 지워지니 ${to}에서 다시 고릅니다.`,
  ];
  if (request.toType === 'return') {
    if (request.refundAccount) lines.push('· 환불계좌는 방금 적은 계좌로 저장됩니다.');
    else if (context.savedAccount) lines.push(`· 환불계좌는 저장된 계좌(${context.savedAccount.account} · ${context.savedAccount.holder})를 씁니다.`);
  } else if (context.savedAccount) lines.push('· 저장된 환불계좌는 교환에서 쓰지 않아 30일 뒤 지워집니다. 그 전에 다시 반품으로 바꾸면 계속 씁니다.');
  lines.push('· 고객에게 앱 알림이 갑니다. 환불·재출고를 시작하기 전에는 다시 바꿀 수 있지만, 이미 간 알림과 취소된 배송비 청구는 돌아오지 않습니다.');
  return lines.join('\n');
}
