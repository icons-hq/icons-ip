import 'server-only';
import { createClient } from './supabase/server';
import { parseGiftClaimContext } from './gift-claims';
export async function loadGiftClaimContext(giftId: string, actorId: string) {
  const client = await createClient(), { data, error } = await client.rpc('get_my_gift_claim_context', { p_gift_id: giftId, p_expected_actor_id: actorId });
  const context = !error ? parseGiftClaimContext(data) : null;
  if (!context || context.giftId !== giftId) throw new Error('gift_claim_context_unavailable');
  return context;
}
