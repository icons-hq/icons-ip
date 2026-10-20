'use server';
import { revalidatePath, updateTag } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { STORE_SETTINGS_CACHE_TAG, STORE_SETTINGS_PATH } from '@/lib/admin/store-settings';
import { parseStoreNavigation } from '@/lib/store-navigation';
import { createClient } from '@/lib/supabase/server';

export type StoreNavigationActionState = { message?: string; error?: string; updatedAt?: string };
export async function saveStoreNavigationAction(input: unknown, stamp: string, operationId: string): Promise<StoreNavigationActionState> {
  try {
    if (!await requireAdminActionAccess(STORE_SETTINGS_PATH, { adminOnly: true, capability: 'store.manage' })) return { error: '메뉴 설정은 관리자(admin)만 저장할 수 있습니다.' };
    const navigation = parseStoreNavigation(input);
    if (!navigation) return { error: '7개 메뉴를 중복 없이 설정해주세요. 메뉴명은 1~20자이며 카테고리는 항상 노출해야 합니다.' };
    if (!stamp || Number.isNaN(Date.parse(stamp)) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) return { error: '설정을 다시 열어 최신 저장 정보를 확인해주세요.' };
    const client = await createClient();
    const { data, error } = await client.rpc('admin_save_store_navigation', {
      target_operation_id: operationId, target_values: navigation, expected_updated_at: stamp,
    });
    if (error) return { error: error.message?.includes('store_settings_conflict')
      ? '다른 관리자가 설정을 수정했습니다. 입력값을 복사한 뒤 새로고침해 최신 설정을 확인해주세요.'
      : '메뉴 설정을 저장하지 못했습니다. 입력값은 유지됩니다. 잠시 후 다시 시도해주세요.' };
    if (typeof data !== 'string' || Number.isNaN(Date.parse(data))) return { error: '저장 결과를 확인하지 못했습니다. 입력값을 유지한 채 다시 저장해주세요.' };
    updateTag(STORE_SETTINGS_CACHE_TAG);
    revalidatePath(STORE_SETTINGS_PATH);
    revalidatePath('/', 'layout');
    return { message: '공개 메뉴 설정을 저장했습니다.', updatedAt: data };
  } catch (error) {
    unstable_rethrow(error);
    return { error: '메뉴 설정을 저장하지 못했습니다. 입력값은 유지됩니다. 잠시 후 다시 시도해주세요.' };
  }
}
