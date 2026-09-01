'use client';

import Link from 'next/link';
import { Suspense, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type RefObject } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { signOutAction } from '@/app/login/actions';
import { nextPathWithSearch } from '@/lib/auth/onboarding';
import { COMMUNITY_ENABLED } from '@/lib/community-visibility';
import { isCardRewardDestination, isCommunityDestination, type NoticeStrip } from '@/lib/home-catalog';
import {
  CATEGORY_MEGA_GROUPS,
  NAV_ITEMS,
  UTIL_ITEMS,
  activeNavId,
  hrefFor,
  isActive,
  isAuthShellPath,
  type NavGroup,
} from '@/lib/routes';
import { createClient } from '@/lib/supabase/client';
import { Icon } from '@/components/ui/Icon';
import { useAuthPresence } from './AuthPresenceProvider';
import { BottomTabBar } from './BottomTabBar';
import { useCardRewardsEnabled } from './CardRewardAvailability';
import { useCart } from './CartProvider';
import { MenuSheet } from './MenuSheet';
import { loadUnreadNotificationCount, notificationNavigationKey } from './notification-count';
import { SearchOverlay } from './SearchOverlay';

/** 검색 오버레이와 전체 메뉴 시트는 동시에 열리지 않는다 — 하나의 상태로 다룬다. */
type OverlayKind = 'none' | 'search' | 'sheet';

/* 로그인 복귀 경로는 렌더 시점이 아니라 클릭 시점의 주소로 계산한다 — 그래서 값이 아니라 함수다.
   SSR 렌더 시점에는 window가 없고, 셸은 라우트 전환에도 살아남으므로 한 번 굳혀 두면
   경로가 바뀐 뒤에도 옛 주소가 남아 로그인 후 엉뚱한 곳으로 돌아간다. */
function loginHref() {
  return `/login?next=${encodeURIComponent(
    nextPathWithSearch(window.location.pathname, new URLSearchParams(window.location.search)),
  )}`;
}

/* 축약 기준은 스크롤 절대값이 아니라 "헤더가 뷰포트 상단에 닿았는가"다.
   유틸바(그리고 S3의 공지 스트립)가 아직 화면에 있는데 GNB부터 접히면 54px 레이아웃 점프가 보인다.
   접힘과 해제의 경계를 하나로 쓰면 접히면서 줄어든 54px에 스크롤 앵커링이 맞물려 경계 위에서 출렁이므로,
   레퍼런스(R-01 §3.1)의 "최상단 근처에서 해제"를 그대로 둔다 — 접힘은 헤더 직전 센티널이 뷰포트를 벗어날 때,
   해제는 크롬 최상단 센티널이 다시 보일 때. 두 센티널 사이가 히스테리시스 밴드다. SSR 초기값은 항상 펼침이다. */
function useHeaderCondensed(
  topSentinelRef: RefObject<HTMLElement | null>,
  headerSentinelRef: RefObject<HTMLElement | null>,
) {
  const [condensed, setCondensed] = useState(false);

  useEffect(() => {
    const top = topSentinelRef.current;
    const boundary = headerSentinelRef.current;
    if (!top || !boundary) return;
    const expandObserver = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setCondensed(false);
    });
    const condenseObserver = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) setCondensed(true);
    });
    expandObserver.observe(top);
    condenseObserver.observe(boundary);
    return () => {
      expandObserver.disconnect();
      condenseObserver.disconnect();
    };
  }, [headerSentinelRef, topSentinelRef]);

  return condensed;
}

/** 카드 리워드 게이트가 꺼지면 packs 항목을 지우고, 그 결과 비어 버린 그룹은 그룹째 렌더하지 않는다. */
function gatedGroups(groups: NavGroup[], cardRewardsEnabled: boolean): NavGroup[] {
  if (cardRewardsEnabled) return groups;
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => item.id !== 'packs') }))
    .filter((group) => group.items.length > 0);
}

export function Nav({ noticeStrip = null }: { noticeStrip?: NoticeStrip | null }) {
  const pathname = usePathname();
  const cardRewardsEnabled = useCardRewardsEnabled();
  // 게임은 자기완결 번들, 어드민은 자체 작업대, 인증은 집중형 셸을 사용한다.
  if (isAuthShellPath(pathname) || pathname.startsWith('/games') || pathname.startsWith('/admin')) return null;
  return <WcChrome cardRewardsEnabled={cardRewardsEnabled} noticeStrip={noticeStrip} pathname={pathname} />;
}

