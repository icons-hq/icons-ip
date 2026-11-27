import { isUuid } from '@/lib/uuid';
import { transactionExactKeys, transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';
import { CHANGED_BY_OTHER, SAVE_CHECK_LABEL, SAVE_UNKNOWN_MESSAGE, TEMPLATE_DISCARD_INPUT_LABEL, TEMPLATE_SAVE_OVER_LATEST_LABEL } from '@/lib/admin/goods-template-save';

/** 착불 조건의 네 칸. 모두 고객에게 보인다(상품 상세·주문서·주문 메일·출고지시 파일)이고, 주문할 때 주문 기록에 그대로 남는다. */
export const SHIPPING_COLLECT_FIELDS = ['collectorName', 'collectionMethod', 'refundContact', 'customerInstructions'] as const;
/**
 * 예전 화면이 받던 근거 네 칸(계약 근거·출고 표기 근거·증빙 확인 방법·내부 분쟁 담당자). 읽는 주문·정산 처리가 없어 화면에서 걷어 냈다(2026-11-26).
 * 저장된 조건에는 남아 있어 조회 응답에 함께 온다 — 형식만 확인하고 버린다. 저장할 때는 보내지 않고, 저장돼 있던 값은 DB가 그대로 둔다.
 */
const SHIPPING_COLLECT_RETIRED_FIELDS = ['contractReference', 'dispatchMappingReference', 'receiptReference', 'disputeContact'] as const;
export type ShippingCollectValues = Record<typeof SHIPPING_COLLECT_FIELDS[number], string>;
export type ShippingCollectStatus = 'draft' | 'active' | 'disabled';
export interface ShippingCollectDocument { originId: string; revision: number; versionId: string | null; status: ShippingCollectStatus; values: ShippingCollectValues }
export interface ShippingCollectReceipt extends ShippingCollectDocument { operationId: string }
export interface ShippingCollectContext { originId: string; expectedActorId: string }
export interface ShippingCollectRequest extends ShippingCollectContext { expectedRevision: number; operationId: string; status: ShippingCollectStatus; values: ShippingCollectValues }
export interface ShippingCollectPending { version: 1; sessionId: string; originId: string; operationId: string }
export type ShippingCollectResult<T> = { ok: true; value: T } | { ok: false; error: string; uncertain?: boolean; conflict?: boolean; committed?: ShippingCollectReceipt; latest?: ShippingCollectDocument };
export const SHIPPING_COLLECT_LABELS: Record<typeof SHIPPING_COLLECT_FIELDS[number], string> = {
  collectorName: '수납 주체', collectionMethod: '수납 방법', refundContact: '환불 문의처', customerInstructions: '고객 안내',
};
/** 칸마다 넣을 값의 예. */
export const SHIPPING_COLLECT_EXAMPLES: Record<typeof SHIPPING_COLLECT_FIELDS[number], string> = {
  collectorName: '예: 한진택배 배송 기사', collectionMethod: '예: 받을 때 기사에게 현금 또는 계좌이체',
  refundContact: '예: 고객센터 1588-0000', customerInstructions: '예: 착불 배송비는 상품을 받을 때 냅니다.',
};
/** 칸의 최대 글자 수(DB 검사와 같다). */
export const shippingCollectFieldLimit = (key: typeof SHIPPING_COLLECT_FIELDS[number]) => key === 'collectorName' ? 100 : key === 'customerInstructions' ? 500 : 200;
/** 착불 조건의 상태 이름. 아직 켜지 않은 조건(draft)도 고객 주문에는 쓰이지 않으므로 '사용 안 함'이다. */
export const shippingCollectStatusLabel = (status: ShippingCollectStatus) => status === 'active' ? '사용' : '사용 안 함';
/** '사용'으로 저장하려는데 비어 있는 칸의 이름. */
export function shippingCollectMissingLabels(values: ShippingCollectValues): string[] {
  return SHIPPING_COLLECT_FIELDS.filter(key => !values[key].trim()).map(key => SHIPPING_COLLECT_LABELS[key]);
}
/** 화면이 저장 전에 말하는 필수 안내. */
export const shippingCollectRequiredMessage = (missing: readonly string[]) => `'사용'으로 저장하려면 ${missing.join(' · ')} 칸을 적어 주세요. 네 칸 모두 고객에게 보입니다.`;
export const SHIPPING_COLLECT_INVALID_MESSAGE = '칸 앞뒤의 빈칸과 줄바꿈을 지워 주세요. 수납 주체는 100자, 고객 안내는 500자, 나머지 칸은 200자까지 적을 수 있습니다.';
/** 저장 결과를 모를 때. 버튼 이름은 화면에 적힌 그대로다. */
export const SHIPPING_COLLECT_UNKNOWN_MESSAGE = SAVE_UNKNOWN_MESSAGE;
/**
 * 쇼핑몰 주문 설정이 꺼져 있으면 착불 주문을 받을 수 없다(상품에서 착불을 켜는 저장이 거절되고, 주문서에 착불이 없다).
 * 그 설정을 켜는 어드민 화면은 없고 개발 담당자가 켠다.
 */
export const SHIPPING_COLLECT_RUNTIME_OFF = '지금 쇼핑몰 설정에서는 착불을 쓸 수 없습니다. 써야 하면 개발 담당자에게 요청해 주세요.';
/** 착불을 끌 때의 확인창. 끄면 주문이 막히는 상품이 있어 저장 전에 묻는다. */
export const SHIPPING_COLLECT_OFF_CONFIRM = {
  title: '착불을 사용 안 함으로 바꿀까요?',
  message: "저장하면 이 출고지 상품 가운데 배송비 결제 방법이 '착불'인 상품은 새 주문이 막히고, '구매자 선택'인 상품은 선결제만 됩니다. 이미 들어온 착불 주문은 그대로입니다.",
  confirmLabel: '사용 안 함으로 저장',
  cancelLabel: '돌아가기',
} as const;

export function validShippingCollectContext(value: unknown): value is ShippingCollectContext {
  return transactionRecord(value) && typeof value.originId === 'string' && isUuid(value.originId)
    && typeof value.expectedActorId === 'string' && isUuid(value.expectedActorId);
}
const validText = (value: unknown, limit: number): value is string => typeof value === 'string' && value === value.trim()
  && !/[\u0000-\u001f\u007f]/.test(value) && [...value].length <= limit;
/** 저장 요청의 값: 정확히 네 칸. '사용'이면 네 칸 모두 채워야 한다. */
export function parseShippingCollectValues(value: unknown, status: ShippingCollectStatus): ShippingCollectValues | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, SHIPPING_COLLECT_FIELDS)) return null;
  if (SHIPPING_COLLECT_FIELDS.some(key => !validText(value[key], shippingCollectFieldLimit(key)) || status === 'active' && !value[key])) return null;
  return Object.fromEntries(SHIPPING_COLLECT_FIELDS.map(key => [key, value[key]])) as ShippingCollectValues;
}
/** 저장된 조건의 값: 네 칸에 예전 근거 칸이 함께 올 수 있다. 근거 칸은 형식만 보고 버린다. */
function parseStoredShippingCollectValues(value: unknown, status: ShippingCollectStatus): ShippingCollectValues | null {
  if (!transactionRecord(value)) return null;
  const retired = SHIPPING_COLLECT_RETIRED_FIELDS.filter(key => Object.hasOwn(value, key));
  if (retired.some(key => !validText(value[key], 200))) return null;
  return parseShippingCollectValues(Object.fromEntries(Object.entries(value).filter(([key]) => !(retired as readonly string[]).includes(key))), status);
}
export function parseShippingCollectDocument(value: unknown): ShippingCollectDocument | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['originId', 'revision', 'versionId', 'status', 'values'])
    || typeof value.originId !== 'string' || !isUuid(value.originId) || !transactionInteger(value.revision, 0, 2147483647)
    || !['draft', 'active', 'disabled'].includes(String(value.status))
    || (value.versionId !== null && (typeof value.versionId !== 'string' || !isUuid(value.versionId)))
    || (value.revision === 0) !== (value.versionId === null) || value.revision === 0 && value.status !== 'disabled') return null;
  const status = value.status as ShippingCollectStatus, values = parseStoredShippingCollectValues(value.values, status);
  return values ? { originId: value.originId.toLowerCase(), revision: value.revision, versionId: value.versionId as string | null, status, values } : null;
}
export function parseShippingCollectRequest(value: unknown): ShippingCollectRequest | null {
  if (!validShippingCollectContext(value) || !transactionRecord(value)
    || !transactionExactKeys(value, ['originId', 'expectedActorId', 'expectedRevision', 'operationId', 'status', 'values'])
    || !transactionInteger(value.expectedRevision, 0, 2147483646) || typeof value.operationId !== 'string' || !isUuid(value.operationId)
    || !['draft', 'active', 'disabled'].includes(String(value.status))) return null;
  const status = value.status as ShippingCollectStatus, values = parseShippingCollectValues(value.values, status);
  return values ? { originId: value.originId.toLowerCase(), expectedActorId: value.expectedActorId.toLowerCase(), expectedRevision: value.expectedRevision, operationId: value.operationId.toLowerCase(), status, values } : null;
}
export function parseShippingCollectReceipt(value: unknown): ShippingCollectReceipt | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['originId', 'revision', 'versionId', 'status', 'values', 'operationId'])
    || typeof value.operationId !== 'string' || !isUuid(value.operationId)) return null;
  const document = parseShippingCollectDocument(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'operationId')));
  return document && document.revision > 0 ? { ...document, operationId: value.operationId.toLowerCase() } : null;
}
export function sameShippingCollectValues(a: ShippingCollectValues, b: ShippingCollectValues): boolean { return SHIPPING_COLLECT_FIELDS.every(key => a[key] === b[key]); }
export function sameShippingCollectDocument(a: ShippingCollectDocument, b: ShippingCollectDocument): boolean {
  return a.originId === b.originId && a.revision === b.revision && a.versionId === b.versionId && a.status === b.status && sameShippingCollectValues(a.values, b.values);
}
export function shippingCollectReceiptMatches(receipt: ShippingCollectReceipt, request: ShippingCollectRequest): boolean {
  return receipt.originId === request.originId && receipt.operationId === request.operationId && receipt.revision === request.expectedRevision + 1
    && receipt.status === request.status && sameShippingCollectValues(receipt.values, request.values);
}
/** 브라우저에는 저장됐는지 확인할 번호만 남긴다. 연락처·안내 글은 남기지 않는다. */
export function parseShippingCollectPending(value: unknown): ShippingCollectPending | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['version', 'sessionId', 'originId', 'operationId']) || value.version !== 1
    || ['sessionId', 'originId', 'operationId'].some(key => typeof value[key] !== 'string' || !isUuid(value[key]))) return null;
  return value as unknown as ShippingCollectPending;
}
export function shippingCollectError(message?: string): string {
  const errors: Record<string, string> = {
    collect_contract_changed: `${CHANGED_BY_OTHER} 적은 내용은 그대로 있습니다. 아래에서 지금 저장된 내용과 비교한 뒤 [${TEMPLATE_SAVE_OVER_LATEST_LABEL}]나 [${TEMPLATE_DISCARD_INPUT_LABEL}]를 골라 주세요.`,
    invalid_collect_contract: `'사용'으로 저장하려면 ${SHIPPING_COLLECT_FIELDS.map(key => SHIPPING_COLLECT_LABELS[key]).join(' · ')} 칸을 모두 적어 주세요. 칸 앞뒤의 빈칸과 줄바꿈은 지워 주세요.`,
    fulfillment_origin_not_found: "사용 안 함인 출고지에는 착불 조건을 저장할 수 없습니다. 위에서 출고지의 '사용 여부'를 사용으로 바꿔 저장한 뒤 다시 눌러 주세요.",
    auth_context_changed: '로그인한 계정이 바뀌었습니다. 이 화면을 새로고침한 뒤 다시 저장해 주세요.',
    operation_conflict: `앞서 누른 저장과 내용이 달라 이어서 저장하지 못했습니다. [${SAVE_CHECK_LABEL}]을 눌러 앞서 누른 저장이 됐는지 먼저 확인해 주세요.`,
    operator_capability_required: '착불 조건은 최고 관리자만 바꿀 수 있습니다. 최고 관리자 계정으로 로그인한 뒤 다시 저장해 주세요.',
  };
  return Object.entries(errors).find(([code]) => message?.includes(code))?.[1] ?? '착불 조건을 저장하지 못했습니다. 적은 내용은 그대로 있습니다. 잠시 뒤 다시 저장해 주세요.';
}
