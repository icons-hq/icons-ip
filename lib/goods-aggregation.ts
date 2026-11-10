import type { Good } from './data';
import type { GoodsTransactionOffer } from './goods-transaction-offers';

export function applyGoodsAggregationPolicy(good: Good, offer: GoodsTransactionOffer | null): void {
  good.transactionOffer = offer;
  const policy = offer?.sharedPolicy;
  if (!policy) return;
  good.originId = policy.originId;
  good.orderQuantityLimitEnabled = policy.orderQuantityLimitEnabled;
  good.minOrderQty = policy.minOrderQty;
  good.maxOrderQty = policy.maxOrderQty;
  good.memberPurchaseLimitEnabled = policy.memberPurchaseLimitEnabled;
  good.memberLifetimeQtyLimit = policy.memberLifetimeQtyLimit;
}

export function goodsAggregationUnavailableLabel(good: Pick<Good, 'transactionOffer'>): string | null {
  return good.transactionOffer?.aggregation?.runtimeEnabled === false ? '구매 준비 중' : null;
}
