import { isUuid } from '@/lib/uuid';
import { isGoodType } from '@/lib/goods-taxonomy';
import { z } from 'zod';

export const CATEGORY_MAX_DEPTH = 4;
export const CATEGORY_CODE_MAX_LENGTH = 80;
export const CATEGORY_NAME_MAX_LENGTH = 120;
export const CATEGORY_PATH = '/admin/catalog/categories';
export const CATEGORY_EXPORT_API_PATH = '/api/admin/categories/export';

export const CATEGORY_CODE_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export type CategoryStatus = 'active' | 'archived';
export type CategoryMigrationStatus = 'suggested' | 'confirmed' | 'rejected';

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
  /**
   * 이 카테고리에 연결한 상품 유형(SHEET-003·ADR-0037). 비어 있으면 가까운 상위 카테고리의 연결값을 따른다.
   * 상품 유형을 쓰지 않는 화면의 목록은 싣지 않아도 된다(없음으로 본다).
   */
  goodType?: string | null;
}

export interface AdminCategoryErpMapping {
  categoryId: string;
  erpCode: string;
  erpName: string;
  source: string;
  verifiedAt: string | null;
  verifiedBy: string | null;
}

export interface AdminCategoryMigration {
  type: string;
  categoryId: string | null;
  status: CategoryMigrationStatus;
  note: string | null;
  updatedAt: string;
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
  migrations: AdminCategoryMigration[];
  activation: AdminCategoryActivation;
}

export interface CategoryFormValues {
  id: string | null;
  code: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  expectedUpdatedAt: string | null;
  /** 상품 유형 연결. '' = 연결 안 함(상위를 따른다), null = 이 칸 없이 보낸 요청(저장된 값을 그대로 둔다). */
  goodType: string | null;
}

export type CategoryValidationError =
  | 'invalid_id'
  | 'invalid_code'
  | 'invalid_name'
  | 'invalid_parent'
  | 'invalid_sort_order'
  | 'invalid_good_type'
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
  goodType?: unknown;
}): { ok: true; value: CategoryFormValues } | { ok: false; errors: Partial<Record<CategoryValidationError, string>> } {
  const goodType = input.goodType == null ? null : String(input.goodType).trim();
  const goodTypeValid = goodType === null || goodType === '' || isGoodType(goodType);
  const raw = {
    id: input.id == null || input.id === '' ? null : String(input.id).trim(),
    code: normalizeCategoryCode(input.code),
    name: normalizeCategoryName(input.name),
    parentId: input.parentId == null || input.parentId === '' ? null : String(input.parentId).trim(),
    sortOrder: input.sortOrder == null || input.sortOrder === '' ? 0 : Number(input.sortOrder),
    expectedUpdatedAt: input.expectedUpdatedAt == null || input.expectedUpdatedAt === '' ? null : String(input.expectedUpdatedAt),
  };
  const parsed = categoryFormSchema.safeParse(raw);
  if (parsed.success && goodTypeValid && (parsed.data.id === null || isCategoryId(parsed.data.id))
    && (parsed.data.parentId === null || isCategoryId(parsed.data.parentId))
    && (parsed.data.expectedUpdatedAt === null || !Number.isNaN(Date.parse(parsed.data.expectedUpdatedAt)))) {
    return { ok: true, value: { ...parsed.data, goodType } };
  }

  const errors: Partial<Record<CategoryValidationError, string>> = {};
  if (raw.id !== null && !isCategoryId(raw.id)) errors.invalid_id = '카테고리 ID가 올바르지 않습니다.';
  if (!CATEGORY_CODE_PATTERN.test(raw.code) || raw.code.length > CATEGORY_CODE_MAX_LENGTH) {
    errors.invalid_code = '코드는 영문 소문자·숫자·하이픈으로 입력해주세요.';
  }
  if (!raw.name || raw.name.length > CATEGORY_NAME_MAX_LENGTH) errors.invalid_name = '카테고리 이름을 입력해주세요.';
  if (raw.parentId !== null && !isCategoryId(raw.parentId)) errors.invalid_parent = '부모 카테고리가 올바르지 않습니다.';
  if (!Number.isSafeInteger(raw.sortOrder) || raw.sortOrder < 0) errors.invalid_sort_order = '순서는 0 이상의 정수여야 합니다.';
  if (!goodTypeValid) errors.invalid_good_type = '상품 유형은 정해진 분류 중에서 고르거나 연결 안 함으로 두세요.';
  if (raw.id !== null && !raw.expectedUpdatedAt) errors.missing_expected_version = '최신 카테고리를 확인한 뒤 다시 저장해주세요.';
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

export interface CategoryGoodTypeSource {
  /** 파생된 상품 유형. 대표 카테고리 경로 어디에도 연결이 없으면 ''. */
  type: string;
  /** 그 값을 연결한 카테고리. 없으면 null. */
  categoryId: string | null;
  /** 상위 카테고리에서 물려받은 값인가. */
  inherited: boolean;
}

/**
 * 상품 유형(SHEET-003·ADR-0037): 카테고리에 연결한 값, 없으면 가까운 상위 카테고리의 값이다.
 * DB private.goods_category_type과 같은 규칙의 화면용 판정이다(공개 판정은 서버가 한다).
 */
export function categoryGoodTypeSource(nodes: readonly Pick<AdminCategoryNode, 'id' | 'parentId' | 'goodType'>[], id: string | null | undefined): CategoryGoodTypeSource {
  if (!id) return { type: '', categoryId: null, inherited: false };
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.goodType) return { type: current.goodType, categoryId: current.id, inherited: current.id !== id };
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return { type: '', categoryId: null, inherited: false };
}

/** 대표 카테고리에서 파생한 상품 유형. 없으면 ''. */
export function categoryGoodType(nodes: readonly Pick<AdminCategoryNode, 'id' | 'parentId' | 'goodType'>[], id: string | null | undefined): string {
  return categoryGoodTypeSource(nodes, id).type;
}

export function categoryParentOptions(nodes: readonly AdminCategoryNode[], editingId: string | null): AdminCategoryNode[] {
  const descendants = editingId ? categoryDescendantIds(nodes, editingId) : new Set<string>();
  return nodes.filter((node) => !node.archivedAt && node.id !== editingId && !descendants.has(node.id));
}

export function categoryActivationLabel(activation: AdminCategoryActivation): string {
  if (activation.customerEnabled && activation.erpEnabled) return '고객 분류·ERP 활성';
  if (activation.customerEnabled) return '고객 분류 활성 · ERP 미설정';
  if (activation.erpEnabled) return 'ERP 활성 · 고객 분류 미설정';
  return '검토 중 · 기존 유형 유지';
}

export function categoryWorkspaceHref(): string {
  return CATEGORY_PATH;
}

export function categoryExportHref(): string {
  return CATEGORY_EXPORT_API_PATH;
}
