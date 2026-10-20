import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parsePurchaseRestrictionBatch, type PurchaseRestrictionBatch } from './purchase-restriction-batches';
export async function loadPurchaseRestrictionBatch(id: string): Promise<PurchaseRestrictionBatch | null> {
  const client = await createClient(); const { data, error } = await client.rpc('admin_get_purchase_restriction_batch', { p_batch_id: id });
  if (error) throw new Error('구매제한 등록 결과를 불러오지 못했습니다.');
  if (data === null) return null;
  const batch = parsePurchaseRestrictionBatch(data); if (!batch || batch.id !== id) throw new Error('구매제한 등록 결과를 확인하지 못했습니다.');
  return batch;
}
