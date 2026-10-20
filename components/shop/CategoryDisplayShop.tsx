'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shop, shopQueryString } from '@/components/screens/Shop';
import { CATEGORY_DISPLAY_API_PATH, categoryDisplayRecord, isCategoryDisplayGoodId, type CategoryDisplayPage, type CategoryDisplayPageBatch } from '@/lib/category-display';
import { CategoryDisplayContents, CategoryDisplayNavigation } from './CategoryDisplayContents';

export function CategoryDisplayShop({ initial }: { initial: CategoryDisplayPage }) {
  const router = useRouter(), active = useRef(true), request = useRef<AbortController | null>(null);
  const [goods, setGoods] = useState(initial.result.goods), [nextOffset, setNextOffset] = useState(initial.nextOffset);
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
      setGoods(current => { const ids = new Set(current.map(good => good.id)); return [...current, ...batch.goods.filter(good => !ids.has(good.id))]; });
      setNextOffset(batch.nextOffset);
    } catch (cause) {
      if (active.current && !controller.signal.aborted) setError(cause instanceof Error && cause.message === 'stale' ? '전시 굿즈가 변경되었습니다. 목록을 새로 불러와주세요.' : '굿즈를 더 불러오지 못했습니다. 다시 시도해주세요.');
    } finally { if (active.current) setLoading(false); if (request.current === controller) request.current = null; }
  }
  return <>
    <CategoryDisplayNavigation entries={initial.navigation} currentId={initial.category.id} />
    <CategoryDisplayContents page={initial} />
    <Shop view="all" title={initial.category.name} query={initial.query} result={{ ...initial.result, goods }}
      paging={{ loading, error, hasMore: nextOffset !== null, onLoadMore: () => { if (stale) router.refresh(); else void loadMore(); }, onReload: stale ? () => router.refresh() : undefined }} />
  </>;
}
