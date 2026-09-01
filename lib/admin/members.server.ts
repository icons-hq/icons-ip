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

  /* 등급은 상세 RPC 계약(admin_get_member_detail)을 재정의하지 않고 profiles 의
     staff select 로 병합한다 — 못 읽으면 기본 등급으로 두고 상세는 그대로 연다. */
  const { data: gradeRow } = await supabase
    .from('profiles')
    .select('loyalty_grade')
    .eq('id', profileId)
    .maybeSingle<{ loyalty_grade: string }>();

  return {
    ...record,
    loyaltyGrade: typeof gradeRow?.loyalty_grade === 'string'
      ? gradeRow.loyalty_grade
      : record.loyaltyGrade,
  };
}
