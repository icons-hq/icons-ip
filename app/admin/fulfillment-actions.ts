'use server';
import { isUuid } from '@/lib/uuid';
import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { revalidateGoodsSurfaces } from '@/lib/admin/revalidate-goods.server';
import { createClient } from '@/lib/supabase/server';
import { FULFILLMENT_ORIGINS_PATH, fulfillmentOriginFormValues, parseFulfillmentOriginInput, type FulfillmentOriginConflict } from '@/lib/admin/fulfillment-origins';
import { loadAdminFulfillmentOrigin } from '@/lib/admin/fulfillment-origins.server';
import { withPreservedFormValues, type AdminFormValuesState } from '@/lib/admin/form-state';
import { fulfillmentOriginTabHref } from '@/lib/admin/fulfillment-origin-tabs';
import { CHANGED_BY_OTHER } from '@/lib/admin/goods-template-save';

export interface FulfillmentActionState extends AdminFormValuesState {
  message?: string; errors?: Record<string, string>; updatedAt?: string;
  /** 다른 사람이 먼저 바꿨을 때, 그 사람이 저장한 지금 내용. 폼이 '내 입력으로 덮어쓰기'·'내 입력 버리기' 두 길을 보인다. */
  conflict?: FulfillmentOriginConflict;
}

/** 다른 사람이 먼저 바꿨을 때 지금 저장된 내용을 읽는다. 읽지 못하면 null — 그때는 새로고침해 확인하라고만 말한다. */
async function latestFulfillmentOrigin(id: string): Promise<FulfillmentOriginConflict | null> {
  try {
    const origin = await loadAdminFulfillmentOrigin(id);
    return origin ? { updatedAt: origin.updatedAt, values: fulfillmentOriginFormValues(origin) } : null;
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
}

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
      if (error.message.includes('conflict')) {
        const latest = values.id ? await latestFulfillmentOrigin(values.id) : null;
        return latest ? { ...fail({ form: CHANGED_BY_OTHER }), conflict: latest }
          : fail({ form: `${CHANGED_BY_OTHER} 적은 내용을 따로 복사해 둔 뒤 새로고침해 지금 저장된 내용을 확인해 주세요.` });
      }
      if (error.message.includes('shipping_carrier_inactive')) return fail({ defaultCarrier: '사용 안 함인 택배사는 고를 수 없습니다. 다른 택배사를 골라 주세요.' });
      if (error.message.includes('carrier')) return fail({ defaultCarrier: '사용으로 저장하려면 기본 택배사를 골라 주세요.' });
      if (error.message.includes('code_key')) return fail({ code: '이미 있는 출고지 코드입니다. 다른 코드를 적어 주세요.' });
      return fail({ form: '출고지 설정을 저장하지 못했습니다. 입력은 그대로 있습니다. 잠시 뒤 다시 저장하고, 같은 오류가 계속되면 개발 담당자에게 알려주세요.' });
    }
    for (const path of [FULFILLMENT_ORIGINS_PATH, '/admin/settings/store', '/admin/catalog/goods', '/cart', '/checkout', '/legal/shipping']) revalidatePath(path);
    revalidateGoodsSurfaces();
    // R22: 새 출고지는 '출고지 추가' 탭에 머물지 않고 저장한 출고지의 탭으로 간다.
    if (!values.id) redirect(fulfillmentOriginTabHref(result.value.code));
    /* 사용 안 함으로 저장하면 상품에서 이 출고지를 고를 수 없다 — 저장 결과에서 다음 할 일을 말한다. */
    return { message: result.value.is_active ? '출고지 설정을 저장했습니다.' : "사용 안 함으로 저장했습니다. 상품에서 고르려면 '사용'으로 바꿔 주세요.",
      attempt: (previous.attempt ?? 0) + 1, ...(values.id ? { updatedAt: saved.updatedAt } : {}) };
  } catch (error) {
    unstable_rethrow(error);
    return fail({ form: '출고지 설정을 저장하지 못했습니다. 입력은 그대로 있습니다. 잠시 뒤 다시 저장해주세요.' });
  }
}
