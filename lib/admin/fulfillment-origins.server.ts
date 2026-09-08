import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { FulfillmentOrigin } from './fulfillment-origins';
export async function loadAdminFulfillmentOrigins(): Promise<FulfillmentOrigin[]> {
  const client = await createClient();
  const { data, error } = await client.from('fulfillment_origins')
    .select('id,code,name,default_carrier,base_fee,free_threshold,return_address,cutoff,export_template,export_columns,is_active,updated_at').order('code');
  if (error) throw new Error('출고지를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  return (data ?? []).map((row) => ({
    id: row.id, code: row.code, name: row.name, defaultCarrier: row.default_carrier,
    baseFee: Number(row.base_fee), freeThreshold: row.free_threshold === null ? null : Number(row.free_threshold),
    returnAddress: row.return_address, cutoff: row.cutoff ? row.cutoff.slice(0, 5) : null,
    exportTemplate: row.export_template, exportColumns: row.export_columns, active: row.is_active, updatedAt: row.updated_at,
  }));
}
