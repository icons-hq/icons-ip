import { ProductCard } from '@/components/wc/ProductCard';
import { goodDisplayBadges } from '@/lib/goods-taxonomy';
import { goodReviewsHref, reviewRatingLabel } from '@/lib/reviews';
import type { PublicDetailPresentation, DetailRecommendationKey } from '@/lib/product-detail-presentation';
import type { PublicGoodRelations } from '@/lib/good-relations';
import { ProductDetailReviewLink } from './ProductDetailReviewLink';
import { ReviewEventDisclosureNote } from '@/components/reviews/ReviewEventBanner';

export function ProductDetailBanner({ data }: { data: PublicDetailPresentation | null }) {
  const banner = data?.banner;
  return banner ? <aside className="wc-pdp-promotion" aria-label="굿즈 혜택 안내" data-style={banner.style}><strong>{banner.title}</strong><span>{banner.text}</span></aside> : null;
}
export function ProductDetailReviewSummary({ goodId, data }: { goodId: string; data: PublicDetailPresentation | null }) {
  const reviews = data?.reviews;
  if (!reviews?.count || !reviews.cards.length) return null;
  return <section className="wc-pdp-review-summary" aria-labelledby="pdp-review-highlight-heading">
    <header><h2 id="pdp-review-highlight-heading">4점 이상 리뷰가 <strong>{Math.round(reviews.positiveCount / reviews.count * 100)}%</strong>예요</h2><ProductDetailReviewLink href={goodReviewsHref(goodId)}>리뷰 {reviews.count.toLocaleString('ko-KR')}건 모두 보기</ProductDetailReviewLink></header>
    <p className="wc-pdp-review-summary__basis">공개된 구매 리뷰 전체 기준 · 사진 리뷰 우선</p>
    <ul className="wc-pdp-review-summary__cards">{reviews.cards.map(card => <li key={card.id}>
      <ProductDetailReviewLink href={goodReviewsHref(goodId, undefined, { sort: 'rating_desc', photoOnly: card.imageUrls.length > 0 })}>
        {card.imageUrls[0] ? (
          // Signed review media follows the existing public-review storage policy.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.imageUrls[0]} alt="" loading="lazy" />
        ) : null}
        <div><span className="wc-pdp-review-summary__rating" aria-label={reviewRatingLabel(card.rating)}>★ {card.rating}</span><span className="wc-pdp-review-summary__author">{card.authorName}</span><p>{card.body}</p><ReviewEventDisclosureNote value={card.eventDisclosure} /></div>
      </ProductDetailReviewLink>
    </li>)}</ul>
  </section>;
}
const recommendationCopy: Record<DetailRecommendationKey, { title: string; basis: string }> = {
  similar: { title: '비슷한 굿즈도 살펴보세요', basis: '같은 카테고리와 IP의 굿즈를 모았어요.' },
  together: { title: '함께 구매한 굿즈', basis: '최근 30일 실제 함께 구매한 주문을 기준으로 추천해요.' },
  categoryPopular: { title: '이 카테고리의 인기 굿즈', basis: '최근 30일 판매수량과 현재 찜 수를 반영했어요.' },
  storePopular: { title: '스토어 인기 굿즈', basis: '최근 30일 판매수량과 현재 찜 수를 반영했어요.' },
};
export function ProductDetailRecommendations({ data, manual }: { data: PublicDetailPresentation | null; manual?: PublicGoodRelations }) {
  if (!data || data.unavailable) return null;
  if (data.recommendationsUnavailable) return <p className="wc-pdp-panel__note">추천 굿즈를 불러오지 못했습니다. 잠시 후 다시 확인해주세요.</p>;
  const kinds = ['similar', 'together', 'categoryPopular', 'storePopular'] as const;
  return <>{kinds.map(kind => {
    if ((kind === 'similar' || kind === 'together') && (manual?.unavailable || manual?.groups.some(group => group.kind === kind))) return null;
    const goods = data.recommendations[kind], copy = recommendationCopy[kind];
    if (!goods.length || (kind === 'similar' || kind === 'together') && goods.length < 5) return null;
    return <section key={kind} className="wc-pdp-auto" aria-labelledby={`pdp-auto-${kind}`}>
      <h2 id={`pdp-auto-${kind}`}>{copy.title}</h2><p>{copy.basis}</p>
      <div className="wc-pdp-auto__products">{goods.map(good => <ProductCard key={good.id} href={`/shop/${good.id}`} name={good.name}
        listSurface="standard" listingAppearance={good.listingAppearance} cartGood={good} price={good.price} priceMax={good.priceMax}
        compareAtPrice={good.compareAtPrice} showDiscountRate={good.showDiscountRate} badges={goodDisplayBadges(good)} salePeriod={good.salePeriod} soldOut={good.stock === 'soldout'} imageBackground={good.img} />)}</div>
    </section>;
  })}</>;
}
export function detailPresentationNextChange(data: PublicDetailPresentation | null): string | null {
  const times = [data?.nextChangeAt, ...Object.values(data?.recommendations ?? {}).flatMap(goods => goods.flatMap(good => [good.salePeriod?.nextChangeAt, ...(good.options?.flatMap(option => [option.pricing?.nextChangeAt, option.supply?.nextChangeAt]) ?? [])]))]
    .filter((value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)));
  return times.length ? new Date(Math.min(...times.map(value => Date.parse(value)))).toISOString() : null;
}
