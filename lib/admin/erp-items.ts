import type { AdminCategoryErpMapping, AdminCategoryNode } from './category';

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
  /** ERP 품목 화면에서 저장한 연결. 없으면 null. */
  categoryId: string | null;
  updatedAt: string | null;
  /**
   * 새 연결이 없을 때 고객 카테고리 화면의 ERP 분류 매핑(정본)으로 제안하는 활성 말단.
   * ERP 분류 이름 또는 코드가 원문과 정확히 같은 말단이 하나뿐일 때만 값이 있다.
   */
  fallbackCategoryId: string | null;
}

/** `admin_list_erp_categories` 행 → 연결 표 행. */
export function parseErpCategoryMappingRow(value: unknown): ErpCategoryMappingRow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const itemCount = typeof row.item_count === 'number' ? row.item_count : Number(row.item_count);
  const categoryId = textOrNull(row.category_id);
  const updatedAt = textOrNull(row.updated_at);
  const fallbackCategoryId = textOrNull(row.fallback_category_id);
  if (typeof row.erp_category !== 'string' || !row.erp_category || !Number.isSafeInteger(itemCount) || itemCount < 0
    || categoryId === undefined || updatedAt === undefined || fallbackCategoryId === undefined) return null;
  return { erpCategory: row.erp_category, itemCount, categoryId, updatedAt, fallbackCategoryId };
}

/** 한 번에 저장할 수 있는 ERP 분류 연결 수(`admin_set_erp_category_mappings`와 같은 상한). 연결 표가 한 번에 보여 주는 행 수이기도 하다. */
export const ERP_CATEGORY_MAPPING_BATCH_LIMIT = 500;

export interface ErpCategoryMappingEntry {
  erpCategory: string;
  /** 연결할 고객 카테고리. null이면 연결 해제. */
  categoryId: string | null;
}

export interface ErpCategoryMappingBatch {
  changed: number;
  unchanged: number;
  /** 저장하지 못한 행. index는 보낸 순서(0부터), reason은 DB 사유 코드. */
  rejected: { index: number; reason: string }[];
}

function batchCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** `admin_set_erp_category_mappings` 결과 → 계약 타입. 형식이 다르면 null. */
export function parseErpCategoryMappingBatch(value: unknown): ErpCategoryMappingBatch | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  const changed = batchCount(result.changed);
  const unchanged = batchCount(result.unchanged);
  if (changed === null || unchanged === null || !Array.isArray(result.rejected)) return null;
  const rejected: ErpCategoryMappingBatch['rejected'] = [];
  for (const raw of result.rejected) {
    if (!raw || typeof raw !== 'object') return null;
    const entry = raw as Record<string, unknown>;
    const index = batchCount(entry.index);
    if (index === null || typeof entry.reason !== 'string') return null;
    rejected.push({ index, reason: entry.reason });
  }
  return { changed, unchanged, rejected };
}

const ERP_CATEGORY_MAPPING_ERRORS: Record<string, string> = {
  category_archived: '보관된 카테고리에는 연결할 수 없습니다.',
  category_not_leaf: '하위 카테고리가 있는 분류에는 연결할 수 없습니다. 마지막 단계 카테고리를 골라주세요.',
  category_not_found: '카테고리를 찾지 못했습니다. 새로고침한 뒤 다시 골라주세요.',
  invalid_erp_category: 'ERP 분류 이름을 확인해주세요.',
  invalid_category_id: '연결할 고객 카테고리를 다시 골라주세요.',
  duplicate_erp_category: '같은 ERP 분류가 두 번 들어 있습니다. 다시 시도해주세요.',
};

/** DB 오류·거절 사유를 운영자 문구로 바꾼다. 모르는 사유면 null. */
export function erpCategoryMappingErrorLabel(descriptor: string): string | null {
  const key = Object.keys(ERP_CATEGORY_MAPPING_ERRORS).find((reason) => descriptor.includes(reason));
  return key ? ERP_CATEGORY_MAPPING_ERRORS[key] : null;
}

/** 일괄 저장 결과 한 줄. 해제만 한 묶음이면 해제라고 말한다. */
export function erpCategoryMappingBatchMessage(
  result: Pick<ErpCategoryMappingBatch, 'changed' | 'unchanged'> & { rejected: readonly unknown[] },
  clearedOnly: boolean,
): string {
  const count = (value: number) => value.toLocaleString('ko-KR');
  const parts: string[] = [];
  if (result.changed) parts.push(`ERP 분류 ${count(result.changed)}건의 연결을 ${clearedOnly ? '해제' : '저장'}했습니다.`);
  if (result.unchanged) parts.push(`${count(result.unchanged)}건은 이미 같은 연결입니다.`);
  if (result.rejected.length) parts.push(`${count(result.rejected.length)}건은 저장하지 못했습니다. 표에서 사유를 확인해주세요.`);
  return parts.join(' ') || '바뀐 연결이 없습니다.';
}

/* DB(private.erp_item_text)처럼 공백 연속을 하나로 합치고 앞뒤 공백을 지운다. 대소문자는 그대로 비교한다. */
function sameErpText(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
  return normalize(left) === normalize(right);
}

/**
 * 연결 화면에서 고른 고객 카테고리의 정본 ERP 분류 매핑(고객 카테고리 화면)이 이 ERP 분류와
 * 다르면 그 매핑을 돌려준다. 매핑이 없거나 이름·코드 중 하나가 같으면 null.
 */
