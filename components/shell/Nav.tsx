'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_ITEMS, hrefFor, isActive } from '@/lib/routes';
import { Icon } from '@/components/ui/Icon';
import { useCart } from './CartProvider';
import { useGo } from './useGo';
import { AuthButton } from './AuthButton';

export function Nav() {
  const pathname = usePathname();
  const go = useGo();
  const { count } = useCart();

  if (pathname === '/login') return null;

  return (
    <nav className="nav">
      <div className="wrap">
        <Link className="brand" href="/">
          <span className="dot" />ICONS
        </Link>
        <div className="nav-links">
          {NAV_ITEMS.map((n) => (
            <Link key={n.id} className={isActive(n.id, pathname) ? 'active' : ''} href={hrefFor(n.id)}>
              {n.label}
            </Link>
          ))}
        </div>
        <div className="nav-right">
          <button className="icon-btn" onClick={() => go('search')} title="검색" aria-label="검색">
            <Icon name="search" />
          </button>
          <button className="icon-btn" onClick={() => go('shop')} title="장바구니" aria-label="장바구니">
            <Icon name="bag" />
            {count > 0 && <span className="badge">{count}</span>}
          </button>
          <AuthButton />
        </div>
      </div>
    </nav>
  );
}
