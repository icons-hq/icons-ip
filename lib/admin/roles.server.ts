import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { AdminAssignableRole } from '@/lib/admin/roles';

const PROFILE_LIMIT = 50;

export interface AdminProfileRecord {
  id: string;
  nickname: string;
  role: AdminAssignableRole;
  createdAt: string;
}

interface ProfileRow {
  profile_id: string;
  nickname: string | null;
  role: AdminAssignableRole;
  created_at: string;
}

export async function getAdminProfileRecords(): Promise<AdminProfileRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_search_members', {
    target_limit: PROFILE_LIMIT,
    target_offset: 0,
    target_query: null,
  });

  if (error) throw new Error(`Failed to load admin profiles: ${error.message}`);

  return ((data ?? []) as ProfileRow[]).map((row) => ({
    id: row.profile_id,
    nickname: row.nickname?.trim() || `fan_${row.profile_id.slice(0, 6)}`,
    role: row.role,
    createdAt: row.created_at,
  }));
}
