'use client';

import Link from 'next/link';
import { Suspense, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { signOutAction } from '@/app/login/actions';
import { EMPTY_SHELL_NOTICES, type ShellNotices as ShellNoticeData } from '@/lib/shell-notices';
import {
  CATEGORY_MEGA_GROUPS,
  CATEGORY_SHEET_SHORTCUTS,
  MEMBER_UTIL_ITEMS,
  UTIL_ITEMS,
  activeNavId,
  campaignDetailHref,
  hrefFor,
  isActive,
  isStandaloneShellPath,
  type NavGroup,
  type NavItem,
} from '@/lib/routes';
import {
  EMPTY_STOREFRONT_MEGA_MENUS,
  MEGA_MENU_CAMPAIGN_LIMIT,
  MEGA_MENU_IP_TILE_COUNT,
  categoryMenuGroups,
  isCategoryMenuLive,
  menuMonogram,
  type CategoryMenuGroup,
  type StorefrontMegaMenus,
  type StorefrontMenuCampaign,
  type StorefrontMenuIp,
} from '@/lib/storefront-mega-menu';
import { createClient } from '@/lib/supabase/client';
import { Icon } from '@/components/ui/Icon';
import { useAuthPresence } from './AuthPresenceProvider';
import { BottomTabBar } from './BottomTabBar';
import { useCardRewardsEnabled } from './CardRewardAvailability';
import { useCart } from './CartProvider';
import { CategorySheet } from './CategorySheet';
import { nextHeaderCondensed, nextTabBarScroll, tabBarScrollAt } from './chrome-scroll';
import { loginEntryHref } from './login-entry';
import { MenuSheet } from './MenuSheet';
import { loadUnreadNotificationCount, notificationNavigationKey } from './notification-count';
import { OverlayPortal } from './OverlayPortal';
import { SearchOverlay } from './SearchOverlay';
import { ShellNotices } from './ShellNotices';
import { StoreBrandLogo } from './StoreBranding';
import { DEFAULT_STOREFRONT_BRANDING, type StorefrontBranding } from '@/lib/store-branding';
import { useStorePresentation } from './StorePresentationProvider';
import { storeThemeForeground } from '@/lib/store-presentation';
import type { CSSProperties } from 'react';
import { configuredNavigationGroups, DEFAULT_STOREFRONT_NAVIGATION, resolveStorefrontNavigation, type StorefrontNavigation } from '@/lib/store-navigation';

/** 검색 오버레이·전체 메뉴 시트·카테고리 시트는 동시에 열리지 않는다 — 하나의 상태로 다룬다. */
type OverlayKind = 'none' | 'search' | 'sheet' | 'category';

/* 로그인 복귀 경로는 렌더 시점이 아니라 클릭 시점의 주소로 계산한다 — 그래서 값이 아니라 함수다.
   SSR 렌더 시점에는 window가 없고, 셸은 라우트 전환에도 살아남으므로 한 번 굳혀 두면
   경로가 바뀐 뒤에도 옛 주소가 남아 로그인 후 엉뚱한 곳으로 돌아간다. */
function loginHref() {
  return loginEntryHref(window.location.pathname, window.location.search);
}

/* 공지(텍스트 공지 바 + 이미지 스트립, ShellNotices)는 유틸바 위에 쌓인다 — 유틸바의 문서상 위치가 곧 공지 높이다.
   공지 바를 닫거나 공지가 없으면 그 높이도 0이 되어 다음 스크롤 판정부터 기준이 함께 줄어든다.
   모바일에서는 유틸바가 숨어 레이아웃 상자가 없으므로 0을 돌려준다. 이 값을 쓰는 데스크톱 축약 판정은
   모바일에서 표현되지 않는다(wc-chrome.css가 data-condensed를 990px 이상에서만 읽는다). */
function noticeOffsetAbove(utilbar: HTMLElement | null): number {
  if (!utilbar || utilbar.offsetParent === null) return 0;
  return utilbar.getBoundingClientRect().top + window.scrollY;
}

/* 스크롤 판정은 순수 함수(chrome-scroll.ts)에 맡기고 여기서는 스크롤 위치와 공지 높이만 읽어 넘긴다.
   - 데스크톱 축약: B1 한 쌍(>150 접힘 / <64 해제, 공지 높이 가산)
   - 모바일 하단 탭바: B3(아래로 누적 300px 숨김 / 위로·최상단 노출)
   모바일 로고 행은 판정 없이 CSS(sticky top 음수)가 스크롤과 함께 밀어낸다(wc-chrome.css '모바일 헤더 고정').
   스크롤 이벤트는 이미 프레임당 한 번 이하로 오고, 상태가 그대로면 React가 렌더를 건너뛴다.
   SSR 초기값은 항상 펼침·노출이다 — 첫 판정은 다음 프레임에 한다(복원된 스크롤 위치에서 열려도 바로 맞춰진다). */
function useChromeScroll(utilbarRef: RefObject<HTMLElement | null>) {
  const [condensed, setCondensed] = useState(false);
  const [tabBarHidden, setTabBarHidden] = useState(false);

  useEffect(() => {
    let headerCondensed = false;
    let tabBar = tabBarScrollAt(window.scrollY);
    const update = () => {
      headerCondensed = nextHeaderCondensed(headerCondensed, window.scrollY, noticeOffsetAbove(utilbarRef.current));
      tabBar = nextTabBarScroll(tabBar, window.scrollY);
      setCondensed(headerCondensed);
      setTabBarHidden(tabBar.hidden);
    };
    const frame = window.requestAnimationFrame(update);
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [utilbarRef]);

  return { condensed, tabBarHidden };
}

export function Nav({
  notices = EMPTY_SHELL_NOTICES,
  branding = DEFAULT_STOREFRONT_BRANDING,
  navigation = DEFAULT_STOREFRONT_NAVIGATION,
  megaMenus = EMPTY_STOREFRONT_MEGA_MENUS,
}: {
  notices?: ShellNoticeData;
  branding?: StorefrontBranding;
  navigation?: StorefrontNavigation;
  megaMenus?: StorefrontMegaMenus;
}) {
  const pathname = usePathname();
  const cardRewardsEnabled = useCardRewardsEnabled();
  // 게임은 자기완결 번들, 어드민은 자체 작업대, 초대·비밀번호 변경·정지 안내는 집중형 셸을 사용한다(로그인은 크롬 안).
  if (isStandaloneShellPath(pathname)) return null;
  return <WcChrome cardRewardsEnabled={cardRewardsEnabled} notices={notices} pathname={pathname} branding={branding} navigation={navigation} megaMenus={megaMenus} />;
}

function WcChrome({
  cardRewardsEnabled,
  notices,
  pathname,
  branding,
  navigation,
  megaMenus,
}: {
  cardRewardsEnabled: boolean;
  notices: ShellNoticeData;
  pathname: string;
  branding: StorefrontBranding;
  navigation: StorefrontNavigation;
  megaMenus: StorefrontMegaMenus;
}) {
  const { count } = useCart();
  const { common } = useStorePresentation();
  const utilbarRef = useRef<HTMLElement>(null);
  const { condensed, tabBarHidden: tabBarScrolledAway } = useChromeScroll(utilbarRef);
  const [overlay, setOverlay] = useState<{ kind: OverlayKind; pathname: string }>({ kind: 'none', pathname });
  /* 상태와 그 상태가 속한 경로를 함께 들고 있다가, 경로가 달라지면 effect가 아니라 렌더 중에 실제로 리셋한다.
     파생 불리언으로 가리기만 하면 뒤로/앞으로 가기로 같은 경로에 돌아왔을 때 옛 상태가 되살아나 오버레이가 멋대로 다시 열린다. */
  if (overlay.pathname !== pathname) {
    setOverlay({ kind: 'none', pathname });
  }
  const searchOpen = overlay.pathname === pathname && overlay.kind === 'search';
  const sheetOpen = overlay.pathname === pathname && overlay.kind === 'sheet';
  const categoryOpen = overlay.pathname === pathname && overlay.kind === 'category';
  const closeOverlay = () => setOverlay({ kind: 'none', pathname });

  const navItems = resolveStorefrontNavigation(navigation, cardRewardsEnabled);
  /* 활성 항목은 반드시 여기 한 곳에서만 고른다. 항목별로 isActive를 부르면
     '/shop/new'에서 카테고리(/shop)와 NEW가 동시에 활성으로 보인다. */
  const activeId = activeNavId(pathname, navItems);
  const megaGroups = configuredNavigationGroups(CATEGORY_MEGA_GROUPS, navItems);
  /* 공개 전시 트리가 있으면(고객 카테고리 공개 스위치 ON + 공개 전시 1개 이상) 카테고리 메가메뉴는 실제 분류·기획전을 싣고
     모바일 '카테고리' 탭은 카테고리 시트를 연다. 없으면 지금 메뉴(굿즈샵·수집·거래)와 전체 메뉴 시트로 돌아간다(L5 폴백). */
  const categoryLive = isCategoryMenuLive(megaMenus);
  const shortcutGroup = configuredNavigationGroups([CATEGORY_MEGA_GROUPS[0]], navItems)[0] ?? null;
  const sheetShortcuts = configuredNavigationGroups([CATEGORY_SHEET_SHORTCUTS], navItems)[0]?.items ?? [];

  return (
    <div className="wc-root wc-chrome">
      <a className="wc-skip-link" href="#root">본문으로 건너뛰기</a>

      {/* 텍스트 공지 바 + 이미지 스트립. 유틸바 위에 두면 축약 기준이 실제 공지 높이만큼 자동 보정된다(noticeOffsetAbove) —
          공지가 아직 보이는 동안에는 GNB가 접히지 않는다. 카드 리워드·커뮤니티 목적지 공지는 게이트가 꺼진 배포에서
          GNB 항목과 같은 규칙으로 숨긴다(ShellNotices). */}
      <ShellNotices cardRewardsEnabled={cardRewardsEnabled} notices={notices} pathname={pathname} />

      <nav ref={utilbarRef} aria-label="유틸리티 메뉴" className="wc-utilbar">
        <div className="wc-container wc-utilbar__inner">
          <UtilMemberLinks />
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

      <header className="wc-header" data-condensed={condensed ? 'true' : 'false'} data-store-header={common.headerStyle} style={{ '--store-theme': common.themeColor, '--store-theme-ink': storeThemeForeground(common.themeColor) } as CSSProperties}>
        <div className="wc-header__bar">
          <div className="wc-container wc-header__bar-inner">
            <Link aria-label={`${branding.displayName} 홈`} className="wc-logo" href="/"><StoreBrandLogo branding={branding} /></Link>

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
              {navItems.map((item) => {
                if (item.id === 'shop') {
                  return (
                    <MegaMenuItem
                      key={item.id}
                      active={activeId === 'shop'}
                      href={hrefFor('shop')}
                      label={item.label}
                      panelId="wc-mega-category"
                      pathname={pathname}
                    >
                      {(close) => (categoryLive
                        ? (
                          <CategoryMegaCatalog
                            campaigns={megaMenus.campaigns.slice(0, MEGA_MENU_CAMPAIGN_LIMIT)}
                            groups={categoryMenuGroups(megaMenus.categories)}
                            onNavigate={close}
                            pathname={pathname}
                            shortcuts={shortcutGroup}
                          />
                        )
                        : <CategoryMegaFallback groups={megaGroups} onNavigate={close} pathname={pathname} />)}
                    </MegaMenuItem>
                  );
                }
                /* CH-07 — 온라인 팝업 메가메뉴는 디렉토리 피처드 IP가 있을 때만 연다. 없으면 지금처럼 디렉토리 링크다. */
                if (item.id === 'iphub' && megaMenus.featuredIps.length > 0) {
                  return (
                    <MegaMenuItem
                      key={item.id}
                      active={activeId === 'iphub'}
                      href={hrefFor('iphub')}
                      label={item.label}
                      panelId="wc-mega-online-popup"
                      pathname={pathname}
                    >
                      {(close) => <OnlinePopupMega ips={megaMenus.featuredIps} onNavigate={close} pathname={pathname} />}
                    </MegaMenuItem>
                  );
                }
                return (
                  <li key={item.id} className="wc-gnb__item">
                    <Link
                      aria-current={activeId === item.id ? 'page' : undefined}
                      className={`wc-gnb__link${activeId === item.id ? ' is-active' : ''}`}
                      href={hrefFor(item.id)}
                      title={item.label}
                    >
                      <span className="wc-gnb__label">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <nav aria-label="주요 메뉴 탭" className="wc-mob-gnb">
            <div className="wc-mob-gnb__wrap">
              <ul className="wc-mob-gnb__list">
                {navItems.map((item) => (
                  <li key={item.id}>
                    {item.id === 'shop'
                      ? (
                        /* MC-05 — 공개 전시 트리가 있으면 카테고리 전용 시트, 없으면 지금 전체 메뉴 시트. */
                        <button
                          aria-expanded={categoryLive ? categoryOpen : sheetOpen}
                          aria-haspopup="dialog"
                          className={`wc-mob-gnb__link${activeId === 'shop' ? ' is-active' : ''}`}
                          onClick={() => setOverlay({ kind: categoryLive ? 'category' : 'sheet', pathname })}
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

      <MenuSheet open={sheetOpen} onClose={closeOverlay} cardRewardsEnabled={cardRewardsEnabled} navigation={navigation} />
      {/* 카테고리 시트는 body 직계 포털로 연다(호출부 포털 — 계약 §2-8). 열린 동안에만 마운트한다. */}
      {categoryOpen ? (
        <OverlayPortal>
          <CategorySheet
            campaigns={megaMenus.campaigns}
            featuredIps={megaMenus.featuredIps}
            nodes={megaMenus.categories}
            onClose={closeOverlay}
            shortcuts={sheetShortcuts}
          />
        </OverlayPortal>
      ) : null}
      {/* 검색 오버레이가 열려 있는 동안에도 탭바를 내린다(MC-03) — 딤 위에 탭바만 떠 있으면 모달 밖 조작처럼 보인다. */}
      <BottomTabBar
        hidden={searchOpen || tabBarScrolledAway}
        menuOpen={sheetOpen}
        onMenuOpen={() => setOverlay({ kind: 'sheet', pathname })}
      />
    </div>
  );
}

/* 메가메뉴 트리거는 링크이자 메가메뉴 트리거다(카테고리·온라인 팝업). 포인터(hover)와 키보드(focus) 양쪽으로 열리고,
   메가 마크업은 항상 DOM에 두고 data-open으로만 표시를 토글한다 — 크롤러와 스크린리더가 목차를 잃지 않게.
   키보드: 트리거에 포커스가 오면 열리고 Tab 으로 패널 링크를 차례로 지난다. ↓ 는 패널 첫 링크로, Escape 는 패널을 닫고
   트리거로 돌아간다 — 돌아온 포커스가 패널을 다시 열지 않으므로 다음 Tab 은 옆 GNB 항목으로 간다(레퍼런스는 키보드로
   열리지 않는 결함, 11 §6 B4 — 재현하지 않는다). */
function MegaMenuItem({
  active,
  children,
  href,
  label,
  panelId,
  pathname,
}: {
  active: boolean;
  children: (close: () => void) => ReactNode;
  href: string;
  label: string;
  panelId: string;
  pathname: string;
}) {
  const liRef = useRef<HTMLLIElement>(null);
  const triggerRef = useRef<HTMLAnchorElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /* Escape 로 닫고 트리거에 되돌린 포커스가 focus 이벤트로 패널을 다시 여는 것을 막는다. 포커스가 항목을 떠나면 풀린다. */
  const suppressFocusOpen = useRef(false);
  /* 셸은 라우트 전환에도 살아남는다 — 링크로 이동해도 포인터·포커스가 li 안에 남아
     mouseleave/blur가 안 올 수 있어, 경로가 바뀌면 렌더 중에 닫힌 상태로 리셋한다. */
  const [mega, setMega] = useState({ open: false, pathname });
  if (mega.pathname !== pathname) {
    setMega({ open: false, pathname });
  }
  const megaOpen = mega.open && mega.pathname === pathname;
  const setMegaOpen = (open: boolean) => setMega({ open, pathname });
  const close = () => setMegaOpen(false);

  const onFocusCapture = () => {
    if (!suppressFocusOpen.current) setMegaOpen(true);
  };

  const onBlurCapture = (event: FocusEvent<HTMLLIElement>) => {
    // 포커스가 항목 안에서 옮겨 다니는 동안에는 닫지 않는다.
    if (liRef.current?.contains(event.relatedTarget)) return;
    suppressFocusOpen.current = false;
    setMegaOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    if (event.key === 'Escape') {
      if (!megaOpen) return;
      event.preventDefault();
      suppressFocusOpen.current = true;
      setMegaOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (event.key === 'ArrowDown' && event.target === triggerRef.current) {
      event.preventDefault();
      suppressFocusOpen.current = false;
      setMegaOpen(true);
      /* 패널이 표시된 다음 프레임에 첫 링크로 옮긴다(닫힌 패널은 display:none 이라 바로는 포커스되지 않는다). */
      window.requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>('a[href]')?.focus());
    }
  };

  return (
    <li
      ref={liRef}
      className="wc-gnb__item wc-gnb__item--mega"
      onBlurCapture={onBlurCapture}
      onFocusCapture={onFocusCapture}
      onKeyDown={onKeyDown}
      onMouseEnter={() => {
        suppressFocusOpen.current = false;
        setMegaOpen(true);
      }}
      onMouseLeave={close}
    >
      <Link
        ref={triggerRef}
        aria-controls={panelId}
        aria-current={active ? 'page' : undefined}
        aria-expanded={megaOpen}
        className={`wc-gnb__link${active ? ' is-active' : ''}`}
        href={href}
        title={label}
      >
        <span className="wc-gnb__label">{label}</span>
      </Link>

      <div ref={panelRef} className="wc-mega" data-open={megaOpen ? 'true' : 'false'} id={panelId}>
        {children(close)}
      </div>
    </li>
  );
}

/* 메가 링크의 현재 위치도 GNB와 같은 규칙(activeNavId)으로 하나만 고른다 — '/shop/new'에서 '전체 굿즈'와
   NEW가 함께 켜지지 않고, 굿즈 상세에서는 아무 링크도 켜지 않는다(CH-12). */
function MegaRouteLinks({ items, onNavigate, pathname }: { items: NavItem[]; onNavigate: () => void; pathname: string }) {
  const currentId = activeNavId(pathname, items);
  return (
    <ul className="wc-mega__links">
      {items.map((item) => (
        <li key={item.id}>
          <Link
            aria-current={currentId === item.id ? 'page' : undefined}
            className="wc-mega__link"
            href={hrefFor(item.id)}
            onClick={onNavigate}
          >
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* 공개 전시 트리가 없을 때의 카테고리 메가메뉴 — 실존 라우트 그룹(굿즈샵·수집·거래). */
function CategoryMegaFallback({ groups, onNavigate, pathname }: { groups: NavGroup[]; onNavigate: () => void; pathname: string }) {
  const currentId = activeNavId(pathname, groups.flatMap((group) => group.items));
  return (
    <ul className="wc-container wc-mega__list">
      {groups.map((group) => (
        <li key={group.heading} className="wc-mega__group">
          <p className="wc-mega__heading">{group.heading}</p>
          <ul className="wc-mega__links">
            {group.items.map((item) => (
              <li key={item.id}>
                <Link
                  aria-current={currentId === item.id ? 'page' : undefined}
                  className="wc-mega__link"
                  href={hrefFor(item.id)}
                  onClick={onNavigate}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/* CH-05 — 카테고리 메가메뉴(R-01 §4.1 메가메뉴 A): [굿즈샵 바로가기][기획전] | 세로선 | 공개 전시분류 그룹.
   기획전은 진행 중 캠페인이고(정적 배열 금지 — DESIGN §0) 없으면 칸째 빠진다. 전시분류 그룹 제목은 자기 전시가 있으면 링크다. */
function CategoryMegaCatalog({
  campaigns,
  groups,
  onNavigate,
  pathname,
  shortcuts,
}: {
  campaigns: StorefrontMenuCampaign[];
  groups: CategoryMenuGroup[];
  onNavigate: () => void;
  pathname: string;
  shortcuts: NavGroup | null;
}) {
  return (
    <ul className={`wc-container wc-mega__list wc-mega__list--catalog${campaigns.length ? '' : ' wc-mega__list--compact'}`}>
      {shortcuts ? (
        <li className="wc-mega__group">
          <p className="wc-mega__heading">{shortcuts.heading}</p>
          <MegaRouteLinks items={shortcuts.items} onNavigate={onNavigate} pathname={pathname} />
        </li>
      ) : null}
      {campaigns.length ? (
        <li className="wc-mega__group">
          <p className="wc-mega__heading">기획전</p>
          <ul className="wc-mega__links">
            {campaigns.map((campaign) => (
              <li key={campaign.id}>
                <Link className="wc-mega__link" href={campaignDetailHref(campaign.id)} onClick={onNavigate}>{campaign.title}</Link>
              </li>
            ))}
          </ul>
        </li>
      ) : null}
      <li className="wc-mega__catalog">
        <ul className="wc-mega__catalog-groups">
          {groups.map((group) => (
            <li key={group.id} className="wc-mega__group">
              {group.href
                ? <Link className="wc-mega__heading wc-mega__heading-link" href={group.href} onClick={onNavigate}>{group.name}</Link>
                : <p className="wc-mega__heading">{group.name}</p>}
              {group.items.length ? (
                <ul className="wc-mega__links">
                  {group.items.map((item) => (
                    <li key={item.id}>
                      {item.href
                        ? (
                          <Link className={`wc-mega__link${item.depth > 2 ? ' wc-mega__link--nested' : ''}`} href={item.href} onClick={onNavigate}>
                            {item.name}
                          </Link>
                        )
                        : <span className={`wc-mega__label${item.depth > 2 ? ' wc-mega__link--nested' : ''}`}>{item.name}</span>}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </li>
    </ul>
  );
}

/* CH-07 — 온라인 팝업 메가메뉴(R-01 §4.1 메가메뉴 B·C): 1열 디렉토리 피처드 IP 목록, 4열부터 '전체보기' + 피처드 상위 2개 이미지 타일.
   이미지가 없는 IP 타일은 이름 첫 글자로 선다. */
function OnlinePopupMega({ ips, onNavigate, pathname }: { ips: StorefrontMenuIp[]; onNavigate: () => void; pathname: string }) {
  const directoryHref = hrefFor('iphub');
  return (
    <ul className="wc-container wc-mega__list wc-mega__list--ip">
      <li className="wc-mega__group">
        <p className="wc-mega__heading">추천 IP</p>
        <ul className="wc-mega__links">
          {ips.map((ip) => (
            <li key={ip.id}>
              <Link aria-current={pathname === ip.href ? 'page' : undefined} className="wc-mega__link" href={ip.href} onClick={onNavigate}>{ip.name}</Link>
            </li>
          ))}
        </ul>
      </li>
      <li className="wc-mega__group wc-mega__group--tiles">
        <Link
          aria-current={pathname === directoryHref ? 'page' : undefined}
          aria-label="온라인 팝업 전체보기"
          className="wc-mega__heading wc-mega__heading-link"
          href={directoryHref}
          onClick={onNavigate}
        >
          전체보기
        </Link>
        <ul className="wc-mega__tiles">
          {ips.slice(0, MEGA_MENU_IP_TILE_COUNT).map((ip) => (
            <li key={ip.id}>
              <Link className="wc-mega__tile" href={ip.href} onClick={onNavigate}>
                <span
                  aria-hidden
                  className={`wc-mega__tile-image${ip.imageBg ? '' : ' wc-mega__tile-image--text'}`}
                  style={ip.imageBg ? { background: ip.imageBg } : undefined}
                >
                  {ip.imageBg ? null : menuMonogram(ip.name)}
                </span>
                <span className="wc-mega__tile-name">{ip.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </li>
    </ul>
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

/* 회원 전용 유틸 링크(위시리스트). 유틸바는 오른쪽 정렬이라 맨 앞(왼쪽)에 두면 presence가 확정되며 나타나도
   주문조회·알림함·로그아웃 자리는 움직이지 않는다. 미확정·비회원에게는 그리지 않는다. */
function UtilMemberLinks() {
  const presence = useAuthPresence();
  if (presence !== 'signed-in') return null;
  return MEMBER_UTIL_ITEMS.map((item) => (
    <Link key={item.id} className="wc-utilbar__link" href={hrefFor(item.id)}>
      {item.label}
    </Link>
  ));
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
