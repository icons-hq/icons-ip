/**
 * 연결 상품 반영 계약(1027T-X04, 사용자 결정 2026-11-11 묶음 13 "빈 칸 자동+확정 반영").
 *
 * 반입한 ERP 품목의 판매가·바코드가 같은 ERP 코드를 넣은 상품 옵션(연결 상품)과 다르면 미리보기에서 보이고,
 * 운영자가 고른 행만 확정해 반영한다. 한 행은 옵션 하나의 판매가 또는 바코드다. DB의
 * `admin_preview_erp_linked_goods`·`admin_commit_erp_linked_goods`(20261113040100)와 같은 모양이다.
 * 판매가는 상품 목록의 판매가 바로 수정과 같은 상품 저장 규칙으로, 바코드는 옵션 ERP 식별자 저장으로 반영한다.
 */
import { ERP_ITEM_LIMITS } from './erp-items';

export type ErpLinkedGoodsField = 'price' | 'barcode';

export const ERP_LINKED_GOODS_SKIP_REASONS = [
  'zero_price', 'random_option', 'active_discount', 'instant_discount', 'notice_required', 'option_price_order',
  'barcode_taken', 'barcode_duplicate',
] as const;
export type ErpLinkedGoodsSkipReason = typeof ERP_LINKED_GOODS_SKIP_REASONS[number];

export interface ErpLinkedGoodsRow {
  /** `옵션 id:price` 또는 `옵션 id:barcode`. 확정할 때 이 값으로 고른다. */
  key: string;
  field: ErpLinkedGoodsField;
  goodId: string;
  goodName: string;
  goodCode: string | null;
  published: boolean;
  variantId: string;
  optionName: string;
  isDefault: boolean;
  erpCode: string;
  erpName: string;
  /** 지금 상품 값. 판매가는 그 옵션의 판매 금액(할인 전, 원), 바코드는 글자(없으면 null). */
  current: number | string | null;
  /** 반입한 ERP 값 */
  next: number | string;
  status: 'apply' | 'skip';
  reason: ErpLinkedGoodsSkipReason | null;
  /** 이미 있던 바코드가 바뀌는 행 */
  warning: 'barcode_changed' | null;
}

export interface ErpLinkedGoodsPreview {
  operationId: string;
  expiresAt: string;
  /** 비교한 ERP 코드 수. null이면 반입한 전체 ERP 품목과 비교했다. */
  scopeCount: number | null;
  /** 비교한 연결 옵션 수 */
  linked: number;
  /** 값이 다른 행 전체 수. 미리보기에는 앞 {@link ERP_LINKED_GOODS_PREVIEW_LIMIT}행까지 담긴다. */
  total: number;
  truncated: boolean;
  rows: ErpLinkedGoodsRow[];
}

export interface ErpLinkedGoodsFailure {
  key: string;
  field: ErpLinkedGoodsField;
  goodId: string;
  goodName: string;
  optionName: string;
  error: string;
}

export type ErpLinkedGoodsReceipt =
  | { state: 'completed'; operationId: string; applied: { price: number; barcode: number; goods: number }; failed: ErpLinkedGoodsFailure[] }
  | { state: 'rejected'; operationId: string; error: string };

/** ERP 품목 화면의 '연결 상품 반영' 구역 id. 반입 결과의 '비교 결과 보기'가 이곳으로 옮긴다. */
export const ERP_LINKED_GOODS_SECTION_ID = 'erp-linked-goods';

/** DB가 미리보기에 담는 행 수이자 한 번에 확정할 수 있는 행 수. */
export const ERP_LINKED_GOODS_PREVIEW_LIMIT = 500;
/** 한 번에 비교할 수 있는 ERP 코드 수(반입 한 번의 상한과 같다). */
export const ERP_LINKED_GOODS_SCOPE_LIMIT = 5_000;

export const ERP_LINKED_GOODS_FIELD_LABELS: Record<ErpLinkedGoodsField, string> = { price: '판매가', barcode: '바코드' };

