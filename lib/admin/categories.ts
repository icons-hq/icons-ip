import type { AdminFieldErrors, AdminFormResult } from './catalog';
import type { AdminCatalogSearchQuery } from './catalog-list';

/*
 * D-9 상품 분류 · D-10 판매 기간 — 순수 모듈(타입 · 트리 조립 · URL 계약 · 폼 정규화).
 *
 * 데이터 계약은 마이그레이션 `20260904130000`~`20260904130400` 이 정본이다. 판매 상태는 저장되지 않고
 * 조회 시 파생되므로(`good_sale_state`), 화면은 서버가 내려준 상태 문자열을 그대로 그린다 —
 * 브라우저 시계로 다시 판정하지 않는다(시계가 어긋나면 배지와 주문 결과가 갈린다).
 */

export const CATEGORY_KINDS = [
  { value: 'catalog', label: '상품 분류 (트리)' },
  { value: 'collection', label: '기획전 (평면)' },
] as const;

export const CATEGORY_STATUSES = [
  { value: 'active', label: '표시' },
  { value: 'hidden', label: '숨김' },
] as const;

export const CATEGORY_DISPLAY_MODES = [
  { value: 'manual', label: '사용자 지정 순서' },
  { value: 'auto', label: '자동 정렬' },
  { value: 'mixed', label: '혼합 (고정 핀 + 자동)' },
] as const;

export const CATEGORY_AUTO_SORT_KEYS = [
  { value: 'newest', label: '최근 등록순' },
  { value: 'updated', label: '최근 수정순' },
  { value: 'name', label: '상품명순' },
  { value: 'price_asc', label: '판매가 낮은순' },
  { value: 'price_desc', label: '판매가 높은순' },
] as const;

export const CATEGORY_MAX_DEPTH = 4;

/** 판매 상태 8단. 우선순위는 DB `good_sale_state` 와 같고, 여기서는 표기만 갖는다. */
export const GOOD_SALE_STATES = [
  { value: 'on_sale', label: '판매중', tone: 'ok' },
  { value: 'preorder', label: '선주문', tone: 'info' },
  { value: 'soldout', label: '품절', tone: 'warn' },
  { value: 'scheduled', label: '판매 예정', tone: 'info' },
  { value: 'ended', label: '기간 만료', tone: 'muted' },
  { value: 'stopped', label: '판매 중지', tone: 'warn' },
  { value: 'hidden', label: '진열 안 함', tone: 'muted' },
  { value: 'archived', label: '보관', tone: 'muted' },
] as const;

export type AdminGoodSaleState = (typeof GOOD_SALE_STATES)[number]['value'];

export const GOOD_SALE_STATE_LABELS: Record<string, string> = Object.fromEntries(
  GOOD_SALE_STATES.map((state) => [state.value, state.label]),
);

export const GOOD_SALE_STATE_TONES: Record<string, string> = Object.fromEntries(
  GOOD_SALE_STATES.map((state) => [state.value, state.tone]),
);

/** 구매 가능한 상태. DB `good_purchasable` 과 같은 집합이다. */
export function isPurchasableSaleState(state: string) {
  return state === 'on_sale' || state === 'preorder';
}

export const TAX_TYPES = [
  { value: 'taxable', label: '과세' },
  { value: 'exempt', label: '면세' },
  { value: 'zero_rated', label: '영세' },
] as const;

export interface AdminCategory {
  id: string;
  kind: string;
  parentId: string | null;
  name: string;
  description: string | null;
  path: string;
  depth: number;
  position: number;
  status: string;
  isInternal: boolean;
  displayMode: string;
  autoSortKey: string;
  soldoutLast: boolean;
  includeDescendants: boolean;
  heroImagePath: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  archivedAt: string | null;
  /** 이 분류에 직접 속한 상품 수. */
  goodsCount: number;
  /** 하위 분류까지 포함한 상품 수(중복 제거). */
  descendantGoodsCount: number;
  /** `erp` = K-System 품목분류에서 동기화한 노드(이름·위치 잠금) · `store` = 어드민이 만든 노드. */
  source: string;
  /** ERP 자연키(이름 경로 「문구 > 노트 > 스프링노트」). ERP 노드에만 있다. */
  erpKey: string | null;
  erpSyncedAt: string | null;
  /** 마지막 동기화 목록에 없던 ERP 노드 — 지우지 않고 숨긴다. */
  erpRemovedAt: string | null;
}

