import { isUuid } from '@/lib/uuid';
import { z } from 'zod';

export const CATEGORY_MAX_DEPTH = 4;
export const CATEGORY_CODE_MAX_LENGTH = 80;
export const CATEGORY_NAME_MAX_LENGTH = 120;
export const CATEGORY_PATH = '/admin/catalog/categories';
export const CATEGORY_EXPORT_API_PATH = '/api/admin/categories/export';

export const CATEGORY_CODE_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export type CategoryStatus = 'active' | 'archived';

export interface AdminCategoryNode {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  depth: number;
  sortOrder: number;
  archivedAt: string | null;
  updatedAt: string;
  childCount: number;
  assignedGoodCount: number;
}

export interface AdminCategoryErpMapping {
  categoryId: string;
  erpCode: string;
  erpName: string;
  /** 예전에 적어 둔 출처·검증 시각. 2026-11-26부터 화면에서 받지 않아 새로 저장한 줄은 비어 있다(지우지 않고 그대로 둔다). */
  source: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
}

export interface CategoryEvidence {
  source: string;
  reference: string;
  verifiedAt: string;
  verifiedBy?: string;
}

export interface AdminCategoryActivation {
  customerEnabled: boolean;
  erpEnabled: boolean;
  customerEvidence: CategoryEvidence | null;
  erpEvidence: CategoryEvidence | null;
  updatedAt: string | null;
}

export interface AdminCategoryWorkspaceData {
  categories: AdminCategoryNode[];
  mappings: AdminCategoryErpMapping[];
  activation: AdminCategoryActivation;
}

export interface CategoryFormValues {
  id: string | null;
  code: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  expectedUpdatedAt: string | null;
}

export type CategoryValidationError =
  | 'invalid_id'
  | 'invalid_code'
  | 'invalid_name'
  | 'invalid_parent'
  | 'invalid_sort_order'
  | 'missing_expected_version';

const categoryFormSchema = z.object({
  id: z.string().nullable(),
  code: z.string().trim().min(1).max(CATEGORY_CODE_MAX_LENGTH).regex(CATEGORY_CODE_PATTERN),
  name: z.string().trim().min(1).max(CATEGORY_NAME_MAX_LENGTH),
  parentId: z.string().nullable(),
  sortOrder: z.number().int().min(0).max(2_147_483_647),
  expectedUpdatedAt: z.string().nullable(),
});

export function isCategoryId(value: unknown): value is string {
  return isUuid(value);
}

