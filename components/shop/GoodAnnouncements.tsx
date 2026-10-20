'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { GoodAnnouncementsData } from '@/lib/admin/goods-announcements';
import { GoodsDescription } from './GoodsDescription';

export function GoodAnnouncements({ data }: { data: GoodAnnouncementsData }) {
  const router = useRouter();
  useEffect(() => {
    if (!data.nextChangeAt) return;
    const boundary = Date.parse(data.nextChangeAt); if (!Number.isFinite(boundary)) return;
    const refresh = () => router.refresh();
    const timer = window.setTimeout(refresh, Math.min(2147483647, Math.max(0, boundary - Date.now()) + 50));
    const onVisible = () => { if (document.visibilityState === 'visible' && Date.now() >= boundary) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [data.nextChangeAt, router]);
  if (data.unavailable) return <p className="wc-pdp-panel__note">굿즈 공지를 불러오지 못했습니다. 잠시 후 다시 확인해주세요.</p>;
  if (!data.items.length) return null;
  return <section className="wc-pdp-announcements" aria-label="굿즈 공지사항" data-pc={data.items.some(item => item.device !== 'mobile')} data-mobile={data.items.some(item => item.device !== 'pc')}>
    <h2>굿즈 공지사항</h2>
    {data.items.map(item => <article className="wc-pdp-announcement" data-device={item.device} data-important={item.important} key={item.id}>
      <h3>{item.important ? <span>중요</span> : null}{item.title}</h3><GoodsDescription description={item.body} format={item.format} />
    </article>)}
  </section>;
}
