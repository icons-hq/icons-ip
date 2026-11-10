import type { Good, GoodOption } from './data';
import { krw } from './format';
import type { GoodsTransactionOffer } from './goods-transaction-offers';
import { calculateGoodsVolumeDiscount, type GoodsVolumeDiscountResult } from './goods-volume-discount';
import { calculateGoodsQuantityDelivery, type GoodsDeliveryQuantityTerms } from './goods-delivery-pricing';

export function goodsVolumeConditionLabel(offer: GoodsTransactionOffer): string | null {
  const terms = offer.volume?.status === 'active' ? offer.volume.terms : null;
  if (!terms) return null;
  const condition = terms.condition === 'quantity' ? `${terms.threshold.toLocaleString('ko-KR')}개 이상` : `옵션 정상가 합계 ${krw(terms.threshold)} 이상`;
  const discount = terms.discountKind === 'fixed' ? krw(terms.discountValue) : `${terms.discountValue}%`;
  return `${offer.aggregation ? '같은 굿즈에서 나뉜 항목 합산' : '같은 굿즈'} ${condition} 구매 시 개당 ${discount} 할인`;
}
export function goodsQuantityDeliveryLabel(terms: GoodsDeliveryQuantityTerms): string {
  if (terms.kind === 'repeat') return `${terms.interval.toLocaleString('ko-KR')}개마다 ${krw(terms.baseFee)}`;
  if (terms.kind === 'tier2') return `${terms.firstLimit.toLocaleString('ko-KR')}개까지 ${krw(terms.baseFee)}, 초과 시 ${krw(terms.baseFee + terms.extra1)}`;
  return `${terms.firstLimit.toLocaleString('ko-KR')}개까지 ${krw(terms.baseFee)}, ${terms.secondLimit.toLocaleString('ko-KR')}개까지 ${krw(terms.baseFee + terms.extra1)}, 초과 시 ${krw(terms.baseFee + terms.extra2)}`;
}
export function goodsDeliveryPaymentLabel(offer: GoodsTransactionOffer): string | null {
  if (offer.delivery?.status !== 'active') return null;
  return offer.delivery.paymentMode === 'collect' ? '배송비는 배송 시 결제(착불)' : offer.delivery.paymentMode === 'buyer_choice' ? '주문서에서 배송비 선결제 또는 착불 선택' : '배송비는 주문 시 선결제';
}
export function goodsVolumeBoundary(good: Pick<Good, 'transactionOffer' | 'transactionCalculatedAt'>): string | null {
  const terms = good.transactionOffer?.volume?.terms;
  if (!terms || !good.transactionCalculatedAt) return null;
  return [terms.startsAt, terms.endsAt].filter((value): value is string => !!value && Date.parse(value) > Date.parse(good.transactionCalculatedAt!)).sort()[0] ?? null;
}
export interface GoodsPurchasePreviewLine { good: Good; option?: GoodOption; quantity: number }
/** Selection-only preview: cart contents, coupons, credits and destination fees
 * are resolved by the authoritative checkout quote. Never used to charge. */
export function goodsPurchaseVolumePreview(rows: readonly GoodsPurchasePreviewLine[]): GoodsVolumeDiscountResult | null {
  if (!rows.length || rows.some(row => row.good.transactionOffer === null)) return null;
  const at = rows.map(row => row.good.transactionCalculatedAt ?? row.option?.pricing?.calculatedAt).find(Boolean);
  if (!at) return null;
  try {
    const key = (good: Good) => good.transactionOffer?.aggregation ? `aggregation:${good.transactionOffer.aggregation.id}` : good.id;
    const policies = new Map<string, NonNullable<GoodsTransactionOffer['volume']>>();
    for (const row of rows) {
      const volume = row.good.transactionOffer?.volume;
      if (!volume) continue;
      const policy = { ...volume, goodId: key(row.good) };
      const previous = policies.get(policy.goodId);
      if (previous && JSON.stringify(previous) !== JSON.stringify(policy)) return null;
      policies.set(policy.goodId, policy);
    }
    const result = calculateGoodsVolumeDiscount(rows.map((row, index) => ({ lineId: `${index}`, goodId: key(row.good), qty: row.quantity,
      regularUnitPrice: row.option?.pricing?.regularPrice ?? row.option?.price ?? row.good.price,
      unitPrice: row.option?.price ?? row.good.price })), [...policies.values()], at);
    return { ...result, lines: result.lines.map((line, index) => ({ ...line, goodId: rows[index].good.id })) };
  } catch { return null; }
}
export function goodsQuantityDeliveryPreview(offer: GoodsTransactionOffer, quantity: number): number | null {
  const terms = offer.delivery?.status === 'active' ? offer.delivery.quantityTerms : null;
  if (!terms) return null;
  try { return calculateGoodsQuantityDelivery(quantity, terms); } catch { return null; }
}
