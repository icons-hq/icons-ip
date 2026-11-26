'use server';
import type { AdminCapability } from '@/lib/admin/access';

import { revalidateGoodsSurfaces } from '@/lib/admin/revalidate-goods.server';

import { isUuid } from '@/lib/uuid';

import { revalidatePath, updateTag } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { goodCategoryFailure } from '@/lib/admin/good-workspace';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { withPreservedFormValues, type AdminFormValuesState } from '@/lib/admin/form-state';
import {
  CATEGORY_PATH,
  categoryAutoCode,
  isCategoryId,
  normalizeCategoryForm,
} from '@/lib/admin/category';
import {
  CATEGORY_BULK_LINE_LIMIT,
  CATEGORY_BULK_TEXT_LIMIT,
  parseCategoryBulkResult,
  parseCategoryBulkText,
  type CategoryBulkResult,
} from '@/lib/admin/category-bulk';
import { createClient } from '@/lib/supabase/server';
import { STOREFRONT_MEGA_MENU_CACHE_TAG } from '@/lib/storefront-mega-menu';

export interface AdminCategoryActionState extends AdminFormValuesState {
  errors?: {
    id?: string;
    code?: string;
    name?: string;
    parentId?: string;
    categoryId?: string;
    erpCode?: string;
    erpName?: string;
    form?: string;
  };
  message?: string;
  changed?: boolean;
}

const GOOD_ID = /^[a-z0-9][a-z0-9-]*$/;
const OPERATION_ID = 'operationId';
/** 저장 중에 연결이 끊겨 결과를 모를 때. 이미 저장됐을 수 있어 목록을 먼저 보게 한다. */
const RETRY = '저장됐는지 확인하지 못했습니다. 새로고침해 카테고리 목록에 반영됐는지 본 뒤, 안 됐으면 다시 저장해주세요.';
const NO_ACCESS = '카테고리를 바꿀 권한이 없습니다. 상품 관리 권한이 있는 계정으로 다시 해주세요.';
const NO_PLATFORM_ACCESS = '이 설정은 통합 매니저와 계정 주매니저만 바꿀 수 있습니다. 그 계정으로 다시 해주세요.';
const CHANGED_BY_OTHER = '다른 사람이 먼저 바꿨습니다. 새로고침한 뒤 다시 해주세요.';
/** 순서 바꾸기가 한 번에 받는 카테고리 수. DB 상한과 같다. */
const REORDER_LIMIT = 2000;

/**
 * 화면이 폼마다 만들어 보내는 작업 번호. 같은 폼을 두 번 보내도 DB가 한 번만 처리하게 한다.
 * 번호가 없거나 형식이 다르면(자바스크립트 없이 보낸 폼) 서버가 새로 만든다.
 */
function operationId(formData: FormData): string {
  const value = formData.get(OPERATION_ID);
  return isUuid(value) ? value : crypto.randomUUID();
}

async function requireCategoryStaff(capability: AdminCapability = 'catalog.manage') {
  const auth = await requireAdminActionAccess(CATEGORY_PATH, { capability });
  return auth ? { auth } : { error: capability === 'platform.manage' ? NO_PLATFORM_ACCESS : NO_ACCESS };
}

function preserve(state: AdminCategoryActionState, formData: FormData, errors: NonNullable<AdminCategoryActionState['errors']>) {
  return withPreservedFormValues({ errors }, state, formData);
}

