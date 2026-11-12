import 'server-only';
import { createClient } from './supabase/server';
import { giftClaimContextView, parseGiftClaimContext, type GiftClaimContext, type GiftClaimContextData } from './gift-claims';
import { getShippingCarrierRegistry } from './orders/shipment.server';
/**
 * 선물 상세의 교환·반품 문맥을 읽는다. 읽기 한 번이 실패해도(QA2: 모바일 첫 진입 1회 gift_claim_context_unavailable, 재현 안 됨 —
 * 인증 세션 갱신이나 회수 접수 크론의 쓰기와 겹친 순간으로 추정) 한 번 더 읽고, 그래도 안 되면 원인 코드를 남기고 실패한다.
 * 모양이 계약과 다른 응답(parse 실패)은 일시 경합이 아니므로 다시 읽지 않는다.
 */
export async function loadGiftClaimContext(giftId: string, actorId: string) {
  let lastError: string | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 150));
    const client = await createClient(), { data, error } = await client.rpc('get_my_gift_claim_context', { p_gift_id: giftId, p_expected_actor_id: actorId });
    if (error) { lastError = error.code ?? error.message; continue; }
    const context = parseGiftClaimContext(data);
    if (!context || context.giftId !== giftId) { console.error('gift_claim_context_unavailable: invalid shape'); throw new Error('gift_claim_context_unavailable'); }
    return withGiftClaimParcelViews(context);
  }
  console.error(`gift_claim_context_unavailable: rpc error ${lastError}`);
  throw new Error('gift_claim_context_unavailable');
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
