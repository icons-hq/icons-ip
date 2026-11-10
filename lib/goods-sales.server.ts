import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { ShippingQuoteItem } from '@/lib/fulfillment';
import { parseAddressGoodsSalesQuote, type ShippingDestination } from './shipping-regions';
import { parseGoodsSalesPrecheckoutQuote } from './goods-sales';

export async function loadGoodsSalesQuote(items: ShippingQuoteItem[], destination: ShippingDestination | null = null) {
  const client = await createClient();
  const { data, error } = await client.rpc('quote_goods_sales_for_address', { items, destination });
  return error ? null : parseAddressGoodsSalesQuote(data);
}

export async function loadGoodsSalesPrecheckoutQuote(items: ShippingQuoteItem[]) {
  const client = await createClient();
  const { data, error } = await client.rpc('quote_goods_sales_precheckout', { items });
  return error ? null : parseGoodsSalesPrecheckoutQuote(data);
}
