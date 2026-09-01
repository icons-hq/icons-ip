'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentAuthState } from '@/lib/auth/server';
import { mapCouponActionError } from '@/lib/coupons';
import { createClient } from '@/lib/supabase/server';

/* 카트 쿠폰 적용·해제 액션 (S7).
 *
 * 신규 파일이다 — app/cart/actions.ts 의 기존 계약은 DESIGN.md §11 동결이라
 * 손대지 않는다. 검증·발급·선택 저장은 전부 RPC(security definer) 안에서
 * 일어나고, 이 액션은 인증 게이트와 에러 번역만 맡는다. */

const AUTH_MESSAGE = '로그인하면 쿠폰을 쓸 수 있어요.';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CouponActionResult {
  ok: boolean;
  message?: string;
}

async function requireCouponUser(): Promise<CouponActionResult | null> {
  const auth = await getCurrentAuthState();
  if (!auth.isConfigured || !auth.user) {
    return { ok: false, message: AUTH_MESSAGE };
  }
  return null;
}

/** 코드 직접 입력 — 미보유 코드는 발급까지, 보유 코드는 적용만 이뤄진다. */
export async function applyCouponCodeAction(code: unknown): Promise<CouponActionResult> {
  const gate = await requireCouponUser();
  if (gate) return gate;

  const normalized = typeof code === 'string' ? code.trim() : '';
  if (!normalized) {
    return { ok: false, message: '쿠폰 코드를 입력해주세요.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('apply_cart_coupon_code', { p_code: normalized });
  if (error) {
    return { ok: false, message: mapCouponActionError(error.message) };
  }

  revalidatePath('/cart');
  return { ok: true };
}

/** 보유 쿠폰 select 적용. */
export async function applyCouponAction(userCouponId: unknown): Promise<CouponActionResult> {
  const gate = await requireCouponUser();
  if (gate) return gate;

  const normalized = typeof userCouponId === 'string' ? userCouponId.trim() : '';
  if (!UUID_PATTERN.test(normalized)) {
    return { ok: false, message: '적용할 쿠폰을 선택해주세요.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('apply_cart_coupon', { p_user_coupon_id: normalized });
  if (error) {
    return { ok: false, message: mapCouponActionError(error.message) };
  }

  revalidatePath('/cart');
  return { ok: true };
}

/** 적용 해제. */
export async function clearCouponAction(): Promise<CouponActionResult> {
  const gate = await requireCouponUser();
  if (gate) return gate;

  const supabase = await createClient();
  const { error } = await supabase.rpc('clear_cart_coupon');
  if (error) {
    return { ok: false, message: mapCouponActionError(error.message) };
  }

  revalidatePath('/cart');
  return { ok: true };
}
