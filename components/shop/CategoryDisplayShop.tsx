'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shop, shopQueryString } from '@/components/screens/Shop';
import { CATEGORY_DISPLAY_API_PATH, categoryDisplayRecord, categoryDisplayReviewSummaries, isCategoryDisplayGoodId, type CategoryDisplayPage, type CategoryDisplayPageBatch } from '@/lib/category-display';
import { CategoryDisplayContents, CategoryDisplayNavigation } from './CategoryDisplayContents';
import type { GoodsReviewSummary } from '@/lib/goods-review-summary';
import type { ListingWishlist } from '@/lib/listing-wishlist';

/* 카테고리 전시 컬렉션 — 컬렉션과 같은 목록 문법(정렬 7종·타입 '예약판매'·카드 하트·별점, LFS 패리티 2차 L5).
 * 서버가 20개씩 잘라 주므로 다음 묶음의 굿즈와 그 묶음 몫의 별점을 함께 이어 붙인다. */
export function CategoryDisplayShop({ initial, wishlist }: { initial: CategoryDisplayPage; wishlist?: ListingWishlist | null }) {
  const router = useRouter(), active = useRef(true), request = useRef<AbortController | null>(null);
  const [goods, setGoods] = useState(initial.result.goods), [nextOffset, setNextOffset] = useState(initial.nextOffset);
  const [reviewSummaries, setReviewSummaries] = useState<Record<string, GoodsReviewSummary>>(initial.result.reviewSummaries ?? {});
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [stale, setStale] = useState(false);
  useEffect(() => { active.current = true; return () => { active.current = false; request.current?.abort(); }; }, []);
  async function loadMore() {
    if (request.current || nextOffset === null || stale) return;
    const controller = new AbortController(); request.current = controller; setLoading(true); setError('');
    const params = new URLSearchParams(shopQueryString(initial.query)); params.set('offset', String(nextOffset)); params.set('token', initial.token);
    try {
      const response = await fetch(`${CATEGORY_DISPLAY_API_PATH}?${params}`, { cache: 'no-store', signal: controller.signal });
      if (!active.current) return;
      if (response.status === 409) { setStale(true); throw new Error('stale'); }
      if (!response.ok) throw new Error('request');
      const data: unknown = await response.json();
      if (!categoryDisplayRecord(data) || !Array.isArray(data.goods) || data.goods.length > 20 || data.goods.some(good => !categoryDisplayRecord(good) || !isCategoryDisplayGoodId(good.id))
        || data.token !== initial.token || data.nextOffset !== null && data.nextOffset !== nextOffset + 20) throw new Error('response');
      const batch = data as unknown as CategoryDisplayPageBatch;
      if (!active.current) return;
      const batchSummaries = categoryDisplayReviewSummaries(data.reviewSummaries, batch.goods.map(good => good.id));
      setGoods(current => { const ids = new Set(current.map(good => good.id)); return [...current, ...batch.goods.filter(good => !ids.has(good.id))]; });
      setReviewSummaries(current => ({ ...current, ...batchSummaries }));
      setNextOffset(batch.nextOffset);
    } catch (cause) {
      if (active.current && !controller.signal.aborted) setError(cause instanceof Error && cause.message === 'stale' ? '전시 굿즈가 변경되었습니다. 목록을 새로 불러와주세요.' : '굿즈를 더 불러오지 못했습니다. 다시 시도해주세요.');
    } finally { if (active.current) setLoading(false); if (request.current === controller) request.current = null; }
  }
  /* 내비는 CategoryDisplayContents·Shop 과 달리 자기 .wc-root 가 없다 — 토큰 스코프를 여기서 준다(l4-qa-2, app/shop/page.tsx 와 같은 규칙). */
  return <>
    {initial.navigation.length ? <div className="wc-root">
      <CategoryDisplayNavigation entries={initial.navigation} currentId={initial.category.id} />
    </div> : null}
    <CategoryDisplayContents page={initial} />
    <Shop view="all" title={initial.category.name} query={initial.query} result={{ ...initial.result, goods, reviewSummaries }} wishlist={wishlist}
      paging={{ loading, error, hasMore: nextOffset !== null, onLoadMore: () => { if (stale) router.refresh(); else void loadMore(); }, onReload: stale ? () => router.refresh() : undefined }} />
  </>;
}
