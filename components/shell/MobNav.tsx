'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MOB_ITEMS, hrefFor, isActive } from '@/lib/routes';

export function MobNav() {
  const pathname = usePathname();

  if (pathname === '/login') return null;
  return (
    <nav className="mobnav" aria-label="모바일 내비게이션">
      {MOB_ITEMS.map((n) => (
        <Link key={n.id} className={isActive(n.id, pathname) ? 'on' : ''} href={hrefFor(n.id)}>
          <span className="dot" />
          {n.label}
        </Link>
      ))}
    </nav>
  );
}
