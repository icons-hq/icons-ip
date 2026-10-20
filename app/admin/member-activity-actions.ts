'use server';
import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { parseMemberActivitySettings } from '@/lib/admin/member-activity';
import { loadMemberActivitySettings } from '@/lib/admin/member-activity.server';
import { parseMemberActivityIdentity } from '@/lib/member-activity';
import { CUSTOMER_SEGMENTS_PATH } from '@/lib/admin/customer-segments';
import { isUuid } from '@/lib/uuid';
export async function readMemberActivitySettingsAction() {
  if (!await requireAdminActionAccess(CUSTOMER_SEGMENTS_PATH, { capability: 'marketing.manage' })) return { error: '마케팅 관리 권한이 필요합니다.' };
  try { return { settings: await loadMemberActivitySettings() }; }
  catch (error) { unstable_rethrow(error); return { error: '현재 저장 상태를 불러오지 못했습니다.' }; }
}
export async function saveMemberActivitySettingsAction(enabled: unknown, rawIdentity: unknown, operationId: unknown) {
  const identity = parseMemberActivityIdentity(rawIdentity);
  if (typeof enabled !== 'boolean' || !identity || identity.revision < 1 || !isUuid(operationId)) return { error: '설정 값을 확인해주세요.' };
  const auth = await requireAdminActionAccess(CUSTOMER_SEGMENTS_PATH, { capability: 'marketing.manage' });
  if (!auth || auth.user.id !== identity.actorId) return { error: '로그인 상태가 바뀌었습니다. 현재 계정으로 화면을 다시 열어주세요.' };
  try {
    const client = await createClient(); const result = await client.rpc('admin_save_member_activity_settings', { p_enabled: enabled, p_expected_revision: identity.revision,
      p_operation_id: operationId, p_expected_actor: identity.actorId, p_expected_session: identity.sessionId });
    if (result.error) return { error: result.error.code === 'PT409' ? '저장된 설정이 바뀌었습니다. 현재 상태를 조회한 뒤 다시 선택해주세요.' : '설정 저장을 확인하지 못했습니다. 현재 상태를 조회해주세요.' };
    const settings = parseMemberActivitySettings(result.data); if (!settings || settings.enabled !== enabled) return { error: '저장 결과가 불명확합니다. 현재 상태를 조회해주세요.' };
    revalidatePath(CUSTOMER_SEGMENTS_PATH); return { settings };
  } catch (error) { unstable_rethrow(error); return { error: '저장 결과가 불명확합니다. 현재 상태를 조회해주세요.' }; }
}
