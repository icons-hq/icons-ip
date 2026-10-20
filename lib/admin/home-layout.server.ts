import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseHomeLayoutBlocks } from '@/lib/home-layout';
import type { AdminHomeLayout } from './home-layout';

/** The page checks staff access first; the table also grants staff-only RLS reads. */
export async function getAdminHomeLayout(): Promise<AdminHomeLayout> {
  const client = await createClient();
  const { data, error } = await client.from('home_layout_settings').select('blocks,revision,updated_at').eq('singleton', true).single();
  if (error || !data) throw new Error('홈 영역 순서를 불러오지 못했습니다.');
  const blocks = data.blocks === null ? null : parseHomeLayoutBlocks(data.blocks);
  if (data.blocks !== null && !blocks) throw new Error('저장된 홈 영역 순서를 확인해주세요.');
  return { blocks, revision: Number(data.revision), updatedAt: data.updated_at };
}