function mapRpcError(error: { code?: unknown; message?: unknown }): string {
  const code = typeof error.code === 'string' ? error.code.toLowerCase() : '';
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  const descriptor = `${code} ${message}`;
  if (descriptor.includes('category_code_taken')) return '다른 카테고리가 이미 쓰는 코드입니다. 다른 코드로 바꿔 다시 저장해주세요.';
  if (descriptor.includes('category_cycle')) return '자기 자신이나 자기 하위 카테고리 아래로는 옮길 수 없습니다. 상위 카테고리를 다시 골라주세요.';
  if (descriptor.includes('category_depth_exceeded')) return '카테고리는 4단계까지만 만들 수 있습니다. 더 위 단계의 카테고리를 상위 카테고리로 골라주세요.';
  if (descriptor.includes('category_parent_archived')) return '보관한 카테고리 아래에는 둘 수 없습니다. 상위 카테고리를 먼저 복원하거나 다른 상위 카테고리를 골라주세요.';
  if (descriptor.includes('category_parent_not_found')) return '상위 카테고리를 찾지 못했습니다. 새로고침한 뒤 상위 카테고리를 다시 골라주세요.';
  if (descriptor.includes('category_has_goods')) return '상품이 연결된 카테고리 아래에는 하위 카테고리를 둘 수 없습니다. 다른 상위 카테고리를 고르거나, 그 카테고리의 상품을 다른 카테고리로 옮긴 뒤 다시 저장해주세요.';
  if (descriptor.includes('category_has_active_children')) return '보관하지 않은 하위 카테고리가 있습니다. 하위 카테고리를 먼저 보관하거나 다른 곳으로 옮겨주세요.';
  if (descriptor.includes('category_erp_code_taken')) return '다른 카테고리가 이미 쓰는 ERP 코드입니다. 코드를 확인해 다시 적어주세요.';
  if (descriptor.includes('category_activation_unready')) return '지금은 바꿀 수 없습니다. 새로고침한 뒤 다시 눌러주세요. 버튼이 잠겨 있으면 그 아래에 이유가 적혀 있습니다.';
  if (descriptor.includes('category_archived')) return '보관한 카테고리는 상품에 연결할 수 없습니다. 다른 카테고리를 골라주세요.';
  if (descriptor.includes('category_not_leaf')) return '하위 카테고리가 있는 카테고리는 상품에 연결할 수 없습니다. 마지막 단계 카테고리를 골라주세요.';
  /* ADR-0044: 대표 카테고리 바꾸기는 공개 중 상품의 대표 카테고리를 비우지 못한다. */
  const goodCategoryMessage = goodCategoryFailure(descriptor);
  if (goodCategoryMessage) return goodCategoryMessage;
  if (descriptor.includes('goods_not_found')) return '상품을 찾지 못했습니다. [상품 고르기]로 다시 골라주세요.';
  if (descriptor.includes('category_not_found')) return '카테고리를 찾지 못했습니다. 새로고침한 뒤 다시 골라주세요.';
  if (descriptor.includes('category_changed') || descriptor.includes('goods_changed') || descriptor.includes('pt409')) return CHANGED_BY_OTHER;
  if (descriptor.includes('invalid_category_paths')) return `붙여넣은 경로를 확인해주세요. 한 줄은 1,000자, 한 번에 ${CATEGORY_BULK_LINE_LIMIT.toLocaleString('ko-KR')}줄까지 등록할 수 있습니다.`;
  if (descriptor.includes('operation_conflict')) return '방금 누른 저장이 이미 처리됐습니다. 새로고침해 카테고리 목록에 반영됐는지 확인해주세요.';
  if (code === '42501' || code === '28000' || descriptor.includes('forbidden') || descriptor.includes('auth_required') || descriptor.includes('operator_capability_required')) return NO_ACCESS;
  return '저장하지 못했습니다. 새로고침해 카테고리 목록을 확인한 뒤 다시 저장해주세요.';
}

function revalidateCategorySurfaces() {
  revalidatePath(CATEGORY_PATH);
  revalidateGoodsSurfaces();
  /* 전역 셸의 카테고리 메가메뉴·모바일 카테고리 시트는 쿠키 없는 300초 캐시로 읽는다(lib/storefront-mega-menu.server.ts).
     고객 카테고리 공개 전환(LG-3)·상품분류·상품 분류 연결이 공개 메뉴(노출 여부·목적지 있는 전시)를 바꾸므로 저장 직후 태그를
     즉시 만료한다 — 서버 액션 전용 updateTag(다음 요청이 새 값을 기다린다). */
  updateTag(STOREFRONT_MEGA_MENU_CACHE_TAG);
}

