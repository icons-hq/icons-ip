import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { connection } from 'next/server';
import { getSupabaseConfig } from '@/lib/supabase/config';

/**
 * Public read of the database-owned card reward gate. Any missing config,
 * transport failure, unexpected value, or RPC error is deliberately OFF.
 */
export async function readCardRewardsEnabled(): Promise<boolean> {
  try {
    // Runtime configuration and the database value must never be frozen into a
    // build artifact. Defer before reading either one (Next.js 16 connection API).
    await connection();
    const { isConfigured, url, key } = getSupabaseConfig();
    if (!isConfigured || !url || !key) return false;

    const supabase = createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    const { data, error } = await supabase.rpc('card_rewards_enabled');
    return error === null && data === true;
  } catch {
    return false;
  }
}
