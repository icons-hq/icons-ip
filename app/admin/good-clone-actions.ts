'use server';

import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { withPreservedFormValues, type AdminFormValuesState } from '@/lib/admin/form-state';
import {
  GOOD_CLONE_PATH,
  goodCloneResult,
  normalizeGoodCloneForm,
  type GoodCloneResult,
} from '@/lib/admin/good-clone';
import { createClient } from '@/lib/supabase/server';

export interface GoodCloneActionState extends AdminFormValuesState {
  operationId?: string;
  savedGood?: GoodCloneResult;
  errors?: {
    sourceGoodId?: string;
    newId?: string;
    newCode?: string;
    newName?: string;
    form?: string;
  };
  message?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function operationId(formData: FormData): string {
  const value = formData.get('operationId');
  return typeof value === 'string' && UUID.test(value) ? value : crypto.randomUUID();
}

function loginPath() {
  return `/login?next=${encodeURIComponent(GOOD_CLONE_PATH)}`;
}

async function requireCloneStaff() {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured) return { error: 'Supabase 환경변수를 설정한 뒤 상품을 복사할 수 있습니다.' };
  if (!auth.user) redirect(loginPath());
  if (!auth.isStaff) return { error: '관리자 권한이 필요합니다.' };
  return { auth };
}

function preserve(
  state: GoodCloneActionState,
  formData: FormData,
  errors: NonNullable<GoodCloneActionState['errors']>,
  currentOperationId: string,
): GoodCloneActionState {
  return {
    ...withPreservedFormValues({ errors }, state, formData),
    operationId: currentOperationId,
  };
}

function rpcErrorMessage(error: { code?: unknown; message?: unknown }): string {
  const code = typeof error.code === 'string' ? error.code.toLowerCase() : '';
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  const descriptor = `${code} ${message}`;
  if (descriptor.includes('source_good_not_found') || descriptor.includes('goods_clone_source_not_found')) return '복사할 굿즈를 찾을 수 없습니다.';
  if (descriptor.includes('source_good_archived') || descriptor.includes('goods_clone_source_archived')) return '보관된 굿즈는 복사할 수 없습니다.';
  if (descriptor.includes('good_clone_id_taken') || descriptor.includes('catalog_id_taken') || descriptor.includes('goods_pkey')) return '이미 사용 중인 새 상품 URL입니다.';
  if (descriptor.includes('good_clone_code_taken') || descriptor.includes('goods_code_key')) return '이미 사용 중인 새 상품코드입니다.';
  if (descriptor.includes('goods_clone_operation_conflict') || descriptor.includes('operation_conflict')) return '같은 복사 요청 ID가 다른 내용으로 사용되었습니다. 새로고침 후 다시 시도해주세요.';
  if (descriptor.includes('goods_clone_source_changed') || descriptor.includes('goods_changed')) return '원본 굿즈가 변경되었습니다. 최신 원본을 다시 확인해주세요.';
  if (descriptor.includes('goods_clone_source_busy')) return '같은 IP의 주문이나 상품 변경을 처리 중입니다. 입력값을 유지했으니 잠시 후 다시 복사해주세요.';
  if (descriptor.includes('category_archived') || descriptor.includes('category_not_leaf')) return '원본 카테고리를 새 상품에 연결할 수 없어 미분류 초안으로 복사해주세요.';
  if (descriptor.includes('forbidden') || code === '42501' || code === '28000') return '관리자 권한이 필요합니다.';
  return '굿즈를 복사하지 못했습니다. 입력값은 유지됩니다.';
}

export async function cloneAdminGoodAction(
  state: GoodCloneActionState,
  formData: FormData,
): Promise<GoodCloneActionState> {
  const currentOperationId = operationId(formData);
  const normalized = normalizeGoodCloneForm({
    sourceGoodId: formData.get('sourceGoodId'),
    newId: formData.get('newId'),
    newCode: formData.get('newCode'),
    newName: formData.get('newName'),
  });
  if (!normalized.ok) {
    return preserve(state, formData, normalized.errors, currentOperationId);
  }

  let access: Awaited<ReturnType<typeof requireCloneStaff>>;
  try {
    access = await requireCloneStaff();
  } catch (error) {
    unstable_rethrow(error);
    return preserve(state, formData, { form: '상품 복사를 시작하지 못했습니다. 다시 시도해주세요.' }, currentOperationId);
  }
  if ('error' in access) return preserve(state, formData, { form: access.error }, currentOperationId);

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_clone_good', {
      target_operation_id: currentOperationId,
      target_source_good_id: normalized.value.sourceGoodId,
      target_new_id: normalized.value.newId || null,
      target_new_code: normalized.value.newCode || null,
      target_new_name: normalized.value.newName || null,
    });
    if (error) return preserve(state, formData, { form: rpcErrorMessage(error) }, currentOperationId);
    const savedGood = goodCloneResult(data);
    if (!savedGood) return preserve(state, formData, { form: '복사 결과를 확인하지 못했습니다. 목록을 새로고침해주세요.' }, currentOperationId);
    for (const path of ['/admin/catalog/goods', '/shop', '/search', '/']) revalidatePath(path);
    return { operationId: currentOperationId, savedGood, message: `초안 굿즈 ${savedGood.code}를 만들었습니다.` };
  } catch (error) {
    unstable_rethrow(error);
    return preserve(state, formData, { form: '굿즈를 복사하지 못했습니다. 입력값은 유지됩니다.' }, currentOperationId);
  }
}
