import { isUuid } from '@/lib/uuid';
import { GOODS_DELIVERY_DRAFT_KEYS, parseGoodsDeliveryQuantityTerms, type GoodsDeliveryPolicy } from '@/lib/goods-delivery-pricing';
import { GOODS_VOLUME_DISCOUNT_DRAFT_KEYS, parseGoodsVolumeDiscountTerms, type GoodsVolumeDiscountPolicy } from '@/lib/goods-volume-discount';
import { GOODS_TRANSACTION_INT_MAX, parseTransactionDraftValues, transactionEpochMicros, transactionExactKeys, transactionGoodId, transactionInstant, transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';
import { parseGoodsTransactionAdminTerms, type GoodsTransactionAdminReceipt, type GoodsTransactionAdminTerms } from '@/lib/goods-transaction';

export type VolumeTermsInput = Omit<GoodsVolumeDiscountPolicy, 'id' | 'goodId' | 'revision'>;
export type DeliveryTermsInput = Omit<GoodsDeliveryPolicy, 'id' | 'goodId' | 'revision'>;
export interface GoodsTermsContext { goodId: string; expectedActorId: string }
export interface GoodsTermsRequest extends GoodsTermsContext {
  expectedRevision: number; expectedGoodUpdatedAt: string; operationId: string;
  volume: VolumeTermsInput | null; delivery: DeliveryTermsInput | null;
}
export type GoodsTermsResult<T> = { ok: true; value: T } | {
  ok: false; error: string; uncertain?: boolean; conflict?: boolean; committed?: GoodsTransactionAdminReceipt; latest?: GoodsTransactionAdminTerms;
};
export interface GoodsTermsDraft {
  volume: { status: VolumeTermsInput['status']; fields: Record<typeof GOODS_VOLUME_DISCOUNT_DRAFT_KEYS[number], string> };
  delivery: { status: DeliveryTermsInput['status']; fields: Record<typeof GOODS_DELIVERY_DRAFT_KEYS[number], string> };
}
export interface GoodsTermsRecovery { version: 1; sessionId: string; base: GoodsTransactionAdminTerms; draft: GoodsTermsDraft; retry: GoodsTermsRequest | null }
const statuses = ['draft', 'active', 'disabled'];
const invalid = (error: string): GoodsTermsResult<never> => ({ ok: false, error });

export function validGoodsTermsContext(value: unknown): value is GoodsTermsContext {
  return transactionRecord(value) && transactionGoodId(value.goodId) && typeof value.expectedActorId === 'string' && isUuid(value.expectedActorId);
}
function volumeInput(value: unknown): VolumeTermsInput | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['status', 'terms', 'draftValues']) || !statuses.includes(String(value.status))) return null;
  const terms = value.terms === null ? null : parseGoodsVolumeDiscountTerms(value.terms);
  const draftValues = parseTransactionDraftValues(value.draftValues, GOODS_VOLUME_DISCOUNT_DRAFT_KEYS);
  return !draftValues || (value.terms !== null && !terms) || (value.status === 'active' && !terms) ? null
    : { status: value.status as VolumeTermsInput['status'], terms, draftValues };
}
function deliveryInput(value: unknown): DeliveryTermsInput | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['status', 'paymentMode', 'quantityTerms', 'draftValues'])
    || !statuses.includes(String(value.status)) || !['prepaid', 'collect', 'buyer_choice'].includes(String(value.paymentMode))) return null;
  const quantityTerms = value.quantityTerms === null ? null : parseGoodsDeliveryQuantityTerms(value.quantityTerms);
  const draftValues = parseTransactionDraftValues(value.draftValues, GOODS_DELIVERY_DRAFT_KEYS);
  return !draftValues || (value.quantityTerms !== null && !quantityTerms) ? null
    : { status: value.status as DeliveryTermsInput['status'], paymentMode: value.paymentMode as DeliveryTermsInput['paymentMode'], quantityTerms, draftValues };
}
/** Shared by the product editor and shipping-template copies; one typed policy. */
export const parseGoodsDeliveryTermsInput = deliveryInput;
export function parseGoodsTermsRequest(value: unknown): GoodsTermsRequest | null {
  if (!validGoodsTermsContext(value) || !transactionRecord(value)
    || !transactionExactKeys(value, ['goodId', 'expectedActorId', 'expectedRevision', 'expectedGoodUpdatedAt', 'operationId', 'volume', 'delivery'])
    || !transactionInteger(value.expectedRevision, 0, GOODS_TRANSACTION_INT_MAX) || !transactionInstant(value.expectedGoodUpdatedAt)
    || typeof value.operationId !== 'string' || !isUuid(value.operationId)) return null;
  const volume = value.volume === null ? null : volumeInput(value.volume), delivery = value.delivery === null ? null : deliveryInput(value.delivery);
  if ((value.volume !== null && !volume) || (value.delivery !== null && !delivery) || (!volume && !delivery)) return null;
  return { goodId: value.goodId, expectedActorId: value.expectedActorId.toLowerCase(), expectedRevision: value.expectedRevision,
    expectedGoodUpdatedAt: value.expectedGoodUpdatedAt, operationId: value.operationId.toLowerCase(), volume, delivery };
}
function kstInput(value: string | null): string {
  if (!value) return '';
  // Keep seconds and microseconds when loading a policy; the editor must not round
  // a saved boundary merely because an unrelated field is changed.
  const local = new Date(Date.parse(value) + 32_400_000).toISOString().slice(0, 19);
  const fraction = /\.(\d{1,6})/.exec(value)?.[1];
  return `${local}${fraction ? `.${fraction}` : ''}`;
}
function instantInput(value: string): string | null | false {
  if (!value) return null;
  const result = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00+09:00`
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value) ? `${value}+09:00` : value;
  return transactionInstant(result) ? result : false;
}
function integerInput(value: string): number | null {
  return /^(0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
}
export function goodsTermsDraft(terms: GoodsTransactionAdminTerms): GoodsTermsDraft {
  const volume = terms.volume, v = volume?.terms, delivery = terms.delivery, d = delivery?.quantityTerms;
  const result: GoodsTermsDraft = {
    volume: { status: volume?.status ?? 'draft', fields: { condition: 'quantity', threshold: '', discountKind: 'fixed', discountValue: '', startsAt: '', endsAt: '',
      ...(v ? { condition: v.condition, threshold: String(v.threshold), discountKind: v.discountKind, discountValue: String(v.discountValue), startsAt: kstInput(v.startsAt), endsAt: kstInput(v.endsAt) } : {}), ...volume?.draftValues } },
    delivery: { status: delivery?.status ?? 'draft', fields: { kind: d?.kind ?? 'existing', baseFee: d ? String(d.baseFee) : '', interval: d?.kind === 'repeat' ? String(d.interval) : '',
      firstLimit: d && d.kind !== 'repeat' ? String(d.firstLimit) : '', secondLimit: d?.kind === 'tier3' ? String(d.secondLimit) : '',
      extra1: d && d.kind !== 'repeat' ? String(d.extra1) : '', extra2: d?.kind === 'tier3' ? String(d.extra2) : '', paymentMode: delivery?.paymentMode ?? 'prepaid', ...delivery?.draftValues } },
  };
  // An active policy's typed terms are authoritative, even if another admin
  // client left inconsistent draft strings. Never display a different charge.
  if (volume?.status === 'active' && v) Object.assign(result.volume.fields, { condition: v.condition, threshold: String(v.threshold),
    discountKind: v.discountKind, discountValue: String(v.discountValue), startsAt: kstInput(v.startsAt), endsAt: kstInput(v.endsAt) });
  if (delivery?.status === 'active') Object.assign(result.delivery.fields, { paymentMode: delivery.paymentMode, kind: d?.kind ?? 'existing',
    ...(d ? { baseFee: String(d.baseFee) } : {}), ...(d?.kind === 'repeat' ? { interval: String(d.interval) } : {}),
    ...(d && d.kind !== 'repeat' ? { firstLimit: String(d.firstLimit), extra1: String(d.extra1) } : {}),
    ...(d?.kind === 'tier3' ? { secondLimit: String(d.secondLimit), extra2: String(d.extra2) } : {}) });
  return result;
}
export function parseGoodsTermsDraft(value: unknown): GoodsTermsDraft | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['volume', 'delivery'])) return null;
  for (const kind of ['volume', 'delivery'] as const) {
    const part = value[kind], keys = kind === 'volume' ? GOODS_VOLUME_DISCOUNT_DRAFT_KEYS : GOODS_DELIVERY_DRAFT_KEYS;
    if (!transactionRecord(part) || !transactionExactKeys(part, ['status', 'fields']) || !statuses.includes(String(part.status))
      || !transactionRecord(part.fields) || !transactionExactKeys(part.fields, keys) || !parseTransactionDraftValues(part.fields, keys)) return null;
  }
  return value as unknown as GoodsTermsDraft;
}
export function prepareGoodsTermsInput(kind: 'volume' | 'delivery', draft: GoodsTermsDraft): GoodsTermsResult<VolumeTermsInput | DeliveryTermsInput> {
  if (!parseGoodsTermsDraft(draft)) return invalid('입력 형식을 확인해주세요. 각 값은 128자 이내여야 합니다.');
  if (kind === 'volume') {
    const { status, fields } = draft.volume, startsAt = instantInput(fields.startsAt), endsAt = instantInput(fields.endsAt);
    const terms = startsAt === false || endsAt === false ? null : parseGoodsVolumeDiscountTerms({ condition: fields.condition, threshold: integerInput(fields.threshold),
      discountKind: fields.discountKind, discountValue: integerInput(fields.discountValue), startsAt, endsAt });
    if (status === 'active' && !terms) return invalid('조건·할인값을 확인해주세요. 기간은 시작과 종료를 모두 입력하거나 모두 비워주세요.');
    return { ok: true, value: { status, terms, draftValues: { ...fields } } };
  }
  const { status, fields } = draft.delivery;
  if (!['prepaid', 'collect', 'buyer_choice'].includes(fields.paymentMode) || !['existing', 'repeat', 'tier2', 'tier3'].includes(fields.kind)) return invalid('배송비 유형과 결제 방식을 선택해주세요.');
  const numeric = Object.fromEntries(['baseFee', 'interval', 'firstLimit', 'secondLimit', 'extra1', 'extra2'].map(key => [key, integerInput(fields[key as keyof typeof fields])]));
  const quantityTerms = fields.kind === 'existing' ? null : parseGoodsDeliveryQuantityTerms({ kind: fields.kind, baseFee: numeric.baseFee,
    ...(fields.kind === 'repeat' ? { interval: numeric.interval } : { firstLimit: numeric.firstLimit, extra1: numeric.extra1 }),
    ...(fields.kind === 'tier3' ? { secondLimit: numeric.secondLimit, extra2: numeric.extra2 } : {}) });
  if (status === 'active' && fields.kind !== 'existing' && !quantityTerms) return invalid('수량 구간·기본 배송비·추가 배송비를 확인해주세요. 3구간의 두 번째 한도와 추가금은 첫 번째보다 작을 수 없습니다.');
  return { ok: true, value: { status, paymentMode: fields.paymentMode as DeliveryTermsInput['paymentMode'], quantityTerms, draftValues: { ...fields } } };
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (transactionRecord(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  if (transactionInstant(value)) return `${transactionEpochMicros(value)}us`;
  return value;
}
export function sameGoodsTerms(a: unknown, b: unknown): boolean { return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)); }
export function goodsTermsReceiptMatches(receipt: GoodsTransactionAdminReceipt, request: GoodsTermsRequest): boolean {
  if (receipt.operationId !== request.operationId || receipt.goodId !== request.goodId || receipt.revision !== request.expectedRevision + Number(receipt.changed)) return false;
  for (const kind of ['volume', 'delivery'] as const) {
    if (request[kind] === null) continue;
    const policy = receipt[kind]; if (!policy) return false;
    const input = Object.fromEntries(Object.entries(policy).filter(([key]) => !['id', 'goodId', 'revision'].includes(key)));
    if (!sameGoodsTerms(input, request[kind])) return false;
  }
  return receipt.changed || sameGoodsTerms(receipt.goodUpdatedAt, request.expectedGoodUpdatedAt);
}
export function parseGoodsTermsRecovery(value: unknown): GoodsTermsRecovery | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['version', 'sessionId', 'base', 'draft', 'retry']) || value.version !== 1
    || typeof value.sessionId !== 'string' || !isUuid(value.sessionId)) return null;
  const base = parseGoodsTransactionAdminTerms(value.base), draft = parseGoodsTermsDraft(value.draft), retry = value.retry === null ? null : parseGoodsTermsRequest(value.retry);
  if (!base || !draft || (value.retry !== null && !retry) || (retry && (retry.goodId !== base.goodId || retry.expectedRevision !== base.revision
    || !sameGoodsTerms(retry.expectedGoodUpdatedAt, base.goodUpdatedAt)))) return null;
  return { version: 1, sessionId: value.sessionId, base, draft, retry };
}
export function goodsTermsError(message?: string): string {
  const messages: Record<string, string> = {
    goods_transaction_terms_changed: '상품 또는 할인·배송 설정이 변경됐습니다. 입력을 유지한 채 최신 저장본을 비교해주세요.',
    checkout_contract_upgrade_required: '주문·결제 기능 준비가 끝난 뒤 활성화할 수 있습니다. 지금은 초안으로 저장해주세요.',
    collect_contract_not_ready: '출고지의 착불 수납 계약·수납 방법·분쟁 연락처를 먼저 준비해주세요.',
    operator_operation_conflict: '같은 요청 번호에 다른 내용이 있습니다. 최신 저장본을 확인해주세요.',
    auth_context_changed: '로그인 계정이 바뀌었습니다. 현재 계정으로 화면을 다시 열어주세요.',
    operator_capability_required: '상품관리 권한이 필요합니다.', good_not_found: '상품이 없거나 보관됐습니다. 상품 목록에서 다시 확인해주세요.',
  };
  return Object.entries(messages).find(([code]) => message?.includes(code))?.[1] ?? '할인·배송 설정을 저장하지 못했습니다. 입력값과 현재 권한을 확인해주세요.';
}
