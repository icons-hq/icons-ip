import { parseGoodsAttributeSubmission, type GoodsAttributeField, type GoodsAttributeKind } from '@/lib/goods-attributes';
import { categoryPath, type AdminCategoryNode } from './category';
import { usableTemplateCategory } from './category-templates';
import { adminPickerLocalLoader, type AdminPickerLoader } from './picker';
export const GOODS_ATTRIBUTES_PATH = '/admin/catalog/attributes';
export const GOODS_ATTRIBUTE_KIND_LABELS = { single: '단일 선택', multi: '복수 선택', text: '텍스트', number: '숫자' } as const;
/** 한 카테고리에 둘 수 있는 상품속성 항목 수와 항목 하나의 선택값 수(`lib/goods-attributes.ts`의 검사와 같다). */
export const GOODS_ATTRIBUTE_FIELD_LIMIT = 30;
export const GOODS_ATTRIBUTE_OPTION_LIMIT = 100;
/** A category change must finish loading its schema before the product can submit. */
export function goodsAttributeSubmissionReady(serialized: string | undefined, categoryId: string): boolean {
  try {
    const value = parseGoodsAttributeSubmission(JSON.parse(serialized ?? ''));
    return Boolean(value && value.categoryId === (categoryId || null));
  } catch { return false; }
}
export function readGoodsAttributeSubmission(form: FormData) {
  if (!form.has('productAttributes')) return { ok: true as const, fields: {} };
  try {
    const submission = parseGoodsAttributeSubmission(JSON.parse(String(form.get('productAttributes'))));
    if (!submission) throw new Error();
    return { ok: true as const, fields: { product_attributes: submission } };
  } catch { return { ok: false as const, error: '상품속성 입력을 읽지 못했습니다. 상품속성을 다 불러왔는지 확인한 뒤 다시 저장해주세요. 입력은 유지됩니다.' }; }
}

/* ───────── 상품속성 관리 화면(components/admin/screens/GoodsAttributeSchemaScreen.tsx) ───────── */

/** 저장하기 전에 이름·선택값의 앞뒤 공백을 걷어 낸다. 서버는 공백 없는 값만 받는다. */
export function normalizeGoodsAttributeFields(fields: readonly GoodsAttributeField[]): GoodsAttributeField[] {
  return fields.map(field => ({ ...field, name: field.name.trim(), unit: field.unit.trim(), options: field.options.map(option => ({ ...option, label: option.label.trim() })) }));
}

function sameField(a: GoodsAttributeField, b: GoodsAttributeField): boolean {
  return a.name === b.name && a.kind === b.kind && a.required === b.required && a.unit === b.unit
    && a.options.length === b.options.length && a.options.every((option, index) => option.id === b.options[index].id && option.label === b.options[index].label);
}

/** 저장된 항목(saved)과 지금 고치는 항목(draft)의 차이. 같은 항목은 번호(id)로 알아본다. */
export interface GoodsAttributeChanges { added: number; removed: number; changed: number; moved: boolean }
export function goodsAttributeChanges(saved: readonly GoodsAttributeField[], draft: readonly GoodsAttributeField[]): GoodsAttributeChanges {
  const before = new Map(saved.map(field => [field.id, field]));
  const after = new Set(draft.map(field => field.id));
  const keptBefore = saved.filter(field => after.has(field.id)).map(field => field.id);
  const keptAfter = draft.filter(field => before.has(field.id)).map(field => field.id);
  return {
    added: draft.filter(field => !before.has(field.id)).length,
    removed: saved.filter(field => !after.has(field.id)).length,
    changed: draft.filter(field => { const old = before.get(field.id); return old ? !sameField(old, field) : false; }).length,
    moved: keptBefore.join() !== keptAfter.join(),
  };
}
export function hasGoodsAttributeChanges(changes: GoodsAttributeChanges): boolean {
  return changes.added + changes.removed + changes.changed > 0 || changes.moved;
}
/** 확인창·저장 줄에 보이는 한 줄: "추가 1개 · 수정 2개 · 삭제 1개 · 순서 바꿈". 바뀐 것이 없으면 빈 글자. */
export function goodsAttributeChangeSummary(changes: GoodsAttributeChanges): string {
  return [changes.added ? `추가 ${changes.added}개` : '', changes.changed ? `수정 ${changes.changed}개` : '', changes.removed ? `삭제 ${changes.removed}개` : '', changes.moved ? '순서 바꿈' : ''].filter(Boolean).join(' · ');
}

