'use server';

import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { withPreservedFormValues, type AdminFormValuesState } from '@/lib/admin/form-state';
import {
  CATEGORY_PATH,
  isCategoryId,
  normalizeCategoryForm,
} from '@/lib/admin/category';
import { createClient } from '@/lib/supabase/server';

export interface AdminCategoryActionState extends AdminFormValuesState {
  errors?: {
    id?: string;
    code?: string;
    name?: string;
    parentId?: string;
    categoryId?: string;
    erpCode?: string;
    erpName?: string;
    source?: string;
    form?: string;
  };
  message?: string;
  changed?: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GOOD_ID = /^[a-z0-9][a-z0-9-]*$/;
const OPERATION_ID = 'operationId';
const RETRY = '카테고리 저장을 완료하지 못했습니다. 입력값은 유지됩니다. 다시 시도해주세요.';

function operationId(formData: FormData): string {
  const value = formData.get(OPERATION_ID);
  return typeof value === 'string' && UUID.test(value) ? value : crypto.randomUUID();
}

function loginPath() {
  return `/login?next=${encodeURIComponent(CATEGORY_PATH)}`;
}

async function requireCategoryStaff() {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured) return { error: 'Supabase 환경변수를 설정한 뒤 카테고리를 관리할 수 있습니다.' };
  if (!auth.user) redirect(loginPath());
  if (!auth.isStaff) return { error: '관리자 권한이 필요합니다.' };
  return { auth };
}

function preserve(state: AdminCategoryActionState, formData: FormData, errors: NonNullable<AdminCategoryActionState['errors']>) {
  return withPreservedFormValues({ errors }, state, formData);
}

function mapRpcError(error: { code?: unknown; message?: unknown }): string {
  const code = typeof error.code === 'string' ? error.code.toLowerCase() : '';
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  const descriptor = `${code} ${message}`;
  if (descriptor.includes('category_code_taken')) return '이미 사용 중인 카테고리 코드입니다.';
  if (descriptor.includes('category_cycle')) return '자기 자신이나 하위 카테고리로 이동할 수 없습니다.';
  if (descriptor.includes('category_depth_exceeded')) return '카테고리는 최대 4단계까지만 만들 수 있습니다.';
  if (descriptor.includes('category_parent_archived')) return '보관된 부모 카테고리는 선택할 수 없습니다.';
  if (descriptor.includes('category_has_goods')) return '굿즈가 연결된 카테고리는 하위 카테고리를 추가하거나 이동 목적지로 사용할 수 없습니다.';
  if (descriptor.includes('category_has_active_children')) return '활성 하위 카테고리를 먼저 정리해주세요.';
  if (descriptor.includes('category_erp_code_taken')) return '이미 연결된 ERP 코드입니다.';
  if (descriptor.includes('category_activation_unready')) return '실제 분류·ERP 값과 운영 확인 근거를 채운 뒤 활성화해주세요.';
  if (descriptor.includes('category_not_found') || descriptor.includes('goods_not_found')) return '최신 카테고리 목록을 확인한 뒤 다시 시도해주세요.';
  if (descriptor.includes('category_changed') || descriptor.includes('pt409')) return '다른 운영자가 카테고리를 변경했습니다. 새로고침 후 다시 시도해주세요.';
  if (code === '42501' || code === '28000' || descriptor.includes('forbidden') || descriptor.includes('auth_required')) return '관리자 권한이 필요합니다.';
  return '카테고리 저장을 완료하지 못했습니다. 최신 내용을 확인해주세요.';
}

function revalidateCategorySurfaces() {
  for (const path of [CATEGORY_PATH, '/admin/catalog/goods', '/shop', '/search', '/']) revalidatePath(path);
}