function WcChrome({
  cardRewardsEnabled,
  noticeStrip,
  pathname,
}: {
  cardRewardsEnabled: boolean;
  noticeStrip: NoticeStrip | null;
  pathname: string;
}) {
  const { count } = useCart();
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const headerSentinelRef = useRef<HTMLDivElement>(null);
  const condensed = useHeaderCondensed(topSentinelRef, headerSentinelRef);
  const [overlay, setOverlay] = useState<{ kind: OverlayKind; pathname: string }>({ kind: 'none', pathname });
  /* 상태와 그 상태가 속한 경로를 함께 들고 있다가, 경로가 달라지면 effect가 아니라 렌더 중에 실제로 리셋한다.
     파생 불리언으로 가리기만 하면 뒤로/앞으로 가기로 같은 경로에 돌아왔을 때 옛 상태가 되살아나 오버레이가 멋대로 다시 열린다. */
  if (overlay.pathname !== pathname) {
    setOverlay({ kind: 'none', pathname });
  }
  const searchOpen = overlay.pathname === pathname && overlay.kind === 'search';
  const sheetOpen = overlay.pathname === pathname && overlay.kind === 'sheet';
  const closeOverlay = () => setOverlay({ kind: 'none', pathname });

  const navItems = cardRewardsEnabled
    ? NAV_ITEMS
    : NAV_ITEMS.filter((item) => item.id !== 'packs');
  /* 활성 항목은 반드시 여기 한 곳에서만 고른다. 항목별로 isActive를 부르면
     '/shop/new'에서 카테고리(/shop)와 NEW가 동시에 활성으로 보인다. */
  const activeId = activeNavId(pathname, navItems);
  const megaGroups = gatedGroups(CATEGORY_MEGA_GROUPS, cardRewardsEnabled);

  return (
    <div className="wc-root wc-chrome">
      {/* 축약 해제 센티널 — 이게 다시 보이는 "최상단 근처"에서만 GNB를 펼친다. */}
      <div ref={topSentinelRef} aria-hidden className="wc-header-sentinel" />
      <a className="wc-skip-link" href="#root">본문으로 건너뛰기</a>

      {/* 공지 스트립은 이미지 비율만큼 높이를 차지하는 링크 배너다(R-01 §1). 두 센티널 사이에 두면
          축약 기준이 스트립 높이만큼 자동 보정된다 — 스트립이 아직 보이는 동안에는 GNB가 접히지 않는다.
          PC 비율 아트웍은 모바일 폭에서 수 px 로 붕괴하므로 히어로처럼 모바일 소스를 분기하고,
          카드 리워드 목적지 스트립은 게이트가 꺼진 배포에서 packs GNB 항목과 같은 규칙으로 숨긴다. */}
      {noticeStrip
        && (cardRewardsEnabled || !isCardRewardDestination(noticeStrip.href))
        && (COMMUNITY_ENABLED || !isCommunityDestination(noticeStrip.href)) ? (
        <Link className="wc-notice" href={noticeStrip.href}>
          <picture>
            {noticeStrip.mobileImageUrl ? (
              <source media="(max-width: 749px)" srcSet={noticeStrip.mobileImageUrl} />
            ) : null}
            <img alt={noticeStrip.title} src={noticeStrip.imageUrl} />
          </picture>
        </Link>
      ) : null}

      <nav aria-label="유틸리티 메뉴" className="wc-utilbar">
        <div className="wc-container wc-utilbar__inner">
          {UTIL_ITEMS.map((item) => (item.id === 'notifications'
            ? <UtilNotificationsLink key={item.id} label={item.label} />
            : (
              <Link key={item.id} className="wc-utilbar__link" href={hrefFor(item.id)}>
                {item.label}
              </Link>
            )))}
          <UtilAuthAction />
        </div>
      </nav>

      {/* 축약 판정 센티널 — 뷰포트를 벗어나는 순간이 헤더가 top:0에 붙는 순간이다. */}
      <div ref={headerSentinelRef} aria-hidden className="wc-header-sentinel" />
      <header className="wc-header" data-condensed={condensed ? 'true' : 'false'}>
        <div className="wc-header__bar">
          <div className="wc-container wc-header__bar-inner">
            <Link aria-label="ICONS 홈" className="wc-logo" href="/">ICONS</Link>

            <div className="wc-header__icons">
              <button
                aria-expanded={searchOpen}
                aria-haspopup="dialog"
                aria-label="검색"
                className="wc-icon-btn"
                onClick={() => setOverlay({ kind: 'search', pathname })}
                type="button"
              >
                <Icon name="search" size={24} />
              </button>
              <Link
                aria-current={isActive('cart', pathname) ? 'page' : undefined}
                aria-label={count > 0 ? `장바구니, ${count}개` : '장바구니'}
                className="wc-icon-btn wc-icon-btn--cart"
                href={hrefFor('cart')}
              >
                <Icon name="bag" size={24} />
                {count > 0 && <span aria-hidden className="wc-cartcount">{count}</span>}
              </Link>
              <AccountIconLink pathname={pathname} />
            </div>
          </div>
        </div>

        <div className="wc-gnb-wrap">
          <nav aria-label="주요 메뉴" className="wc-gnb">
            <ul className="wc-gnb__list">
              {navItems.map((item) => (item.id === 'shop'
                ? (
                  <CategoryMegaItem
                    key={item.id}
                    active={activeId === 'shop'}
                    groups={megaGroups}
                    label={item.label}
                    pathname={pathname}
                  />
                )
                : (
                  <li key={item.id} className="wc-gnb__item">
                    <Link
                      aria-current={activeId === item.id ? 'page' : undefined}
                      className={`wc-gnb__link${activeId === item.id ? ' is-active' : ''}`}
                      href={hrefFor(item.id)}
                    >
                      <span className="wc-gnb__label">{item.label}</span>
                    </Link>
                  </li>
                )))}
            </ul>
          </nav>

          <nav aria-label="주요 메뉴 탭" className="wc-mob-gnb">
            <div className="wc-mob-gnb__wrap">
              <ul className="wc-mob-gnb__list">
                {navItems.map((item) => (
                  <li key={item.id}>
                    {item.id === 'shop'
                      ? (
                        <button
                          aria-expanded={sheetOpen}
                          aria-haspopup="dialog"
                          className={`wc-mob-gnb__link${activeId === 'shop' ? ' is-active' : ''}`}
                          onClick={() => setOverlay({ kind: 'sheet', pathname })}
                          type="button"
                        >
                          {item.label}
                        </button>
                      )
                      : (
                        <Link
                          aria-current={activeId === item.id ? 'page' : undefined}
                          className={`wc-mob-gnb__link${activeId === item.id ? ' is-active' : ''}`}
                          href={hrefFor(item.id)}
                        >
                          {item.label}
                        </Link>
                      )}
                  </li>
                ))}
              </ul>
            </div>
          </nav>
        </div>

        <SearchOverlay open={searchOpen} onClose={closeOverlay} />
      </header>

      <MenuSheet open={sheetOpen} onClose={closeOverlay} cardRewardsEnabled={cardRewardsEnabled} />
      <BottomTabBar menuOpen={sheetOpen} onMenuOpen={() => setOverlay({ kind: 'sheet', pathname })} />
    </div>
  );
}

