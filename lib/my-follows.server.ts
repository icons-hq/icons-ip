import 'server-only';

import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';

/* 내가 팔로우한 IP 목록 (LFS 패리티 2차 L6 · MY-07) — 대시보드 블록과 위시 화면 '팔로우한 IP' 탭이 함께 쓴다.
 *
 * RLS select 로 읽는다 — follows_read 정책이 본인 행(또는 운영 권한)만 준다. 최근에 팔로우한 IP 가 앞에 온다.
 * 던지지 않는다. 못 읽으면 null 이라 화면이 "없다"와 "확인하지 못했다"를 가른다(빈 배열과 다른 값). */
export async function loadMyFollowedIpIds(userId: string): Promise<string[] | null> {
  if (!getSupabaseConfig().isConfigured) return [];
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('ip_follows')
      .select('ip_id,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .order('ip_id', { ascending: true });
    if (error) return null;
    return ((data ?? []) as { ip_id: string }[]).map((row) => row.ip_id);
  } catch {
    return null;
  }
}