export const CATEGORY_SOURCE_ERP = 'erp';

/** ERP 노드인지. 정체(이름·부모·순서)는 ERP 가 원본이라 화면이 편집 칸을 잠근다. */
export function isErpCategory(category: Pick<AdminCategory, 'source'>) {
  return category.source === CATEGORY_SOURCE_ERP;
}

/** ERP 잎(소분류) — 자체 분류를 매달 수 있는 유일한 자리. DB `private.is_erp_leaf_category` 와 같은 규칙. */
export function isErpLeafCategory(category: AdminCategory, categories: readonly AdminCategory[]) {
  if (!isErpCategory(category) || category.archivedAt) return false;
  return !categories.some((child) => child.parentId === category.id && isErpCategory(child));
}

export interface AdminCategoryNode extends AdminCategory {
  children: AdminCategoryNode[];
}

/** path 순으로 정렬된 평면 목록을 트리로 접는다. 부모가 없는 항목은 뿌리로 올린다. */
export function buildCategoryTree(categories: readonly AdminCategory[]): AdminCategoryNode[] {
  const nodes = new Map<string, AdminCategoryNode>();
  for (const category of categories) nodes.set(category.id, { ...category, children: [] });

  const roots: AdminCategoryNode[] = [];
  for (const category of categories) {
    const node = nodes.get(category.id);
    if (!node) continue;
    const parent = category.parentId ? nodes.get(category.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sort = (list: AdminCategoryNode[]) => {
    list.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    for (const node of list) sort(node.children);
  };
  sort(roots);
  return roots;
}

/** 트리를 화면이 그릴 순서(깊이 우선)로 편다. */
export function flattenCategoryTree(nodes: readonly AdminCategoryNode[]): AdminCategoryNode[] {
  return nodes.flatMap((node) => [node, ...flattenCategoryTree(node.children)]);
}

/** 어느 분류의 자손인지. 부모 선택기가 자기 자신·자손을 고르지 못하게 막는 데 쓴다. */
export function isDescendantCategory(candidate: Pick<AdminCategory, 'path'>, ancestorId: string) {
  return candidate.path.includes(`/${ancestorId}/`);
}

/**
 * 자체 분류를 매달 수 있는 상위 분류 = ERP 잎(소분류)뿐이다. 1~3단은 ERP 가 원본이라 그 사이에 우리 노드를 끼우지 않는다 —
 * 그래야 어떤 굿즈든 대표 분류의 조상 셋이 항상 ERP 대/중/소분류다(ERP 엑셀의 분류 열이 확정값이 되는 조건).
 */
export function categoryParentOptions(
  categories: readonly AdminCategory[],
  selfId: string | null,
): AdminCategory[] {
  return categories.filter((category) => {
    if (category.kind !== 'catalog') return false;
    if (selfId && (category.id === selfId || isDescendantCategory(category, selfId))) return false;
    return isErpLeafCategory(category, categories) && category.depth < CATEGORY_MAX_DEPTH;
  });
}

export interface AdminCategoryOption {
  id: string;
  /** 그룹 안에서 보이는 이름. 자체 분류는 「└ 이름」으로 ERP 잎 아래임을 드러낸다. */
  label: string;
  source: string;
}

export interface AdminCategoryOptionGroup {
  /** 「대분류 › 중분류」 또는 「기획전」. */
  label: string;
  options: AdminCategoryOption[];
}

/** 분류 이름 경로 — 「리빙 › 홈데코 › 장식소품」. 굿즈 편집·목록이 대표 분류를 한 줄로 보여 줄 때 쓴다. */
export function categoryPathLabel(category: Pick<AdminCategory, 'path'>, categories: readonly AdminCategory[]) {
  const byId = new Map(categories.map((entry) => [entry.id, entry]));
  return category.path
    .split('/')
    .filter(Boolean)
    .map((id) => byId.get(id)?.name ?? id)
    .join(' › ');
}

/**
 * 굿즈 편집의 분류 선택지. 350개를 한 줄로 늘어놓으면 못 고르므로 「대 › 중」 묶음(optgroup) 아래에
 * ERP 소분류와 그 밑의 자체 분류를 둔다. 기획전은 맨 뒤 한 묶음. 보관·ERP 삭제 표시 노드는 뺀다.
 */
export function categoryOptionGroups(categories: readonly AdminCategory[]): AdminCategoryOptionGroup[] {
  const usable = categories.filter((category) => !category.archivedAt && !category.erpRemovedAt);
  const byId = new Map(usable.map((entry) => [entry.id, entry]));
  const groups = new Map<string, AdminCategoryOptionGroup>();
  const sorted = [...usable].sort((a, b) => a.path.localeCompare(b.path));

  for (const category of sorted) {
    if (category.kind === 'collection') {
      const group = groups.get('collection') ?? { label: '기획전', options: [] };
      group.options.push({ id: category.id, label: category.name, source: category.source });
      groups.set('collection', group);
      continue;
    }
    const isLeaf = isErpLeafCategory(category, usable);
    if (isErpCategory(category) && !isLeaf) continue;
    /* ERP 잎은 부모(중분류)까지, 자체 분류는 ERP 잎의 부모까지 올라가 그룹 이름을 만든다. */
    const anchor = isErpCategory(category) ? category : byId.get(category.parentId ?? '');
    const groupParent = anchor?.parentId ? byId.get(anchor.parentId) : null;
    const grandParent = groupParent?.parentId ? byId.get(groupParent.parentId) : null;
    const key = groupParent?.id ?? 'root';
    const label = [grandParent?.name, groupParent?.name].filter(Boolean).join(' › ') || '분류';
    const group = groups.get(key) ?? { label, options: [] };
    group.options.push({
      id: category.id,
      label: isErpCategory(category) ? category.name : `└ ${category.name}`,
      source: category.source,
    });
    groups.set(key, group);
  }

  const collection = groups.get('collection');
  groups.delete('collection');
  return [...groups.values(), ...(collection ? [collection] : [])];
}

/* ------------------------------------------------------------------------- */
/* ERP 분류 동기화 목록 (JSON 파일 업로드)                                       */
/* ------------------------------------------------------------------------- */

export interface ErpCategoryRow {
  id: string;
  key: string;
  parentKey: string | null;
  name: string;
  level: number;
  position: number;
}

export const ERP_CATEGORY_ROWS_MAX = 5000;

/**
 * `scripts/erp/erp-categories-from-xlsx.py` 가 만든 목록인지 본다. 모양만 본다 — 부모가 있는지·이름이 겹치는지는
 * DB 동기화 함수가 판단한다(거기가 원장이다).
 */
export function parseErpCategoryRows(value: unknown): { ok: true; rows: ErpCategoryRow[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: 'ERP 분류 목록은 배열이어야 합니다.' };
  if (value.length === 0) return { ok: false, error: 'ERP 분류 목록이 비어 있습니다.' };
  if (value.length > ERP_CATEGORY_ROWS_MAX) return { ok: false, error: `ERP 분류 목록은 ${ERP_CATEGORY_ROWS_MAX}행까지입니다.` };
  const rows: ErpCategoryRow[] = [];
  for (const [index, item] of value.entries()) {
    const row = item as Partial<Record<keyof ErpCategoryRow, unknown>> | null;
    const id = typeof row?.id === 'string' ? row.id.trim() : '';
    const key = typeof row?.key === 'string' ? row.key.trim() : '';
    const name = typeof row?.name === 'string' ? row.name.trim() : '';
    const parentKey = row?.parentKey === null || row?.parentKey === undefined ? null : String(row.parentKey).trim();
    const level = Number(row?.level);
    const position = Number(row?.position);
    const problem = !SLUG_PATTERN.test(id) ? '코드'
      : !key || key.length > 200 ? '키'
      : !name || name.length > 60 ? '이름'
      : !Number.isInteger(level) || level < 1 || level > 3 ? '단계'
      : !Number.isInteger(position) || position < 0 ? '순서'
      : (level === 1) !== (parentKey === null || parentKey === '') ? '상위 키'
      : null;
    if (problem) return { ok: false, error: `${index + 1}번째 행의 ${problem}이(가) 올바르지 않습니다.` };
    rows.push({ id, key, parentKey: parentKey || null, name, level, position });
  }
  return { ok: true, rows };
}

/* ------------------------------------------------------------------------- */
/* URL 계약                                                                    */
/* ------------------------------------------------------------------------- */

export const ADMIN_CATEGORY_PATH = '/admin/catalog/categories';
export const ADMIN_CATEGORY_NEW_RECORD = 'new';

export interface AdminCategoryFilters {
  /** 편집 중인 분류 id 또는 `new`. */
  selected: string | null;
  /** 새 분류를 만들 때 미리 고른 부모. */
  parent: string | null;
  /** 보관된 분류까지 보기. */
  archived: boolean;
}

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

function singleParam(value: string | string[] | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeAdminCategoryFilters(query: AdminCatalogSearchQuery): AdminCategoryFilters {
  const selected = singleParam(query.selected);
  const parent = singleParam(query.parent);
  const archived = singleParam(query.archived);
  return {
    selected: selected === ADMIN_CATEGORY_NEW_RECORD || SLUG_PATTERN.test(selected) ? selected : null,
    parent: SLUG_PATTERN.test(parent) ? parent : null,
    archived: archived === '1' || archived === 'true',
  };
}

export function adminCategoryHref(filters: AdminCategoryFilters, patch: Partial<AdminCategoryFilters> = {}) {
  const next = { ...filters, ...patch };
  const search = new URLSearchParams();
  if (next.selected) search.set('selected', next.selected);
  if (next.parent) search.set('parent', next.parent);
  if (next.archived) search.set('archived', '1');
  const query = search.toString();
  return query ? `${ADMIN_CATEGORY_PATH}?${query}` : ADMIN_CATEGORY_PATH;
}

/* ------------------------------------------------------------------------- */
/* 폼 정규화                                                                   */
/* ------------------------------------------------------------------------- */

function readString(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function readFlag(formData: FormData, name: string) {
  return formData.get(name) === 'on';
}

export interface AdminCategoryFormValue {
  id: string;
  previousId: string | null;
  name: string;
  parentId: string | null;
  kind: string;
  description: string | null;
  status: string;
  isInternal: boolean;
  displayMode: string;
  autoSortKey: string;
  soldoutLast: boolean;
  includeDescendants: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
}

export function normalizeAdminCategoryForm(formData: FormData): AdminFormResult<AdminCategoryFormValue> {
  const errors: AdminFieldErrors = {};
  const id = readString(formData, 'id').toLowerCase();
  const name = readString(formData, 'name');
  const kind = readString(formData, 'kind') || 'catalog';
  const parentId = readString(formData, 'parentId');
  const status = readString(formData, 'status') || 'active';
  const displayMode = readString(formData, 'displayMode') || 'manual';
  const autoSortKey = readString(formData, 'autoSortKey') || 'newest';
  const seoTitle = readString(formData, 'seoTitle');
  const seoDescription = readString(formData, 'seoDescription');
  const description = readString(formData, 'description');

  if (!SLUG_PATTERN.test(id)) errors.id = '분류 코드는 영문 소문자·숫자·하이픈 2~64자여야 합니다.';
  if (!name || name.length > 60) errors.name = '분류 이름은 1~60자여야 합니다.';
  if (!CATEGORY_KINDS.some((entry) => entry.value === kind)) errors.kind = '분류 유형을 선택해주세요.';
  if (kind === 'collection' && parentId) errors.parentId = '기획전은 상위 분류를 가질 수 없습니다.';
  if (!CATEGORY_STATUSES.some((entry) => entry.value === status)) errors.status = '표시 상태를 선택해주세요.';
  if (!CATEGORY_DISPLAY_MODES.some((entry) => entry.value === displayMode)) errors.displayMode = '진열 방식을 선택해주세요.';
  if (!CATEGORY_AUTO_SORT_KEYS.some((entry) => entry.value === autoSortKey)) errors.autoSortKey = '정렬 기준을 선택해주세요.';
  if (description.length > 300) errors.description = '설명은 300자 이내여야 합니다.';
  if (seoTitle.length > 70) errors.seoTitle = 'SEO 제목은 70자 이내여야 합니다.';
  if (seoDescription.length > 160) errors.seoDescription = 'SEO 설명은 160자 이내여야 합니다.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      id,
      previousId: readString(formData, 'previousId').toLowerCase() || null,
      name,
      parentId: parentId || null,
      kind,
      description: description || null,
      status,
      isInternal: readFlag(formData, 'isInternal'),
      displayMode,
      autoSortKey,
      soldoutLast: readFlag(formData, 'soldoutLast'),
      includeDescendants: readFlag(formData, 'includeDescendants'),
      seoTitle: seoTitle || null,
      seoDescription: seoDescription || null,
    },
  };
}

export interface AdminGoodSaleWindowValue {
  goodId: string;
  startsAt: string | null;
  endsAt: string | null;
  saleMode: string;
  preorderShipsAt: string | null;
}

/** `datetime-local` 값(로컬 시각, 초 없음)을 그대로 넘긴다 — 서버가 timestamptz 로 해석한다. */
function readDateTime(formData: FormData, name: string) {
  const raw = readString(formData, name);
  if (!raw) return null;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(raw) ? raw : '';
}

export function normalizeGoodSaleWindowForm(formData: FormData): AdminFormResult<AdminGoodSaleWindowValue> {
  const errors: AdminFieldErrors = {};
  const goodId = readString(formData, 'goodId');
  const startsAt = readDateTime(formData, 'startsAt');
  const endsAt = readDateTime(formData, 'endsAt');
  const saleMode = readString(formData, 'saleMode') || 'regular';
  const preorderShipsAt = readString(formData, 'preorderShipsAt');

  if (!goodId) errors.form = '굿즈를 찾을 수 없습니다.';
  if (startsAt === '' || endsAt === '') errors.startsAt = '날짜와 시각을 확인해주세요.';
  if (saleMode !== 'regular' && saleMode !== 'preorder') errors.saleMode = '판매 방식을 선택해주세요.';
  if (saleMode === 'preorder' && !/^\d{4}-\d{2}-\d{2}$/.test(preorderShipsAt)) {
    errors.preorderShipsAt = '선주문은 출고 예정일이 필요합니다.';
  }
  if (startsAt && endsAt && endsAt <= startsAt) errors.endsAt = '종료는 시작보다 뒤여야 합니다.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      goodId,
      startsAt: startsAt || null,
      endsAt: endsAt || null,
      saleMode,
      preorderShipsAt: saleMode === 'preorder' ? preorderShipsAt : null,
    },
  };
}