/* 카테고리 트리거는 링크이자 메가메뉴 트리거다. 포인터(hover)와 키보드(focus) 양쪽으로 열리고,
   메가 마크업은 항상 DOM에 두고 data-open으로만 표시를 토글한다 — 크롤러와 스크린리더가 목차를 잃지 않게. */
function CategoryMegaItem({
  active,
  groups,
  label,
  pathname,
}: {
  active: boolean;
  groups: NavGroup[];
  label: string;
  pathname: string;
}) {
  const liRef = useRef<HTMLLIElement>(null);
  const triggerRef = useRef<HTMLAnchorElement>(null);
  /* 셸은 라우트 전환에도 살아남는다 — 링크로 이동해도 포인터·포커스가 li 안에 남아
     mouseleave/blur가 안 올 수 있어, 경로가 바뀌면 렌더 중에 닫힌 상태로 리셋한다. */
  const [mega, setMega] = useState({ open: false, pathname });
  if (mega.pathname !== pathname) {
    setMega({ open: false, pathname });
  }
  const megaOpen = mega.open && mega.pathname === pathname;
  const setMegaOpen = (open: boolean) => setMega({ open, pathname });

  const onBlurCapture = (event: FocusEvent<HTMLLIElement>) => {
    // 포커스가 항목 안에서 옮겨 다니는 동안에는 닫지 않는다.
    if (liRef.current?.contains(event.relatedTarget)) return;
    setMegaOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    setMegaOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <li
      ref={liRef}
      className="wc-gnb__item wc-gnb__item--mega"
      onBlurCapture={onBlurCapture}
      onFocusCapture={() => setMegaOpen(true)}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setMegaOpen(true)}
      onMouseLeave={() => setMegaOpen(false)}
    >
      <Link
        ref={triggerRef}
        aria-controls="wc-mega-category"
        aria-current={active ? 'page' : undefined}
        aria-expanded={megaOpen}
        className={`wc-gnb__link${active ? ' is-active' : ''}`}
        href={hrefFor('shop')}
      >
        <span className="wc-gnb__label">{label}</span>
      </Link>

      <div className="wc-mega" data-open={megaOpen ? 'true' : 'false'} id="wc-mega-category">
        <ul className="wc-container wc-mega__list">
          {groups.map((group) => (
            <li key={group.heading} className="wc-mega__group">
              <p className="wc-mega__heading">{group.heading}</p>
              <ul className="wc-mega__links">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <Link
                      aria-current={isActive(item.id, pathname) ? 'page' : undefined}
                      className="wc-mega__link"
                      href={hrefFor(item.id)}
                      onClick={() => setMegaOpen(false)}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

/* 알림 수는 useSearchParams에 의존한다 — Suspense 밖으로 새면 이 라우트 전체가 CSR로 떨어진다. */
function UtilNotificationsLink({ label }: { label: string }) {
  return (
    <Suspense fallback={<Link className="wc-utilbar__link" href={hrefFor('notifications')}>{label}</Link>}>
      <UtilNotificationsCount label={label} />
    </Suspense>
  );
}

function UtilNotificationsCount({ label }: { label: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const presence = useAuthPresence();
  const [count, setCount] = useState(0);
  /* 알림함에서 돌아오면 pathname이 그대로라 재조회가 걸리지 않는다 — 열람 신호까지 키에 넣는다. */
  const navigationKey = notificationNavigationKey(
    pathname,
    searchParams.get('notification_opened'),
  );

  useEffect(() => {
    if (presence !== 'signed-in') return;
    let active = true;
    void loadUnreadNotificationCount(createClient()).then(
      (next) => {
        if (active) setCount(next);
      },
      () => {
        // 실패는 조용히 0으로 둔다. 유틸바 링크 자체는 로그인 여부와 무관하게 항상 살아 있다.
        if (active) setCount(0);
      },
    );
    return () => {
      active = false;
    };
  }, [navigationKey, presence]);

  const unread = presence === 'signed-in' ? count : 0;

  return (
    <Link
      aria-label={unread > 0 ? `${label}, 안 읽은 알림 ${unread}개` : undefined}
      className="wc-utilbar__link"
      href={hrefFor('notifications')}
    >
      {label}
      {unread > 0 && <span aria-hidden className="wc-utilbar__badge">{unread > 99 ? '99+' : unread}</span>}
    </Link>
  );
}

/* presence 확정 전에는 자리만 잡는다. 로그인/로그아웃이 번갈아 깜빡이면 유틸바 폭이 흔들린다. */
function UtilAuthAction() {
  const router = useRouter();
  const { resetForSignOut } = useCart();
  const presence = useAuthPresence();

  if (presence === 'unknown') {
    return <span aria-hidden className="wc-utilbar__placeholder" />;
  }

  if (presence === 'signed-in') {
    return (
      <form action={signOutAction} onSubmit={resetForSignOut}>
        <button className="wc-utilbar__action" type="submit">로그아웃</button>
      </form>
    );
  }

  return (
    <button className="wc-utilbar__action" onClick={() => router.push(loginHref())} type="button">
      로그인
    </button>
  );
}

/* 계정 아이콘 — 모바일에서는 CSS가 숨기고 하단 탭바의 '마이'가 그 역할을 맡는다. */
function AccountIconLink({ pathname }: { pathname: string }) {
  const router = useRouter();
  const presence = useAuthPresence();

  if (presence === 'unknown') {
    return <span aria-hidden className="wc-icon-btn-placeholder" />;
  }

  if (presence === 'signed-in') {
    return (
      <Link
        aria-current={isActive('my', pathname) ? 'page' : undefined}
        aria-label="마이페이지"
        className="wc-icon-btn wc-icon-btn--account"
        href={hrefFor('my')}
      >
        <Icon name="user" size={24} />
      </Link>
    );
  }

  return (
    <button
      aria-label="로그인"
      className="wc-icon-btn wc-icon-btn--account"
      onClick={() => router.push(loginHref())}
      type="button"
    >
      <Icon name="user" size={24} />
    </button>
  );
}
