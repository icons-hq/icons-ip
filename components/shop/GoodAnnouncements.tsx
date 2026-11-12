'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { GoodAnnouncementsData, GoodsAnnouncementPlacement } from '@/lib/admin/goods-announcements';
import { GoodsDescription } from './GoodsDescription';

/*
 * 굿즈 상세의 상품공지사항. 같은 조회 결과를 위치마다 한 번씩 그린다 — 상단(기본)은 하부 탭 위
 * '굿즈 공지사항', 하단은 상세정보 탭의 상세설명 바로 아래 '굿즈 안내'(1027T-005).
 * 전시 경계 새로고침과 조회 실패 안내는 상단 한 곳만 맡는다(같은 경계로 두 번 새로고침하지 않는다).
 */
export function GoodAnnouncements({ data, placement = 'top' }: { data: GoodAnnouncementsData; placement?: GoodsAnnouncementPlacement }) {
  const router = useRouter();
  const ownsRefresh = placement === 'top';
  useEffect(() => {
    if (!ownsRefresh || !data.nextChangeAt) return;
    const boundary = Date.parse(data.nextChangeAt); if (!Number.isFinite(boundary)) return;
    const refresh = () => router.refresh();
    const timer = window.setTimeout(refresh, Math.min(2147483647, Math.max(0, boundary - Date.now()) + 50));
    const onVisible = () => { if (document.visibilityState === 'visible' && Date.now() >= boundary) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [ownsRefresh, data.nextChangeAt, router]);
  if (data.unavailable) return ownsRefresh ? <p className="wc-pdp-panel__note">굿즈 공지를 불러오지 못했습니다. 잠시 후 다시 확인해주세요.</p> : null;
  const items = data.items.filter(item => item.placement === placement);
  if (!items.length) return null;
  const heading = placement === 'bottom' ? '굿즈 안내' : '굿즈 공지사항';
  return <section className="wc-pdp-announcements" aria-label={heading} data-placement={placement} data-pc={items.some(item => item.device !== 'mobile')} data-mobile={items.some(item => item.device !== 'pc')}>
    <h2>{heading}</h2>
    {items.map(item => <article className="wc-pdp-announcement" data-device={item.device} data-important={item.important} key={item.id}>
      <h3>{item.important ? <span>중요</span> : null}{item.title}</h3><GoodsDescription description={item.body} format={item.format} />
    </article>)}
  </section>;
}