export async function saveAdminCategoryAction(
  state: AdminCategoryActionState,
  formData: FormData,
): Promise<AdminCategoryActionState> {
  let access: Awaited<ReturnType<typeof requireCategoryStaff>>;
  try { access = await requireCategoryStaff(); } catch (error) { unstable_rethrow(error); return preserve(state, formData, { form: RETRY }); }
  if ('error' in access) return preserve(state, formData, { form: access.error });
  /* 새 카테고리는 코드를 비워 두면 자동으로 만든다(일괄 등록과 같다). 작업 번호에서 만들어 같은 저장을 다시 보내도 같은 코드다. */
  const operation = operationId(formData);
  const isNew = !String(formData.get('id') ?? '').trim();
  const typedCode = String(formData.get('code') ?? '').trim();
  const normalized = normalizeCategoryForm({
    id: formData.get('id'), code: isNew && !typedCode ? categoryAutoCode(operation) : formData.get('code'), name: formData.get('name'),
    parentId: formData.get('parentId'), sortOrder: formData.get('sortOrder'), expectedUpdatedAt: formData.get('expectedUpdatedAt'),
  });
  if (!normalized.ok) {
    return preserve(state, formData, {
      ...(normalized.errors.invalid_id ? { id: normalized.errors.invalid_id } : {}),
      ...(normalized.errors.invalid_code ? { code: normalized.errors.invalid_code } : {}),
      ...(normalized.errors.invalid_name ? { name: normalized.errors.invalid_name } : {}),
      ...(normalized.errors.invalid_parent ? { parentId: normalized.errors.invalid_parent } : {}),
      ...(normalized.errors.invalid_sort_order ? { form: normalized.errors.invalid_sort_order } : {}),
      ...(normalized.errors.missing_expected_version ? { form: normalized.errors.missing_expected_version } : {}),
    });
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_upsert_category', {
      target_operation_id: operation,
      target_category_id: normalized.value.id,
      target_code: normalized.value.code,
      target_name: normalized.value.name,
      target_parent_id: normalized.value.parentId,
      target_sort_order: normalized.value.sortOrder,
      target_expected_updated_at: normalized.value.expectedUpdatedAt,
    });
    if (error) return preserve(state, formData, { form: mapRpcError(error) });
    revalidateCategorySurfaces();
    return { message: normalized.value.id ? '카테고리를 저장했습니다.' : '카테고리를 등록했습니다.', changed: data !== false };
  } catch (error) {
    unstable_rethrow(error);
    return preserve(state, formData, { form: RETRY });
  }
}

export type AdminCategoryBulkActionResult =
  | { ok: true; result: CategoryBulkResult }
  | { ok: false; error: string };

/**
 * 붙여넣은 `대>중>소` 경로를 한 번에 등록한다(R9). 같은 operationId로 다시 보내면 DB가 첫 결과를 그대로 돌려준다.
 * 결과표 번호는 빈 줄을 뺀 배열 순서가 아니라 붙여넣은 원래 줄 번호다.
 */
export async function bulkCreateAdminCategoriesAction(input: { operationId: string; text: string }): Promise<AdminCategoryBulkActionResult> {
  let access: Awaited<ReturnType<typeof requireCategoryStaff>>;
  try { access = await requireCategoryStaff(); } catch (error) { unstable_rethrow(error); return { ok: false, error: RETRY }; }
  if ('error' in access) return { ok: false, error: access.error ?? RETRY };
  if (!input || !isUuid(input.operationId) || typeof input.text !== 'string') return { ok: false, error: '화면이 오래돼 등록하지 못했습니다. 새로고침한 뒤 다시 눌러주세요.' };
  if (input.text.length > CATEGORY_BULK_TEXT_LIMIT) return { ok: false, error: '붙여넣은 내용이 너무 깁니다. 나눠서 등록하세요.' };
  const parsed = parseCategoryBulkText(input.text);
  if (!parsed.paths.length) return { ok: false, error: '등록할 경로를 한 줄에 하나씩 입력하세요.' };
  if (parsed.paths.length > CATEGORY_BULK_LINE_LIMIT) return { ok: false, error: `한 번에 ${CATEGORY_BULK_LINE_LIMIT.toLocaleString('ko-KR')}줄까지 등록할 수 있습니다. 나눠서 등록하세요.` };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_bulk_create_categories', { p_operation_id: input.operationId, p_paths: parsed.paths });
    if (error) return { ok: false, error: mapRpcError(error) };
    const result = parseCategoryBulkResult(data);
    if (!result) return { ok: false, error: '등록 결과를 확인하지 못했습니다. 새로고침해 카테고리 목록에 반영됐는지 확인하세요.' };
    if (result.createdCategories > 0) revalidateCategorySurfaces();
    return {
      ok: true,
      result: { ...result, lines: result.lines.map((line) => ({ ...line, line: parsed.sourceLines[line.line - 1] ?? line.line })) },
    };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: RETRY };
  }
}

