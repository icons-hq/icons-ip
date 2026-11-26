'use server';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { revalidatePath } from 'next/cache';
import { OVERSEAS_ADMIN_PATH } from '@/lib/identity/overseas-adult';
import { createClient } from '@/lib/supabase/server';

export async function changeOverseasAssignment(kind: 'good' | 'reviewer', target: string, enabled: boolean) {
  const auth = await requireAdminActionAccess(OVERSEAS_ADMIN_PATH, {
    capability: 'operators.manage',
    adminOnly: true,
  });
  if (!auth) return false;
  const { data, error } = await (
    await createClient()
  ).rpc('configure_overseas_adult_review', { p_kind: kind, p_target: target, p_enabled: enabled });
  if (error || data !== true) return false;
  revalidatePath(OVERSEAS_ADMIN_PATH);
  return true;
}
