import 'server-only';
import { createClient } from './supabase/server';
import { parseCouponCombinationPolicy } from './coupon-combinations';
export async function loadCouponCombinationPolicy() {
 try { const { data, error } = await (await createClient()).rpc('get_coupon_combination_policy'); return error ? null : parseCouponCombinationPolicy(data); } catch { return null; }
}
