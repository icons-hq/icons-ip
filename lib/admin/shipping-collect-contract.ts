import { isUuid } from '@/lib/uuid';
import { transactionExactKeys, transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';

export const SHIPPING_COLLECT_FIELDS = ['collectorName', 'collectionMethod', 'refundContact', 'customerInstructions', 'contractReference', 'dispatchMappingReference', 'receiptReference', 'disputeContact'] as const;
export type ShippingCollectValues = Record<typeof SHIPPING_COLLECT_FIELDS[number], string>;
export type ShippingCollectStatus = 'draft' | 'active' | 'disabled';
export interface ShippingCollectDocument { originId: string; revision: number; versionId: string | null; status: ShippingCollectStatus; values: ShippingCollectValues }
export interface ShippingCollectReceipt extends ShippingCollectDocument { operationId: string }
export interface ShippingCollectContext { originId: string; expectedActorId: string }
export interface ShippingCollectRequest extends ShippingCollectContext { expectedRevision: number; operationId: string; status: ShippingCollectStatus; values: ShippingCollectValues }
export interface ShippingCollectPending { version: 1; sessionId: string; originId: string; operationId: string }
export type ShippingCollectResult<T> = { ok: true; value: T } | { ok: false; error: string; uncertain?: boolean; conflict?: boolean; committed?: ShippingCollectReceipt; latest?: ShippingCollectDocument };
export const SHIPPING_COLLECT_LABELS: Record<typeof SHIPPING_COLLECT_FIELDS[number], string> = {
  collectorName: '수납 주체', collectionMethod: '고객 수납 방법', refundContact: '고객 환급 문의처', customerInstructions: '고객 안내 문구',
  contractReference: '착불 수납 계약 근거', dispatchMappingReference: '출고·운송장 착불 표기 근거', receiptReference: '수납·환급 증빙 확인 방법', disputeContact: '내부 분쟁 처리 담당자·연락처',
};
export function validShippingCollectContext(value: unknown): value is ShippingCollectContext {
  return transactionRecord(value) && typeof value.originId === 'string' && isUuid(value.originId)
    && typeof value.expectedActorId === 'string' && isUuid(value.expectedActorId);
}
export function parseShippingCollectValues(value: unknown, status: ShippingCollectStatus): ShippingCollectValues | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, SHIPPING_COLLECT_FIELDS)) return null;
  if (SHIPPING_COLLECT_FIELDS.some(key => typeof value[key] !== 'string' || value[key] !== value[key].trim()
    || /[\u0000-\u001f\u007f]/.test(value[key]) || [...value[key]].length > (key === 'collectorName' ? 100 : key === 'customerInstructions' ? 500 : 200)
    || status === 'active' && !value[key])) return null;
  return Object.fromEntries(SHIPPING_COLLECT_FIELDS.map(key => [key, value[key]])) as ShippingCollectValues;
}
export function parseShippingCollectDocument(value: unknown): ShippingCollectDocument | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['originId', 'revision', 'versionId', 'status', 'values'])
    || typeof value.originId !== 'string' || !isUuid(value.originId) || !transactionInteger(value.revision, 0, 2147483647)
    || !['draft', 'active', 'disabled'].includes(String(value.status))
    || (value.versionId !== null && (typeof value.versionId !== 'string' || !isUuid(value.versionId)))
    || (value.revision === 0) !== (value.versionId === null) || value.revision === 0 && value.status !== 'disabled') return null;
  const status = value.status as ShippingCollectStatus, values = parseShippingCollectValues(value.values, status);
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
/** Browser recovery stores no contact, contract text or business evidence. */
export function parseShippingCollectPending(value: unknown): ShippingCollectPending | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['version', 'sessionId', 'originId', 'operationId']) || value.version !== 1
    || ['sessionId', 'originId', 'operationId'].some(key => typeof value[key] !== 'string' || !isUuid(value[key]))) return null;
  return value as unknown as ShippingCollectPending;
}
export function shippingCollectError(message?: string): string {
  const errors: Record<string, string> = { collect_contract_changed: '다른 사람이 착불 운영 조건을 먼저 바꿨습니다. 입력은 그대로 있으니 [입력과 최신 저장본 비교]에서 확인한 뒤 다시 저장해주세요.',
    invalid_collect_contract: '"실제 운영 근거 확인 · 사용"으로 저장하려면 수납·출고·환급의 실제 운영 조건과 근거 칸을 모두 채워야 합니다.',
    fulfillment_origin_not_found: '출고지를 찾을 수 없거나 사용을 멈춘 출고지입니다. 출고지 목록을 새로고침해 확인해주세요.', auth_context_changed: '로그인 상태가 바뀌었습니다. 현재 계정으로 다시 열어주세요.',
    operator_operation_conflict: '같은 요청 번호로 다른 내용이 이미 처리됐습니다. [이전 저장 결과 확인]으로 원래 요청의 결과를 확인해주세요.', operator_capability_required: '운영 설정을 변경할 권한이 필요합니다.' };
  return Object.entries(errors).find(([code]) => message?.includes(code))?.[1] ?? '착불 운영 조건을 저장하지 못했습니다. 칸마다 글자 수와 필수 입력을 확인하고, 최고 관리자 계정으로 로그인했는지 확인해주세요.';
}
