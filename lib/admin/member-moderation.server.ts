import 'server-only';
import { MANAGER_ROLES, type ManagerRole } from './access';
import { isLoyaltyGrade, type LoyaltyGrade } from '@/lib/loyalty';
import { createClient } from '@/lib/supabase/server';

export interface MemberModerationContext {
  managerRole: ManagerRole | null;
  canModerate: boolean;
  loyaltyGrade: LoyaltyGrade | null;
}

/** UI reads the same current actor/target policy that the mutation checks again. */
export async function getMemberModerationContext(profileId: string): Promise<MemberModerationContext> {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_member_moderation_context', { p_profile_ids: [profileId] });
  if (error || !Array.isArray(data) || data.length > 1) throw new Error('회원 제재 권한을 확인하지 못했습니다.');
  if (!data.length) return { managerRole: null, canModerate: false, loyaltyGrade: null };
  const row = data[0];
  if (!row || row.profileId !== profileId || typeof row.canModerate !== 'boolean'
    || (row.managerRole !== null && !MANAGER_ROLES.includes(row.managerRole)) || !isLoyaltyGrade(row.loyaltyGrade)) {
    throw new Error('회원 제재 권한을 확인하지 못했습니다.');
  }
  return { managerRole: row.managerRole, canModerate: row.canModerate, loyaltyGrade: row.loyaltyGrade };
}
