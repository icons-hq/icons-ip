import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import { createClient } from '@/lib/supabase/server';
import {
  CHECKOUT_ACKNOWLEDGEMENT_VERSION,
  claimNoticeRecord,
  type CheckoutClaimNotice,
  EMPTY_CHECKOUT_CLAIM_RESTRICTIONS,
  parseCheckoutClaimRestrictions,
  type CheckoutClaimRestrictions,
} from '@/lib/checkout-acknowledgement';

const RESTRICTED_FILTER = 'claim_return_allowed.eq.false,claim_exchange_allowed.eq.false';
const RESTRICTION_COLUMNS = 'id,claim_return_allowed,claim_exchange_allowed,claim_restriction_reason';

/**
 * 이 주문서 품목 중 청약철회·교환이 제한된 굿즈. 고객 화면 prop으로 내려가므로 품목 id로만 한정하고, 읽기는 사용자 세션 client다 —
 * 공개 RLS(goods_public_read)를 통과한 굿즈만 보여서 성인 인증 없는 회원에게 19금·미공개 굿즈의 id·사유가 새지 않는다.
 * 못 읽으면 null(확인 불가)이다 — 화면은 일반 고지를 보이고 서버가 주문 직전에 같은 판정을 다시 한다.
 */
export async function loadCheckoutClaimRestrictions(goodIds: readonly string[]): Promise<CheckoutClaimRestrictions | null> {
  const ids = [...new Set(goodIds)];
  if (ids.length === 0) return EMPTY_CHECKOUT_CLAIM_RESTRICTIONS;
  try {
    const { data, error } = await (await createClient()).from('goods').select(RESTRICTION_COLUMNS).in('id', ids).or(RESTRICTED_FILTER);
    if (error) {
      console.error('[checkout/acknowledgement] restriction read failed', { code: error.code ?? null });
      return null;
    }
    /* 방어: 요청한 품목 밖의 행은 응답이 와도 prop에 싣지 않는다. */
    const wanted = new Set(ids);
    return Object.fromEntries(Object.entries(parseCheckoutClaimRestrictions(data)).filter(([id]) => wanted.has(id)));
  } catch (error) {
    console.error('[checkout/acknowledgement] restriction read failed', error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** 서버 장바구니의 굿즈 id(주문서가 장바구니 전체일 때 제한 굿즈 조회 범위). 못 읽으면 null. */
export async function loadUserCartGoodIds(userId: string): Promise<string[] | null> {
  try {
    const { data, error } = await createServiceClient().from('cart_items').select('good_id').eq('user_id', userId);
    if (error) return null;
    return [...new Set((data ?? []).flatMap((row) => (typeof row.good_id === 'string' ? [row.good_id] : [])))];
  } catch {
    return null;
  }
}

export type ClaimNoticeVerdict = 'ok' | 'changed' | 'unavailable';

/**
 * 주문을 만들기 전에 이 주문의 굿즈 기준으로 제한을 다시 읽어, 화면이 보인 고지에 없던 제한 굿즈가 있으면 'changed'다(fail-closed).
 * 화면 읽기가 실패해 일반 고지만 보였으면('unavailable') 보인 목록이 비어 있는 것과 같다. 서버 판정은 service client지만 결과는 판정만 돌려준다.
 * 서버가 못 읽으면 'unavailable' — 확인하지 못한 채 주문하지 않는다.
 */
export async function verifyClaimNotice(goodIds: readonly string[], notice: CheckoutClaimNotice): Promise<ClaimNoticeVerdict> {
  const ids = [...new Set(goodIds)];
  if (ids.length === 0) return 'ok';
  try {
    const { data, error } = await createServiceClient().from('goods').select(RESTRICTION_COLUMNS).in('id', ids).or(RESTRICTED_FILTER);
    if (error) return 'unavailable';
    const shown = new Set(notice === 'unavailable' ? [] : notice);
    return Object.keys(parseCheckoutClaimRestrictions(data)).every((id) => shown.has(id)) ? 'ok' : 'changed';
  } catch {
    return 'unavailable';
  }
}

async function recordOnce(userId: string, orderId: string, notice: CheckoutClaimNotice | null): Promise<boolean> {
  const { error } = await createServiceClient().rpc('record_order_purchase_acknowledgement', {
    p_user_id: userId,
    p_order_id: orderId,
    p_notice_version: CHECKOUT_ACKNOWLEDGEMENT_VERSION,
    p_screen_notice: claimNoticeRecord(notice),
  });
  return !error;
}

/**
 * 주문 생성 직후 결제 전 확인 동의를 기록한다(멱등 — 같은 주문의 재호출은 첫 기록을 그대로 둔다).
 * 주문은 이미 만들어졌으므로 기록 실패가 고객의 결제 흐름을 끊지 않는다: 한 번 다시 시도하고, 그래도 실패하면
 * 오류 로그만 남긴다(동의는 이미 서버 액션에서 true로 확인했다). 기록이 없는 주문은 운영자 주문 상세에서 '기록 없음'으로 보인다.
 */
export async function recordOrderPurchaseAcknowledgement(userId: string, orderId: string, notice: CheckoutClaimNotice | null = null): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (await recordOnce(userId, orderId, notice)) return true;
    } catch { /* 아래에서 재시도하거나 로그를 남긴다. */ }
  }
  console.error('[checkout/acknowledgement] record failed', { orderId });
  return false;
}
