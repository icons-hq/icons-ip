import { categoryPath, type AdminCategoryErpMapping, type AdminCategoryNode } from './category';

/**
 * ERP 품목 마스터 계약.
 *
 * MD가 ERP '품목 생성' 데이터를 어드민에 반입해 두면, 상품 옵션에 ERP 품명을
 * 입력할 때 품번·바코드·고객 카테고리·판매가를 제안한다. ERP와 실시간 연동은
 * 하지 않는다. 반입된 값은 제안일 뿐이며 MD가 상품 화면에서 바꿀 수 있다.
 */
export type ErpItemMatch = {
  /** ERP 품번 */
  code: string;
  /** ERP 품명 */
  name: string;
  /** ERP 카테고리 원문. 없으면 null */
  category: string | null;
  /** ERP 판매가(원). 없으면 null */
  salePrice: number | null;
  barcode: string | null;
  /** 이 ERP 카테고리에 연결해 둔 ICONS 고객 카테고리 id. 연결이 없으면 null */
  mappedCategoryId: string | null;
};

export const ERP_ITEMS_PATH = '/admin/catalog/erp-items';

/** DB 체크 제약(supabase/migrations/20261007110000_erp_item_master.sql)과 같은 상한. */
export const ERP_ITEM_LIMITS = {
  code: 120,
  name: 200,
  category: 200,
  barcode: 120,
  salePrice: 2_147_483_647,
} as const;

/** 상품 옵션 ERP 품명 입력이 검색을 시작하는 글자 수. */
export const ERP_ITEM_SEARCH_MIN_LENGTH = 2;
export const ERP_ITEM_SEARCH_QUERY_MAX = 100;
export const ERP_ITEM_SUGGESTION_LIMIT = 8;
export const ERP_ITEMS_PAGE_SIZE = 50;

export type ErpItemRejectReason =
  | 'invalid_row'
  | 'missing_code'
  | 'invalid_code'
  | 'missing_name'
  | 'invalid_name'
  | 'invalid_category'
  | 'invalid_sale_price'
  | 'invalid_barcode'
  | 'duplicate_code';

export const ERP_ITEM_REJECT_REASON_LABELS: Record<ErpItemRejectReason, string> = {
  invalid_row: '행 형식을 읽을 수 없습니다.',
  missing_code: 'ERP 코드(품번)가 비어 있습니다.',
  invalid_code: `ERP 코드는 ${ERP_ITEM_LIMITS.code}자 이하로, 줄바꿈·탭 없이 입력해주세요.`,
  missing_name: 'ERP 품명이 비어 있습니다.',
  invalid_name: `ERP 품명은 ${ERP_ITEM_LIMITS.name}자 이하로 입력해주세요.`,
  invalid_category: `ERP 분류는 ${ERP_ITEM_LIMITS.category}자 이하로 입력해주세요.`,
  invalid_sale_price: '판매가는 0 이상의 원 단위 숫자로 입력해주세요.',
  invalid_barcode: `바코드는 ${ERP_ITEM_LIMITS.barcode}자 이하로, 줄바꿈·탭 없이 입력해주세요.`,
  duplicate_code: '같은 ERP 코드가 뒤에 다시 있어 마지막 행으로 반입했습니다.',
};

export function isErpItemRejectReason(value: unknown): value is ErpItemRejectReason {
  return typeof value === 'string' && Object.hasOwn(ERP_ITEM_REJECT_REASON_LABELS, value);
}

export function erpItemRejectReasonLabel(reason: string): string {
  return isErpItemRejectReason(reason) ? ERP_ITEM_REJECT_REASON_LABELS[reason] : '반입하지 못한 행입니다. 값을 확인해주세요.';
}

function textOrNull(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' ? value : undefined;
}

function priceOrNull(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= ERP_ITEM_LIMITS.salePrice
    ? value
    : undefined;
}

/** `admin_search_erp_items` 행 → 계약 타입. 형식이 다르면 null(제안에서 조용히 뺀다). */
export function parseErpItemMatch(value: unknown): ErpItemMatch | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const category = textOrNull(row.category);
  const salePrice = priceOrNull(row.sale_price);
  const barcode = textOrNull(row.barcode);
  const mappedCategoryId = textOrNull(row.mapped_category_id);
  if (typeof row.code !== 'string' || !row.code || typeof row.name !== 'string' || !row.name
    || category === undefined || salePrice === undefined || barcode === undefined || mappedCategoryId === undefined) return null;
  return { code: row.code, name: row.name, category, salePrice, barcode, mappedCategoryId };
}

export interface ErpItemListRow extends ErpItemMatch {
  importedAt: string;
  updatedAt: string;
}

export interface ErpItemListPage {
  total: number;
  items: ErpItemListRow[];
}

