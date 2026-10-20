'use server';
import { revalidatePath, updateTag } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { STORE_SETTINGS_CACHE_TAG, STORE_SETTINGS_PATH } from '@/lib/admin/store-settings';
import { parseStoreBranding } from '@/lib/store-branding';

export type StoreBrandingActionState = { message?: string; error?: string; updatedAt?: string };
export async function saveStoreBrandingAction(input: unknown, stamp: string, operationId: string): Promise<StoreBrandingActionState> {
  try {
    if (!await requireAdminActionAccess(STORE_SETTINGS_PATH, { adminOnly: true, capability: 'store.manage' })) return { error: '설정 변경은 관리자(admin)만 할 수 있습니다.' };
    const branding = parseStoreBranding(input);
    if (!branding) return { error: '입력값을 확인해주세요. 표시 이름은 1~30자, 소개는 최대 50자이며 사용할 소개·로고·SNS 주소가 필요합니다. SNS에는 해당 서비스의 HTTPS 주소를 입력해주세요.' };
    if (!stamp || Number.isNaN(Date.parse(stamp)) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) return { error: '설정을 다시 열어 최신 저장 정보를 확인해주세요.' };
    const client = await createClient();
    const { data, error } = await client.rpc('admin_save_store_branding', { target_operation_id: operationId, target_values: branding, expected_updated_at: stamp });
    if (error) return { error: error.message?.includes('store_settings_conflict')
      ? '다른 관리자가 수정했습니다. 입력값을 복사한 뒤 새로고침해 최신 설정을 확인해주세요.'
      : error.message?.includes('invalid_store_profile_image') ? '대표 이미지는 160×160px 이상의 정사각형이어야 합니다. 조건에 맞는 이미지를 새로 업로드해주세요.'
      : error.message?.includes('unverified_artwork') ? '로고 업로드 유효기간이 지났거나 사용할 수 없는 이미지입니다. 이미지를 다시 업로드해주세요.'
      : '스토어 브랜드 설정을 저장하지 못했습니다. 입력값은 유지됩니다. 잠시 후 다시 시도해주세요.' };
    if (typeof data !== 'string' || Number.isNaN(Date.parse(data))) return { error: '저장 결과를 확인하지 못했습니다. 입력값을 유지한 채 다시 저장해주세요.' };
    updateTag(STORE_SETTINGS_CACHE_TAG);
    revalidatePath(STORE_SETTINGS_PATH);
    revalidatePath('/', 'layout');
    return { message: '스토어 브랜드·SNS 설정을 저장했습니다.', updatedAt: data };
  } catch (error) {
    unstable_rethrow(error);
    return { error: '스토어 브랜드 설정을 저장하지 못했습니다. 입력값은 유지됩니다. 잠시 후 다시 시도해주세요.' };
  }
}
