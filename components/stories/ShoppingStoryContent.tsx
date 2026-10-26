import { sanitizeShoppingStoryContent } from '@/lib/shopping-stories-content';
import { listingHeartsFor } from '@/components/shop/listing-hearts';
import { ProductCard } from '@/components/wc/ProductCard';
import type { ListingWishlist } from '@/lib/listing-wishlist';
import type { PublicShoppingStorySection } from '@/lib/shopping-stories';

/** The editor preview and storefront render the exact same sanitized document.
 *  상품 카드의 목록 하트(L4b · CL-01)는 공개 화면이 위시 상태(`wishlist`)를 넘길 때만 선다 — 에디터 미리보기에는 없다.
 *  별점(CL-02)은 공개 로더가 굿즈에 실어 온 값(`reviewSummary`)이 있을 때만 그린다. */
export function ShoppingStoryContent({ title, bodyHtml, imagePaths, sections, wishlist }: { title: string; bodyHtml: string; imagePaths?: string[]; sections: PublicShoppingStorySection[]; wishlist?: ListingWishlist | null }) {
  const content = sanitizeShoppingStoryContent(bodyHtml, { imagePaths, renderImages: true });
  const heartFor = listingHeartsFor(wishlist);
  return <article className="wc-shopping-story">
    <header className="wc-shopping-story__header"><p>SHOPPING STORY</p><h1>{title || '스토리 제목'}</h1></header>
    <div className="wc-shopping-story__body" dangerouslySetInnerHTML={{ __html: content.html }} />
    {sections.map(section => section.goods.length ? <section key={section.id} className="wc-shopping-story__section" aria-label={section.title}>
      <h2>{section.title}</h2><div className="wc-shopping-story__goods" data-shape={section.imageShape}>
        {section.goods.map(good => <ProductCard key={good.id} href={`/shop/${encodeURIComponent(good.id)}`} name={good.name} price={good.price} priceMax={good.priceMax}
          action={heartFor(good)} reviewSummary={good.reviewSummary}
          listSurface="story" listingAppearance={good.listingAppearance} imageShape={section.imageShape}
          compareAtPrice={good.compareAtPrice} showDiscountRate={good.showDiscountRate} imageBackground={good.imageBackground} badges={good.badge ? [good.badge] : undefined} salePeriod={good.salePeriod} soldOut={good.soldOut} />)}
      </div></section> : null)}
  </article>;
}
