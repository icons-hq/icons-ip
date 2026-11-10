import { REVIEW_KIND_LABELS } from '@/lib/review-types';
import { ReviewEventDisclosureNote } from '@/components/reviews/ReviewEventBanner';
import { formatReviewDate, goodReviewsHref, reviewRatingLabel } from '@/lib/reviews';
import type { PublicSelectedReviewCard } from '@/lib/review-best';
import { ProductDetailReviewLink } from './ProductDetailReviewLink';

export function GalleryBestReviews({ goodId, cards }: { goodId: string; cards: PublicSelectedReviewCard[] }) {
  if (cards.length !== 3) return null;
  return <section className="wc-gallery-best-reviews" aria-labelledby="gallery-best-reviews-heading">
    <header><h2 id="gallery-best-reviews-heading">BEST 리뷰</h2><span>운영자가 선정한 구매 리뷰</span></header>
    <ul>{cards.map(card => <li key={card.id}>
      <ProductDetailReviewLink href={goodReviewsHref(goodId)}>
        {card.imageUrls[0] ? (
          // Signed customer photos keep the existing public review Storage policy.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.imageUrls[0]} alt="" loading="lazy" />
        ) : null}
        <div className="wc-gallery-best-reviews__content"><div className="wc-gallery-best-reviews__meta"><span>{REVIEW_KIND_LABELS[card.kind ?? 'ordinary']}</span>{card.repeatPurchase ? <span>재구매</span> : null}<span aria-label={reviewRatingLabel(card.rating)}>★ {card.rating}</span><span className="wc-gallery-best-reviews__author">{card.authorName}</span><time dateTime={card.createdAt}>{formatReviewDate(card.createdAt)}</time></div><p>{card.body}</p><ReviewEventDisclosureNote value={card.eventDisclosure} /></div>
      </ProductDetailReviewLink>
    </li>)}</ul>
    <div className="wc-gallery-best-reviews__all"><ProductDetailReviewLink href={goodReviewsHref(goodId)}>리뷰 모두 보기</ProductDetailReviewLink></div>
  </section>;
}
