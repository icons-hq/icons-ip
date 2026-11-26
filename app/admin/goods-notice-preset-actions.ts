'use server';

import { isUuid } from '@/lib/uuid';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { GOODS_NOTICE_FIELDS } from '@/lib/goods-notice';
import { nextFormAttempt, type AdminFormValuesState } from '@/lib/admin/form-state';
import {
  GOODS_NOTICE_PRESET_FIELD_MAX,
  GOODS_NOTICE_PRESET_NAME_MAX,
  GOODS_NOTICE_PRESETS_PATH,
  normalizeGoodsKcPresetTemplate,
  type GoodsKcPresetTemplate,
} from '@/lib/admin/goods-notice-presets';

export interface GoodsNoticePresetActionState extends AdminFormValuesState {
  errors?: Record<string, string>;
  message?: string;
}
const VALUE_FIELDS = ['id', 'name', 'updatedAt', ...GOODS_NOTICE_FIELDS.map((field) => field.formName)];
const SAVE_FAILED = '템플릿을 저장하지 못했습니다. 입력한 내용은 그대로 있습니다. 잠시 후 다시 저장해주세요.';
const DELETE_FAILED = '템플릿을 삭제하지 못했습니다. 잠시 후 다시 시도해주세요.';
/* 고시 내용 일곱 칸은 비워 둘 수 있다 — 비운 칸은 상품에 가져올 때 상품의 값을 건드리지 않는다. 모두 비우면 가져올 내용이 없다. */
const ALL_BLANK = '고시 내용을 한 칸 이상 적어 주세요. 일곱 칸이 모두 비어 있으면 상품에 가져올 내용이 없습니다.';
const SAVE_CONFLICT = '다른 사람이 먼저 바꿨습니다. 새로고침하면 최신 내용이 보입니다. 지금 적은 내용은 사라지니 필요한 칸은 먼저 복사해 두세요.';
const DELETE_CONFLICT = '다른 사람이 먼저 바꿨습니다. 새로고침해 최신 내용을 확인한 뒤 다시 삭제해 주세요.';

async function staffError(): Promise<string | null> {
  try {
    return await requireAdminActionAccess(GOODS_NOTICE_PRESETS_PATH) ? null : '관리자 권한이 필요합니다.';
  } catch (error) {
    unstable_rethrow(error);
    return '권한을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.';
  }
}

function rpcError(error: { code?: string; message: string }, fallback = SAVE_FAILED): Record<string, string> {
  if (error.code === '23505') return { name: '이미 사용 중인 템플릿 이름입니다. 다른 이름을 입력해주세요.' };
  if (error.message.includes('goods_notice_preset_conflict')) return { form: fallback === DELETE_FAILED ? DELETE_CONFLICT : SAVE_CONFLICT };
  if (error.message.includes('goods_notice_preset_empty')) return { form: ALL_BLANK };
  if (error.message.includes('goods_notice_preset_not_found')) return { form: '템플릿을 찾을 수 없습니다. 다른 사람이 삭제했을 수 있으니 새로고침해 목록을 확인해주세요.' };
  if (error.message.includes('staff_required')) return { form: '관리자 권한이 필요합니다.' };
  return { form: fallback };
}

export async function saveGoodsNoticePresetAction(
  previous: GoodsNoticePresetActionState,
  data: FormData,
): Promise<GoodsNoticePresetActionState> {
  const values = Object.fromEntries(VALUE_FIELDS.map((name) => [name, typeof data.get(name) === 'string' ? data.get(name) as string : '']));
  if (data.has('kcTemplate')) values.kcTemplate=typeof data.get('kcTemplate')==='string'?data.get('kcTemplate') as string:'';
  const attempt = nextFormAttempt(previous);
  const fail = (errors: Record<string, string>): GoodsNoticePresetActionState => ({ errors, values, attempt });
  const accessError = await staffError();
  if (accessError) return fail({ form: accessError });
  const errors: Record<string, string> = {};
  let kcTemplate:GoodsKcPresetTemplate|null=null;
  if ('kcTemplate' in values) {
    try {
      const raw=JSON.parse(values.kcTemplate);
      kcTemplate=normalizeGoodsKcPresetTemplate(raw);
      if (raw!==null && !kcTemplate) errors.kcTemplate='KC 유형 틀의 제품군·적용 제도·안내 문구를 확인해주세요.';
    } catch {errors.kcTemplate='KC 유형 틀의 입력 형식을 확인해주세요.';}
  }
  const name = values.name.trim();
  if (!name || name.length > GOODS_NOTICE_PRESET_NAME_MAX) errors.name = `템플릿 이름을 ${GOODS_NOTICE_PRESET_NAME_MAX}자 안으로 적어 주세요.`;
  if (values.id && (!isUuid(values.id) || !values.updatedAt || Number.isNaN(Date.parse(values.updatedAt)))) {
    errors.form = '화면 정보가 오래됐습니다. 새로고침해 최신 템플릿을 다시 열어주세요.';
  }
  const notice = Object.fromEntries(GOODS_NOTICE_FIELDS.map((field) => [field.key, values[field.formName].trim()]));
  for (const field of GOODS_NOTICE_FIELDS) {
    if (notice[field.key].length > GOODS_NOTICE_PRESET_FIELD_MAX) errors[field.formName] = `${field.label} 칸은 ${GOODS_NOTICE_PRESET_FIELD_MAX.toLocaleString('ko-KR')}자까지 적을 수 있습니다.`;
  }
  if (GOODS_NOTICE_FIELDS.every((field) => !notice[field.key])) errors.form ??= ALL_BLANK;
  if (Object.keys(errors).length) return fail(errors);
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc('admin_save_goods_notice_preset', {
      target_id: values.id || null, target_name: name,
      target_notice: { ...notice, ...('kcTemplate' in values?{kcTemplate}:{}) },
      expected_updated_at: values.updatedAt || null,
    });
    if (error) return fail(rpcError(error));
  } catch {
    return fail({ form: SAVE_FAILED });
  }
  revalidatePath(GOODS_NOTICE_PRESETS_PATH);
  revalidatePath('/admin/catalog/goods');
  return { attempt, message: `‘${name}’ 템플릿을 ${values.id ? '저장' : '등록'}했습니다.` };
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
  if (!isUuid(id) || !updatedAt || Number.isNaN(Date.parse(updatedAt))) return fail({ form: '화면 정보가 오래됐습니다. 새로고침해 최신 템플릿을 다시 열어주세요.' });
  /* 화면은 확인창을 지난 뒤에만 confirmed를 싣는다(GoodsNoticePresetFeedback). */
  if (data.get('confirmed') !== 'true') return fail({ form: '삭제 확인을 받지 못했습니다. [삭제]를 다시 눌러 주세요.' });
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
  /* 채운 상품의 내용이 그대로 남는다는 말은 삭제 확인창에서 한 번만 한다. */
  return { attempt, message: '템플릿을 삭제했습니다.' };
}
