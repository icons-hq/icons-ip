'use server';
import { revalidatePath } from 'next/cache';
import { OVERSEAS_REVIEW_PATH } from '@/lib/identity/overseas-adult';
import { purgeOverseasEvidence } from '@/lib/identity/overseas-evidence.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

export async function beginOverseasRequest() {
  const { data, error } = await (await createClient()).rpc('begin_overseas_adult_request');
  revalidatePath(OVERSEAS_REVIEW_PATH);
  return !error && typeof data === 'string';
}
export async function cancelOverseasRequest(id: string) {
  if (!isUuid(id)) return false;
  const { data, error } = await (await createClient()).rpc('cancel_overseas_adult_request', { p_id: id });
  if (error || data !== true) return false;
  await purgeOverseasEvidence(id).catch(() => null);
  revalidatePath(OVERSEAS_REVIEW_PATH);
  return true;
}
