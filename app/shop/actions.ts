'use server';

import { isAccountSuspended } from '@/lib/auth/onboarding';
import { getCurrentAuthState, type CurrentAuthState } from '@/lib/auth/server';
import { createClient } from '@/lib/supabase/server';

/* 굿즈 참여 액션 (#326 S4).
 *
 * 위시 토글과 재입고 알림 신청 두 가지다. 둘 다 돈·재고·발급을 만들지 않는 사용자
 * 표식이라 RPC 없이 RLS 직접 쓰기로 간다 — 본인 행만 보이고 쓸 수 있는 정책이 이미
 * 걸려 있어 RPC 를 하나 더 두면 같은 규칙이 두 곳에 생긴다(lib/inquiries.server 와 같은 규율).
 *
 * 결과는 항상 판별 가능한 코드다. 화면이 낙관적으로 그린 상태를 되돌릴지, 로그인으로
 * 보낼지를 문자열 메시지 파싱이 아니라 코드로 판단해야 하기 때문이다. */

export type ShopEngagementError =
  | 'auth_required'
  | 'account_suspended'
  | 'unavailable'
  | 'invalid_request';

export type WishlistToggleResult =
  | { ok: true; wished: boolean }
  | { ok: false; error: ShopEngagementError };

export type RestockAlertResult =
  | { ok: true; status: 'pending' }
  | { ok: false; error: ShopEngagementError };

interface GoodStockRow {
  stock: string;
  stock_qty: number;
}

function normalizeGoodId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/*
 * 게이트 순서가 곧 에러의 의미다. Supabase 미설정(= mock 모드)은 로그인해도 풀리지
 * 않으므로 auth_required 보다 먼저 걸러야 한다 — 아니면 mock 프리뷰에서 하트를 누른
 * 사용자가 로그인 화면을 오갈 뿐 아무것도 저장되지 않는다.
 * `auth.isConfigured` 가 getSupabaseConfig().isConfigured 그 값이다(lib/auth/server).
 */
function engagementGate(
  auth: CurrentAuthState,
): { user: NonNullable<CurrentAuthState['user']> } | { error: ShopEngagementError } {
  if (!auth.isConfigured) return { error: 'unavailable' };
  if (!auth.user) return { error: 'auth_required' };
  if (isAccountSuspended(auth.profile)) return { error: 'account_suspended' };
  return { user: auth.user };
}

export async function toggleWishlistAction(
  goodIdValue: unknown,
  nextWishedValue: unknown,
): Promise<WishlistToggleResult> {
  const gate = engagementGate(await getCurrentAuthState());
  if ('error' in gate) return { ok: false, error: gate.error };

  const goodId = normalizeGoodId(goodIdValue);
  if (!goodId || typeof nextWishedValue !== 'boolean') {
    return { ok: false, error: 'invalid_request' };
  }

  const supabase = await createClient();

  /* 목표 상태를 그대로 실행한다 — "현재 상태를 읽고 뒤집기"는 두 탭에서 동시에
     누르면 서로의 결과를 지운다. insert on conflict do nothing / delete 는 몇 번
     반복해도 같은 결과라 낙관적 렌더와 어긋나지 않는다. */
  if (nextWishedValue) {
    const { error } = await supabase
      .from('wishlists')
      .upsert(
        { user_id: gate.user.id, good_id: goodId },
        { onConflict: 'user_id,good_id', ignoreDuplicates: true },
      );
    if (error) return { ok: false, error: 'unavailable' };
  } else {
    const { error } = await supabase
      .from('wishlists')
      .delete()
      .eq('user_id', gate.user.id)
      .eq('good_id', goodId);
    if (error) return { ok: false, error: 'unavailable' };
  }

  return { ok: true, wished: nextWishedValue };
}

export async function requestRestockAlertAction(goodIdValue: unknown): Promise<RestockAlertResult> {
  const gate = engagementGate(await getCurrentAuthState());
  if ('error' in gate) return { ok: false, error: gate.error };

  const goodId = normalizeGoodId(goodIdValue);
  if (!goodId) return { ok: false, error: 'invalid_request' };

  const supabase = await createClient();

  /* 품절 판정은 서버가 한다. 판매 중인 굿즈에 신청이 붙으면 재입고 트리거의 전이
     조건(거짓→참)이 영영 성립하지 않아 신청자가 기다리다 끝난다. 술어는 카트·주문
     게이트와 같다 — stock='soldout' 이거나 수량 0. */
  const { data, error: loadError } = await supabase
    .from('goods')
    .select('stock,stock_qty')
    .eq('id', goodId)
    .is('archived_at', null)
    .maybeSingle<GoodStockRow>();
  if (loadError) return { ok: false, error: 'unavailable' };
  if (!data) return { ok: false, error: 'invalid_request' };
  if (data.stock !== 'soldout' && data.stock_qty > 0) {
    return { ok: false, error: 'invalid_request' };
  }

  /* 재신청은 새 행이 아니라 기존 행을 pending 으로 되돌린다(unique user×good).
     notified_at 을 함께 비워야 status 와 시각이 어긋나지 않는다 — DB CHECK 와 같은 규칙. */
  const { error } = await supabase
    .from('restock_alerts')
    .upsert(
      { user_id: gate.user.id, good_id: goodId, status: 'pending', notified_at: null },
      { onConflict: 'user_id,good_id' },
    );
  if (error) return { ok: false, error: 'unavailable' };

  return { ok: true, status: 'pending' };
}