export const ERP_LINKED_GOODS_SKIP_LABELS: Record<ErpLinkedGoodsSkipReason, string> = {
  zero_price: 'ERP 판매가가 0원이라 반영하지 않습니다. 빈 값일 수 있어 상품을 0원으로 바꾸지 않습니다.',
  random_option: '랜덤 판매 상품은 모든 옵션의 판매가가 같아야 해서 상품 화면에서 한 번에 바꿉니다.',
  active_discount: '기간 할인(일괄 즉시할인·할인 프로모션 포함)이 진행 중이거나 예정된 상품이라 판매가를 바꿀 수 없습니다. 할인을 중지한 뒤 다시 비교해주세요.',
  notice_required: '상품정보제공고시가 빈 공개 상품이라 저장할 수 없습니다. 상품 화면에서 고시를 채운 뒤 다시 비교해주세요.',
  instant_discount: '상품 할인(할인가)이 설정된 상품이라 판매가를 바꾸지 않습니다. 할인 전 판매가가 ERP 판매가와 다르니 상품 수정의 판매가와 할인을 함께 확인해주세요.',
  option_price_order: '반영하면 옵션 판매 금액이 상품 판매가(기본 옵션)보다 낮아집니다. 상품 화면에서 판매가부터 맞춰주세요.',
  barcode_taken: '다른 옵션이 이미 쓰는 바코드라 넣을 수 없습니다.',
  barcode_duplicate: '같은 바코드를 두 옵션에 넣게 되어 반영하지 않습니다. ERP 품목의 바코드를 확인해주세요.',
};

export const ERP_LINKED_GOODS_SKIP_SHORT_LABELS: Record<ErpLinkedGoodsSkipReason, string> = {
  zero_price: 'ERP 0원', random_option: '랜덤 판매', active_discount: '기간 할인 중', notice_required: '고시 없음',
  instant_discount: '상품 할인 중', option_price_order: '옵션가 순서', barcode_taken: '쓰는 바코드', barcode_duplicate: '바코드 겹침',
};

export const ERP_LINKED_GOODS_BARCODE_WARNING = '출고 파일·창고 대조에 쓰는 바코드가 바뀝니다. 창고에 등록된 바코드와 같은지 확인해주세요.';

/** 확정·미리보기 RPC 오류 → 운영자 문구. 모르는 오류면 null. */
export function erpLinkedGoodsErrorLabel(descriptor: string, detail?: string | null): string | null {
  if (descriptor.includes('erp_goods_apply_partial_price')) {
    return `같은 상품${detail ? `(‘${detail}’)` : ''}의 판매가 행을 일부만 고르면 옵션 판매 금액이 상품 판매가보다 낮아집니다. 그 상품의 판매가 행을 함께 고르거나 함께 빼 주세요.`;
  }
  if (descriptor.includes('erp_goods_apply_busy')) return '다른 작업이 같은 상품을 저장하고 있습니다. 잠시 뒤 다시 반영해주세요.';
  if (descriptor.includes('erp_goods_apply_unavailable')) return '이 미리보기를 찾을 수 없습니다. 다시 비교해주세요.';
  if (descriptor.includes('invalid_erp_goods_apply_keys')) return '반영할 행을 다시 골라주세요.';
  if (descriptor.includes('invalid_erp_goods_apply_request')) return '비교할 ERP 품목을 다시 확인해주세요.';
  return null;
}

/** 거절 영수증의 사유. 아무것도 반영하지 않았다. */
export function erpLinkedGoodsRejectionLabel(error: string): string {
  if (error === 'erp_goods_apply_changed') return '미리보기 뒤 상품이나 ERP 값이 바뀌어 아무것도 반영하지 않았습니다. 다시 비교해주세요.';
  if (error === 'erp_goods_apply_expired') return '미리보기를 연 지 15분이 지나 아무것도 반영하지 않았습니다. 다시 비교해주세요.';
  return '반영하지 못했습니다. 다시 비교해주세요.';
}