/** 이름·단위·선택값이 모두 비어 있는 항목. 지워도 다시 입력할 것이 없어 묻지 않는다. */
export function isBlankGoodsAttributeField(field: GoodsAttributeField): boolean {
  return !field.name.trim() && !field.unit.trim() && field.options.every(option => !option.label.trim());
}
/** 이름을 적은 선택값의 수(빈 줄은 세지 않는다). */
export function goodsAttributeNamedOptionCount(field: GoodsAttributeField): number {
  return field.options.filter(option => option.label.trim()).length;
}
/** 유형을 바꾸면 지워지는 입력. 선택값은 단일·복수 선택에서만, 단위는 숫자에서만 남는다. */
export function goodsAttributeKindLoss(field: GoodsAttributeField, next: GoodsAttributeKind): { options: number; unit: string } {
  return { options: next === 'single' || next === 'multi' ? 0 : goodsAttributeNamedOptionCount(field), unit: next === 'number' ? '' : field.unit.trim() };
}

/**
 * 저장하기 전에 걸리는 곳. 항목 위치(index)는 0부터 센 화면 순서다. 서버 검사(`parseGoodsAttributeFields`)가 거절하는 이유 가운데
 * 운영자가 고칠 수 있는 것만 담는다 — 이름이 비었거나 겹침, 선택 유형인데 선택값이 없음, 선택값 이름이 비었거나 겹침.
 */
export type GoodsAttributeIssue =
  | { code: 'name-empty'; index: number }
  | { code: 'name-duplicate'; index: number; of: number }
  | { code: 'options-empty'; index: number }
  | { code: 'option-empty'; index: number; option: number }
  | { code: 'option-duplicate'; index: number; option: number; of: number };

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** 서버 액션도 같은 검사를 쓰므로 어떤 값이 와도 던지지 않는다. 이름·선택값은 앞뒤 공백을 뺀 값으로 견준다. */
export function goodsAttributeFieldIssues(value: unknown): GoodsAttributeIssue[] {
  if (!Array.isArray(value)) return [];
  const issues: GoodsAttributeIssue[] = [];
  const names = new Map<string, number>();
  value.forEach((field, index) => {
    if (!isRecord(field)) return;
    const name = typeof field.name === 'string' ? field.name.trim() : '';
    const sameName = names.get(name);
    if (!name) issues.push({ code: 'name-empty', index });
    else if (sameName !== undefined) issues.push({ code: 'name-duplicate', index, of: sameName });
    else names.set(name, index);
    if (field.kind !== 'single' && field.kind !== 'multi') return;
    const options = Array.isArray(field.options) ? field.options : [];
    if (!options.length) { issues.push({ code: 'options-empty', index }); return; }
    const labels = new Map<string, number>();
    options.forEach((option, optionIndex) => {
      const label = isRecord(option) && typeof option.label === 'string' ? option.label.trim() : '';
      const sameLabel = labels.get(label);
      if (!label) issues.push({ code: 'option-empty', index, option: optionIndex });
      else if (sameLabel !== undefined) issues.push({ code: 'option-duplicate', index, option: optionIndex, of: sameLabel });
      else labels.set(label, optionIndex);
    });
  });
  return issues;
}

