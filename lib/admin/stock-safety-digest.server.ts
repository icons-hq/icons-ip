import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { parseStockSafetyDigestSettings, type StockSafetyDigestSettings } from './stock-safety-digest';

/** 요약 메일 설정·최근 발송 기록. 권한이 없거나 읽지 못하면 null — 화면은 설정 칸 대신 안내를 보인다. */
export async function loadStockSafetyDigest(): Promise<StockSafetyDigestSettings | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_get_stock_safety_digest');
  return error ? null : parseStockSafetyDigestSettings(data);
}
