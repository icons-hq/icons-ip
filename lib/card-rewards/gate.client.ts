import { createClient } from '@/lib/supabase/client';

/**
 * Browser readback for optional navigation surfaces. It starts and fails OFF;
 * server routes, actions, and the database remain the authorization boundary.
 */
export async function fetchCardRewardsEnabled(): Promise<boolean> {
  try {
    const { data, error } = await createClient().rpc('card_rewards_enabled');
    return error === null && data === true;
  } catch {
    return false;
  }
}
