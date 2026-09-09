'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';
import { GOODS_NOTICE_FIELDS } from '@/lib/goods-notice';
import { nextFormAttempt, type AdminFormValuesState } from '@/lib/admin/form-state';
import {
  GOODS_NOTICE_PRESET_FIELD_MAX,
  GOODS_NOTICE_PRESET_NAME_MAX,
  GOODS_NOTICE_PRESETS_PATH,
} from '@/lib/admin/goods-notice-presets';

export interface GoodsNoticePresetActionState extends AdminFormValuesState {
  errors?: Record<string, string>;
  message?: string;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALUE_FIELDS = ['id', 'name', 'updatedAt', ...GOODS_NOTICE_FIELDS.map((field) => field.formName)];
const SAVE_FAILED = '프리셋을 저장하지 못했습니다. 입력값은 유지됩니다. 잠시 후 다시 시도해주세요.';
const DELETE_FAILED = '프리셋을 삭제하지 못했습니다. 잠시 후 다시 시도해주세요.';

async function staffError(): Promise<string | null> {
  let auth: Awaited<ReturnType<typeof getCurrentAdminAuthState>>;
  try { auth = await getCurrentAdminAuthState(); }
  catch { return '권한을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.'; }
  if (!auth.isConfigured || !auth.user) redirect(`/login?next=${encodeURIComponent(GOODS_NOTICE_PRESETS_PATH)}`);
  return auth.isStaff ? null : '관리자 권한이 필요합니다.';
}

function rpcError(error: { code?: string; message: string }, fallback = SAVE_FAILED): Record<string, string> {
  if (error.code === '23505') return { name: '이미 사용 중인 프리셋 이름입니다. 다른 이름을 입력해주세요.' };
  if (error.message.includes('goods_notice_preset_conflict')) {
    return { form: '다른 운영자가 수정했습니다. 입력값을 복사한 뒤 새로고침해 최신 내용을 확인해주세요.' };
  }
  if (error.message.includes('goods_notice_preset_not_found')) return { form: '프리셋을 찾을 수 없습니다. 삭제되었을 수 있습니다.' };
  if (error.message.includes('staff_required')) return { form: '관리자 권한이 필요합니다.' };
  return { form: fallback };
}

export async function saveGoodsNoticePresetAction(
  previous: GoodsNoticePresetActionState,
  data: FormData,
): Promise<GoodsNoticePresetActionState> {
  const values = Object.fromEntries(VALUE_FIELDS.map((name) => [name, typeof data.get(name) === 'string' ? data.get(name) as string : '']));
  const attempt = nextFormAttempt(previous);
  const fail = (errors: Record<string, string>): GoodsNoticePresetActionState => ({ errors, values, attempt });
  const accessError = await staffError();
  if (accessError) return fail({ form: accessError });
  const errors: Record<string, string> = {};
  const name = values.name.trim();
  if (!name || name.length > GOODS_NOTICE_PRESET_NAME_MAX) errors.name = `이름은 1~${GOODS_NOTICE_PRESET_NAME_MAX}자로 입력해주세요.`;
  if (values.id && (!UUID.test(values.id) || !values.updatedAt || Number.isNaN(Date.parse(values.updatedAt)))) {
    errors.form = '최신 프리셋을 다시 열어주세요.';
  }
  for (const field of GOODS_NOTICE_FIELDS) {
    const value = values[field.formName].trim();
    if (!value || value.length > GOODS_NOTICE_PRESET_FIELD_MAX) errors[field.formName] = `${field.label} 항목은 1~${GOODS_NOTICE_PRESET_FIELD_MAX}자로 입력해주세요.`;
  }
  if (Object.keys(errors).length) return fail(errors);
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc('admin_save_goods_notice_preset', {
      target_id: values.id || null, target_name: name,
      target_notice: Object.fromEntries(GOODS_NOTICE_FIELDS.map((field) => [field.key, values[field.formName].trim()])),
      expected_updated_at: values.updatedAt || null,
    });
    if (error) return fail(rpcError(error));
  } catch {
    return fail({ form: SAVE_FAILED });
  }
  revalidatePath(GOODS_NOTICE_PRESETS_PATH);
  revalidatePath('/admin/catalog/goods');
  return { attempt, message: '상품정보제공고시 프리셋을 저장했습니다.' };
}

export async function deleteGoodsNoticePresetAction(
  previous: GoodsNoticePresetActionState,
  data: FormData,
): Promise<GoodsNoticePresetActionState> {
  const attempt = nextFormAttempt(previous);
  const fail = (errors: Record<string, string>): GoodsNoticePresetActionState => ({ errors, attempt });
  const accessError = await staffError();
  if (accessError) return fail({ form: accessError });
  const id = typeof data.get('id') === 'string' ? data.get('id') as string : '';
  const updatedAt = typeof data.get('updatedAt') === 'string' ? data.get('updatedAt') as string : '';
  if (!UUID.test(id) || !updatedAt || Number.isNaN(Date.parse(updatedAt))) return fail({ form: '최신 프리셋을 다시 열어주세요.' });
  if (data.get('confirmed') !== 'true') return fail({ form: '삭제 확인을 선택해주세요.' });
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc('admin_delete_goods_notice_preset', {
      target_id: id, expected_updated_at: updatedAt,
    });
    if (error) return fail(rpcError(error, DELETE_FAILED));
  } catch {
    return fail({ form: DELETE_FAILED });
  }
  revalidatePath(GOODS_NOTICE_PRESETS_PATH);
  revalidatePath('/admin/catalog/goods');
  return { attempt, message: '프리셋을 삭제했습니다. 이미 입력된 상품정보제공고시는 유지됩니다.' };
}