const FAILURE_LABELS: Record<string, string> = {
  goods_notice_required: '상품정보제공고시가 빈 공개 상품이라 저장할 수 없습니다.',
  active_price_period_requires_reset: '할인이 진행 중이거나 예정돼 판매가를 바꿀 수 없습니다.',
  goods_variant_external_identity_changed: '다른 작업에서 이 옵션의 ERP 정보가 바뀌었습니다.',
  goods_kc_reassessment_required: 'KC 재검토가 필요한 공개 상품입니다.',
  goods_options_changed: '다른 작업에서 옵션이 바뀌었습니다.',
  invalid_goods_options: '옵션 금액이 상품 저장 규칙에 맞지 않습니다.',
};

/** 상품 저장 규칙에 막혀 반영하지 못한 행의 사유. */
export function erpLinkedGoodsFailureLabel(error: string): string {
  return FAILURE_LABELS[error] ?? '상품 저장 규칙에 막혔습니다. 상품 화면에서 저장해 보고 사유를 확인해주세요.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function isSkipReason(value: unknown): value is ErpLinkedGoodsSkipReason {
  return typeof value === 'string' && (ERP_LINKED_GOODS_SKIP_REASONS as readonly string[]).includes(value);
}

function parseRow(value: unknown): ErpLinkedGoodsRow | null {
  if (!isRecord(value)) return null;
  const field = value.field;
  if (field !== 'price' && field !== 'barcode') return null;
  const strings = ['key', 'goodId', 'goodName', 'variantId', 'optionName', 'erpCode', 'erpName'] as const;
  if (strings.some((name) => typeof value[name] !== 'string' || !value[name])) return null;
  if (value.key !== `${value.variantId}:${field}`) return null;
  if (value.goodCode !== null && typeof value.goodCode !== 'string') return null;
  if (typeof value.published !== 'boolean' || typeof value.isDefault !== 'boolean') return null;
  if (value.status !== 'apply' && value.status !== 'skip') return null;
  if (value.status === 'apply' ? value.reason !== null : !isSkipReason(value.reason)) return null;
  if (value.warning !== null && value.warning !== 'barcode_changed') return null;
  const price = (input: unknown) => typeof input === 'number' && Number.isSafeInteger(input) && input >= 0 && input <= ERP_ITEM_LIMITS.salePrice;
  if (field === 'price' ? !price(value.next) || !(value.current === null || price(value.current))
    : typeof value.next !== 'string' || !value.next || !(value.current === null || typeof value.current === 'string')) return null;
  return {
    key: value.key as string, field, goodId: value.goodId as string, goodName: value.goodName as string,
    goodCode: value.goodCode as string | null, published: value.published, variantId: value.variantId as string,
    optionName: value.optionName as string, isDefault: value.isDefault, erpCode: value.erpCode as string, erpName: value.erpName as string,
    current: value.current as number | string | null, next: value.next as number | string,
    status: value.status, reason: (value.reason ?? null) as ErpLinkedGoodsSkipReason | null, warning: value.warning as 'barcode_changed' | null,
  };
}

/** 미리보기 결과 → 계약 타입. 형식이 다르면 null(반영 버튼을 열지 않는다). */
export function parseErpLinkedGoodsPreview(value: unknown): ErpLinkedGoodsPreview | null {
  if (!isRecord(value) || typeof value.operationId !== 'string' || typeof value.expiresAt !== 'string') return null;
  const linked = safeCount(value.linked);
  const total = safeCount(value.total);
  const scopeCount = value.scopeCount === null ? null : safeCount(value.scopeCount);
  if (linked === null || total === null || (value.scopeCount !== null && scopeCount === null)
    || typeof value.truncated !== 'boolean' || !Array.isArray(value.rows)) return null;
  const rows: ErpLinkedGoodsRow[] = [];
  for (const raw of value.rows) {
    const row = parseRow(raw);
    if (!row) return null;
    rows.push(row);
  }
  if (rows.length > total || new Set(rows.map((row) => row.key)).size !== rows.length) return null;
  return { operationId: value.operationId, expiresAt: value.expiresAt, scopeCount, linked, total, truncated: value.truncated, rows };
}

