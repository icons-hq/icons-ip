import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { DEFAULT_DETAIL_EXPERIENCES, parseDetailExperienceSnapshot, type DetailExperienceSnapshot } from '@/lib/product-detail-experiences';
export async function loadAdminDetailExperiences(): Promise<DetailExperienceSnapshot> {
  try {
    const client = await createClient(); const { data, error } = await client.rpc('admin_get_product_detail_experiences');
    const result = error ? null : parseDetailExperienceSnapshot(data); if (result) return result;
  } catch { /* A failed read never pretends to be a stored default. */ }
  return { values: DEFAULT_DETAIL_EXPERIENCES, revisions: { messages: 0, discovery: 0 }, unavailable: true };
}
