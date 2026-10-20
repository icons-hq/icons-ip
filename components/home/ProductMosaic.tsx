import Link from 'next/link';
import type { HomeMosaicBand } from '@/lib/home-mosaic';
import { goodsSaleUnavailableLabel } from '@/lib/goods-sale-period';

export function ProductMosaic({ band }: { band: HomeMosaicBand }) {
  if (!band.tiles.some(Boolean)) return null;
  return <section className="wc-product-mosaic wc-container" aria-labelledby={`mosaic-${band.id}`}>
    <h2 id={`mosaic-${band.id}`}>{band.title}</h2>
    <div className="wc-product-mosaic__surface">
      {band.heading || band.subtitle ? <header>{band.heading ? <h3>{band.heading}</h3> : null}{band.subtitle ? <p>{band.subtitle}</p> : null}</header> : null}
      <div className="wc-product-mosaic__scroll" tabIndex={0} role="region" aria-label={`${band.title} 상품 이미지, 가로로 스크롤`}>
        <ol className="wc-product-mosaic__grid">{band.tiles.map((tile, index) => <li key={index} data-slot={index + 1} data-empty={!tile}>
          {tile ? <Link href={tile.good.href} aria-label={`${tile.good.name}${goodsSaleUnavailableLabel(tile.good.salePeriod) ? ` · ${goodsSaleUnavailableLabel(tile.good.salePeriod)}` : tile.good.soldOut ? ' · 품절' : ''}`}>
            {/* Validated uploaded art is served from the catalog media store. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={tile.imageUrl} alt={tile.good.name} loading="lazy" />
            <span className="wc-product-mosaic__caption">{tile.good.name}{goodsSaleUnavailableLabel(tile.good.salePeriod) || tile.good.soldOut ? <strong>{goodsSaleUnavailableLabel(tile.good.salePeriod) ?? '품절'}</strong> : null}</span>
          </Link> : <span aria-hidden="true" />}
        </li>)}</ol>
      </div>
    </div>
  </section>;
}
