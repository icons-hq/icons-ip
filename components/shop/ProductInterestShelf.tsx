'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadInterestAvailabilityAction, loadInterestCollectionAction } from '@/app/shop/experience-actions';
import { useCart } from '@/components/shell/CartProvider';
import { createClient } from '@/lib/supabase/client';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { emptyInterestCollection, readRecentGoods, recentGoodsKey, normalizeExperienceGoodsIds, type InterestCollection, type InterestKind } from '@/lib/product-detail-experiences';
import { ProductCard } from '@/components/wc/ProductCard';
import { goodDisplayBadges } from '@/lib/goods-taxonomy';
import { GoodsSalePeriodRefresh } from './GoodsSalePeriodRefresh';

const labels: Record<InterestKind, string> = { repurchase: '재구매한 굿즈', cart: '장바구니', wishlist: '찜한 굿즈', recent: '최근 본 굿즈' };
const kinds: InterestKind[] = ['repurchase', 'cart', 'wishlist', 'recent'];
export function ProductInterestShelf({ currentGoodId, standalone = false }: { currentGoodId?: string; standalone?: boolean }) {
  const cart = useCart();
  const [owner, setOwner] = useState<string | null | undefined>(undefined), [collection, setCollection] = useState<InterestCollection>(() => emptyInterestCollection());
  const [selected, setSelected] = useState<InterestKind>('recent'), [refresh, setRefresh] = useState(0);
  const generation = useRef(0), recorded = useRef(''), ownerRef = useRef<string | null | undefined>(undefined);
  const refreshSalePeriods = useCallback(() => setRefresh(value => value + 1), []);
  useEffect(() => {
    if (!getSupabaseConfig().isConfigured) return;
    let active = true, observed = false; const client = createClient();
    const identity = (id: string | null) => { if (active && ownerRef.current !== id) { ownerRef.current = id; generation.current += 1; setCollection(emptyInterestCollection(id)); setOwner(id); } };
    const { data } = client.auth.onAuthStateChange((_event, session) => { observed = true; identity(session?.user.id ?? null); });
    void client.auth.getUser().then(({ data }) => { if (!observed) identity(data.user?.id ?? null); }, () => { if (!observed) identity(null); });
    return () => { active = false; generation.current += 1; data.subscription.unsubscribe(); };
  }, []);
  const cartIds = cart.ready && cart.mode === 'local' ? normalizeExperienceGoodsIds(cart.items.map(item => item.goodId)).join(',') : '';
  useEffect(() => {
    if (owner === undefined) return;
    const version = ++generation.current, storageKey = recentGoodsKey(owner), visitKey = `${recentGoodsKey(owner)}:${currentGoodId ?? ''}`;
    const shouldRecord = Boolean(currentGoodId && recorded.current !== visitKey);
    let recent: string[] = [];
    try {
      recent = readRecentGoods(window.localStorage.getItem(storageKey));
      if (currentGoodId && shouldRecord) recent = normalizeExperienceGoodsIds([currentGoodId, ...recent.filter(id => id !== currentGoodId)]);
    } catch { /* Privacy mode can block local persistence without blocking browsing. */ }
    void loadInterestCollectionAction(recent.filter(id => id !== currentGoodId), owner ? [] : cartIds.split(',').filter(Boolean)).then(result => {
      if (generation.current === version && result.ownerId === owner) {
        // The server checks the current display switch before any new local record is kept.
        if (result.enabled && shouldRecord) { recorded.current = visitKey; try { window.localStorage.setItem(storageKey, JSON.stringify({ version: 1, ids: recent })); } catch { /* Storage may be blocked. */ } }
        setCollection(result);
      }
    }, () => { if (generation.current === version) setCollection({ ...emptyInterestCollection(owner), unavailable: true }); });
    return () => { generation.current += 1; };
  }, [owner, currentGoodId, cartIds, refresh]);
  const groups = kinds.map(kind => ({ kind, goods: collection.groups[kind].filter(good => good.id !== currentGoodId) }));
  const available = groups.filter(group => group.goods.length), active = available.find(group => group.kind === selected) ?? available[0];
  if (!standalone && (!collection.enabled || !active)) return null;
  return <section className="wc-product-interests" aria-labelledby="product-interests-heading">
    <GoodsSalePeriodRefresh goods={groups.flatMap(group => group.goods)} onRefresh={refreshSalePeriods} />
    <header><h2 id="product-interests-heading">관심 굿즈 모아보기</h2>{!standalone ? <Link href="/interests">모두 보기</Link> : null}</header>
    {collection.unavailable ? <p role="alert">관심 굿즈를 불러오지 못했습니다. 새로고침 후 다시 확인해주세요.</p> : !active ? <p>아직 모아볼 굿즈가 없습니다. 굿즈를 둘러보거나 찜해보세요.</p> : <>
      <div className="wc-product-interests__tabs" role="group" aria-label="관심 굿즈 종류">{available.map(group => <button key={group.kind} type="button" aria-pressed={group.kind === active.kind} aria-controls="product-interests-panel" onClick={() => setSelected(group.kind)}>{labels[group.kind]} ({group.goods.length})</button>)}</div>
      <div id="product-interests-panel" role="region" aria-label={labels[active.kind]} className="wc-product-interests__products">{active.goods.map(good => <ProductCard key={good.id} href={`/shop/${good.id}`} name={good.name} imageBackground={good.img} price={good.price} priceMax={good.priceMax} compareAtPrice={good.compareAtPrice} showDiscountRate={good.showDiscountRate} badges={goodDisplayBadges(good)} salePeriod={good.salePeriod} soldOut={good.stock === 'soldout'} listSurface="standard" listingAppearance={good.listingAppearance} cartGood={good} />)}</div>
    </>}
    <footer><small>최근 본 굿즈는 현재 계정별로 이 브라우저에만 최대 30개 저장합니다.</small><button type="button" onClick={() => { if (owner === undefined) return; try { window.localStorage.removeItem(recentGoodsKey(owner)); } catch { /* Local persistence may be blocked. */ } setCollection(current => ({ ...current, groups: { ...current.groups, recent: [] } })); setRefresh(value => value + 1); }}>최근 본 굿즈 지우기</button></footer>
  </section>;
}

/** Mount in the open menu so the current store switch also gates its entry point. */
export function ProductInterestMenuLink({ onNavigate, className }: { onNavigate?: () => void; className?: string } = {}) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => { let active = true; void loadInterestAvailabilityAction().then(value => { if (active) setEnabled(value); }, () => {}); return () => { active = false; }; }, []);
  return enabled ? <Link href="/interests" onClick={onNavigate} className={className}>관심 굿즈 모아보기</Link> : null;
}
