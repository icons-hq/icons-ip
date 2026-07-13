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
  id: string;
  nickname: string | null;
  role: AdminAssignableRole;
  created_at: string;
}

export async function getAdminProfileRecords(): Promise<AdminProfileRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('id,nickname,role,created_at')
    .order('created_at', { ascending: false })
    .limit(PROFILE_LIMIT);

  if (error) throw new Error(`Failed to load admin profiles: ${error.message}`);

  return ((data ?? []) as ProfileRow[]).map((row) => ({
    id: row.id,
    nickname: row.nickname?.trim() || `fan_${row.id.slice(0, 6)}`,
    role: row.role,
    createdAt: row.created_at,
  }));
}
