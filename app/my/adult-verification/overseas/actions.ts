'use server';
import { revalidatePath } from 'next/cache';
import { OVERSEAS_REVIEW_PATH, type OverseasRequestStatus } from '@/lib/identity/overseas-adult';
import { purgeOverseasEvidence } from '@/lib/identity/overseas-evidence.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

export async function readOwnOverseasRequest(): Promise<OverseasRequestStatus | null> {
  const { data, error } = await (await createClient()).rpc('my_overseas_adult_request');
  if (error || !data?.intakeStatus) return null;
  return {
    intakeStatus: data.domesticVerified ? 'domestic' : data.intakeStatus,
    request: data.request ?? null,
    checkedAt: new Date().toISOString(),
  };
}

export async function cancelOverseasRequest(id: string) {
  if (!isUuid(id)) return false;
  const { data, error } = await (await createClient()).rpc('cancel_overseas_adult_request', { p_id: id });
  if (error || data !== true) return false;
  await purgeOverseasEvidence(id).catch(() => null);
  revalidatePath(OVERSEAS_REVIEW_PATH);
  return true;
}
