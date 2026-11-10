import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
export type PublicGoodsAttributeRow = { id: string; name: string; value: string };
export function parsePublicGoodsAttributeRows(value: unknown): PublicGoodsAttributeRow[] | null {
  if (!Array.isArray(value) || value.length > 30) return null;
  const ids = new Set<string>();
  for (const row of value) {
    if (!row || !isUuid(row.id) || ids.has(row.id) || typeof row.name !== 'string' || !row.name.trim() || typeof row.value !== 'string' || !row.value.trim()) return null;
    ids.add(row.id);
  }
  return value;
}
export async function loadPublicGoodsAttributeRows(goodId: string): Promise<PublicGoodsAttributeRow[]> {
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('get_good_attribute_rows', { p_good_id: goodId });
    return error ? [] : parsePublicGoodsAttributeRows(data) ?? [];
  } catch { return []; }
}