async function archiveCategory(
  operation: 'archive' | 'unarchive',
  state: AdminCategoryActionState,
  formData: FormData,
): Promise<AdminCategoryActionState> {
  let access: Awaited<ReturnType<typeof requireCategoryStaff>>;
  try { access = await requireCategoryStaff(); } catch (error) { unstable_rethrow(error); return preserve(state, formData, { form: RETRY }); }
  if ('error' in access) return preserve(state, formData, { form: access.error });
  const id = typeof formData.get('id') === 'string' ? String(formData.get('id')).trim() : '';
  const expectedUpdatedAt = typeof formData.get('expectedUpdatedAt') === 'string' ? String(formData.get('expectedUpdatedAt')).trim() : '';
  if (!isCategoryId(id)) return preserve(state, formData, { id: '카테고리를 찾지 못했습니다. 새로고침한 뒤 다시 골라주세요.' });
  if (!expectedUpdatedAt) return preserve(state, formData, { form: '화면이 오래됐습니다. 새로고침한 뒤 다시 눌러주세요.' });
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc(operation === 'archive' ? 'admin_archive_category' : 'admin_unarchive_category', {
      target_operation_id: operationId(formData), target_category_id: id, target_expected_updated_at: expectedUpdatedAt,
    });
    if (error) return preserve(state, formData, { form: mapRpcError(error) });
    revalidateCategorySurfaces();
    return { message: operation === 'archive' ? '카테고리를 보관했습니다.' : '카테고리를 복원했습니다.', changed: data !== false };
  } catch (error) {
    unstable_rethrow(error);
    return preserve(state, formData, { form: RETRY });
  }
}

export async function archiveAdminCategoryAction(state: AdminCategoryActionState, formData: FormData) {
  return archiveCategory('archive', state, formData);
}

export async function unarchiveAdminCategoryAction(state: AdminCategoryActionState, formData: FormData) {
  return archiveCategory('unarchive', state, formData);
}

/** 카테고리별 ERP 코드·품명 저장. 출처·검증 시각은 받지 않는다(2026-11-26 — 누가 언제 바꿨는지는 감사 기록이 남긴다). */
export async function saveAdminCategoryErpMappingAction(
  state: AdminCategoryActionState,
  formData: FormData,
): Promise<AdminCategoryActionState> {
  let access: Awaited<ReturnType<typeof requireCategoryStaff>>;
  try { access = await requireCategoryStaff('platform.manage'); } catch (error) { unstable_rethrow(error); return preserve(state, formData, { form: RETRY }); }
  if ('error' in access) return preserve(state, formData, { form: access.error });
  const categoryId = typeof formData.get('categoryId') === 'string' ? String(formData.get('categoryId')).trim() : '';
  const erpCode = typeof formData.get('erpCode') === 'string' ? String(formData.get('erpCode')).trim() : '';
  const erpName = typeof formData.get('erpName') === 'string' ? String(formData.get('erpName')).trim() : '';
  const errors: NonNullable<AdminCategoryActionState['errors']> = {};
  if (!isCategoryId(categoryId)) errors.categoryId = '카테고리를 찾지 못했습니다. 새로고침한 뒤 다시 적어주세요.';
  if (!erpCode) errors.erpCode = 'ERP 코드를 적어주세요.';
  if (!erpName) errors.erpName = 'ERP 품명을 적어주세요.';
  if (Object.keys(errors).length) return preserve(state, formData, errors);
  try {
    const supabase = await createClient();
    /* 출처·검증 시각 인자는 DB 함수에 남아 있다(이미 저장된 값을 지우지 않으려고). 보내지 않으면 저장돼 있던 값이 그대로 남는다. */
    const { data, error } = await supabase.rpc('admin_set_category_erp_mapping', {
      target_operation_id: operationId(formData), target_category_id: categoryId,
      target_erp_code: erpCode, target_erp_name: erpName, target_source: null, target_verified_at: null,
    });
    if (error) return preserve(state, formData, { form: mapRpcError(error) });
    revalidateCategorySurfaces();
    return { message: 'ERP 코드를 저장했습니다.', changed: data !== false };
  } catch (error) {
    unstable_rethrow(error);
    return preserve(state, formData, { form: RETRY });
  }
}

/**
 * 고객 화면에 카테고리 보이기 켜기·끄기. 근거 칸은 받지 않는다(2026-11-26).
 * `erpEnabled`는 읽는 곳이 없어 화면에 스위치가 없는 값이다. 폼이 저장돼 있던 값을 실어 보내고(이 저장이 그 값을 바꾸지 않게),
 * ERP 코드가 빈 카테고리가 있을 때만 끈 값으로 보낸다(DB가 그 상태의 켠 값을 거절해 고객 화면 스위치까지 잠기므로).
 */
