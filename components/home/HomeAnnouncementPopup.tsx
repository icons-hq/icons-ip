'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { HOME_POPUP_DISMISS_STORAGE, nextKstMidnight, popupDismissedUntil, type HomeAnnouncementPopupData, type HomeAnnouncementPopupItem } from '@/lib/goods-announcement-popup';
import { GoodsDescription } from '@/components/shop/GoodsDescription';
import { ScheduledHomeRefresh } from './ScheduledHomeRefresh';

function Popup({ item }: { item: HomeAnnouncementPopupItem }) {
  const ref = useRef<HTMLDialogElement>(null); const titleId = useId(); const router = useRouter();
  const [closedKey, setClosedKey] = useState<string | null>(null);
  const [dayDismissedUntil, setDayDismissedUntil] = useState<number | null>(null);
  const close = useCallback(() => { setClosedKey(item.dismissKey); ref.current?.close(); }, [item.dismissKey]);
  useEffect(() => {
    const dialog = ref.current; if (!dialog) return;
    const desktop = window.matchMedia('(min-width: 750px)');
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    let scrollLocked = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let refreshed = false;
    const check = () => {
      if (timer !== null) clearTimeout(timer);
      const now = Date.now(); const start = Date.parse(item.startsAt); const end = Date.parse(item.endsAt);
      const device = item.device === 'all' || (item.device === 'pc' ? desktop.matches : !desktop.matches);
      let until: number | null = dayDismissedUntil && dayDismissedUntil > now ? dayDismissedUntil : null;
      try { until = popupDismissedUntil(window.localStorage.getItem(HOME_POPUP_DISMISS_STORAGE), item.dismissKey, now) ?? until; } catch { /* Storage can be unavailable; a normal close still works. */ }
      const visible = device && closedKey !== item.dismissKey && !until && start <= now && now < end;
      if (visible && !dialog.open) { dialog.showModal(); document.body.style.overflow = 'hidden'; scrollLocked = true; }
      else if (!visible && dialog.open) dialog.close();
      if (!visible && scrollLocked) { document.body.style.overflow = previousOverflow; scrollLocked = false; }
      if (now >= end) { if (!refreshed) { refreshed = true; router.refresh(); } return; }
      const boundary = Math.min(end, start > now ? start : Infinity, until ?? Infinity);
      timer = setTimeout(check, Math.min(2_147_483_647, Math.max(1, boundary - now)));
    };
    const onVisible = () => { if (document.visibilityState === 'visible') { check(); router.refresh(); } };
    check(); desktop.addEventListener('change', check); window.addEventListener('storage', check);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timer !== null) clearTimeout(timer);
      desktop.removeEventListener('change', check); window.removeEventListener('storage', check);
      document.removeEventListener('visibilitychange', onVisible);
      if (dialog.open) dialog.close();
      if (scrollLocked) document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [item, closedKey, dayDismissedUntil, router]);
  const dismissToday = () => {
    const until = nextKstMidnight(Date.now());
    try { window.localStorage.setItem(HOME_POPUP_DISMISS_STORAGE, JSON.stringify({ key: item.dismissKey, until })); }
    catch { /* The current visit can still be dismissed without storage. */ }
    setDayDismissedUntil(until); ref.current?.close();
  };
  return <dialog ref={ref} className="wc-home-popup" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); close(); }}>
    <div className="wc-home-popup__actions"><button type="button" onClick={dismissToday}>오늘 하루 안 보기</button><button type="button" onClick={close} aria-label="홈 공지 닫기">×</button></div>
    <article className="wc-home-popup__content"><h2 id={titleId}>{item.important ? <span>중요</span> : null}{item.title}</h2><GoodsDescription description={item.body} format={item.format} /></article>
  </dialog>;
}

export function HomeAnnouncementPopup({ data }: { data: HomeAnnouncementPopupData }) {
  return <>{data.nextChangeAt ? <ScheduledHomeRefresh at={data.nextChangeAt} /> : null}{data.item ? <Popup key={data.item.dismissKey} item={data.item} /> : null}</>;
}
