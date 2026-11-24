import Link from 'next/link';
import type { HomeMosaicBand } from '@/lib/home-mosaic';
import { homeCardUnavailableLabel, type HomeGoodsCard } from '@/lib/home-catalog';

/* 판매기간·예약 상태 문구가 품절보다 앞선다(홈의 다른 카드와 같은 판정). */
function tileStatus(good: HomeGoodsCard) {
  return homeCardUnavailableLabel(good) ?? (good.soldOut ? '품절' : null);
}

export function ProductMosaic({ band }: { band: HomeMosaicBand }) {
  if (!band.tiles.some(Boolean)) return null;
  return <section className="wc-product-mosaic wc-container" aria-labelledby={`mosaic-${band.id}`}>
    <h2 id={`mosaic-${band.id}`}>{band.title}</h2>
    <div className="wc-product-mosaic__surface">
      {band.heading || band.subtitle ? <header>{band.heading ? <h3>{band.heading}</h3> : null}{band.subtitle ? <p>{band.subtitle}</p> : null}</header> : null}
      <div className="wc-product-mosaic__scroll" tabIndex={0} role="region" aria-label={`${band.title} 상품 이미지, 가로로 스크롤`}>
        <ol className="wc-product-mosaic__grid">{band.tiles.map((tile, index) => <li key={index} data-slot={index + 1} data-empty={!tile}>
          {tile ? <Link href={tile.good.href} aria-label={`${tile.good.name}${tileStatus(tile.good) ? ` · ${tileStatus(tile.good)}` : ''}`}>
            {/* Validated uploaded art is served from the catalog media store. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={tile.imageUrl} alt={tile.good.name} loading="lazy" />
            <span className="wc-product-mosaic__caption">{tile.good.name}{tileStatus(tile.good) ? <strong>{tileStatus(tile.good)}</strong> : null}</span>
          </Link> : <span aria-hidden="true" />}
        </li>)}</ol>
      </div>
    </div>
  </section>;
}
