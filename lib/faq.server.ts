import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { FAQ_PAGE_SIZE, type FaqEntry, type FaqFilters } from '@/lib/faq';

export interface FaqPageData {
  entries: FaqEntry[];
  total: number;
  filters: FaqFilters;
}

/** Explicit public-only RPC even for an authenticated staff visitor. No service role. */
export async function loadPublishedFaq(filters: FaqFilters, limit = FAQ_PAGE_SIZE): Promise<FaqPageData> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('search_faq_entries', {
    target_query: filters.query, target_category: filters.category,
    page_limit: limit, page_offset: (filters.page - 1) * limit,
  });
  if (error) throw new Error(`Failed to load FAQ: ${error.message}`);
  const result = data as { entries: FaqEntry[]; total: number } | null;
  const total = result?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / limit));
  if (filters.page > lastPage) return loadPublishedFaq({ ...filters, page: lastPage }, limit);
  return { entries: result?.entries ?? [], total, filters };
}

export async function loadAdminFaq(filters: FaqFilters): Promise<FaqPageData> {
  const supabase = await createClient();
  let query = supabase.from('faq_entries')
    .select('id,category,question,answer,sort_order,is_published,updated_at', { count: 'exact' });
  if (filters.category) query = query.eq('category', filters.category);
  if (filters.status !== 'all') query = query.eq('is_published', filters.status === 'published');
  if (filters.query) query = query.ilike('question', `%${filters.query.replace(/[\\%_]/g, '\\$&')}%`);
  const { data, count, error } = await query.order('sort_order').order('id')
    .range((filters.page - 1) * FAQ_PAGE_SIZE, filters.page * FAQ_PAGE_SIZE - 1);
  if (error) throw new Error(`Failed to load admin FAQ: ${error.message}`);
  const total = count ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / FAQ_PAGE_SIZE));
  if (filters.page > lastPage) return loadAdminFaq({ ...filters, page: lastPage });
  return {
    entries: (data ?? []).map((row) => ({
      id: row.id, category: row.category, question: row.question, answer: row.answer,
      sortOrder: row.sort_order, published: row.is_published, updatedAt: row.updated_at,
    })), total, filters,
  };
}
