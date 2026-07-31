import 'server-only';

import { createClient } from '@/lib/supabase/server';

/* 차단 목록 조회. 카탈로그 IP 상세와 커뮤니티 피드가 각자 조회하면 한쪽만 고쳐졌을 때
   같은 사용자의 글이 한 화면에서만 사라진다. 조회는 여기서만 한다. */

interface BlockRow {
  blocked_user_id: string;
}

type BlocksSupabaseClient = Awaited<ReturnType<typeof createClient>>;

/** 조회 실패는 throw한다 — 차단이 반영되지 않은 피드를 보여주느니 실패하는 편이 안전하다. */
export async function blockedUserIds(
  supabase: BlocksSupabaseClient,
  viewerId: string | null,
): Promise<Set<string>> {
  if (!viewerId) return new Set<string>();

  const { data, error } = await supabase
    .from('blocks')
    .select('blocked_user_id')
    .eq('user_id', viewerId);

  if (error) {
    throw new Error(`Failed to load blocked users: ${error.message}`);
  }

  return new Set(((data ?? []) as BlockRow[]).map((row) => row.blocked_user_id));
}
