import 'server-only';

import { createClient } from '@/lib/supabase/server';
import {
  FAQ_PAGE_SIZE, FAQ_WIDGET_TOPIC_LIST_SIZE, faqWidgetTopic, isFaqWidgetTopic,
  type FaqEntry, type FaqFilters, type FaqWidgetTopic, type FaqWidgetTopicAnswer, type FaqWidgetTopicDesignation,
} from '@/lib/faq';
import { isInquiryCategory } from '@/lib/inquiries';

export interface FaqPageData {
  entries: FaqEntry[];
  total: number;
  filters: FaqFilters;
  /** 상담 위젯 버튼마다 지정된 대표 FAQ(지정된 것만). 읽지 못하면 비운다. */
  widgetTopics?: FaqWidgetTopicDesignation[];
}

const FAQ_COLUMNS = 'id,category,question,answer,sort_order,is_published,updated_at,widget_topic';
interface FaqRow {
  id: string; category: string; question: string; answer: string; sort_order: number;
  is_published: boolean; updated_at: string; widget_topic?: string | null;
}
function faqEntry(row: FaqRow): FaqEntry {
  return {
    id: row.id, category: isInquiryCategory(row.category) ? row.category : 'etc', question: row.question, answer: row.answer,
    sortOrder: row.sort_order, published: row.is_published, updatedAt: row.updated_at,
    widgetTopic: isFaqWidgetTopic(row.widget_topic) ? row.widget_topic : null,
  };
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

/**
 * 상담 위젯 유형 버튼의 답(0901-044). 운영자가 지정한 공개 대표 FAQ가 있으면 그것 하나, 없으면(지정 안 함·비공개)
 * 그 버튼에 연결된 카테고리의 공개 FAQ 목록이다. 직원이 위젯을 열어도 비공개 FAQ는 보이지 않게 공개 조건을 명시한다.
 */
export async function loadFaqWidgetTopicAnswer(topic: FaqWidgetTopic): Promise<FaqWidgetTopicAnswer> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('faq_entries').select(FAQ_COLUMNS)
    .eq('widget_topic', topic).eq('is_published', true).limit(1);
  if (error) throw new Error(`Failed to load FAQ widget topic: ${error.message}`);
  const designated = (data ?? []) as FaqRow[];
  if (designated[0]) return { topic, entry: faqEntry(designated[0]), entries: [] };
  const { entries } = await loadPublishedFaq(
    { query: '', category: faqWidgetTopic(topic).category, status: 'all', page: 1 },
    FAQ_WIDGET_TOPIC_LIST_SIZE,
  );
  return { topic, entry: null, entries };
}

async function loadFaqWidgetTopicDesignations(supabase: Awaited<ReturnType<typeof createClient>>): Promise<FaqWidgetTopicDesignation[]> {
  const { data, error } = await supabase.from('faq_entries').select('id,question,is_published,widget_topic')
    .not('widget_topic', 'is', null);
  /* 요약은 안내용이다. 읽지 못해도 FAQ 목록·수정은 그대로 연다. */
  if (error) return [];
  return ((data ?? []) as { id: string; question: string; is_published: boolean; widget_topic: string | null }[])
    .flatMap((row) => isFaqWidgetTopic(row.widget_topic)
      ? [{ topic: row.widget_topic, id: row.id, question: row.question, published: row.is_published }] : []);
}

export async function loadAdminFaq(filters: FaqFilters): Promise<FaqPageData> {
  const supabase = await createClient();
  let query = supabase.from('faq_entries')
    .select(FAQ_COLUMNS, { count: 'exact' });
  if (filters.category) query = query.eq('category', filters.category);
  if (filters.status !== 'all') query = query.eq('is_published', filters.status === 'published');
  if (filters.query) query = query.ilike('question', `%${filters.query.replace(/[\\%_]/g, '\\$&')}%`);
  const [{ data, count, error }, widgetTopics] = await Promise.all([
    query.order('sort_order').order('id')
      .range((filters.page - 1) * FAQ_PAGE_SIZE, filters.page * FAQ_PAGE_SIZE - 1),
    loadFaqWidgetTopicDesignations(supabase),
  ]);
  if (error) throw new Error(`Failed to load admin FAQ: ${error.message}`);
  const total = count ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / FAQ_PAGE_SIZE));
  if (filters.page > lastPage) return loadAdminFaq({ ...filters, page: lastPage });
  return { entries: ((data ?? []) as FaqRow[]).map(faqEntry), total, filters, widgetTopics };
}