export async function saveAdminCategoryAction(
  state: AdminCategoryActionState,
  formData: FormData,
): Promise<AdminCategoryActionState> {
  const normalized = normalizeCategoryForm({
    id: formData.get('id'), code: formData.get('code'), name: formData.get('name'),
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

  let access: Awaited<ReturnType<typeof requireCategoryStaff>>;
  try { access = await requireCategoryStaff(); } catch (error) { unstable_rethrow(error); return preserve(state, formData, { form: RETRY }); }
  if ('error' in access) return preserve(state, formData, { form: access.error });
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_upsert_category', {
      target_operation_id: operationId(formData),
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

async function archiveCategory(
  operation: 'archive' | 'unarchive',
  state: AdminCategoryActionState,
  formData: FormData,
): Promise<AdminCategoryActionState> {
  const id = typeof formData.get('id') === 'string' ? String(formData.get('id')).trim() : '';
  const expectedUpdatedAt = typeof formData.get('expectedUpdatedAt') === 'string' ? String(formData.get('expectedUpdatedAt')).trim() : '';
  if (!isCategoryId(id)) return preserve(state, formData, { id: '카테고리 ID가 올바르지 않습니다.' });
  if (!expectedUpdatedAt) return preserve(state, formData, { form: '최신 카테고리를 확인한 뒤 다시 시도해주세요.' });
  let access: Awaited<ReturnType<typeof requireCategoryStaff>>;
  try { access = await requireCategoryStaff(); } catch (error) { unstable_rethrow(error); return preserve(state, formData, { form: RETRY }); }
  if ('error' in access) return preserve(state, formData, { form: access.error });
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

export async function saveAdminCategoryErpMappingAction(
  state: AdminCategoryActionState,
  formData: FormData,
): Promise<AdminCategoryActionState> {
  const categoryId = typeof formData.get('categoryId') === 'string' ? String(formData.get('categoryId')).trim() : '';
  const erpCode = typeof formData.get('erpCode') === 'string' ? String(formData.get('erpCode')).trim() : '';
  const erpName = typeof formData.get('erpName') === 'string' ? String(formData.get('erpName')).trim() : '';
  const source = typeof formData.get('source') === 'string' ? String(formData.get('source')).trim() : '';
  const verifiedAt = typeof formData.get('verifiedAt') === 'string' ? String(formData.get('verifiedAt')).trim() : '';
  const errors: NonNullable<AdminCategoryActionState['errors']> = {};
  if (!isCategoryId(categoryId)) errors.categoryId = '카테고리 ID가 올바르지 않습니다.';
  if (!erpCode) errors.erpCode = 'ERP 코드를 입력해주세요.';
  if (!erpName) errors.erpName = 'ERP 품명을 입력해주세요.';
  if (!source) errors.source = 'ERP 분류 출처를 입력해주세요.';
  if (!verifiedAt || Number.isNaN(Date.parse(verifiedAt))) errors.form = '검증 시각을 입력해주세요.';
  if (Object.keys(errors).length) return preserve(state, formData, errors);
  let access: Awaited<ReturnType<typeof requireCategoryStaff>>;
  try { access = await requireCategoryStaff(); } catch (error) { unstable_rethrow(error); return preserve(state, formData, { form: RETRY }); }
  if ('error' in access) return preserve(state, formData, { form: access.error });
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_set_category_erp_mapping', {
      target_operation_id: operationId(formData), target_category_id: categoryId,
      target_erp_code: erpCode, target_erp_name: erpName, target_source: source, target_verified_at: verifiedAt,
    });
    if (error) return preserve(state, formData, { form: mapRpcError(error) });
    revalidateCategorySurfaces();
    return { message: 'ERP 분류 매핑을 저장했습니다.', changed: data !== false };
  } catch (error) {
    unstable_rethrow(error);
    return preserve(state, formData, { form: RETRY });
  }
}

export async function setAdminCategoryActivationAction(
  state: AdminCategoryActionState,
  formData: FormData,
): Promise<AdminCategoryActionState> {
  const customerEnabled = formData.get('customerEnabled') === 'on';
  const erpEnabled = formData.get('erpEnabled') === 'on';
  const customerEvidence = {
    source: String(formData.get('customerEvidenceSource') ?? '').trim(),
    reference: String(formData.get('customerEvidenceReference') ?? '').trim(),
    verifiedAt: String(formData.get('customerEvidenceVerifiedAt') ?? '').trim(),
  };
  const erpEvidence = {
    source: String(formData.get('erpEvidenceSource') ?? '').trim(),
    reference: String(formData.get('erpEvidenceReference') ?? '').trim(),
    verifiedAt: String(formData.get('erpEvidenceVerifiedAt') ?? '').trim(),
  };
  if (customerEnabled && (!customerEvidence.source || !customerEvidence.reference || !customerEvidence.verifiedAt)) {
    return preserve(state, formData, { form: '고객 분류 실제 값과 운영 확인 근거를 입력해주세요.' });
  }
  if (erpEnabled && (!erpEvidence.source || !erpEvidence.reference || !erpEvidence.verifiedAt)) {
    return preserve(state, formData, { form: 'ERP 실제 분류와 검증 근거를 입력해주세요.' });
  }
  let access: Awaited<ReturnType<typeof requireCategoryStaff>>;
  try { access = await requireCategoryStaff(); } catch (error) { unstable_rethrow(error); return preserve(state, formData, { form: RETRY }); }
  if ('error' in access) return preserve(state, formData, { form: access.error });
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_set_category_activation', {
      target_operation_id: operationId(formData), target_customer_enabled: customerEnabled, target_erp_enabled: erpEnabled,
      target_evidence: { customer: customerEvidence, erp: erpEvidence },
    });
    if (error) return preserve(state, formData, { form: mapRpcError(error) });
    revalidateCategorySurfaces();
    return { message: '카테고리 활성화 상태를 저장했습니다.', changed: data !== false };
  } catch (error) {
    unstable_rethrow(error);
    return preserve(state, formData, { form: RETRY });
  }
}

