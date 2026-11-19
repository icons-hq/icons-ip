import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import {
  CHECKOUT_ACKNOWLEDGEMENT_VERSION,
  EMPTY_CHECKOUT_CLAIM_RESTRICTIONS,
  parseCheckoutClaimRestrictions,
  type CheckoutClaimRestrictions,
} from '@/lib/checkout-acknowledgement';

/**
 * 청약철회·교환이 제한된 게시 굿즈 전부. 제한 굿즈는 소수라 주문서 품목과 무관하게 한 번에 읽고, 화면이 품목과 맞춘다.
 * 값은 상품 상세 '교환·반품 안내'에 이미 공개된 굿즈 조건이다. 못 읽으면 빈 값이다 — 고지를 못 보일 뿐 주문을 막지는 않고,
 * 동의 기록의 제한 굿즈 스냅샷은 DB가 주문 품목에서 다시 읽는다.
 */
export async function loadCheckoutClaimRestrictions(): Promise<CheckoutClaimRestrictions> {
  try {
    const { data, error } = await createServiceClient()
      .from('goods')
      .select('id,claim_return_allowed,claim_exchange_allowed,claim_restriction_reason')
      .not('published_at', 'is', null)
      .is('archived_at', null)
      .or('claim_return_allowed.eq.false,claim_exchange_allowed.eq.false');
    if (error) {
      console.error('[checkout/acknowledgement] restriction read failed', { code: error.code ?? null });
      return EMPTY_CHECKOUT_CLAIM_RESTRICTIONS;
    }
    return parseCheckoutClaimRestrictions(data);
  } catch (error) {
    console.error('[checkout/acknowledgement] restriction read failed', error instanceof Error ? error.message : String(error));
    return EMPTY_CHECKOUT_CLAIM_RESTRICTIONS;
  }
}

async function recordOnce(userId: string, orderId: string): Promise<boolean> {
  const { error } = await createServiceClient().rpc('record_order_purchase_acknowledgement', {
    p_user_id: userId,
    p_order_id: orderId,
    p_notice_version: CHECKOUT_ACKNOWLEDGEMENT_VERSION,
  });
  return !error;
}

/**
 * 주문 생성 직후 결제 전 확인 동의를 기록한다(멱등 — 같은 주문의 재호출은 첫 기록을 그대로 둔다).
 * 주문은 이미 만들어졌으므로 기록 실패가 고객의 결제 흐름을 끊지 않는다: 한 번 다시 시도하고, 그래도 실패하면
 * 오류 로그만 남긴다(동의는 이미 서버 액션에서 true로 확인했다). 기록이 없는 주문은 운영자 주문 상세에서 '기록 없음'으로 보인다.
 */
export async function recordOrderPurchaseAcknowledgement(userId: string, orderId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (await recordOnce(userId, orderId)) return true;
    } catch { /* 아래에서 재시도하거나 로그를 남긴다. */ }
  }
  console.error('[checkout/acknowledgement] record failed', { orderId });
  return false;
}
