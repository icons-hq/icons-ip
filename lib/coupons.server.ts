import 'server-only';

import {
  isLoyaltyGrade,
  type LoyaltyGrade,
} from '@/lib/loyalty';
import { loyaltyProgressNote, parseLoyaltyPolicy } from '@/lib/loyalty-policy';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { parseUserCouponRows, type UserCouponSummary } from './coupons';

/* 쿠폰함·카트 쿠폰 상태 로더 (S7).
 *
 * 읽기는 RLS select 로 한다 — user_coupons 는 본인 행, coupons 는 보유한
 * 정의만 보이는 정책이 걸려 있다(발급·적용·사용은 전부 RPC).
 *
 * 절대 던지지 않는다. 쿠폰 상태는 카트·마이페이지의 장식이고, 못 읽었다고
 * 카트가 500 이 되면 구매 경로가 깨진다. 조회 실패/깨진 금액 응답은 unavailable로 구별한다. */

export interface CartCouponState {
  /** 카트에 적용해 둔 보유 쿠폰 id. 없으면 null. */
  selectedUserCouponId: string | null;
  coupons: UserCouponSummary[];
  unavailable?: boolean;
}

const emptyCartCouponState: CartCouponState = { selectedUserCouponId: null, coupons: [] };

type CouponSupabaseClient = Awaited<ReturnType<typeof createClient>>;

async function currentUserId(supabase: CouponSupabaseClient): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user.id;
}

/** 마이 쿠폰함 목록 — 보유·사용·만료를 한 번에 내리고 화면이 상태를 파생한다. */
export async function loadMyCoupons(): Promise<UserCouponSummary[] | null> {
  if (!getSupabaseConfig().isConfigured) return [];

  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return [];

  const { data, error } = await supabase
    .from('user_coupons')
    .select('id,status,issued_at,expires_at,usable_from,used_at,coupons(code,name,discount_type,discount_value,max_discount_amount,min_subtotal,starts_at,ends_at,issue_starts_at,status,grade_benefit,benefit_kind,stackable,recipient_segment,goods_scope,target_good_ids,target_category_ids,target_ip_ids,issuance_mode,recipient_reason:coupon_recipient_state)')
    .eq('user_id', userId)
    .order('issued_at', { ascending: false });

  if (error) return null;
  return parseUserCouponRows(data ?? []);
}

/** 카트 쿠폰 슬롯 상태 — 보유 쿠폰 목록과 현재 적용된 선택. */
export async function loadCartCouponState(): Promise<CartCouponState> {
  if (!getSupabaseConfig().isConfigured) return emptyCartCouponState;

  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return emptyCartCouponState;

  const [couponsResult, selectionResult] = await Promise.all([
    supabase
      .from('user_coupons')
      .select('id,status,issued_at,expires_at,usable_from,used_at,coupons(code,name,discount_type,discount_value,max_discount_amount,min_subtotal,starts_at,ends_at,issue_starts_at,status,grade_benefit,benefit_kind,stackable,recipient_segment,goods_scope,target_good_ids,target_category_ids,target_ip_ids,issuance_mode,recipient_reason:coupon_recipient_state)')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('issued_at', { ascending: false }),
    supabase
      .from('cart_coupon_selections')
      .select('user_coupon_id')
      .eq('user_id', userId)
      .maybeSingle<{ user_coupon_id: string }>(),
  ]);

  const coupons = couponsResult.error ? null : parseUserCouponRows(couponsResult.data ?? []);
  if (!coupons) return { ...emptyCartCouponState, unavailable: true };

  return {
    selectedUserCouponId: selectionResult.error
      ? null
      : selectionResult.data?.user_coupon_id ?? null,
    coupons,
  };
}

export interface LoyaltyStatus {
  grade: LoyaltyGrade;
  /** 산정 창 안의 결제 확정 실적 합(표시용 파생 — 진실원은 재산정 RPC). */
  windowSpend: number;
  windowItemCount: number;
  nextNote: string | null;
}

/** 프로필 스트립 등급 뱃지와 "다음 등급까지" 안내용 상태. */
export async function loadLoyaltyStatus(): Promise<LoyaltyStatus | null> {
  if (!getSupabaseConfig().isConfigured) return null;

  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return null;

  const { data, error } = await supabase.rpc('get_my_loyalty_status');
  if (error || !data || !isLoyaltyGrade(data.grade)) return null;
  const policy = parseLoyaltyPolicy(data.policy);
  if (!policy || !Number.isSafeInteger(data.windowSpend) || data.windowSpend < 0
    || !Number.isSafeInteger(data.windowItemCount) || data.windowItemCount < 0) return null;
  return {
    grade: data.grade,
    windowSpend: data.windowSpend,
    windowItemCount: data.windowItemCount,
    nextNote: loyaltyProgressNote(data.grade, data.windowSpend, data.windowItemCount, policy.tiers),
  };
}
