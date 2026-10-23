import 'server-only';

import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';

/* 위시·재입고 신청 상태 로더 (#326 S4).
 *
 * 읽기는 RLS select 로 한다 — 본인 행만 보이는 정책이 이미 걸려 있다(쓰기만 액션).
 *
 * 절대 던지지 않는다. 이 값은 PDP 와 위시 화면의 장식이고, 굿즈 상세는 로그인하지
 * 않은 방문자에게도 열려야 하는 공개 표면이다. 참여 상태를 못 읽었다는 이유로
 * 상세페이지가 500 이 되면 공개 브라우징 원칙이 깨진다.
 */

interface WishlistRow {
  good_id: string;
  created_at: string;
}

export interface GoodEngagement {
  wished: boolean;
  /** 굿즈 단위(모든 옵션) 재입고 알림이 대기 중인가. */
  restockRequested: boolean;
  /** 옵션 단위 재입고 알림이 대기 중인 옵션 id (PD-11). */
  restockVariantIds: string[];
}

export interface WishlistEntry {
  goodId: string;
  createdAt: string;
}

const guestEngagement: GoodEngagement = { wished: false, restockRequested: false, restockVariantIds: [] };

type WishlistSupabaseClient = Awaited<ReturnType<typeof createClient>>;

async function currentUserId(
  supabase: WishlistSupabaseClient,
): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user.id;
}

export async function getGoodEngagement(goodId: string): Promise<GoodEngagement> {
  const id = goodId.trim();
  if (!id || !getSupabaseConfig().isConfigured) return guestEngagement;

  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return guestEngagement;

  /* 두 표식은 서로 독립이라 한 번에 병렬로 읽는다. 한쪽이 실패해도 다른 쪽 표시는
     맞아야 하므로 각자 기본값으로 접는다. */
  const [wishResult, restockResult] = await Promise.all([
    supabase
      .from('wishlists')
      .select('good_id')
      .eq('user_id', userId)
      .eq('good_id', id)
      .maybeSingle<{ good_id: string }>(),
    /* 한 굿즈에 신청이 여러 행일 수 있다 — "모든 옵션" 1행과 옵션마다 1행(PD-11).
       maybeSingle 로 읽으면 두 행부터 오류가 나 신청 상태가 통째로 false 로 접힌다. */
    supabase
      .from('restock_alerts')
      .select('variant_id,status')
      .eq('user_id', userId)
      .eq('good_id', id)
      .eq('status', 'pending'),
  ]);

  return {
    wished: !wishResult.error && Boolean(wishResult.data),
    ...pendingRestockState(restockResult.error ? [] : restockResult.data ?? []),
  };
}

interface RestockAlertStateRow {
  variant_id: string | null;
  status: string;
}

/**
 * 대기 중인 재입고 신청 행을 굿즈 단위 표식과 옵션 id 목록으로 나눈다.
 * notified 로 넘어간 신청은 이미 알림을 받은 과거다 — 다시 신청할 수 있어야 하므로 세지 않는다.
 */
export function pendingRestockState(rows: readonly RestockAlertStateRow[]): Pick<GoodEngagement, 'restockRequested' | 'restockVariantIds'> {
  const pending = rows.filter((row) => row.status === 'pending');
  return {
    restockRequested: pending.some((row) => row.variant_id === null),
    restockVariantIds: [...new Set(pending.flatMap((row) => typeof row.variant_id === 'string' ? [row.variant_id] : []))],
  };
}

export async function getWishlistEntries(): Promise<WishlistEntry[]> {
  if (!getSupabaseConfig().isConfigured) return [];

  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return [];

  /* 최근에 찜한 것이 위로 온다 — 목록에서 가장 먼저 찾는 굿즈가 방금 담은 것이다. */
  const { data, error } = await supabase
    .from('wishlists')
    .select('good_id,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) return [];

  return ((data ?? []) as WishlistRow[]).map((row) => ({
    goodId: row.good_id,
    createdAt: row.created_at,
  }));
}
