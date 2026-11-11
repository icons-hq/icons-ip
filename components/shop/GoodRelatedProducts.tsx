'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ProductCard } from '@/components/wc/ProductCard';
import { goodDisplayBadges } from '@/lib/goods-taxonomy';
import type { PublicGoodRelations } from '@/lib/good-relations';
import type { GoodsReviewSummaries } from '@/lib/goods-review-summary';
import type { ListingWishlist } from '@/lib/listing-wishlist';
import { GoodRelationVisual } from './GoodRelationVisual';
import { listingHeartsFor } from './listing-hearts';

/* 연관 굿즈 카드에도 목록 하트와 별점을 단다(LFS 패리티 2차 L4b · CL-01·CL-02, 레퍼런스 R-04 §5.4 관련 상품 카드).
   위시 상태·별점은 상세 페이지가 한 번씩 읽어 내려 준다 — 위시 상태가 없는 자리(어드민 미리보기)는 하트가 없다. */
export function GoodRelatedProducts({ data, reviewSummaries, wishlist }: {
  data: PublicGoodRelations;
  reviewSummaries?: GoodsReviewSummaries;
  wishlist?: ListingWishlist | null;
}) {
  const router = useRouter();
  const heartFor = listingHeartsFor(wishlist);
  const nextChangeAt = [data.nextChangeAt, ...data.groups.flatMap(group => (group.allGoods ?? group.goods).flatMap(good => [good.salePeriod?.nextChangeAt, ...(good.options?.flatMap(option => [option.pricing?.nextChangeAt, option.supply?.nextChangeAt]) ?? [])]))]
    .reduce<number | null>((next, value) => {
      const time = value ? Date.parse(value) : NaN;
      return Number.isFinite(time) ? Math.min(next ?? time, time) : next;
    }, null);
  useEffect(() => {
    if (nextChangeAt === null) return;
    const refresh = () => { if (document.visibilityState !== 'hidden' && Date.now() >= nextChangeAt) router.refresh(); };
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => { timer = setTimeout(() => { if (Date.now() < nextChangeAt) schedule(); else refresh(); }, Math.min(2147483647, Math.max(100, nextChangeAt - Date.now() + 50))); };
    schedule(); window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { clearTimeout(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [nextChangeAt, router]);
  if (data.unavailable) return <p className="wc-pdp-panel__note">연관 굿즈를 불러오지 못했습니다. 잠시 후 다시 확인해주세요.</p>;
  return <>{data.groups.map(group => <section className="wc-pdp-related" aria-labelledby={`good-relation-${group.id}`} key={group.id}>
    <h2 id={`good-relation-${group.id}`}>{group.title}</h2>
    {group.visual ? <GoodRelationVisual value={group.visual} goods={group.allGoods ?? group.goods} currentGoodId={data.currentGoodId} kind={group.kind} /> : null}
    <div className="wc-pdp-related__products">{group.goods.map(good => <ProductCard key={good.id} href={`/shop/${good.id}`} name={good.name}
      action={heartFor(good)} reviewSummary={reviewSummaries?.[good.id]}
      listSurface="standard" listingAppearance={good.listingAppearance} cartGood={good}
      price={good.price} priceMax={good.priceMax} compareAtPrice={good.compareAtPrice} showDiscountRate={good.showDiscountRate}
      badges={goodDisplayBadges(good)} salePeriod={good.salePeriod} soldOut={good.stock === 'soldout'} imageBackground={good.img} />)}</div>
  </section>)}</>;
}