export async function assignAdminGoodCategoryAction(
  state: AdminCategoryActionState,
  formData: FormData,
): Promise<AdminCategoryActionState> {
  const goodId = typeof formData.get('goodId') === 'string' ? String(formData.get('goodId')).trim() : '';
  const categoryId = typeof formData.get('categoryId') === 'string' ? String(formData.get('categoryId')).trim() : '';
  if (!GOOD_ID.test(goodId)) return preserve(state, formData, { form: '굿즈 ID가 올바르지 않습니다.' });
  if (categoryId && !isCategoryId(categoryId)) return preserve(state, formData, { categoryId: '말단 카테고리를 선택해주세요.' });
  let access: Awaited<ReturnType<typeof requireCategoryStaff>>;
  try { access = await requireCategoryStaff(); } catch (error) { unstable_rethrow(error); return preserve(state, formData, { form: RETRY }); }
  if ('error' in access) return preserve(state, formData, { form: access.error });
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_assign_good_category', {
      target_operation_id: operationId(formData), target_good_id: goodId, target_category_id: categoryId || null,
      target_expected_updated_at: String(formData.get('expectedUpdatedAt') ?? '').trim() || null,
    });
    if (error) return preserve(state, formData, { form: mapRpcError(error) });
    revalidateCategorySurfaces();
    return { message: categoryId ? '굿즈의 기본 카테고리를 저장했습니다.' : '굿즈를 미분류로 되돌렸습니다.', changed: data !== false };
  } catch (error) {
    unstable_rethrow(error);
    return preserve(state, formData, { form: RETRY });
  }
}

export async function saveAdminCategoryTypeMigrationAction(
  state: AdminCategoryActionState,
  formData: FormData,
): Promise<AdminCategoryActionState> {
  const type = typeof formData.get('type') === 'string' ? String(formData.get('type')).trim() : '';
  const categoryId = typeof formData.get('categoryId') === 'string' ? String(formData.get('categoryId')).trim() : '';
  const status = String(formData.get('status') ?? 'suggested');
  if (!type) return preserve(state, formData, { form: '기존 유형을 입력해주세요.' });
  if (categoryId && !isCategoryId(categoryId)) return preserve(state, formData, { categoryId: '카테고리를 선택해주세요.' });
  if (!['suggested', 'confirmed', 'rejected'].includes(status)) return preserve(state, formData, { form: '이관 상태가 올바르지 않습니다.' });
  let access: Awaited<ReturnType<typeof requireCategoryStaff>>;
  try { access = await requireCategoryStaff(); } catch (error) { unstable_rethrow(error); return preserve(state, formData, { form: RETRY }); }
  if ('error' in access) return preserve(state, formData, { form: access.error });
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_set_category_type_migration', {
      target_operation_id: operationId(formData), target_type: type, target_category_id: categoryId || null,
      target_status: status, target_note: String(formData.get('note') ?? '').trim() || null,
    });
    if (error) return preserve(state, formData, { form: mapRpcError(error) });
    revalidatePath(CATEGORY_PATH);
    return { message: '기존 유형 이관 메모를 저장했습니다.', changed: data !== false };
  } catch (error) {
    unstable_rethrow(error);
    return preserve(state, formData, { form: RETRY });
  }
}
