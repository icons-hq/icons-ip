import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseClaimTypeHistory } from './claim-type-conversion';
export async function loadMyOrderClaimTypeHistory(orderId: string) {
  try {
    const client = await createClient(); const { data, error } = await client.rpc('get_my_order_claim_type_changes', { p_order_id: orderId });
    return error ? null : parseClaimTypeHistory(data);
  } catch { return null; }
}
