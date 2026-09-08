import 'server-only';
import type { createClient } from '@/lib/supabase/server';

/** 문의 소유자/staff 범위의 답변 표시명만 읽는다. profiles 읽기 범위를 넓히지 않는다. */
export async function loadInquiryAuthorNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  inquiryId: string,
): Promise<Map<string, string>> {
  const { data, error } = await supabase.rpc('inquiry_message_author_names', {
    target_inquiry_id: inquiryId,
  });
  if (error) throw new Error(`Failed to load inquiry authors: ${error.message}`);
  return new Map(((data ?? []) as { message_id: string; author_name: string }[])
    .map((row) => [row.message_id, row.author_name]));
}
