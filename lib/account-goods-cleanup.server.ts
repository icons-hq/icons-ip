import 'server-only';
import { isUuid } from '@/lib/uuid';
import { createServiceClient } from '@/lib/supabase/service';
interface CleanupRpc { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
/** Invoke only after the self-only deletion RPC commits. Each RPC owns its locks. */
export async function cleanupFencedGoodsAccount(actorId: string, supplied?: CleanupRpc): Promise<boolean> {
  if (!isUuid(actorId)) return false;
  try {
    const client = supplied ?? createServiceClient();
    const gifts = await client.rpc('service_list_fenced_gifts', { p_actor: actorId, p_after: null, p_limit: 25 });
    let complete = !gifts.error && Array.isArray(gifts.data) && gifts.data.length <= 25 && gifts.data.every(isUuid) && new Set(gifts.data).size === gifts.data.length;
    if (complete) {
      for (const giftId of gifts.data as string[]) {
        const result = await client.rpc('service_cleanup_fenced_gift', { p_id: giftId });
        if (result.error || !object(result.data) || result.data.giftId !== giftId || !['cleaned', 'ordered', 'not_fenced', 'missing'].includes(String(result.data.state))) complete = false;
      }
      // Remaining records converge through the bounded gift maintenance worker.
      if ((gifts.data as string[]).length === 25) complete = false;
    }
    const result = await client.rpc('service_cleanup_fenced_goods_transactions', { p_actor: actorId });
    const cleaned = !result.error && object(result.data) && ['cleaned', 'deferred'].includes(String(result.data.state))
      && Number.isSafeInteger(result.data.quotesRemoved) && (result.data.quotesRemoved as number) >= 0;
    return complete && cleaned;
  } catch { return false; }
}
