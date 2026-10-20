import { ProductCard } from '@/components/wc/ProductCard';
import { goodDisplayBadges } from '@/lib/goods-taxonomy';
import type { PublicGoodOtherCompositions } from '@/lib/good-other-compositions';

export function GoodOtherCompositions({ data }: { data: PublicGoodOtherCompositions }) {
  if (data.unavailable) return <p className="wc-pdp-panel__note">다른 구성 굿즈를 불러오지 못했습니다. 잠시 후 다시 확인해주세요.</p>;
  return <>{data.groups.map(group => <section className="wc-pdp-other-compositions" aria-labelledby={`good-other-composition-${group.id}`} key={group.id}>
    <h2 id={`good-other-composition-${group.id}`}>{group.title}</h2>
    <ul className="wc-pdp-other-compositions__products" aria-label={`${group.title} 목록`} tabIndex={0}>
      {group.goods.map(({ good, compositionLabel }) => <li key={good.id}>
        <ProductCard href={`/shop/${good.id}`} name={good.name}
          listSurface="standard" listingAppearance={good.listingAppearance} cartGood={good}
          price={good.price} priceMax={good.priceMax} compareAtPrice={good.compareAtPrice} showDiscountRate={good.showDiscountRate}
          badges={goodDisplayBadges(good)} salePeriod={good.salePeriod} soldOut={good.stock === 'soldout'} imageBackground={good.img} />
        {compositionLabel ? <p className="wc-pdp-other-compositions__label">{compositionLabel}</p> : null}
      </li>)}
    </ul>
  </section>)}</>;
}
