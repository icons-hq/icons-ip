import 'server-only';

import type { ListingWishlist } from '@/lib/listing-wishlist';
import { readCompleteIdPages } from '@/lib/supabase/complete-id-pages';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';

/* 목록용 위시 굿즈 ID 배치 로더 (LFS 패리티 2차 L4 · CL-01).
 *
 * 목록 페이지가 렌더마다 한 번 부른다 — 카드 수와 무관하게 질의는 회원당 하나다(N+1 금지).
 * 굿즈 상세·위시 화면의 상태 로더(`lib/wishlist.server.ts`)와 같은 RLS select 규율을 따른다:
 * 본인 행만 보이는 정책이 이미 걸려 있고 쓰기는 액션만 한다.
 *
 * PostgREST 는 max_rows 를 넘는 결과를 오류 없이 잘라 준다. ID 커서로 끝까지 읽어 잘린 집합이
 * "찜하지 않음"으로 보이는 일을 막는다(`readCompleteIdPages`).
 *
 * 던지지 않는다. 목록은 비로그인 방문자에게도 열린 공개 표면이라, 위시 상태를 못 읽었다고
 * 페이지가 500 이 되면 공개 브라우징 원칙이 깨진다 — 읽기 실패는 빈 집합으로 접는다.
 * 하트를 누르면 액션이 목표 상태를 멱등하게 기록하므로 화면은 다시 맞춰진다. */
export async function loadListingWishlist(): Promise<ListingWishlist | null> {
  if (!getSupabaseConfig().isConfigured) return null;

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return { viewerId: null, goodIds: [] };

  const userId = auth.user.id;
  const result = await readCompleteIdPages<{ id: string }>((afterId, pageSize) => {
    let query = supabase
      .from('wishlists')
      .select('id:good_id', { count: 'exact' })
      .eq('user_id', userId)
      .order('good_id', { ascending: true })
      .limit(pageSize);
    if (afterId) query = query.gt('good_id', afterId);
    return query;
  });

  return {
    viewerId: userId,
    goodIds: result.error ? [] : (result.data ?? []).map((row) => row.id),
  };
}
