'use client';

import Link from 'next/link';
import { useState, type FocusEvent } from 'react';
import { usePathname } from 'next/navigation';
import { MOB_ITEMS, activeNavId, hrefFor, isGoodDetailPath } from '@/lib/routes';
import { focusKeepsTabBarVisible } from './chrome-scroll';
import { Icon } from '@/components/ui/Icon';

/* 바텀 탭의 아이콘은 라우트 데이터가 아니라 표면의 표현이라 여기서 고정한다. */
const ICONS_BY_ID: Record<string, string> = {
  menu: 'grid',
  shop: 'shop',
  home: 'home',
  wish: 'heart',
  my: 'user',
};

/* 모바일 하단 고정 탭바. 'menu'만 목적지가 없는 액션 탭이라 링크 대신 전체 메뉴 시트를 연다.
   hidden은 셸이 정한다 — 아래로 누적 300px 스크롤(B3, chrome-scroll.ts)했거나 검색 오버레이가 열린 동안.
   숨김은 화면 밖으로 내린 뒤 visibility로 포커스·접근성 트리에서도 빼고(wc-chrome.css),
   키보드 포커스가 탭바 안에 있는 동안에는 스크롤해도 내리지 않는다 — 포커스가 보이지 않는 곳에 남으면 안 된다. */
export function BottomTabBar({
  hidden = false,
  menuOpen,
  onMenuOpen,
}: {
  hidden?: boolean;
  menuOpen: boolean;
  onMenuOpen: () => void;
}) {
  const pathname = usePathname();
  /* 탭을 눌러 이동하면 포커스를 쥔 링크째 새 경로로 넘어간다 — 경로가 바뀌면 포커스 기록을 무효로 본다. */
  const [focus, setFocus] = useState({ within: false, pathname });
  const focusWithin = focus.within && focus.pathname === pathname;

  /* 결제 흐름에서는 하단 고정 CTA를 가리지 않도록 스스로 빠진다. */
  if (pathname.startsWith('/checkout') || pathname.startsWith('/ticket-checkout')) return null;
  /* 굿즈 상세도 같다 — 모바일 PDP 는 72px 구매바가 최하단을 차지한다(R-04 §7.2).
     탭바를 그대로 두면 z-index 로 가려진 채 포커스 순서에만 남는 유령 내비가 된다.
     /shop/new·/shop/best 는 컬렉션 표면이라 탭바를 유지한다. */
  if (isGoodDetailPath(pathname)) return null;

  /* 항목별 isActive가 아니라 activeNavId — '/shop/new'에서 '굿즈샵'과 홈이 함께 켜지지 않게 최장 경로가 이긴다. */
  const activeId = activeNavId(pathname, MOB_ITEMS);

  const onBlurCapture = (event: FocusEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setFocus({ within: false, pathname });
  };

  return (
    <nav
      aria-label="하단 메뉴"
      className="wc-tabbar"
      data-hidden={hidden && !focusWithin ? 'true' : 'false'}
      onBlurCapture={onBlurCapture}
      onFocusCapture={(event) => setFocus({ within: focusKeepsTabBarVisible(event.target as Element), pathname })}
    >
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