export function normalizeCategoryCode(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeCategoryName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeCategoryForm(input: {
  id?: unknown;
  code?: unknown;
  name?: unknown;
  parentId?: unknown;
  sortOrder?: unknown;
  expectedUpdatedAt?: unknown;
}): { ok: true; value: CategoryFormValues } | { ok: false; errors: Partial<Record<CategoryValidationError, string>> } {
  const raw = {
    id: input.id == null || input.id === '' ? null : String(input.id).trim(),
    code: normalizeCategoryCode(input.code),
    name: normalizeCategoryName(input.name),
    parentId: input.parentId == null || input.parentId === '' ? null : String(input.parentId).trim(),
    sortOrder: input.sortOrder == null || input.sortOrder === '' ? 0 : Number(input.sortOrder),
    expectedUpdatedAt: input.expectedUpdatedAt == null || input.expectedUpdatedAt === '' ? null : String(input.expectedUpdatedAt),
  };
  const parsed = categoryFormSchema.safeParse(raw);
  if (parsed.success && (parsed.data.id === null || isCategoryId(parsed.data.id))
    && (parsed.data.parentId === null || isCategoryId(parsed.data.parentId))
    && (parsed.data.expectedUpdatedAt === null || !Number.isNaN(Date.parse(parsed.data.expectedUpdatedAt)))) {
    return { ok: true, value: parsed.data };
  }

  const errors: Partial<Record<CategoryValidationError, string>> = {};
  if (raw.id !== null && !isCategoryId(raw.id)) errors.invalid_id = '카테고리를 찾지 못했습니다. 새로고침한 뒤 다시 골라주세요.';
  if (!CATEGORY_CODE_PATTERN.test(raw.code) || raw.code.length > CATEGORY_CODE_MAX_LENGTH) {
    errors.invalid_code = `카테고리 코드는 영문 소문자·숫자·하이픈(-)만 쓰고, 영문이나 숫자로 시작해야 합니다. ${CATEGORY_CODE_MAX_LENGTH}자까지 쓸 수 있습니다.`;
  }
  if (!raw.name || raw.name.length > CATEGORY_NAME_MAX_LENGTH) errors.invalid_name = `카테고리 이름을 입력해주세요. ${CATEGORY_NAME_MAX_LENGTH}자까지 쓸 수 있습니다.`;
  if (raw.parentId !== null && !isCategoryId(raw.parentId)) errors.invalid_parent = '상위 카테고리를 찾지 못했습니다. 새로고침한 뒤 상위 카테고리를 다시 골라주세요.';
  /* 순서는 화면이 계산해 보내는 값이다(목록의 [위로]·[아래로]). 운영자가 고칠 칸이 없으므로 새로고침을 안내한다. */
  if (!Number.isSafeInteger(raw.sortOrder) || raw.sortOrder < 0) errors.invalid_sort_order = '카테고리 순서를 읽지 못했습니다. 새로고침한 뒤 다시 저장해주세요.';
  if (raw.id !== null && !raw.expectedUpdatedAt) errors.missing_expected_version = '새로고침해 최신 카테고리를 확인한 뒤 다시 저장해주세요.';
  return { ok: false, errors };
}

export function categoryDepthMap(nodes: readonly Pick<AdminCategoryNode, 'id' | 'parentId'>[]): Map<string, number> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const depths = new Map<string, number>();
  const visiting = new Set<string>();

  const visit = (id: string): number => {
    const known = depths.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return Number.POSITIVE_INFINITY;
    const node = byId.get(id);
    if (!node) return Number.POSITIVE_INFINITY;
    visiting.add(id);
    const depth = node.parentId === null ? 1 : visit(node.parentId) + 1;
    visiting.delete(id);
    depths.set(id, depth);
    return depth;
  };

  for (const node of nodes) visit(node.id);
  return depths;
}

export function categoryDescendantIds(nodes: readonly Pick<AdminCategoryNode, 'id' | 'parentId'>[], id: string): Set<string> {
  const descendants = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (node.parentId === id || descendants.has(node.parentId ?? '')) {
        if (!descendants.has(node.id)) {
          descendants.add(node.id);
          changed = true;
        }
      }
    }
  }
  return descendants;
}

export function validateCategoryMove(
  nodes: readonly Pick<AdminCategoryNode, 'id' | 'parentId'>[],
  categoryId: string,
  parentId: string | null,
): 'category_not_found' | 'parent_not_found' | 'category_cycle' | 'category_depth_exceeded' | null {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (!byId.has(categoryId)) return 'category_not_found';
  if (parentId !== null && !byId.has(parentId)) return 'parent_not_found';
  if (parentId === categoryId || (parentId && categoryDescendantIds(nodes, categoryId).has(parentId))) return 'category_cycle';

  const nextNodes = nodes.map((node) => node.id === categoryId ? { ...node, parentId } : node);
  const depths = categoryDepthMap(nextNodes);
  if ([...depths.values()].some((depth) => !Number.isFinite(depth) || depth > CATEGORY_MAX_DEPTH)) return 'category_depth_exceeded';
  return null;
}

export function isCategoryLeaf(nodes: readonly Pick<AdminCategoryNode, 'id' | 'parentId' | 'archivedAt'>[], id: string): boolean {
  return !nodes.some((node) => node.parentId === id && !node.archivedAt);
}

