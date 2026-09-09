'use server';
import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';
import { FULFILLMENT_ORIGINS_PATH, parseFulfillmentOriginInput } from '@/lib/admin/fulfillment-origins';
import { withPreservedFormValues, type AdminFormValuesState } from '@/lib/admin/form-state';

export interface FulfillmentActionState extends AdminFormValuesState { message?: string; errors?: Record<string, string>; updatedAt?: string }
export async function saveFulfillmentOriginAction(previous: FulfillmentActionState, data: FormData): Promise<FulfillmentActionState> {
  const values = Object.fromEntries([...data.entries()].filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  const fail = (errors: Record<string, string>) => withPreservedFormValues({ errors }, previous, data);
  try {
    const auth = await getCurrentAdminAuthState();
    if (!auth.user || !auth.isConfigured) redirect(`/login?next=${encodeURIComponent(FULFILLMENT_ORIGINS_PATH)}`);
    if (!auth.isStaff || auth.role !== 'admin') return fail({ form: '출고지 설정 변경은 관리자(admin)만 할 수 있습니다.' });
    const result = parseFulfillmentOriginInput(values);
    if (!result.ok) return fail(result.errors);
    if (values.id && (!/^[0-9a-f-]{36}$/i.test(values.id) || !values.updatedAt || Number.isNaN(Date.parse(values.updatedAt)))) return fail({ form: '최신 출고지 설정을 다시 열어주세요.' });
    const client = await createClient();
    const { data: saved, error } = await client.rpc('admin_save_fulfillment_origin', {
      target_id: values.id || null, target_values: result.value, expected_updated_at: values.updatedAt || null,
    });
    if (error) {
      if (error.message.includes('conflict')) return fail({ form: '다른 관리자가 설정을 변경했습니다. 입력값을 복사한 뒤 새로고침해주세요.' });
      if (error.message.includes('carrier')) return fail({ defaultCarrier: '사용 중인 기본 택배사를 선택해주세요.' });
      if (error.message.includes('code_key')) return fail({ code: '이미 사용 중인 출고지 코드입니다.' });
      return fail({ form: '출고지 설정을 저장하지 못했습니다. 입력값을 확인하고 다시 시도해주세요.' });
    }
    for (const path of [FULFILLMENT_ORIGINS_PATH, '/admin/settings/store', '/admin/catalog/goods', '/cart', '/checkout', '/legal/shipping']) revalidatePath(path);
    revalidatePath('/shop/[goodId]', 'page');
    return { message: '출고지 설정을 저장했습니다.', attempt: (previous.attempt ?? 0) + 1, ...(values.id ? { updatedAt: saved.updatedAt } : {}) };
  } catch (error) {
    unstable_rethrow(error);
    return fail({ form: '출고지 설정을 저장하지 못했습니다. 입력값은 유지됩니다.' });
  }
}
