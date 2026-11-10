import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseClaimReasonHistory } from './claim-reason-change';
export async function loadMyOrderClaimReasonHistory(orderId: string) {
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('get_my_order_claim_reason_changes', { p_order_id: orderId });
    return error ? null : parseClaimReasonHistory(data);
  } catch { return null; }
}