export function categoryPath(nodes: readonly Pick<AdminCategoryNode, 'id' | 'parentId' | 'name'>[], id: string): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const result: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    result.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return result;
}

/** 카테고리 목록의 줄 순서: 순서 값 → 코드. 화면(트리·선택창·순서 바꾸기)이 모두 이 순서를 쓴다. */
export function compareCategoryOrder(left: Pick<AdminCategoryNode, 'sortOrder' | 'code'>, right: Pick<AdminCategoryNode, 'sortOrder' | 'code'>): number {
  return left.sortOrder - right.sortOrder || left.code.localeCompare(right.code);
}

/** 같은 상위 아래의 카테고리(보관한 것 포함)를 목록 순서대로. `parentId`가 null이면 최상위다. */
export function categorySiblings<Node extends Pick<AdminCategoryNode, 'parentId' | 'sortOrder' | 'code'>>(nodes: readonly Node[], parentId: string | null): Node[] {
  return nodes.filter((node) => node.parentId === parentId).sort(compareCategoryOrder);
}

/** 상위 카테고리 아래에 하위가 오는 목록 순서(카테고리 목록에 보이는 순서). 상위를 찾지 못하는 줄은 최상위로 본다. */
export function categoriesInTreeOrder<Node extends Pick<AdminCategoryNode, 'id' | 'parentId' | 'sortOrder' | 'code'>>(nodes: readonly Node[]): Node[] {
  const ids = new Set(nodes.map((node) => node.id));
  const children = new Map<string, Node[]>();
  for (const node of nodes) {
    const parent = node.parentId && ids.has(node.parentId) ? node.parentId : '';
    children.set(parent, [...(children.get(parent) ?? []), node]);
  }
  const ordered: Node[] = [];
  const seen = new Set<string>();
  const visit = (parent: string) => {
    for (const node of [...(children.get(parent) ?? [])].sort(compareCategoryOrder)) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      ordered.push(node);
      visit(node.id);
    }
  };
  visit('');
  return ordered;
}

/** 이 카테고리 아래로 몇 단계가 더 있는가(하위가 없으면 0). 보관한 하위도 센다 — 저장할 때의 단계 검사가 그렇게 센다. */
export function categorySubtreeHeight(nodes: readonly Pick<AdminCategoryNode, 'id' | 'parentId'>[], id: string): number {
  const descendants = categoryDescendantIds(nodes, id);
  if (!descendants.size) return 0;
  const depths = categoryDepthMap(nodes);
  const own = depths.get(id) ?? Number.POSITIVE_INFINITY;
  return Math.max(0, ...[...descendants].map((descendant) => (depths.get(descendant) ?? Number.POSITIVE_INFINITY) - own));
}

/**
 * 상위 카테고리로 고를 수 있는 카테고리(목록 순서). 저장할 때 거절되는 것은 여기서 미리 뺀다(화면 규칙 2):
 * 보관했거나 보관한 상위 아래에 있는 것, 자기 자신과 자기 하위, 넣으면 4단계를 넘는 것, 상품이 연결된 것.
 * 지금의 상위는 상품이 연결돼 있어도 남긴다 — 상위를 바꾸지 않는 저장은 그 검사를 받지 않는다.
 */
export function categoryParentOptions(nodes: readonly AdminCategoryNode[], editingId: string | null): AdminCategoryNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const depths = categoryDepthMap(nodes);
  const descendants = editingId ? categoryDescendantIds(nodes, editingId) : new Set<string>();
  const height = editingId ? categorySubtreeHeight(nodes, editingId) : 0;
  const currentParentId = editingId ? byId.get(editingId)?.parentId ?? null : null;
  const underArchived = (node: AdminCategoryNode) => {
    const seen = new Set<string>();
    for (let current: AdminCategoryNode | undefined = node; current && !seen.has(current.id); current = current.parentId ? byId.get(current.parentId) : undefined) {
      seen.add(current.id);
      if (current.archivedAt) return true;
    }
    return false;
  };
  return categoriesInTreeOrder(nodes).filter((node) => {
    if (node.id === editingId || descendants.has(node.id) || underArchived(node)) return false;
    const depth = depths.get(node.id) ?? Number.POSITIVE_INFINITY;
    if (!Number.isFinite(depth) || depth + 1 + height > CATEGORY_MAX_DEPTH) return false;
    return node.assignedGoodCount === 0 || node.id === currentParentId;
  });
}

