import 'server-only';

import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { parseUserCouponRows, type UserCouponSummary } from './coupons';
import type { WishlistEntry } from './wishlist.server';

/* 마이 대시보드 전용 회원 읽기 (LFS 패리티 2차 L6 · MY-02·03 — 리뷰 l6-data-3).
 *
 * 기존 getWishlistEntries()·loadMyCoupons()는 조회 오류나 로그인 확인 실패에서 빈 배열을 돌려준다 — 카트·위시
 * 화면이 오류로 깨지지 않게 하려는 기존 계약이라 그대로 둔다. 대시보드는 "없다(0)"와 "확인하지 못했다"를
 * 갈라 숫자를 지어내지 않아야 하므로, 같은 RLS 조회를 페이지가 확인한 회원 ID로 다시 쓰고 실패는 null 로 돌려준다.
 * 던지지 않는다. Supabase 가 설정되지 않은 목업 모드는 기존 로더처럼 빈 목록이다. */

/** 쿠폰함(loadMyCoupons)과 같은 선택 열 — parseUserCouponRows 가 같은 판정으로 읽는다. */
const HELD_COUPON_SELECT = 'id,status,issued_at,expires_at,usable_from,used_at,coupons(code,name,discount_type,discount_value,max_discount_amount,min_subtotal,starts_at,ends_at,issue_starts_at,status,grade_benefit,benefit_kind,stackable,recipient_segment,goods_scope,target_good_ids,target_category_ids,target_ip_ids,issuance_mode,recipient_reason:coupon_recipient_state)';

/** 내 위시 행(최근 찜 먼저). 못 읽으면 null. */
export async function loadMyWishlistEntries(userId: string): Promise<WishlistEntry[] | null> {
  if (!getSupabaseConfig().isConfigured) return [];
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('wishlists')
      .select('good_id,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) return null;
    return ((data ?? []) as { good_id: string; created_at: string }[]).map((row) => ({ goodId: row.good_id, createdAt: row.created_at }));
  } catch {
    return null;
  }
}

/** 내 보유 쿠폰(사용·만료 포함, 화면이 상태를 파생). 못 읽거나 응답이 깨지면 null. */
export async function loadMyHeldCoupons(userId: string): Promise<UserCouponSummary[] | null> {
  if (!getSupabaseConfig().isConfigured) return [];
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('user_coupons')
      .select(HELD_COUPON_SELECT)
      .eq('user_id', userId)
      .order('issued_at', { ascending: false });
    if (error) return null;
    return parseUserCouponRows(data ?? []);
  } catch {
    return null;
  }
}
