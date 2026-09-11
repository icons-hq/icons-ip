import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseStoreCreditCheckoutQuote, parseStoreCreditHistory, type StoreCreditCheckoutQuote, type StoreCreditHistory } from './store-credits';
import type { ShippingDestination } from './shipping-regions';

export async function loadMyStoreCreditHistory(page = 1): Promise<StoreCreditHistory> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_my_store_credit_history', { p_page: page });
  const history = error ? null : parseStoreCreditHistory(data);
  if (!history) throw new Error('적립금 내역을 불러오지 못했습니다.');
  return history;
}

/** Failure remains unavailable; never substitute a fabricated zero balance. */
export async function loadMyStoreCreditCheckout(requestedAmount = 0, destination: ShippingDestination | null = null): Promise<StoreCreditCheckoutQuote | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('get_my_store_credit_checkout_for_address', { p_requested_amount: requestedAmount, p_destination: destination });
    const quote = error ? null : parseStoreCreditCheckoutQuote(data);
    return quote?.requestedAmount === requestedAmount ? quote : null;
  } catch { return null; }
}
