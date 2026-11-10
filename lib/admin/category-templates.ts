import { isUuid } from '@/lib/uuid';
import type { AdminCategoryNode } from './category';

export const CATEGORY_TEMPLATES_PATH = '/admin/catalog/category-templates';
export interface CategoryTemplate { categoryId: string; code: string; name: string; path: string[]; usable: boolean; revision: number; archived: boolean; createdAt: string }
export interface CategoryTemplatePage { rows: CategoryTemplate[]; total: number; page: number; pageSize: 20 }
export interface CategoryTemplateChange { categoryId: string; revision: number }
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
export function parseCategoryTemplate(value: unknown): CategoryTemplate | null {
  const row = record(value);
  if (!row || typeof row.categoryId !== 'string' || !isUuid(row.categoryId) || typeof row.code !== 'string' || typeof row.name !== 'string'
    || !Array.isArray(row.path) || row.path.length < 1 || row.path.length > 4 || row.path.some(part => typeof part !== 'string' || !part.trim())
    || typeof row.usable !== 'boolean' || typeof row.archived !== 'boolean' || !Number.isSafeInteger(row.revision) || Number(row.revision) < 1
    || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))) return null;
  return { categoryId: row.categoryId, code: row.code, name: row.name, path: row.path as string[], usable: row.usable, archived: row.archived, revision: Number(row.revision), createdAt: row.createdAt };
}
export function parseCategoryTemplateRows(value: unknown, maximum = 100): CategoryTemplate[] | null {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const rows = value.map(parseCategoryTemplate);
  return rows.some(row => !row) || new Set(rows.map(row => row?.categoryId)).size !== rows.length ? null : rows as CategoryTemplate[];
}
export function parseCategoryTemplatePage(value: unknown): CategoryTemplatePage | null {
  const data = record(value); if (!data) return null;
  const rows = parseCategoryTemplateRows(data.rows, 20);
  if (!rows || !Number.isSafeInteger(data.total) || Number(data.total) < rows.length || !Number.isSafeInteger(data.page) || Number(data.page) < 1 || data.pageSize !== 20) return null;
  return { rows, total: Number(data.total), page: Number(data.page), pageSize: 20 };
}
export function parseCategoryTemplateChanges(value: unknown): CategoryTemplateChange[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) return null;
  const changes: CategoryTemplateChange[] = [];
  for (const item of value) {
    const row = record(item);
    if (!row || typeof row.categoryId !== 'string' || !isUuid(row.categoryId) || !Number.isSafeInteger(row.revision) || Number(row.revision) < 0 || Number(row.revision) > 999999999) return null;
    changes.push({ categoryId: row.categoryId.toLowerCase(), revision: Number(row.revision) });
  }
  return new Set(changes.map(row => row.categoryId)).size !== changes.length ? null : changes.sort((a, b) => a.categoryId.localeCompare(b.categoryId));
}
export function categoryTemplateError(message?: string): string {
  if (message === 'category_templates_changed' || message === 'operation_conflict') return '다른 저장 결과가 있습니다. 선택은 유지했습니다. 최신 목록을 다시 확인해주세요.';
  if (message === 'category_not_usable') return '사용 중인 마지막 단계 카테고리만 등록·복구할 수 있습니다. 카테고리 상태를 확인해주세요.';
  if (message === 'category_not_found') return '카테고리를 찾을 수 없습니다. 최신 카테고리를 확인해주세요.';
  if (message === 'operator_capability_required') return '현재 상품 관리 권한을 확인해주세요.';
  return '카테고리 템플릿을 저장하지 못했습니다. 선택과 현재 권한을 확인해주세요.';
}
export function selectedCategoryPath(categories: AdminCategoryNode[], selectedId: string): AdminCategoryNode[] {
  const result: AdminCategoryNode[] = [], seen = new Set<string>();
  let current = categories.find(row => row.id === selectedId);
  while (current && !seen.has(current.id) && result.length < 4) {
    seen.add(current.id); result.unshift(current); current = categories.find(row => row.id === current?.parentId);
  }
  return result;
}
export function usableTemplateCategory(categories: AdminCategoryNode[], id: string): boolean {
  const path = selectedCategoryPath(categories, id), leaf = path.at(-1);
  return Boolean(leaf && path[0]?.parentId === null && leaf.childCount === 0 && path.every(row => !row.archivedAt));
}
