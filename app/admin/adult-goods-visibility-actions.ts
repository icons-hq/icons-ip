'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { ADULT_GOODS_VISIBILITY_PATH, parseAdultGoodsVisibility } from '@/lib/adult-goods';
import { createClient } from '@/lib/supabase/server';

type SaveResult = { error?: string; message?: string };

export async function setAdultGoodsVisibilityAction(_previous: SaveResult, form: FormData): Promise<SaveResult> {
  if (!await requireAdminActionAccess(ADULT_GOODS_VISIBILITY_PATH, { adminOnly: true, capability: 'platform.manage' })) {
    return { error: '성인 상품 공개 설정을 변경할 권한이 없습니다.' };
  }
  const mode = form.get('visibility');
  const revision = Number(form.get('revision'));
  if ((mode !== 'visible' && mode !== 'hidden') || !Number.isSafeInteger(revision) || revision < 1) {
    return { error: '현재 설정을 다시 불러온 뒤 선택해주세요.' };
  }
  try {
    const enabled = mode === 'visible';
    const { data, error } = await (await createClient()).rpc('admin_set_adult_goods_visibility', {
      p_enabled: enabled, p_expected_revision: revision,
    });
    if (error?.code === 'PT409') {
      revalidatePath(ADULT_GOODS_VISIBILITY_PATH);
      return { error: '다른 관리자가 먼저 변경했습니다. 현재 상태를 확인하고 다시 선택해주세요.' };
    }
    if (error || parseAdultGoodsVisibility(data)?.enabled !== enabled) {
      return { error: '저장 결과를 확인할 수 없습니다. 새로고침해 현재 상태를 확인해주세요.' };
    }
    revalidatePath('/', 'layout');
    return { message: enabled ? '19 표시로 노출하도록 저장했습니다.' : '모든 고객에게 숨기도록 저장했습니다.' };
  } catch (error) {
    unstable_rethrow(error);
    return { error: '저장 결과를 확인할 수 없습니다. 새로고침해 현재 상태를 확인해주세요.' };
  }
}
