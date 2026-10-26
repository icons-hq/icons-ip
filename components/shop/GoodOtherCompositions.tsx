import { ProductCard } from '@/components/wc/ProductCard';
import { goodDisplayBadges } from '@/lib/goods-taxonomy';
import type { PublicGoodOtherCompositions } from '@/lib/good-other-compositions';
import type { GoodsReviewSummaries } from '@/lib/goods-review-summary';
import type { ListingWishlist } from '@/lib/listing-wishlist';
import { listingHeartsFor } from './listing-hearts';

/* 다른 구성 카드에도 목록 하트와 별점을 단다(LFS 패리티 2차 L4b · CL-01·CL-02). 값은 상세 페이지가 한 번씩 읽어 내려 준다. */
export function GoodOtherCompositions({ data, reviewSummaries, wishlist }: {
  data: PublicGoodOtherCompositions;
  reviewSummaries?: GoodsReviewSummaries;
  wishlist?: ListingWishlist | null;
}) {
  const heartFor = listingHeartsFor(wishlist);
  if (data.unavailable) return <p className="wc-pdp-panel__note">다른 구성 굿즈를 불러오지 못했습니다. 잠시 후 다시 확인해주세요.</p>;
  return <>{data.groups.map(group => <section className="wc-pdp-other-compositions" aria-labelledby={`good-other-composition-${group.id}`} key={group.id}>
    <h2 id={`good-other-composition-${group.id}`}>{group.title}</h2>
    <ul className="wc-pdp-other-compositions__products" aria-label={`${group.title} 목록`} tabIndex={0}>
      {group.goods.map(({ good, compositionLabel }) => <li key={good.id}>
        <ProductCard href={`/shop/${good.id}`} name={good.name}
          action={heartFor(good)} reviewSummary={reviewSummaries?.[good.id]}
          listSurface="standard" listingAppearance={good.listingAppearance} cartGood={good}
          price={good.price} priceMax={good.priceMax} compareAtPrice={good.compareAtPrice} showDiscountRate={good.showDiscountRate}
          badges={goodDisplayBadges(good)} salePeriod={good.salePeriod} soldOut={good.stock === 'soldout'} imageBackground={good.img} />
        {compositionLabel ? <p className="wc-pdp-other-compositions__label">{compositionLabel}</p> : null}
      </li>)}
    </ul>
  </section>)}</>;
}
