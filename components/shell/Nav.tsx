'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_ITEMS, hrefFor, isActive, isAuthShellPath } from '@/lib/routes';
import { Icon } from '@/components/ui/Icon';
import { useCart } from './CartProvider';
import { useGo } from './useGo';
import { AuthButton } from './AuthButton';

export function Nav() {
  const pathname = usePathname();
  const go = useGo();
  const { count } = useCart();

  // 게임은 자기완결 번들 — 셸 없이 풀블리드(ADR-0002). 어드민은 자체 콘솔 셸 사용.
  if (isAuthShellPath(pathname) || pathname.startsWith('/games') || pathname.startsWith('/admin')) return null;

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
          <Link
            className={`icon-btn${isActive('cart', pathname) ? ' active' : ''}`}
            href={hrefFor('cart')}
            title="장바구니"
            aria-label={`장바구니${count > 0 ? `, ${count}개` : ''}`}
          >
            <Icon name="bag" />
            {count > 0 && <span className="badge" aria-hidden>{count}</span>}
          </Link>
          <AuthButton />
        </div>
      </div>
    </nav>
  );
}