/** 확정 결과 → 계약 타입. 형식이 다르면 null. */
export function parseErpLinkedGoodsReceipt(value: unknown): ErpLinkedGoodsReceipt | null {
  if (!isRecord(value) || typeof value.operationId !== 'string') return null;
  if (value.state === 'rejected') return typeof value.error === 'string' ? { state: 'rejected', operationId: value.operationId, error: value.error } : null;
  if (value.state !== 'completed' || !isRecord(value.applied) || !Array.isArray(value.failed)) return null;
  const price = safeCount(value.applied.price);
  const barcode = safeCount(value.applied.barcode);
  const goods = safeCount(value.applied.goods);
  if (price === null || barcode === null || goods === null) return null;
  const failed: ErpLinkedGoodsFailure[] = [];
  for (const raw of value.failed) {
    if (!isRecord(raw) || (raw.field !== 'price' && raw.field !== 'barcode')
      || [raw.key, raw.goodId, raw.goodName, raw.optionName, raw.error].some((entry) => typeof entry !== 'string')) return null;
    failed.push({ key: raw.key as string, field: raw.field, goodId: raw.goodId as string, goodName: raw.goodName as string, optionName: raw.optionName as string, error: raw.error as string });
  }
  return { state: 'completed', operationId: value.operationId, applied: { price, barcode, goods }, failed };
}

/** 확정 결과 한 줄. */
export function erpLinkedGoodsReceiptMessage(receipt: ErpLinkedGoodsReceipt): string {
  if (receipt.state === 'rejected') return erpLinkedGoodsRejectionLabel(receipt.error);
  const count = (value: number) => value.toLocaleString('ko-KR');
  const parts: string[] = [];
  const { price, barcode, goods } = receipt.applied;
  if (price || barcode) {
    const fields = [price ? `판매가 ${count(price)}건` : '', barcode ? `바코드 ${count(barcode)}건` : ''].filter(Boolean).join('·');
    parts.push(`상품 ${count(goods)}개에 ${fields}을 반영했습니다.`);
  }
  if (receipt.failed.length) parts.push(`${count(receipt.failed.length)}건은 상품 저장 규칙에 막혀 반영하지 못했습니다. 아래 사유를 확인해주세요.`);
  return parts.join(' ') || '반영한 행이 없습니다.';
}

/** 미리보기 요약 숫자. 판매가·바코드는 반영할 수 있는 행 수다. */
export function erpLinkedGoodsCounts(rows: readonly ErpLinkedGoodsRow[]) {
  return {
    price: rows.filter((row) => row.status === 'apply' && row.field === 'price').length,
    barcode: rows.filter((row) => row.status === 'apply' && row.field === 'barcode').length,
    skipped: rows.filter((row) => row.status === 'skip').length,
    barcodeChanges: rows.filter((row) => row.status === 'apply' && row.warning === 'barcode_changed').length,
  };
}

/** 확정 확인창 문구. 바코드가 바뀌는 행이 있으면 창고 확인을 함께 묻는다. */
export function erpLinkedGoodsConfirmation(rows: readonly ErpLinkedGoodsRow[]): string {
  const count = (value: number) => value.toLocaleString('ko-KR');
  const price = rows.filter((row) => row.field === 'price').length;
  const barcode = rows.filter((row) => row.field === 'barcode').length;
  const changes = rows.filter((row) => row.warning === 'barcode_changed').length;
  const goods = new Set(rows.map((row) => row.goodId)).size;
  const fields = [price ? `판매가 ${count(price)}건` : '', barcode ? `바코드 ${count(barcode)}건` : ''].filter(Boolean).join('·');
  return `연결 상품 ${count(goods)}개에 ${fields}을 반영할까요?`
    + (price ? ' 바뀐 판매가는 저장하는 즉시 고객 화면과 새 주문에 적용됩니다.' : '')
    + (changes ? ` 이미 있던 바코드가 바뀌는 행이 ${count(changes)}건입니다. 창고에 등록된 바코드와 같은지 확인해주세요.` : '')
    + ' 반영 내역은 감사 기록에 남습니다.';
}

/** 값 표시. 판매가는 원, 바코드는 글자 그대로, 비어 있으면 '없음'. */
export function formatErpLinkedGoodsValue(field: ErpLinkedGoodsField, value: number | string | null): string {
  if (value === null || value === '') return '없음';
  return field === 'price' && typeof value === 'number' ? `${value.toLocaleString('ko-KR')}원` : String(value);
}