export function conflictingCategoryErpMapping<T extends Pick<AdminCategoryErpMapping, 'categoryId' | 'erpCode' | 'erpName'>>(
  erpCategory: string,
  categoryId: string,
  erpMappings: readonly T[],
): T | null {
  const mapping = erpMappings.find((entry) => entry.categoryId === categoryId);
  if (!mapping) return null;
  return sameErpText(mapping.erpName, erpCategory) || sameErpText(mapping.erpCode, erpCategory) ? null : mapping;
}

/** 한 번에 지울 수 있는 ERP 품목 수(`admin_delete_erp_items`와 같은 상한). */
export const ERP_ITEM_DELETE_LIMIT = 500;

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

/* DB private.catalog_category_name_key와 같은 키: NFKC, 소문자, 공백 제거. */
function comparable(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\s\u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]+/g, '');
}

/* ERP 분류 경로는 `>`로만 단계를 나눈다. '메모/수첩'처럼 이름에 든 '/'는 이름의 일부다(DB private.catalog_category_path_segments). */
function segments(value: string): string[] {
  return value.split('>').map((part) => part.trim()).filter(Boolean);
}

function pathKey(value: string): string {
  return segments(value).map(comparable).join('>');
}

export type ErpCategorySuggestion = {
  categoryId: string;
  /** 'erp_mapping' = 고객 카테고리의 ERP 분류 매핑과 일치, 'same_path' = `대>중>소` 전체 경로 일치 */
  basis: 'erp_mapping' | 'same_path';
  label: string;
};

/** 연결 표가 행마다 묻는 값을 미리 만들어 둔 색인. 행마다 카테고리 전체를 다시 훑지 않게 한다. */
export interface ErpCategoryIndex {
  /** 연결할 수 있는 활성 말단. `대 > 중 > 소` 경로의 가나다순. */
  readonly leaves: readonly { id: string; label: string }[];
  isLeaf(id: string): boolean;
  /** `대 > 중 > 소` 경로. 모르는 id면 null. */
  pathLabel(id: string): string | null;
  /**
   * ERP 분류 원문에 맞는 고객 카테고리 활성 말단을 하나 제안한다.
   * 고객 카테고리 화면의 ERP 분류 매핑 → 전체 경로 순으로 보고, 후보가 둘 이상이면 추정하지 않고 null을 돌려준다.
   * 말단 이름만 같은 다른 경로는 제안하지 않는다(사이트 카테고리 ≠ ERP 1:1, 10/27 회의).
   */
  suggest(erpCategory: string): ErpCategorySuggestion | null;
  /** DB가 돌려준 제안 말단(fallback_category_id)이 전체 경로 일치인지, 고객 카테고리 화면의 정본 ERP 매핑인지. */
  fallbackBasis(erpCategory: string, fallbackCategoryId: string): ErpCategorySuggestion['basis'];
}

/* 2026-11-10 실측: 말단 300개·ERP 분류 257행에서 행마다 경로를 다시 만들면 제안 계산만 625ms였다(O(행×말단×카테고리)). */
export function createErpCategoryIndex(
  categories: readonly AdminCategoryNode[],
  erpMappings: readonly Pick<AdminCategoryErpMapping, 'categoryId' | 'erpCode' | 'erpName'>[] = [],
): ErpCategoryIndex {
  const byId = new Map(categories.map((category) => [category.id, category]));
  /* lib/admin/category의 categoryPath와 같은 순회(순환 방어 포함). 다만 Map을 id마다 새로 만들지 않는다. */
  const pathOf = (id: string): string[] => {
    const names: string[] = [];
    const seen = new Set<string>();
    let current = byId.get(id);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      names.unshift(current.name);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return names;
  };
  const labelOf = (id: string) => pathOf(id).join(' > ');
  const keyOf = (id: string) => pathOf(id).map(comparable).join('>');

  const leafIds = new Set<string>();
  const leafIdsByPath = new Map<string, string[]>();
  const collator = new Intl.Collator('ko');
  const leaves: { id: string; label: string }[] = [];
  for (const category of categories) {
    if (category.archivedAt || category.childCount !== 0) continue;
    const key = keyOf(category.id);
    leafIds.add(category.id);
    leafIdsByPath.set(key, [...(leafIdsByPath.get(key) ?? []), category.id]);
    leaves.push({ id: category.id, label: labelOf(category.id) });
  }
  leaves.sort((left, right) => collator.compare(left.label, right.label));

  const mappedIds = new Map<string, string[]>();
  for (const mapping of erpMappings) {
    if (!leafIds.has(mapping.categoryId)) continue;
    for (const key of new Set([comparable(mapping.erpName), comparable(mapping.erpCode)])) {
      mappedIds.set(key, [...(mappedIds.get(key) ?? []), mapping.categoryId]);
    }
  }

  const unique = (ids: readonly string[], basis: ErpCategorySuggestion['basis']): ErpCategorySuggestion | null => {
    const distinct = [...new Set(ids)];
    return distinct.length === 1 ? { categoryId: distinct[0], basis, label: labelOf(distinct[0]) } : null;
  };

  return {
    leaves,
    isLeaf: (id) => leafIds.has(id),
    pathLabel: (id) => byId.has(id) ? labelOf(id) : null,
    suggest(erpCategory) {
      const target = comparable(erpCategory);
      if (!target) return null;
      const mapped = mappedIds.get(target);
      if (mapped) return unique(mapped, 'erp_mapping');
      const key = pathKey(erpCategory);
      return key ? unique(leafIdsByPath.get(key) ?? [], 'same_path') : null;
    },
    fallbackBasis(erpCategory, fallbackCategoryId) {
      const key = pathKey(erpCategory);
      return key && keyOf(fallbackCategoryId) === key ? 'same_path' : 'erp_mapping';
    },
  };
}
