'use server';
import { isUuid } from '@/lib/uuid';
import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { revalidateGoodsSurfaces } from '@/lib/admin/revalidate-goods.server';
import { createClient } from '@/lib/supabase/server';
import { FULFILLMENT_ORIGINS_PATH, parseFulfillmentOriginInput } from '@/lib/admin/fulfillment-origins';
import { withPreservedFormValues, type AdminFormValuesState } from '@/lib/admin/form-state';
import { fulfillmentOriginTabHref } from '@/lib/admin/fulfillment-origin-tabs';

export interface FulfillmentActionState extends AdminFormValuesState { message?: string; errors?: Record<string, string>; updatedAt?: string }
export async function saveFulfillmentOriginAction(previous: FulfillmentActionState, data: FormData): Promise<FulfillmentActionState> {
  const values = Object.fromEntries([...data.entries()].filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  const fail = (errors: Record<string, string>) => withPreservedFormValues({ errors }, previous, data);
  try {
    if (!await requireAdminActionAccess(FULFILLMENT_ORIGINS_PATH, { capability: 'platform.manage', adminOnly: true })) return fail({ form: '출고지 설정 변경은 최고 관리자만 할 수 있습니다.' });
    const result = parseFulfillmentOriginInput(values);
    if (!result.ok) return fail(result.errors);
    if (values.id && (!isUuid(values.id) || !values.updatedAt || Number.isNaN(Date.parse(values.updatedAt)))) return fail({ form: '출고지 설정 화면을 새로고침한 뒤 다시 저장해주세요.' });
    const client = await createClient();
    const { data: saved, error } = await client.rpc('admin_save_fulfillment_origin', {
      target_id: values.id || null, target_values: result.value, expected_updated_at: values.updatedAt || null,
    });
    if (error) {
      if (error.message.includes('conflict')) return fail({ form: '다른 관리자가 이 출고지 설정을 먼저 바꿨습니다. 입력한 내용을 따로 적어 둔 뒤 새로고침해 최신 설정에 다시 입력해주세요.' });
      if (error.message.includes('carrier')) return fail({ defaultCarrier: '사용 중인 기본 택배사를 선택해주세요.' });
      if (error.message.includes('code_key')) return fail({ code: '이미 사용 중인 출고지 코드입니다.' });
      return fail({ form: '출고지 설정을 저장하지 못했습니다. 입력은 그대로 있습니다. 잠시 뒤 다시 저장하고, 같은 오류가 계속되면 개발 담당자에게 알려주세요.' });
    }
    for (const path of [FULFILLMENT_ORIGINS_PATH, '/admin/settings/store', '/admin/catalog/goods', '/cart', '/checkout', '/legal/shipping']) revalidatePath(path);
    revalidateGoodsSurfaces();
    // R22: 새 출고지는 '출고지 추가' 탭에 머물지 않고 저장한 출고지의 탭으로 간다.
    if (!values.id) redirect(fulfillmentOriginTabHref(result.value.code));
    return { message: '출고지 설정을 저장했습니다.', attempt: (previous.attempt ?? 0) + 1, ...(values.id ? { updatedAt: saved.updatedAt } : {}) };
  } catch (error) {
    unstable_rethrow(error);
    return fail({ form: '출고지 설정을 저장하지 못했습니다. 입력은 그대로 있습니다. 잠시 뒤 다시 저장해주세요.' });
  }
}
