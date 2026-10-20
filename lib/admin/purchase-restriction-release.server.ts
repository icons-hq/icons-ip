import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseRestrictionReleaseReceipt } from './purchase-restriction-release';

export async function loadRestrictionRelease(id: string) {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_get_purchase_restriction_release', { p_operation_id: id });
  if (error) throw new Error('Failed to read restriction release');
  if (data === null) return null;
  const receipt = parseRestrictionReleaseReceipt(data);
  if (!receipt || receipt.id !== id) throw new Error('Invalid restriction release receipt');
  return receipt;
}
