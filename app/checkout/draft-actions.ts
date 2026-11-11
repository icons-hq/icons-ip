'use server';

import { isAccountSuspended, isOnboarded } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { normalizeCartItems } from '@/lib/cart';
import { normalizeOrderReference } from '@/lib/checkout';
import { checkoutDraftHref, normalizeCheckoutDraftId } from '@/lib/checkout-draft';
import { cartLineIdentityPayload } from '@/lib/checkout-selection';
import { directCheckoutLinePayload, parseDirectCheckoutEntries } from '@/lib/checkout-buy-now';
import { createServiceClient } from '@/lib/supabase/service';

/*
 * 주문서 초안 만들기(ADR-0030). 초안은 서버만 읽고 쓰는 표(private.checkout_drafts)라 서비스 롤 RPC로 만들고,
 * 소유자는 로그인 세션에서 정한다 — 화면이 보낸 사용자 id는 받지 않는다.
 */

export type CheckoutDraftActionError =
  | 'auth_required'
  | 'onboarding_required'
  | 'account_suspended'
  | 'invalid_request'
  | 'cart_changed'
  /** 바로구매: 19금 본품은 유효한 성인 인증이 있어야 한다(ADR-0024). */
  | 'adult_verification_required'
  /** 바로구매: 추가 구성 굿즈의 판매·연결 상태가 바뀌었다. */
  | 'additional_good_unavailable'
  /** 바로구매: 본품·옵션을 지금 살 수 없다(판매 중지·옵션 정리 등). */
  | 'goods_unavailable'
  /** 바로구매: 직접입력형 옵션 설정이 바뀌었다. */
  | 'custom_inputs_changed'
  | 'unavailable';

export type CheckoutDraftActionResult = { ok: true; draftId: string; href: string } | { ok: false; error: CheckoutDraftActionError };

/** DB 선택 초안이 받는 줄 수 상한(장바구니 스냅샷 계약과 같다). */
const MAX_SELECTION_LINES = 19239;

async function draftOwner(): Promise<{ userId: string } | { error: CheckoutDraftActionError }> {
  const auth = await getCurrentAuthState();
  if (!auth.isConfigured || !auth.user) return { error: 'auth_required' };
  if (isAccountSuspended(auth.profile)) return { error: 'account_suspended' };
  if (!isOnboarded(auth.profile, auth.user.email)) return { error: 'onboarding_required' };
  return { userId: auth.user.id };
}

function draftResult(data: unknown): CheckoutDraftActionResult {
  const draftId = normalizeCheckoutDraftId(data);
  return draftId ? { ok: true, draftId, href: checkoutDraftHref(draftId) } : { ok: false, error: 'unavailable' };
}

function draftError(message: string): CheckoutDraftActionError {
  if (message.includes('cart_snapshot_changed')) return 'cart_changed';
  if (message.includes('account_suspended')) return 'account_suspended';
  if (message.includes('adult_verification_required')) return 'adult_verification_required';
  if (message.includes('additional_good_unavailable')) return 'additional_good_unavailable';
  if (message.includes('catalog_item_unavailable')) return 'goods_unavailable';
  if (/goods_custom_inputs/.test(message)) return 'custom_inputs_changed';
  if (message.includes('invalid_checkout_selection') || message.includes('invalid_checkout_direct')) return 'invalid_request';
  return 'unavailable';
}

/**
 * 장바구니에서 체크한 줄로 주문서 초안을 만든다(1014-031). 줄은 화면이 본 장바구니 줄(굿즈·옵션·수량·직접입력값)과
 * 정확히 같아야 한다 — 다른 탭에서 바뀌었으면 `cart_changed`로 알리고 장바구니를 다시 읽게 한다.
 */
export async function createCartSelectionDraftAction(linesValue: unknown): Promise<CheckoutDraftActionResult> {
  const lines = normalizeCartItems(linesValue);
  if (!Array.isArray(linesValue) || !lines.length || lines.length !== linesValue.length || lines.length > MAX_SELECTION_LINES) {
    return { ok: false, error: 'invalid_request' };
  }
  const owner = await draftOwner();
  if ('error' in owner) return { ok: false, error: owner.error };
  try {
    const { data, error } = await createServiceClient().rpc('service_create_checkout_selection_draft', {
      p_user_id: owner.userId,
      p_lines: lines.map((line) => ({ ...cartLineIdentityPayload(line), qty: line.qty })),
    });
    return error ? { ok: false, error: draftError(error.message) } : draftResult(data);
  } catch {
    return { ok: false, error: 'unavailable' };
  }
}

export type CheckoutRetryActionResult = { ok: true; href: string } | { ok: false; error: CheckoutDraftActionError };

/**
 * 결제 없이 끝난 장바구니 주문의 '다시 결제하기'(ADR-0026·0030). 그 주문의 줄 가운데 아직 장바구니에 있는 줄로
 * 선택 초안을 만들어 주문서로 보낸다 — 고르지 않았던 줄이 끼어들지 않는다. 남은 줄이 없으면 장바구니로 보낸다.
 */
export async function createCartRetryDraftAction(orderIdValue: unknown): Promise<CheckoutRetryActionResult> {
  const orderId = normalizeOrderReference(orderIdValue);
  if (!orderId) return { ok: false, error: 'invalid_request' };
  const owner = await draftOwner();
  if ('error' in owner) return { ok: false, error: owner.error };
  try {
    const { data, error } = await createServiceClient().rpc('service_create_checkout_retry_draft', {
      p_user_id: owner.userId,
      p_order_id: orderId,
    });
    if (error) return { ok: false, error: draftError(error.message) };
    if (data === null) return { ok: true, href: '/cart' };
    const draft = draftResult(data);
    return draft.ok ? { ok: true, href: draft.href } : draft;
  } catch {
    return { ok: false, error: 'unavailable' };
  }
}

/**
 * 상품 상세·위시의 [구매하기](1014-033·037·039). 고른 옵션·수량·추가 구성·직접입력값만 바로구매 초안으로 만든다 —
 * 장바구니를 읽지도 바꾸지도 않는다. 추가 구성·19금 본품·옵션 소속은 DB가 담기와 같은 규칙으로 다시 판정한다.
 */
export async function createDirectCheckoutDraftAction(baseGoodIdValue: unknown, entriesValue: unknown): Promise<CheckoutDraftActionResult> {
  const baseGoodId = typeof baseGoodIdValue === 'string' ? baseGoodIdValue.trim() : '';
  const entries = baseGoodId && baseGoodId.length <= 200 ? parseDirectCheckoutEntries(baseGoodId, entriesValue) : null;
  if (!entries) return { ok: false, error: 'invalid_request' };
  const owner = await draftOwner();
  if ('error' in owner) return { ok: false, error: owner.error };
  try {
    const { data, error } = await createServiceClient().rpc('service_create_checkout_direct_draft', {
      p_user_id: owner.userId,
      p_base_good_id: baseGoodId,
      p_lines: entries.map(directCheckoutLinePayload),
    });
    return error ? { ok: false, error: draftError(error.message) } : draftResult(data);
  } catch {
    return { ok: false, error: 'unavailable' };
  }
}