/** 걸린 칸 바로 아래에 보이는 짧은 글. 어느 항목인지는 칸 위치가 말한다. */
export function goodsAttributeIssueHint(issue: GoodsAttributeIssue): string {
  switch (issue.code) {
    case 'name-empty': return '이름을 입력해주세요.';
    case 'name-duplicate': return `이미 항목 ${issue.of + 1}에 같은 이름이 있습니다. 다르게 적어주세요.`;
    case 'options-empty': return '선택값을 하나 이상 추가해주세요.';
    case 'option-empty': return '선택값 이름을 입력해주세요.';
    case 'option-duplicate': return `이미 선택값 ${issue.of + 1}에 같은 이름이 있습니다. 다르게 적어주세요.`;
  }
}
/** 칸 밖에서 보이는 한 문장(화면 위쪽 안내·서버 오류). 어느 항목인지 번호로 말한다. */
export function goodsAttributeIssueSentence(issue: GoodsAttributeIssue): string {
  const item = issue.index + 1;
  switch (issue.code) {
    case 'name-empty': return `항목 ${item}의 이름을 입력해주세요.`;
    case 'name-duplicate': return `항목 ${issue.of + 1}·${item}의 이름이 같습니다. 서로 다르게 적어주세요.`;
    case 'options-empty': return `항목 ${item}에 선택값을 하나 이상 추가해주세요.`;
    case 'option-empty': return `항목 ${item}의 선택값 ${issue.option + 1} 이름을 입력해주세요.`;
    case 'option-duplicate': return `항목 ${item}의 선택값 ${issue.of + 1}·${issue.option + 1}의 이름이 같습니다. 서로 다르게 적어주세요.`;
  }
}
/** 첫 문제를 말하고, 더 있으면 몇 곳인지 덧붙인다. 문제가 없으면 null. */
export function goodsAttributeIssuesMessage(issues: readonly GoodsAttributeIssue[]): string | null {
  if (!issues.length) return null;
  const first = goodsAttributeIssueSentence(issues[0]);
  return issues.length > 1 ? `${first} 이 밖에 ${issues.length - 1}곳이 더 있습니다.` : first;
}

/**
 * 카테고리를 고르는 선택창의 조회(docs/admin-screen-rules.md 규칙 1·2). 카테고리는 화면이 이미 다 가지고 있어 목록을 20개씩 자르기만 한다.
 * 상품에 대표 카테고리로 고를 수 있는 카테고리(보관하지 않은 맨 아래 단계)만 낸다. 순서는 카테고리 관리와 같다 — 상위 아래에 하위, 같은 단계는 노출 순서 → 코드.
 * `hiddenId`는 더 뺄 카테고리(가져올 카테고리를 고를 때 지금 보고 있는 카테고리).
 */
export interface GoodsAttributeCategoryRow { id: string; code: string; path: string }
export function goodsAttributeCategoryLoader(categories: AdminCategoryNode[], hiddenId = ''): AdminPickerLoader<GoodsAttributeCategoryRow> {
  const order = categoryTreeOrder(categories);
  const rows = categories
    .filter(category => category.id !== hiddenId && usableTemplateCategory(categories, category.id))
    .sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0))
    .map(category => ({ id: category.id, code: category.code, path: categoryPath(categories, category.id).join(' > ') }));
  return adminPickerLocalLoader(rows, { textOf: row => `${row.path} ${row.code}` });
}
function categoryTreeOrder(categories: readonly AdminCategoryNode[]): Map<string, number> {
  const ids = new Set(categories.map(category => category.id));
  const children = new Map<string, AdminCategoryNode[]>();
  for (const category of categories) {
    const parent = category.parentId && ids.has(category.parentId) ? category.parentId : '';
    children.set(parent, [...(children.get(parent) ?? []), category]);
  }
  const order = new Map<string, number>();
  const visit = (parent: string) => {
    for (const category of [...(children.get(parent) ?? [])].sort((left, right) => left.sortOrder - right.sortOrder || left.code.localeCompare(right.code))) {
      if (order.has(category.id)) continue;
      order.set(category.id, order.size);
      visit(category.id);
    }
  };
  visit('');
  return order;
}
