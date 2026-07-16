import 'server-only';

import { notFound, redirect } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import {
  parseAdminMemberDetail,
  parseAdminMemberSummary,
  type AdminMemberDetail,
  type AdminMemberSummary,
} from '@/lib/admin/members';
import { createClient } from '@/lib/supabase/server';

async function requireStaffMemberAccess() {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user) redirect(`/login?next=${encodeURIComponent('/admin')}`);
  if (!auth.isStaff) notFound();
}

export async function getAdminMemberSummaries(query = ''): Promise<AdminMemberSummary[]> {
  await requireStaffMemberAccess();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_search_members', {
    target_query: query || null,
  });

  if (error || !Array.isArray(data)) throw new Error('Failed to load admin members');
  const records = data.map(parseAdminMemberSummary);
  if (records.some((record) => record === null)) throw new Error('Failed to load admin members');
  return records as AdminMemberSummary[];
}

export async function getAdminMemberDetail(profileId: string): Promise<AdminMemberDetail | null> {
  await requireStaffMemberAccess();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_get_member_detail', {
    target_profile_id: profileId,
  });

  if (error || !Array.isArray(data)) throw new Error('Failed to load admin member detail');
  if (data.length === 0) return null;
  if (data.length !== 1) throw new Error('Failed to load admin member detail');
  const record = parseAdminMemberDetail(data[0]);
  if (!record) throw new Error('Failed to load admin member detail');
  return record;
}
