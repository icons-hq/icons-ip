import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { ADMIN_INQUIRY_CHAT_PAGE_SIZE, parseInquiryChatContext, parseInquiryChatData, type InquiryChatFilters } from './inquiry-chat';

export async function loadInquiryChatData(filters: InquiryChatFilters) {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_inquiry_chat_console', {
    p_status: filters.status, p_assignee: filters.assignee, p_period: filters.period,
    p_read: filters.read, p_sort: filters.sort, p_query: filters.query,
    p_limit: ADMIN_INQUIRY_CHAT_PAGE_SIZE, p_offset: (filters.page - 1) * ADMIN_INQUIRY_CHAT_PAGE_SIZE,
  });
  const parsed = !error && parseInquiryChatData(data);
  if (!parsed) throw new Error('상담 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  return parsed;
}

export async function loadInquiryChatContext(inquiryId: string) {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_inquiry_chat_context', { p_inquiry_id: inquiryId });
  if (error?.code === 'P0002') return null;
  const parsed = !error && parseInquiryChatContext(data);
  if (!parsed || parsed.inquiryId !== inquiryId) throw new Error('상담 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  return parsed;
}
