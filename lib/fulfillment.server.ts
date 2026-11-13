import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { parseGoodShippingPolicy, parseGoodShippingRegionFees, parseShippingQuote, type ShippingQuoteItem } from './fulfillment';

export async function loadGoodsShippingQuote(items: ShippingQuoteItem[]) {
  const client = await createClient();
  const { data, error } = await client.rpc('quote_goods_shipping', { items });
  if (error) return null;
  return parseShippingQuote(data);
}
/**
 * 상세 배송 안내의 공개 배송 정책. 지역별 추가 배송비 요약(`get_good_shipping_region_fees`)을 함께 읽어 싣는다 —
 * 요약을 읽지 못하거나 형식이 어긋나면 금액 없이 정책만 돌려준다(화면은 지금 문장을 둔다).
 */
export async function loadGoodShippingPolicy(goodId: string) {
  if (!getSupabaseConfig().isConfigured) return null;
  const client = await createClient();
  const [policyResult, regionResult, pickupResult] = await Promise.all([
    client.rpc('get_good_shipping_policy', { target_good_id: goodId }),
    Promise.resolve(client.rpc('get_good_shipping_region_fees', { target_good_id: goodId })).catch(() => ({ data: null, error: true })),
    /* 반품 자동 회수 접수(QNA-032) 스위치·출고지 회수 계약. 읽지 못하면 꺼진 것으로 본다(지금 반송 안내). */
    Promise.resolve(client.rpc('get_good_return_pickup', { target_good_id: goodId })).catch(() => ({ data: null, error: true })),
  ]);
  const policy = policyResult.error ? null : parseGoodShippingPolicy(policyResult.data);
  if (!policy) return null;
  const regionFees = regionResult.error ? null : parseGoodShippingRegionFees(regionResult.data);
  const returnPickup = !pickupResult.error && pickupResult.data === true;
  return { ...policy, ...(regionFees ? { regionFees } : {}), ...(returnPickup ? { returnPickup: true as const } : {}) };
}
