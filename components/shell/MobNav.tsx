'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MOB_ITEMS, hrefFor, isActive } from '@/lib/routes';
import { useCart } from './CartProvider';

export function MobNav() {
  const pathname = usePathname();
  const { count } = useCart();

  if (pathname === '/login' || pathname.startsWith('/games') || pathname.startsWith('/admin')) return null;
  return (
    <nav className="mobnav" aria-label="모바일 내비게이션">
      {MOB_ITEMS.map((n) => (
        <Link
          key={n.id}
          className={isActive(n.id, pathname) ? 'on' : ''}
          href={hrefFor(n.id)}
          aria-label={n.id === 'cart' && count > 0 ? `${n.label}, ${count}개` : n.label}
        >
          <span className="dot" />
          {n.label}
          {n.id === 'cart' && count > 0 && <span className="mobnav-cart-count" aria-hidden>{count}</span>}
        </Link>
      ))}
    </nav>
  );
}
