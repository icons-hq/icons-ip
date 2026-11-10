import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseMemberActivitySettings } from './member-activity';
export async function loadMemberActivitySettings() {
  const client = await createClient(); const { data, error } = await client.rpc('admin_get_member_activity_settings');
  const settings = error ? null : parseMemberActivitySettings(data);
  if (!settings) throw new Error('회원 이용 분석 설정을 불러오지 못했습니다.');
  return settings;
}
