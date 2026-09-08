import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { parseGoodShippingPolicy, parseShippingQuote, type ShippingQuoteItem } from './fulfillment';

export async function loadGoodsShippingQuote(items: ShippingQuoteItem[]) {
  const client = await createClient();
  const { data, error } = await client.rpc('quote_goods_shipping', { items });
  if (error) return null;
  return parseShippingQuote(data);
}
export async function loadGoodShippingPolicy(goodId: string) {
  if (!getSupabaseConfig().isConfigured) return null;
  const client = await createClient();
  const { data, error } = await client.rpc('get_good_shipping_policy', { target_good_id: goodId });
  return error ? null : parseGoodShippingPolicy(data);
}
