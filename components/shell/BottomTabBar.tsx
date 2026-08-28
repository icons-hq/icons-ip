'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MOB_ITEMS, activeNavId, hrefFor } from '@/lib/routes';
import { Icon } from '@/components/ui/Icon';

/* 바텀 탭의 아이콘은 라우트 데이터가 아니라 표면의 표현이라 여기서 고정한다. */
const ICONS_BY_ID: Record<string, string> = {
  menu: 'grid',
  shop: 'shop',
  home: 'home',
  wish: 'heart',
  my: 'user',
};

/* 모바일 하단 고정 탭바. 'menu'만 목적지가 없는 액션 탭이라 링크 대신 전체 메뉴 시트를 연다. */
export function BottomTabBar({ menuOpen, onMenuOpen }: { menuOpen: boolean; onMenuOpen: () => void }) {
  const pathname = usePathname();
  /* 결제 흐름에서는 하단 고정 CTA를 가리지 않도록 스스로 빠진다(구 MobNav 동작 승계). */
  if (pathname.startsWith('/checkout') || pathname.startsWith('/ticket-checkout')) return null;
  /* 굿즈 상세도 같다 — 모바일 PDP 는 72px 구매바가 최하단을 차지한다(R-04 §7.2).
     탭바를 그대로 두면 z-index 로 가려진 채 포커스 순서에만 남는 유령 내비가 된다.
     /shop/new·/shop/best 는 컬렉션 표면이라 탭바를 유지한다. */
  if (/^\/shop\/(?!new$|best$)[^/]+$/.test(pathname)) return null;

  /* 항목별 isActive가 아니라 activeNavId — '/shop/new'에서 '굿즈샵'과 홈이 함께 켜지지 않게 최장 경로가 이긴다. */
  const activeId = activeNavId(pathname, MOB_ITEMS);

  return (
    <nav aria-label="하단 메뉴" className="wc-tabbar">
      {MOB_ITEMS.map((item) => item.id === 'menu'
        ? (
          <button
            key={item.id}
            aria-expanded={menuOpen}
            aria-haspopup="dialog"
            className="wc-tabbar__item"
            onClick={onMenuOpen}
            type="button"
          >
            <Icon name="grid" size={22} />{item.label}
          </button>
        )
        : (
          <Link
            key={item.id}
            aria-current={activeId === item.id ? 'page' : undefined}
            className={`wc-tabbar__item${activeId === item.id ? ' is-active' : ''}`}
            href={hrefFor(item.id)}
          >
            <Icon name={ICONS_BY_ID[item.id]} size={22} />{item.label}
          </Link>
        ))}
    </nav>
  );
}