export interface AdminGoodSearchSeoValue {
  goodId: string;
  summary: string | null;
  keywords: string[];
  seoTitle: string | null;
  seoDescription: string | null;
  imageAlt: string | null;
}

export function normalizeGoodSearchSeoForm(formData: FormData): AdminFormResult<AdminGoodSearchSeoValue> {
  const errors: AdminFieldErrors = {};
  const goodId = readString(formData, 'goodId');
  const summary = readString(formData, 'summary');
  const seoTitle = readString(formData, 'seoTitle');
  const seoDescription = readString(formData, 'seoDescription');
  const imageAlt = readString(formData, 'imageAlt');
  const keywords = Array.from(new Set(
    readString(formData, 'keywords')
      .split(/[,\n]/)
      .map((keyword) => keyword.trim().toLowerCase())
      .filter((keyword) => keyword.length > 0),
  ));

  if (!goodId) errors.form = '굿즈를 찾을 수 없습니다.';
  if (summary.length > 120) errors.summary = '요약은 120자 이내여야 합니다.';
  if (seoTitle.length > 70) errors.seoTitle = 'SEO 제목은 70자 이내여야 합니다.';
  if (seoDescription.length > 160) errors.seoDescription = 'SEO 설명은 160자 이내여야 합니다.';
  if (imageAlt.length > 125) errors.imageAlt = '이미지 설명은 125자 이내여야 합니다.';
  if (keywords.length > 50) errors.keywords = '검색어는 50개까지입니다.';
  if (keywords.some((keyword) => keyword.length > 40)) errors.keywords = '검색어 하나는 40자 이내여야 합니다.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      goodId,
      summary: summary || null,
      keywords,
      seoTitle: seoTitle || null,
      seoDescription: seoDescription || null,
      imageAlt: imageAlt || null,
    },
  };
}

