import { sanitizeShoppingStoryContent } from '@/lib/shopping-stories-content';
import { ProductCard } from '@/components/wc/ProductCard';
import type { PublicShoppingStorySection } from '@/lib/shopping-stories';

/** The editor preview and storefront render the exact same sanitized document. */
export function ShoppingStoryContent({ title, bodyHtml, imagePaths, sections }: { title: string; bodyHtml: string; imagePaths?: string[]; sections: PublicShoppingStorySection[] }) {
  const content = sanitizeShoppingStoryContent(bodyHtml, { imagePaths, renderImages: true });
  return <article className="wc-shopping-story">
    <header className="wc-shopping-story__header"><p>SHOPPING STORY</p><h1>{title || '스토리 제목'}</h1></header>
    <div className="wc-shopping-story__body" dangerouslySetInnerHTML={{ __html: content.html }} />
    {sections.map(section => section.goods.length ? <section key={section.id} className="wc-shopping-story__section" aria-label={section.title}>
      <h2>{section.title}</h2><div className="wc-shopping-story__goods" data-shape={section.imageShape}>
        {section.goods.map(good => <ProductCard key={good.id} href={`/shop/${encodeURIComponent(good.id)}`} name={good.name} price={good.price} priceMax={good.priceMax}
          listSurface="story" listingAppearance={good.listingAppearance} imageShape={section.imageShape}
          compareAtPrice={good.compareAtPrice} showDiscountRate={good.showDiscountRate} imageBackground={good.imageBackground} badges={good.badge ? [good.badge] : undefined} salePeriod={good.salePeriod} soldOut={good.soldOut} />)}
      </div></section> : null)}
  </article>;
}
