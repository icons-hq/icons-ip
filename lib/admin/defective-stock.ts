import { isUuid } from '@/lib/uuid';

/* 반품 불량 재고(QNA-035). 반품 환불을 확정할 때 품목마다 '판매 재고 복원'(기본) 또는 '불량'을 고른다.
 * 불량은 판매 재고(재고수량)에 넣지 않고 옵션별 불량 재고 원장에 따로 남는다.
 *
 * 선택은 환불 확정 전에 DB에 저장되고(그 품목은 재고를 복원하지 않는다), 확정이 끝난 뒤 원장으로 기록된다.
 * 확정 뒤 기록이 실패하면 확정은 되돌리지 않고 '불량 기록 필요'로 남겨 다시 시도한다. */

export const DEFECTIVE_STOCK_PATH = '/admin/catalog/defective-stock';

/** 환불 확정 양식이 품목마다 싣는 필드 이름 접두어. 값은 restore | defective다. */
export const STOCK_DISPOSITION_FIELD_PREFIX = 'stockDisposition:';
export const STOCK_DISPOSITION_LABELS = { restore: '판매 재고 복원', defective: '불량' } as const;
export type StockDisposition = keyof typeof STOCK_DISPOSITION_LABELS;

export const DEFECTIVE_STOCK_FIELD_NOTE = '불량으로 고른 품목은 판매 재고에 넣지 않고 불량 재고 목록에 따로 기록합니다.';
export const DEFECTIVE_STOCK_PENDING_NOTICE = '환불(재고)은 확정됐지만 불량 재고 기록이 끝나지 않았습니다. 환불은 다시 하지 말고 반품 처리 권한이 있는 담당자가 [불량 기록 다시 시도]만 눌러주세요.';

/** 기록 RPC 실패를 운영자 문구로 옮긴다. 원문 코드는 노출하지 않는다. */
export function defectiveStockRecordError(message: string | null | undefined) {
  const value = (message ?? '').toLowerCase();
  if (value.includes('defective_stock_claim_not_completed')) return '재고가 정해진 뒤에 불량 재고를 기록할 수 있습니다.';
  if (value.includes('defective_stock_item_already_restored')) return '이미 판매 재고로 복원된 품목이라 불량으로 기록할 수 없습니다. 재고를 확인할 담당자에게 문의해주세요.';
  return `불량 재고를 기록하지 못했습니다. ${DEFECTIVE_STOCK_PENDING_NOTICE}`;
}

export interface ClaimDefectiveItem {
  orderItemId: string;
  name: string;
  variantName: string | null;
  qty: number;
  /** 지금 저장된 선택이 불량이면 true. */
  defective: boolean;
  /** planned = 선택만 저장됨(기록 전), recorded = 불량 재고 원장에 기록됨. */
  state: 'planned' | 'recorded' | null;
}

export interface ClaimDefectiveStock {
  claimId: string;
  /** 재고가 이미 정해졌다(주문 canceled 또는 무통장 취소 확정). 선택을 더 바꿀 수 없다. */
  frozen: boolean;
  /** 확정은 끝났지만 아직 원장에 기록하지 못한 선택 수. */
  pending: number;
  items: ClaimDefectiveItem[];
}

export interface DefectiveStockVariantRow {
  goodId: string;
  goodName: string;
  variantId: string;
  variantName: string;
  variantCode: string;
  qty: number;
  entries: number;
  lastRecordedAt: string | null;
}

export interface DefectiveStockEntryRow {
  id: string;
  claimId: string;
  claimReference: number;
  orderItemId: string;
  goodName: string;
  variantId: string;
  variantName: string;
  variantCode: string;
  qty: number;
  recordedAt: string;
  recordedByName: string;
}

export interface DefectiveStockPendingRow {
  claimId: string;
  claimReference: number;
  qty: number;
  items: number;
}

export interface DefectiveStockList {
  variants: DefectiveStockVariantRow[];
  entries: DefectiveStockEntryRow[];
  pending: DefectiveStockPendingRow[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown) => typeof value === 'string' ? value : '';
const int = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
};

export function parseClaimDefectiveStock(value: unknown): ClaimDefectiveStock[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((row) => ({
    claimId: text(row.claimId),
    frozen: row.frozen === true,
    pending: int(row.pending),
    items: (Array.isArray(row.items) ? row.items : []).filter(isRecord).map((item) => ({
      orderItemId: text(item.orderItemId),
      name: text(item.name),
      variantName: text(item.variantName) || null,
      qty: int(item.qty),
      defective: item.defective === true,
      state: item.state === 'planned' || item.state === 'recorded' ? item.state : null,
    })),
  }));
}

export function parseDefectiveStockList(value: unknown): DefectiveStockList | null {
  if (!isRecord(value)) return null;
  const rows = (key: string) => (Array.isArray(value[key]) ? value[key] as unknown[] : []).filter(isRecord);
  return {
    variants: rows('variants').map((row) => ({
      goodId: text(row.goodId), goodName: text(row.goodName), variantId: text(row.variantId), variantName: text(row.variantName),
      variantCode: text(row.variantCode), qty: int(row.qty), entries: int(row.entries), lastRecordedAt: text(row.lastRecordedAt) || null,
    })),
    entries: rows('entries').map((row) => ({
      id: text(row.id), claimId: text(row.claimId), claimReference: int(row.claimReference), orderItemId: text(row.orderItemId),
      goodName: text(row.goodName), variantId: text(row.variantId), variantName: text(row.variantName), variantCode: text(row.variantCode),
      qty: int(row.qty), recordedAt: text(row.recordedAt), recordedByName: text(row.recordedByName),
    })),
    pending: rows('pending').map((row) => ({
      claimId: text(row.claimId), claimReference: int(row.claimReference), qty: int(row.qty), items: int(row.items),
    })),
  };
}

/** 옵션별 불량 수량(재고 대조 참고 칸). */
export function parseDefectiveQtyByVariant(value: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  if (!Array.isArray(value)) return result;
  for (const row of value) {
    if (isRecord(row) && typeof row.variantId === 'string' && int(row.qty) > 0) result[row.variantId] = int(row.qty);
  }
  return result;
}

/** 환불 확정 양식의 품목별 선택을 읽는다. 선택 필드가 없으면 null(기존 양식·단건 호출은 그대로 전부 복원). */
export function readStockDispositions(formData: FormData): { itemIds: string[]; defectiveIds: string[] } | { error: string } | null {
  const itemIds: string[] = [];
  const defectiveIds: string[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith(STOCK_DISPOSITION_FIELD_PREFIX)) continue;
    const id = key.slice(STOCK_DISPOSITION_FIELD_PREFIX.length).toLowerCase();
    if (!isUuid(id) || (value !== 'restore' && value !== 'defective') || itemIds.includes(id)) {
      return { error: '품목별 재고 처리 선택을 확인하지 못했습니다. 화면을 새로고침한 뒤 다시 시도해주세요.' };
    }
    itemIds.push(id);
    if (value === 'defective') defectiveIds.push(id);
  }
  return itemIds.length ? { itemIds, defectiveIds } : null;
}

/** 폼에 실을 선택 필드 이름. */
export function stockDispositionField(orderItemId: string) {
  return `${STOCK_DISPOSITION_FIELD_PREFIX}${orderItemId}`;
}