export interface AdminGoodPricingValue {
  goodId: string;
  supplyPrice: number | null;
  taxType: string;
}

export function normalizeGoodPricingForm(formData: FormData): AdminFormResult<AdminGoodPricingValue> {
  const errors: AdminFieldErrors = {};
  const goodId = readString(formData, 'goodId');
  const supplyPriceRaw = readString(formData, 'supplyPrice');
  const taxType = readString(formData, 'taxType') || 'taxable';

  if (!goodId) errors.form = '굿즈를 찾을 수 없습니다.';
  if (supplyPriceRaw && !/^\d+$/.test(supplyPriceRaw)) errors.supplyPrice = '공급가는 0 이상의 정수여야 합니다.';
  if (!TAX_TYPES.some((entry) => entry.value === taxType)) errors.taxType = '과세 구분을 선택해주세요.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { goodId, supplyPrice: supplyPriceRaw ? Number(supplyPriceRaw) : null, taxType },
  };
}

/* ---------------------------------------------------------------------------
 * 현업 요청 슬라이스 1 — 할인 · KC 인증 · 구매 수량 상한
 * ------------------------------------------------------------------------- */

export const GOOD_DISCOUNT_KINDS = [
  { value: 'none', label: '할인 없음' },
  { value: 'percent', label: '정률 (%)' },
  { value: 'amount', label: '정액 (원)' },
] as const;

