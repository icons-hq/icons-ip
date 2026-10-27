'use client';
import { useEffect, useState } from 'react';
import type { GoodOption } from '@/lib/data';
import { loadShippingSavingsAction } from '@/app/shop/experience-actions';
import type { ShippingSavings } from '@/lib/product-detail-experiences';
import { ProductCard } from '@/components/wc/ProductCard';
import { goodDisplayBadges } from '@/lib/goods-taxonomy';
import { krw } from '@/lib/format';
import type { ListingWishlist } from '@/lib/listing-wishlist';
import { listingHeartsFor } from './listing-hearts';
import { ProductDetailRefresh } from './ProductDetailRefresh';
import { useListingReviewSummaries } from './useListingReviewSummaries';

export function ProductShippingSavings({ goodId, option, quantity, wishlist }: { goodId: string; option?: GoodOption; quantity: number; wishlist?: ListingWishlist | null }) {
  const selectionKey = `${goodId}:${option?.id ?? ''}:${quantity}`;
  const [snapshot, setSnapshot] = useState<{ key: string; value: ShippingSavings } | null>(null);
  useEffect(() => {
    if (!option?.id || quantity < 1 || quantity > 1000) return;
    let active = true;
    const timer = setTimeout(() => {
      void loadShippingSavingsAction(goodId, option.id, quantity).then(value => { if (active) setSnapshot({ key: selectionKey, value }); }, () => { if (active) setSnapshot({ key: selectionKey, value: { items: [], nextChangeAt: null, unavailable: true } }); });
    }, 180);
    return () => { active = false; clearTimeout(timer); };
  }, [goodId, option?.id, quantity, selectionKey]);
  const result = snapshot?.key === selectionKey ? snapshot.value : null;
  /* 후보 카드의 목록 하트·별점(LFS 패리티 2차 L4b · CL-01·CL-02). 후보는 서버 액션으로 오므로 별점은 받은 뒤 한 번에 묻는다. */
  const reviewSummaries = useListingReviewSummaries(result?.items.flatMap(item => item.good ? [item.good.id] : []) ?? []);
  const heartFor = listingHeartsFor(wishlist);
  return <section className="wc-pdp-shipping-savings" id="pdp-shipping-savings" aria-labelledby="pdp-shipping-savings-title">
    <h2 id="pdp-shipping-savings-title">배송비를 아끼는 굿즈</h2>
    <p>선택한 굿즈 옵션{option?.name ? ` (${option.name})` : ''} {quantity}개의 선결제·착불을 합친 기본배송비 비교입니다. 현재 장바구니·추가구성·지역 추가배송비·쿠폰은 제외하며 최종 배송비와 결제방법은 주문서에서 확인해주세요.</p>
    {!option || quantity > 1000 ? <p>구매 영역에서 옵션과 수량을 선택해주세요. 한 번에1,000개까지 비교할 수 있습니다.</p>
      : !result ? <p role="status">묶음 배송비를 비교하고 있어요.</p>
      : result.unavailable ? <p role="alert">배송비를 불러오지 못했습니다. 옵션을 다시 선택하거나 새로고침해주세요.</p>
      : result.selectionUnavailable ? <p>선택한 수량으로 구매할 수 있는지 먼저 확인해주세요.</p>
      : !result.items.length ? <p>현재 선택에서는 배송비를 줄일 수 있는 묶음 굿즈가 없습니다.</p>
      : <><ProductDetailRefresh nextChangeAt={result.nextChangeAt} /><div className="wc-pdp-shipping-savings__products">{result.items.map(item => {
        const good = item.good; if (!good) return null; const candidateOption = good.options?.find(value => value.id === item.variantId);
        return <article key={item.goodId}><ProductCard href={`/shop/${good.id}`} name={good.name} imageBackground={good.img} price={candidateOption?.price ?? good.price}
          action={heartFor(good)} reviewSummary={reviewSummaries[good.id]}
          listSurface="standard" listingAppearance={good.listingAppearance} badges={goodDisplayBadges(good)} salePeriod={good.salePeriod} soldOut={good.stock === 'soldout'} />
          <p>{item.variantName || '기본 옵션'} {item.qty}개와 함께</p><strong>배송비 {krw(item.savings)} 절약</strong>
          <p>따로 주문 {krw(item.separateFee)} → 함께 주문 {item.combinedFee === 0 ? '무료' : krw(item.combinedFee)}</p></article>;
      })}</div></>}
  </section>;
}
