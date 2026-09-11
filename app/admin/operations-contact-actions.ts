'use server';

import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';
import { OPERATIONS_CONTACT_FIELDS, OPERATIONS_SETTINGS_PATH, parseOperationsContactValues, validOperationsContactTarget, validOperationsContactVersion, type OperationsContactValues } from '@/lib/admin/operations-contacts';

export type OperationsContactActionState = {
  message?: string;
  errors?: Record<string, string>;
  updatedAt?: string | null;
};

function formString(data: FormData, key: string): string | null {
  const values = data.getAll(key);
  return values.length === 1 && typeof values[0] === 'string' ? values[0] : null;
}

export async function saveOperationsContactAction(previous: OperationsContactActionState, data: FormData): Promise<OperationsContactActionState> {
  const fail = (errors: Record<string, string>): OperationsContactActionState => ({ errors, updatedAt: previous.updatedAt });
  try {
    const auth = await getCurrentAdminAuthState();
    if (!auth.isConfigured || !auth.user) redirect(`/login?next=${encodeURIComponent(OPERATIONS_SETTINGS_PATH)}`);
    if (!auth.isStaff || auth.role !== 'admin') return fail({ form: '담당자 정보 변경은 관리자(admin)만 할 수 있습니다.' });

    const scope = formString(data, 'scope');
    const originId = formString(data, 'originId');
    const version = formString(data, 'updatedAt');
    if (scope === null || originId === null || !validOperationsContactTarget(scope, originId)) return fail({ form: '운영 총괄 또는 출고지를 다시 확인해주세요.' });
    if (version === null || !validOperationsContactVersion(version)) return fail({ form: '최신 담당자 정보를 다시 열어주세요.' });
    const values = Object.fromEntries(Object.keys(OPERATIONS_CONTACT_FIELDS).map(key => [key, formString(data, key)]));
    const parsed = parseOperationsContactValues(values);
    if (!parsed.ok) return fail(parsed.errors);

    const client = await createClient();
    const { data: updatedAt, error } = await client.rpc('admin_save_operations_contact', {
      target_scope: scope, target_origin_id: originId || null,
      target_values: parsed.value satisfies OperationsContactValues, expected_updated_at: version || null,
    });
    if (error) {
      if (error.code === 'PT409' || error.message?.includes('operations_contact_changed')) {
        return fail({ form: '다른 관리자가 수정했습니다. 입력값을 복사한 뒤 새로고침해 최신 정보를 확인해주세요.' });
      }
      return fail({ form: '담당자 정보를 저장하지 못했습니다. 입력값은 유지됩니다. 잠시 후 다시 시도해주세요.' });
    }
    revalidatePath(OPERATIONS_SETTINGS_PATH);
    return { message: '담당자 정보를 저장했습니다.', updatedAt };
  } catch (error) {
    unstable_rethrow(error);
    return fail({ form: '담당자 정보를 저장하지 못했습니다. 입력값은 유지됩니다. 잠시 후 다시 시도해주세요.' });
  }
}
