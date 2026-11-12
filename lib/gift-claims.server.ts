import 'server-only';
import { createClient } from './supabase/server';
import { giftClaimContextView, parseGiftClaimContext, type GiftClaimContext, type GiftClaimContextData } from './gift-claims';
import { getShippingCarrierRegistry } from './orders/shipment.server';
export async function loadGiftClaimContext(giftId: string, actorId: string) {
  const client = await createClient(), { data, error } = await client.rpc('get_my_gift_claim_context', { p_gift_id: giftId, p_expected_actor_id: actorId });
  const context = !error ? parseGiftClaimContext(data) : null;
  if (!context || context.giftId !== giftId) throw new Error('gift_claim_context_unavailable');
  return withGiftClaimParcelViews(context);
}
/**
 * 받는 분의 교환 소포에 택배사 표시 이름·배송조회 링크를 붙인다. 소포가 없으면 택배사 목록을 읽지 않는다.
 * 표시만의 일이라 목록을 읽지 못해도 처리 결과를 실패로 바꾸지 않는다(택배사 코드·링크 없이 보인다).
 */
export async function withGiftClaimParcelViews(context: GiftClaimContextData): Promise<GiftClaimContext> {
  if (!context.reshipmentParcels?.length) return giftClaimContextView(context, []);
  const carriers = await getShippingCarrierRegistry().catch(() => []);
  return giftClaimContextView(context, carriers);
}
