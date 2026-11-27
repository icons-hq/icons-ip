import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseMemberVerificationLimits } from './member-verification-limits';

export async function getMemberVerificationLimits(profileId: string) {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_member_verification_limits', { p_user_id: profileId });
  return error ? null : parseMemberVerificationLimits(data);
}
