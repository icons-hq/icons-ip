import { z } from 'zod';

export const CATEGORY_MAX_DEPTH = 4;
export const CATEGORY_CODE_MAX_LENGTH = 80;
export const CATEGORY_NAME_MAX_LENGTH = 120;
export const CATEGORY_PATH = '/admin/catalog/categories';
export const CATEGORY_EXPORT_API_PATH = '/api/admin/categories/export';

export const CATEGORY_CODE_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  return typeof value === 'string' && UUID_PATTERN.test(value);
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
  if (raw.id !== null && !isCategoryId(raw.id)) errors.invalid_id = '카테고리 ID가 올바르지 않습니다.';
  if (!CATEGORY_CODE_PATTERN.test(raw.code) || raw.code.length > CATEGORY_CODE_MAX_LENGTH) {
    errors.invalid_code = '코드는 영문 소문자·숫자·하이픈으로 입력해주세요.';
  }
  if (!raw.name || raw.name.length > CATEGORY_NAME_MAX_LENGTH) errors.invalid_name = '카테고리 이름을 입력해주세요.';
  if (raw.parentId !== null && !isCategoryId(raw.parentId)) errors.invalid_parent = '부모 카테고리가 올바르지 않습니다.';
  if (!Number.isSafeInteger(raw.sortOrder) || raw.sortOrder < 0) errors.invalid_sort_order = '순서는 0 이상의 정수여야 합니다.';
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
