import type { HomeProductCollectionBand } from '@/lib/home-product-collection';
import { ProductCard } from '@/components/wc/ProductCard';
import { SectionHeading } from '@/components/wc/SectionHeading';
import { imageUrlFromBg } from '@/lib/media';

export function ProductCollection({ band }: { band: HomeProductCollectionBand }) {
  if (band.goods.length === 0) return null;
  const headingId = `home-products-${band.id}-heading`;
  return <section className="wc-home__band wc-product-collection" aria-labelledby={headingId}
    data-layout={band.layout} data-image-shape={band.imageShape}>
    <div className="wc-container">
      <SectionHeading id={headingId} title={band.title} />
      <ol className="wc-product-collection__grid">
        {band.goods.map(good => {
          const imageUrl = imageUrlFromBg(good.imageBg);
          return <li key={good.id}>
          <ProductCard name={good.name} brand={good.brand} href={good.href}
            image={imageUrl ? (
              // The collection explicitly crops the public primary image; ordinary product cards retain contain.
              // eslint-disable-next-line @next/next/no-img-element
              <img className="wc-product-collection__image" src={imageUrl} alt="" loading="lazy" />
            ) : <div className="wc-product-collection__image" style={{ background: good.imageBg }} />}
            badges={good.badge ? [good.badge] : undefined} price={good.price} priceMax={good.priceMax}
            soldOut={good.soldOut} salePeriod={good.salePeriod} />
        </li>;
        })}
      </ol>
    </div>
  </section>;
}
