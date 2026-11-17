import type { HomeGoodsCard } from '@/lib/home-catalog';
import type { HomeProductCollectionBand } from '@/lib/home-product-collection';
import { ListingWishHeart } from '@/components/shop/ListingWishHeart';
import { homeCardChips } from '@/components/home/home-card-chips';
import { useStorePresentation } from '@/components/shell/StorePresentationProvider';
import { ProductCard } from '@/components/wc/ProductCard';
import { ProductGrid } from '@/components/wc/ProductGrid';
import { SectionHeader } from '@/components/wc/SectionHeader';
import { SectionHeading } from '@/components/wc/SectionHeading';
import { listingWishSet, type ListingWishlist } from '@/lib/listing-wishlist';
import { imageUrlFromBg } from '@/lib/media';

/* 홈 자유상품 진열. 카드마다 목록 하트를 단다(11 CL-01) — 위시 상태를 받지 않은 미리보기에는 없다.
   칩은 홈의 다른 카드와 같다(homeCardChips) — 스토어 표시 설정이 태그를 끄면 운영 배지 칩이 빠진다. */
export function ProductCollection({ band, wishlist }: { band: HomeProductCollectionBand; wishlist?: ListingWishlist | null }) {
  const { listing } = useStorePresentation();
  if (band.goods.length === 0) return null;
  const wished = listingWishSet(wishlist);
  const headingId = `home-products-${band.id}-heading`;
  const heartFor = (good: HomeGoodsCard) => wishlist
    ? <ListingWishHeart goodId={good.id} initialWished={wished.has(good.id)} label={good.name} viewerId={wishlist.viewerId} /> : undefined;

  /* 그리드형(X SQUARE 'IP 상품 섹션'): NEW ARRIVAL 과 같은 5열 카드 그리드에 섹션 제목 + 전체보기 알약이다. 이미지는 정사각 고정(카드 기본 모양)이고
     잘라 내지 않는다. '전체보기'는 고른 상품이 모두 한 IP일 때만 그 IP관으로 이어진다(band.moreHref) — 링크는 어드민이 고르지 않는다. */
  if (band.layout === 'grid') {
    return <section className="wc-home__band wc-home__collection-grid" aria-labelledby={headingId}
      data-layout="grid" data-image-shape="square">
      <div className="wc-container wc-container--wide">
        <SectionHeader id={headingId} moreHref={band.moreHref ?? null} title={band.title} />
        <ProductGrid density="home">
          {band.goods.map(good => <li key={good.id}>
            <ProductCard name={good.name} brand={good.brand} href={good.href} action={heartFor(good)}
              chips={homeCardChips(good, listing.showTags)} imageBackground={good.imageBg}
              price={good.price} priceMax={good.priceMax} reviewSummary={good.reviewSummary}
              soldOut={good.soldOut} salePeriod={good.salePeriod} />
          </li>)}
        </ProductGrid>
      </div>
    </section>;
  }

  return <section className="wc-home__band wc-product-collection" aria-labelledby={headingId}
    data-layout={band.layout} data-image-shape={band.imageShape}>
    <div className="wc-container wc-container--wide">
      <SectionHeading id={headingId} title={band.title} />
      <ol className="wc-product-collection__grid">
        {band.goods.map(good => {
          const imageUrl = imageUrlFromBg(good.imageBg);
          return <li key={good.id}>
          <ProductCard name={good.name} brand={good.brand} href={good.href}
            action={heartFor(good)}
            image={imageUrl ? (
              // The collection explicitly crops the public primary image; ordinary product cards retain contain.
              // eslint-disable-next-line @next/next/no-img-element
              <img className="wc-product-collection__image" src={imageUrl} alt="" loading="lazy" />
            ) : <div className="wc-product-collection__image" style={{ background: good.imageBg }} />}
            chips={homeCardChips(good, listing.showTags)} price={good.price} priceMax={good.priceMax} reviewSummary={good.reviewSummary}
            soldOut={good.soldOut} salePeriod={good.salePeriod} />
        </li>;
        })}
      </ol>
    </div>
  </section>;
}
