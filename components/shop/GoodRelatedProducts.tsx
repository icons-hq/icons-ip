'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ProductCard } from '@/components/wc/ProductCard';
import { goodDisplayBadges } from '@/lib/goods-taxonomy';
import type { PublicGoodRelations } from '@/lib/good-relations';
import { GoodRelationVisual } from './GoodRelationVisual';

export function GoodRelatedProducts({ data }: { data: PublicGoodRelations }) {
  const router = useRouter();
  const nextChangeAt = [data.nextChangeAt, ...data.groups.flatMap(group => (group.allGoods ?? group.goods).flatMap(good => [good.salePeriod?.nextChangeAt, ...(good.options?.flatMap(option => [option.pricing?.nextChangeAt, option.supply?.nextChangeAt]) ?? [])]))]
    .reduce<number | null>((next, value) => {
      const time = value ? Date.parse(value) : NaN;
      return Number.isFinite(time) ? Math.min(next ?? time, time) : next;
    }, null);
  useEffect(() => {
    if (nextChangeAt === null) return;
    const refresh = () => { if (document.visibilityState !== 'hidden' && Date.now() >= nextChangeAt) router.refresh(); };
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => { timer = setTimeout(() => { if (Date.now() < nextChangeAt) schedule(); else refresh(); }, Math.min(2147483647, Math.max(100, nextChangeAt - Date.now() + 50))); };
    schedule(); window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { clearTimeout(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [nextChangeAt, router]);
  if (data.unavailable) return <p className="wc-pdp-panel__note">연관 굿즈를 불러오지 못했습니다. 잠시 후 다시 확인해주세요.</p>;
  return <>{data.groups.map(group => <section className="wc-pdp-related" aria-labelledby={`good-relation-${group.id}`} key={group.id}>
    <h2 id={`good-relation-${group.id}`}>{group.title}</h2>
    {group.visual ? <GoodRelationVisual value={group.visual} goods={group.allGoods ?? group.goods} currentGoodId={data.currentGoodId} kind={group.kind} /> : null}
    <div className="wc-pdp-related__products">{group.goods.map(good => <ProductCard key={good.id} href={`/shop/${good.id}`} name={good.name}
      listSurface="standard" listingAppearance={good.listingAppearance} cartGood={good}
      price={good.price} priceMax={good.priceMax} compareAtPrice={good.compareAtPrice} showDiscountRate={good.showDiscountRate}
      badges={goodDisplayBadges(good)} salePeriod={good.salePeriod} soldOut={good.stock === 'soldout'} imageBackground={good.img} />)}</div>
  </section>)}</>;
}
