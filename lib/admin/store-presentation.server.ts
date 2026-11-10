import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseStorePresentationSnapshot } from '@/lib/store-presentation';
export async function loadAdminStorePresentation() {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_get_store_presentation');
  const snapshot = parseStorePresentationSnapshot(data);
  if (error || !snapshot) throw new Error('스토어 전시 설정을 불러오지 못했습니다.');
  return snapshot;
}
