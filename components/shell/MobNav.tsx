'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MOB_ITEMS, hrefFor, isActive, isAuthShellPath } from '@/lib/routes';
import { useCart } from './CartProvider';
import { useAuthPresence } from './AuthPresenceProvider';
import { useCardRewardsEnabled } from './CardRewardAvailability';

export function MobNav() {
  const pathname = usePathname();
  const { count } = useCart();
  const presence = useAuthPresence();
  const cardRewardsEnabled = useCardRewardsEnabled();
  const availableItems = (cardRewardsEnabled
    ? MOB_ITEMS
    : MOB_ITEMS.filter((item) => item.id !== 'packs'))
    /* '메뉴'는 목적지가 없는 액션 탭이라 링크로 세우면 홈으로 폴백된다. 시트를 여는 바텀바만 이 항목을 다룬다. */
    .filter((item) => item.id !== 'menu');
  const items = presence === 'signed-in'
    ? availableItems.map((item) => item.id === 'cart' ? { id: 'my', label: '마이' } : item)
    : presence === 'signed-out'
      ? availableItems
      : availableItems.slice(0, -1);

  if (
    isAuthShellPath(pathname)
    || pathname.startsWith('/checkout')
    || pathname.startsWith('/ticket-checkout')
    || pathname.startsWith('/games')
    || pathname.startsWith('/admin')
  ) return null;
  return (
    <nav aria-busy={presence === 'unknown' ? true : undefined} className="mobnav" aria-label="모바일 내비게이션">
      {items.map((n) => {
        const active = isActive(n.id, pathname);
        return (
          <Link
            key={n.id}
            aria-current={active ? 'page' : undefined}
            aria-label={n.id === 'cart' && count > 0 ? `${n.label}, ${count}개` : n.label}
            className={active ? 'on' : ''}
            href={hrefFor(n.id)}
          >
            <span className="dot" />
            {n.label}
            {n.id === 'cart' && count > 0 && <span className="mobnav-cart-count" aria-hidden>{count}</span>}
          </Link>
        );
      })}
      {presence === 'unknown' && <span aria-hidden className="mobnav-presence-placeholder" />}
    </nav>
  );
}