export const GOOD_KC_STATUSES = [
  { value: 'unknown', label: '미확인' },
  { value: 'none', label: '해당 없음' },
  { value: 'certified', label: '인증 받음' },
  { value: 'exempt', label: '면제' },
] as const;

export interface AdminGoodDiscountValue {
  goodId: string;
  kind: string;
  value: number;
  startsAt: string | null;
  endsAt: string | null;
  showsRate: boolean;
}

export function normalizeGoodDiscountForm(formData: FormData): AdminFormResult<AdminGoodDiscountValue> {
  const errors: AdminFieldErrors = {};
  const goodId = readString(formData, 'goodId');
  const kind = readString(formData, 'discountKind') || 'none';
  const rawValue = readString(formData, 'discountValue');
  const startsAt = readDateTime(formData, 'discountStartsAt');
  const endsAt = readDateTime(formData, 'discountEndsAt');

  if (!goodId) errors.form = '굿즈를 찾을 수 없습니다.';
  if (!GOOD_DISCOUNT_KINDS.some((entry) => entry.value === kind)) {
    errors.discountKind = '할인 종류를 선택해주세요.';
  }

  let value = 0;
  if (kind !== 'none') {
    if (!/^\d+$/.test(rawValue)) {
      errors.discountValue = '할인 값은 1 이상의 정수여야 합니다.';
    } else {
      value = Number(rawValue);
      /* 정률 상한을 여기서도 본다 — DB CHECK 가 막아도 화면이 이유를 말해 줘야 한다. */
      if (kind === 'percent' && (value < 1 || value > 100)) {
        errors.discountValue = '정률 할인은 1~100% 사이여야 합니다.';
      }
      if (kind === 'amount' && value < 1) {
        errors.discountValue = '정액 할인은 1원 이상이어야 합니다.';
      }
    }
  }

  /* 시작이 종료보다 늦으면 「한 번도 안 열리는 할인」이 된다 — 저장은 되고 효과만 없다. */
  if (startsAt === '') errors.discountStartsAt = '할인 시작 시각 형식이 올바르지 않습니다.';
  if (endsAt === '') errors.discountEndsAt = '할인 종료 시각 형식이 올바르지 않습니다.';
  if (kind !== 'none' && startsAt && endsAt && startsAt >= endsAt) {
    errors.discountEndsAt = '할인 종료는 시작보다 뒤여야 합니다.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      goodId,
      kind,
      value,
      startsAt: kind === 'none' ? null : (startsAt || null),
      endsAt: kind === 'none' ? null : (endsAt || null),
      showsRate: formData.get('discountShowsRate') !== null,
    },
  };
}

