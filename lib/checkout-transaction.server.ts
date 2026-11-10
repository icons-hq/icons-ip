import 'server-only';
import { createClient } from './supabase/server';
import { getSupabaseConfig } from './supabase/config';

export type GoodsTransactionRuntimeMode = 'legacy' | 'transaction' | 'unavailable';

/** A missing pre-upgrade function is distinct from a failed runtime read. */
export async function loadGoodsTransactionRuntimeMode(): Promise<GoodsTransactionRuntimeMode> {
  if (!getSupabaseConfig().isConfigured) return 'legacy';
  try {
    const { data, error } = await (await createClient()).rpc('get_goods_transaction_runtime_enabled');
    if (error?.code === 'PGRST202' && error.message.includes('get_goods_transaction_runtime_enabled')) return 'legacy';
    if (error || typeof data !== 'boolean') return 'unavailable';
    return data ? 'transaction' : 'legacy';
  } catch { return 'unavailable'; }
}
