import type { HomeProductCollectionBand } from '@/lib/home-product-collection';
import { ListingWishHeart } from '@/components/shop/ListingWishHeart';
import { ProductCard } from '@/components/wc/ProductCard';
import { SectionHeading } from '@/components/wc/SectionHeading';
import { listingWishSet, type ListingWishlist } from '@/lib/listing-wishlist';
import { imageUrlFromBg } from '@/lib/media';

/* 홈 자유상품 진열. 카드마다 목록 하트를 단다(11 CL-01) — 위시 상태를 받지 않은 미리보기에는 없다. */
export function ProductCollection({ band, wishlist }: { band: HomeProductCollectionBand; wishlist?: ListingWishlist | null }) {
  if (band.goods.length === 0) return null;
  const wished = listingWishSet(wishlist);
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
            action={wishlist ? <ListingWishHeart goodId={good.id} initialWished={wished.has(good.id)} label={good.name} signedIn={wishlist.signedIn} /> : undefined}
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