export interface AdminGoodComplianceValue {
  goodId: string;
  kcStatus: string;
  kcType: string | null;
  kcNumber: string | null;
  kcCompany: string | null;
  adultOnly: boolean;
  barcode: string | null;
}

export function normalizeGoodComplianceForm(
  formData: FormData,
): AdminFormResult<AdminGoodComplianceValue> {
  const errors: AdminFieldErrors = {};
  const goodId = readString(formData, 'goodId');
  const kcStatus = readString(formData, 'kcStatus') || 'unknown';
  const kcNumber = readString(formData, 'kcNumber');

  if (!goodId) errors.form = '굿즈를 찾을 수 없습니다.';
  if (!GOOD_KC_STATUSES.some((entry) => entry.value === kcStatus)) {
    errors.kcStatus = 'KC 인증 상태를 선택해주세요.';
  }
  /* 번호 없는 「인증 받음」은 표기로 쓸 수 없다 — 고시 화면에 빈칸이 나간다. */
  if (kcStatus === 'certified' && !kcNumber) {
    errors.kcNumber = '인증을 받았다면 인증번호가 있어야 합니다.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      goodId,
      kcStatus,
      kcType: readString(formData, 'kcType') || null,
      kcNumber: kcNumber || null,
      kcCompany: readString(formData, 'kcCompany') || null,
      adultOnly: formData.get('adultOnly') !== null,
      barcode: readString(formData, 'barcode') || null,
    },
  };
}

