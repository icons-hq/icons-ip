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
/** 새 등록(저장 버전 0)이 충돌했다 = 그 카테고리의 등록 기록이 이미 있다. 사용 중인지 보관됐는지는 응답으로 구분되지 않는다. 등록 창은 등록한 카테고리를 목록에서 빼므로 다른 사람이 막 등록한 경우에만 나온다. */
export const CATEGORY_TEMPLATE_ALREADY_EXISTS = '고른 카테고리 중에 이미 등록된 것(보관한 것 포함)이 있습니다. 창을 닫았다 다시 열면 목록에서 빠집니다.';
/** 결과를 모를 때의 문장과 버튼 이름(화면과 서버 액션이 함께 쓴다). 낱말 표: 저장됐는지 확인. */
export const CATEGORY_TEMPLATE_CHECK_LABEL = '저장됐는지 확인';
export const CATEGORY_TEMPLATE_UNCERTAIN = `저장됐는지 확인하지 못했습니다. [${CATEGORY_TEMPLATE_CHECK_LABEL}]을 누르면 같은 내용이 두 번 저장되지 않습니다.`;
/** 목록을 읽지 못했을 때. 선택창이 쓰는 문구와 같다. */
export const CATEGORY_TEMPLATE_LIST_FAILED = '목록을 불러오지 못했습니다. 잠시 뒤 다시 검색해주세요.';
export function categoryTemplateError(message?: string): string {
  if (message === 'category_templates_changed' || message === 'operation_conflict') return '다른 사람이 먼저 바꿨습니다. 고른 항목은 그대로 두었습니다. [최신 목록 다시 조회]를 누른 뒤 다시 저장해주세요.';
  if (message === 'category_not_usable') return '보관했거나 하위 카테고리가 있는 카테고리는 등록·복원할 수 없습니다. 카테고리 관리에서 확인해주세요.';
  if (message === 'category_not_found') return '카테고리를 찾을 수 없습니다. 새로고침한 뒤 다시 골라주세요.';
  if (message === 'operator_capability_required') return '상품 관리 권한이 있는 계정만 저장할 수 있습니다. 로그인한 계정의 권한을 확인해주세요.';
  return '자주 쓰는 카테고리를 저장하지 못했습니다. 새로고침한 뒤 다시 시도해주세요. 계속 안 되면 계정에 상품 관리 권한이 있는지 확인해주세요.';
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
/** 고르는 창에서 한 줄을 찾는 글자: 경로, 붙여 쓴 경로(리빙>머그), 코드. 검색어의 낱말이 모두 들어 있으면 걸린다. */
export function categoryTemplateText(row: CategoryTemplate): string {
  return `${row.path.join(' > ')} ${row.path.join('>')} ${row.code}`;
}
/** 등록 창의 한 줄. `text`는 찾는 글자(경로·붙여 쓴 경로·코드)다. */
export interface RegistrableTemplateCategory { id: string; path: string; code: string; text: string }
/**
 * 등록 창에 올릴 카테고리: 지금 쓸 수 있는 마지막 단계 카테고리 가운데 아직 자주 쓰는 카테고리로 등록하지 않은 것.
 * `registered`에는 보관한 등록의 번호도 넣는다 — 보관한 것은 목록에서 복원하므로 새로 등록하지 않는다. 경로 순.
 */
export function registrableTemplateCategories(categories: AdminCategoryNode[], registered: ReadonlySet<string>): RegistrableTemplateCategory[] {
  const collator = new Intl.Collator('ko');
  return categories.filter(category => !registered.has(category.id) && usableTemplateCategory(categories, category.id)).map(category => {
    const names = selectedCategoryPath(categories, category.id).map(row => row.name);
    return { id: category.id, path: names.join(' > '), code: category.code, text: `${names.join(' > ')} ${names.join('>')} ${category.code}` };
  }).sort((left, right) => collator.compare(left.path, right.path));
}
