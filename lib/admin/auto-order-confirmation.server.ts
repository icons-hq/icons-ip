import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseAutoOrderConfirmation, type AutoOrderConfirmationState } from './auto-order-confirmation';

/** 읽지 못하면 null — 발주 화면 자체는 계속 열리고 패널이 안내한다. */
export async function getAutoOrderConfirmation(): Promise<AutoOrderConfirmationState | null> {
  try {
    const { data, error } = await (await createClient()).rpc('admin_get_auto_order_confirmation');
    return error ? null : parseAutoOrderConfirmation(data);
  } catch { return null; }
}