export interface AdminGoodPurchaseLimitValue {
  goodId: string;
  minOrderQty: number;
  maxOrderQty: number | null;
  maxQtyPerAccount: number | null;
}

export function normalizeGoodPurchaseLimitForm(
  formData: FormData,
): AdminFormResult<AdminGoodPurchaseLimitValue> {
  const errors: AdminFieldErrors = {};
  const goodId = readString(formData, 'goodId');
  const min = readString(formData, 'minOrderQty') || '1';
  const max = readString(formData, 'maxOrderQty');
  const perAccount = readString(formData, 'maxQtyPerAccount');

  if (!goodId) errors.form = '굿즈를 찾을 수 없습니다.';
  if (!/^\d+$/.test(min) || Number(min) < 1) {
    errors.minOrderQty = '최소 구매 수량은 1 이상의 정수여야 합니다.';
  }
  if (max && (!/^\d+$/.test(max) || Number(max) < 1)) {
    errors.maxOrderQty = '최대 구매 수량은 1 이상의 정수여야 합니다.';
  }
  if (perAccount && (!/^\d+$/.test(perAccount) || Number(perAccount) < 1)) {
    errors.maxQtyPerAccount = '계정당 상한은 1 이상의 정수여야 합니다.';
  }
  if (!errors.minOrderQty && !errors.maxOrderQty && max && Number(max) < Number(min)) {
    errors.maxOrderQty = '최대 구매 수량은 최소 수량보다 작을 수 없습니다.';
  }
  if (!errors.minOrderQty && !errors.maxQtyPerAccount && perAccount && Number(perAccount) < Number(min)) {
    errors.maxQtyPerAccount = '계정당 상한은 최소 수량보다 작을 수 없습니다.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      goodId,
      minOrderQty: Number(min),
      maxOrderQty: max ? Number(max) : null,
      maxQtyPerAccount: perAccount ? Number(perAccount) : null,
    },
  };
}