/** `admin_list_erp_items` jsonb → 목록. 형식이 다르면 null. */
export function parseErpItemListPage(value: unknown): ErpItemListPage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const page = value as Record<string, unknown>;
  const total = typeof page.total === 'number' ? page.total : Number(page.total);
  if (!Number.isSafeInteger(total) || total < 0 || !Array.isArray(page.items)) return null;
  const items: ErpItemListRow[] = [];
  for (const raw of page.items) {
    const match = parseErpItemMatch(raw);
    const row = raw as Record<string, unknown>;
    if (!match || typeof row.imported_at !== 'string' || typeof row.updated_at !== 'string') return null;
    items.push({ ...match, importedAt: row.imported_at, updatedAt: row.updated_at });
  }
  return total < items.length ? null : { total, items };
}

export interface ErpCategoryMappingRow {
  erpCategory: string;
  itemCount: number;
  categoryId: string | null;
  updatedAt: string | null;
}

/** `admin_list_erp_categories` 행 → 연결 표 행. */
export function parseErpCategoryMappingRow(value: unknown): ErpCategoryMappingRow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const itemCount = typeof row.item_count === 'number' ? row.item_count : Number(row.item_count);
  const categoryId = textOrNull(row.category_id);
  const updatedAt = textOrNull(row.updated_at);
  if (typeof row.erp_category !== 'string' || !row.erp_category || !Number.isSafeInteger(itemCount) || itemCount < 0
    || categoryId === undefined || updatedAt === undefined) return null;
  return { erpCategory: row.erp_category, itemCount, categoryId, updatedAt };
}

export interface ErpItemFilters {
  query: string;
  page: number;
}

export function normalizeErpItemFilters(params: Record<string, string | string[] | undefined>): ErpItemFilters {
  return {
    query: typeof params.q === 'string' ? params.q.trim().slice(0, ERP_ITEM_SEARCH_QUERY_MAX) : '',
    page: Math.min(10_000, Math.max(1, Number.parseInt(typeof params.page === 'string' ? params.page : '', 10) || 1)),
  };
}

export function erpItemsHref(filters: ErpItemFilters, page = filters.page): string {
  const params = new URLSearchParams();
  if (filters.query) params.set('q', filters.query);
  if (page > 1) params.set('page', String(page));
  return `${ERP_ITEMS_PATH}${params.size ? `?${params}` : ''}`;
}

/** 원 단위 표시. 판매가가 없으면 '없음'. */
export function formatErpSalePrice(value: number | null): string {
  return value === null ? '없음' : `${value.toLocaleString('ko-KR')}원`;
}

function comparable(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

function segments(value: string): string[] {
  return value.split(/\s*[>›/|]\s*/).map((part) => part.trim()).filter(Boolean);
}

export type ErpCategorySuggestion = {
  categoryId: string;
  /** 'erp_mapping' = 고객 카테고리의 ERP 분류 매핑과 일치, 'same_path' = 경로 일치, 'same_name' = 말단 이름 일치 */
  basis: 'erp_mapping' | 'same_path' | 'same_name';
  label: string;
};

/**
 * ERP 분류 원문에 맞는 고객 카테고리 활성 말단을 하나 제안한다.
 * 고객 카테고리 화면의 ERP 분류 매핑 → 경로 전체 → 말단 이름 순으로 보고,
 * 후보가 둘 이상이면 추정하지 않고 null을 돌려준다.
 */
export function suggestErpCategoryTarget(
  erpCategory: string,
  categories: readonly AdminCategoryNode[],
  erpMappings: readonly Pick<AdminCategoryErpMapping, 'categoryId' | 'erpCode' | 'erpName'>[] = [],
): ErpCategorySuggestion | null {
  const leaves = categories.filter((category) => !category.archivedAt && category.childCount === 0);
  const leafIds = new Set(leaves.map((leaf) => leaf.id));
  const label = (id: string) => categoryPath(categories, id).join(' > ');
  const target = comparable(erpCategory);
  if (!target) return null;
  const unique = (ids: string[], basis: ErpCategorySuggestion['basis']): ErpCategorySuggestion | null => {
    const distinct = [...new Set(ids)];
    return distinct.length === 1 ? { categoryId: distinct[0], basis, label: label(distinct[0]) } : null;
  };

  const mapped = erpMappings
    .filter((mapping) => leafIds.has(mapping.categoryId)
      && (comparable(mapping.erpName) === target || comparable(mapping.erpCode) === target))
    .map((mapping) => mapping.categoryId);
  if (mapped.length) return unique(mapped, 'erp_mapping');

  const parts = segments(erpCategory).map(comparable);
  const pathKey = parts.join('>');
  const samePath = leaves.filter((leaf) => categoryPath(categories, leaf.id).map(comparable).join('>') === pathKey).map((leaf) => leaf.id);
  if (samePath.length) return unique(samePath, 'same_path');

  const last = parts.at(-1);
  if (!last) return null;
  return unique(leaves.filter((leaf) => comparable(leaf.name) === last).map((leaf) => leaf.id), 'same_name');
}
