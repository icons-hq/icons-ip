'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { normalizeAdminHomeLayoutForm, type AdminHomeLayoutActionState } from '@/lib/admin/home-layout';
import { createClient } from '@/lib/supabase/server';

export async function saveAdminHomeLayoutAction(_state: AdminHomeLayoutActionState, formData: FormData): Promise<AdminHomeLayoutActionState> {
  const parsed = normalizeAdminHomeLayoutForm(formData);
  if (!parsed.ok) return { errors: parsed.errors };
  const auth = await requireAdminActionAccess('/admin/display/curations');
  if (!auth) return { errors: { form: '관리자 권한이 필요합니다.' } };
  try {
    const client = await createClient();
    const { error } = await client.rpc('admin_save_home_layout', {
      target_operation_id: parsed.value.operationId,
      expected_revision: parsed.value.expectedRevision,
      target_blocks: parsed.value.blocks,
    });
    if (error) {
      if (error.message === 'home_layout_conflict' || error.message === 'home_layout_block_not_found') return {
        conflict: true, errors: { form: '홈 구성이 변경되었습니다. 입력은 유지했습니다. 최신 구성을 다시 불러온 뒤 적용해주세요.' },
      };
      return { errors: { form: '영역 순서를 저장하지 못했습니다. 다시 시도해주세요.' } };
    }
  } catch { return { errors: { form: '영역 순서를 저장하지 못했습니다. 다시 시도해주세요.' } }; }
  revalidatePath('/');
  revalidatePath('/admin/display/curations');
  return { message: '홈 영역 순서와 노출 설정을 저장했습니다.' };
}
