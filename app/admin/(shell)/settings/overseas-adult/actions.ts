'use server';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { revalidatePath } from 'next/cache';
import { OVERSEAS_ADMIN_PATH } from '@/lib/identity/overseas-adult';
import { createClient } from '@/lib/supabase/server';

export async function setOverseasReviewGood(goodId: string, enabled: boolean) {
  const auth = await requireAdminActionAccess(OVERSEAS_ADMIN_PATH);
  if (!auth) return false;
  const client = await createClient();
  const { data, error } = await client.rpc('configure_overseas_adult_review', {
    p_kind: 'good', p_target: goodId, p_enabled: enabled,
  });
  if (error || data !== true) return false;
  revalidatePath(OVERSEAS_ADMIN_PATH);
  return true;
}