/** 새로 넣거나 다른 상위로 옮긴 카테고리가 받는 순서 값: 그 상위 아래 맨 끝. */
export function nextCategorySortOrder(nodes: readonly Pick<AdminCategoryNode, 'id' | 'parentId' | 'sortOrder'>[], parentId: string | null, exceptId: string | null = null): number {
  const orders = nodes.filter((node) => node.parentId === parentId && node.id !== exceptId).map((node) => node.sortOrder);
  return orders.length ? Math.max(...orders) + 1 : 0;
}

/**
 * [위로]·[아래로]를 눌렀을 때의 새 순서: 같은 상위 아래의 카테고리 전체(보관 포함)의 번호를 새 순서대로.
 * 맨 위에서 위로, 맨 아래에서 아래로는 옮길 곳이 없어 null이다.
 */
export function categoryMoveOrder(nodes: readonly AdminCategoryNode[], id: string, direction: 'up' | 'down'): { parentId: string | null; orderedIds: string[] } | null {
  const target = nodes.find((node) => node.id === id);
  if (!target) return null;
  const siblings = categorySiblings(nodes, target.parentId);
  const from = siblings.findIndex((node) => node.id === id);
  const to = direction === 'up' ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= siblings.length) return null;
  const orderedIds = siblings.map((node) => node.id);
  [orderedIds[from], orderedIds[to]] = [orderedIds[to], orderedIds[from]];
  return { parentId: target.parentId, orderedIds };
}

/** 코드를 비워 둔 새 카테고리의 자동 코드. 작업 번호에서 만들어, 같은 저장을 다시 보내도 같은 코드가 된다(일괄 등록의 `c-…`와 같은 모양). */
export function categoryAutoCode(operationId: string): string {
  return `c-${operationId.replaceAll('-', '').slice(0, 10).toLowerCase()}`;
}

/**
 * 보관 확인창에 적는 내용. 보관해도 연결은 남고 상품은 그대로 판매된다(admin_archive_category는 상품을 건드리지 않는다).
 * 다만 고객 화면의 카테고리 목록과 카테고리 쿠폰은 보관한 카테고리를 건너뛴다
 * (private.category_display_matching_goods·private.coupon_good_matches). 다른 카테고리로도 연결된 상품은 그 카테고리로 계속 나온다.
 */
export function categoryArchiveConfirm(category: Pick<AdminCategoryNode, 'name' | 'assignedGoodCount'>): { title: string; message: string; confirmLabel: string } {
  const goods = category.assignedGoodCount;
  return {
    title: `'${category.name}' 카테고리를 보관할까요?`,
    message: goods > 0
      ? `연결된 상품 ${goods.toLocaleString('ko-KR')}개는 그대로 판매됩니다. 다만 고객 화면의 카테고리 목록에 이 카테고리로는 나오지 않고, 카테고리 쿠폰도 이 카테고리로는 적용되지 않습니다. 보관한 카테고리는 상품에 새로 연결할 수 없습니다. [복원]을 누르면 되돌아옵니다.`
      : '연결된 상품은 없습니다. 보관한 카테고리는 상품에 새로 연결할 수 없습니다. [복원]을 누르면 되돌아옵니다.',
    confirmLabel: '보관',
  };
}

export function categoryWorkspaceHref(): string {
  return CATEGORY_PATH;
}

export function categoryExportHref(): string {
  return CATEGORY_EXPORT_API_PATH;
}