export async function setAdminCategoryActivationAction(
  state: AdminCategoryActionState,
  formData: FormData,
): Promise<AdminCategoryActionState> {
  let access: Awaited<ReturnType<typeof requireCategoryStaff>>;
  try { access = await requireCategoryStaff('platform.manage'); } catch (error) { unstable_rethrow(error); return preserve(state, formData, { form: RETRY }); }
  if ('error' in access) return preserve(state, formData, { form: access.error });
  const customerEnabled = formData.get('customerEnabled') === 'on';
  const erpEnabled = formData.get('erpEnabled') === 'on';
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_set_category_activation', {
      target_operation_id: operationId(formData), target_customer_enabled: customerEnabled, target_erp_enabled: erpEnabled,
      target_evidence: {},
    });
    if (error) return preserve(state, formData, { form: mapRpcError(error) });
    revalidateCategorySurfaces();
    return { message: customerEnabled ? '켰습니다. 고객 화면에 카테고리가 보입니다.' : '껐습니다. 고객 화면에서 카테고리를 내렸습니다.', changed: data !== false };
  } catch (error) {
    unstable_rethrow(error);
    return preserve(state, formData, { form: RETRY });
  }
}

/**
 * 상품 하나의 대표 카테고리 바꾸기. 카테고리를 골라야 저장한다 — 고르지 않은 채 저장해 대표 카테고리가 지워지는 일이 없게 한다.
 * 지우는 일은 따로 이름 붙인 버튼([미분류로 되돌리기], `intent=clear`)만 한다. 공개 중인 상품은 DB가 막는다(goods_published_category_clear).
 */
export async function assignAdminGoodCategoryAction(
  state: AdminCategoryActionState,
  formData: FormData,
): Promise<AdminCategoryActionState> {
  let access: Awaited<ReturnType<typeof requireCategoryStaff>>;
  try { access = await requireCategoryStaff(); } catch (error) { unstable_rethrow(error); return preserve(state, formData, { form: RETRY }); }
  if ('error' in access) return preserve(state, formData, { form: access.error });
  const goodId = typeof formData.get('goodId') === 'string' ? String(formData.get('goodId')).trim() : '';
  const categoryId = typeof formData.get('categoryId') === 'string' ? String(formData.get('categoryId')).trim() : '';
  const clearing = formData.get('intent') === 'clear';
  if (!GOOD_ID.test(goodId)) return preserve(state, formData, { form: '상품을 고르지 않았습니다. [상품 고르기]로 상품을 고른 뒤 다시 눌러주세요.' });
  if (!clearing && !isCategoryId(categoryId)) return preserve(state, formData, { categoryId: '바꿀 대표 카테고리를 고른 뒤 다시 눌러주세요.' });
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_assign_good_category', {
      target_operation_id: operationId(formData), target_good_id: goodId, target_category_id: clearing ? null : categoryId,
      target_expected_updated_at: String(formData.get('expectedUpdatedAt') ?? '').trim() || null,
    });
    if (error) return preserve(state, formData, { form: mapRpcError(error) });
    revalidateCategorySurfaces();
    return { message: clearing ? '대표 카테고리를 지웠습니다. 이 상품은 지금 미분류입니다.' : '대표 카테고리를 바꿨습니다.', changed: data !== false };
  } catch (error) {
    unstable_rethrow(error);
    return preserve(state, formData, { form: RETRY });
  }
}

export type AdminCategoryReorderResult = { ok: true; changed: boolean } | { ok: false; error: string };

/**
 * 카테고리 목록의 [위로]·[아래로]. 같은 상위 아래의 카테고리 전체를 새 순서대로 보내면 DB가 0부터 다시 매긴다.
 * 그사이 누가 카테고리를 더하거나 옮겼으면 DB가 거절한다(category_changed).
 */
export async function reorderAdminCategoriesAction(input: { operationId: string; parentId: string | null; orderedIds: string[] }): Promise<AdminCategoryReorderResult> {
  let access: Awaited<ReturnType<typeof requireCategoryStaff>>;
  try { access = await requireCategoryStaff(); } catch (error) { unstable_rethrow(error); return { ok: false, error: RETRY }; }
  if ('error' in access) return { ok: false, error: access.error ?? RETRY };
  const stale = '화면이 오래돼 순서를 바꾸지 못했습니다. 새로고침한 뒤 다시 눌러주세요.';
  if (!input || !isUuid(input.operationId) || (input.parentId !== null && !isCategoryId(input.parentId)) || !Array.isArray(input.orderedIds)
    || !input.orderedIds.length || input.orderedIds.length > REORDER_LIMIT || !input.orderedIds.every(isCategoryId)
    || new Set(input.orderedIds).size !== input.orderedIds.length) return { ok: false, error: stale };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_reorder_categories', {
      target_operation_id: input.operationId, target_parent_id: input.parentId, target_ordered_ids: input.orderedIds,
    });
    if (error) return { ok: false, error: mapRpcError(error) };
    if (data !== false) revalidateCategorySurfaces();
    return { ok: true, changed: data !== false };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: RETRY };
  }
}
