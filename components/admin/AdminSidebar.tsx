'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from '@/components/ui/Icon';
import {
  adminGroupForPath,
  adminScreenForPath,
  visibleAdminNavGroups,
  type AdminNavGroup,
  type AdminScreen,
} from '@/lib/admin/navigation';
import {
  adminNavigationStorageKey,
  DEFAULT_ADMIN_NAVIGATION_PREFERENCES,
  parseAdminNavigationPreferences,
  serializeAdminNavigationPreferences,
  type AdminNavigationPreferences,
} from '@/lib/admin/navigation-preferences';

const MOBILE_DRAWER_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function isScreenActive(screen: AdminScreen, pathname: string): boolean {
  if (screen.href === '/admin') return pathname === '/admin';
  return pathname === screen.href || pathname.startsWith(`${screen.href}/`);
}

function useAdminNavigationPreferences(
  accountId: string,
  defaults: AdminNavigationPreferences = DEFAULT_ADMIN_NAVIGATION_PREFERENCES,
) {
  const storageKey = adminNavigationStorageKey(accountId);
  const readSnapshot = useCallback(() => {
    try {
      return window.localStorage.getItem(storageKey) ?? '';
    } catch {
      // Private browsing and blocked storage keep the default in-memory state.
      return '';
    }
  }, [storageKey]);
  const subscribe = useCallback((onStoreChange: () => void) => {
    if (typeof window === 'undefined') return () => {};
    const eventName = 'icons-admin-navigation-change';
    window.addEventListener('storage', onStoreChange);
    window.addEventListener(eventName, onStoreChange);
    return () => {
      window.removeEventListener('storage', onStoreChange);
      window.removeEventListener(eventName, onStoreChange);
    };
  }, []);
  const snapshot = useSyncExternalStore(subscribe, readSnapshot, () => '');
  const preferences = useMemo(
    () => snapshot ? parseAdminNavigationPreferences(snapshot) : defaults,
    [defaults, snapshot],
  );

  const update = useCallback((next: (current: AdminNavigationPreferences) => AdminNavigationPreferences) => {
    const current = parseAdminNavigationPreferences(readSnapshot() || serializeAdminNavigationPreferences(defaults));
    const updated = next(current);
    try {
      window.localStorage.setItem(storageKey, serializeAdminNavigationPreferences(updated));
      window.dispatchEvent(new Event('icons-admin-navigation-change'));
    } catch {
      // The UI remains usable when local storage is unavailable or full.
    }
  }, [defaults, readSnapshot, storageKey]);

  return { preferences: preferences ?? DEFAULT_ADMIN_NAVIGATION_PREFERENCES, update };
}

function AdminNavItem({
  group,
  screen,
  pathname,
  favorite,
  favoriteCopy = false,
  onToggleFavorite,
  onNavigate,
}: {
  group: AdminNavGroup;
  screen: AdminScreen;
  pathname: string;
  favorite: boolean;
  favoriteCopy?: boolean;
  onToggleFavorite: (screenId: string) => void;
  onNavigate?: () => void;
}) {
  const active = isScreenActive(screen, pathname);
  const label = screen.status === 'planned' ? `${screen.label} · 준비 중` : screen.label;

  if (screen.status === 'planned') {
    return (
      <span
        aria-disabled="true"
        className="wc-admin__nav-item wc-admin__nav-item-planned"
        title={`${screen.label} — 준비 중`}
      >
        <Icon name={group.icon} size={18} />
        <span className="wc-admin__nav-label">{label}</span>
      </span>
    );
  }

  return (
    <div className={active ? 'admin-nav-item-row admin-nav-item-row-current' : 'admin-nav-item-row'}>
      <Link
        aria-current={!favoriteCopy && active ? 'page' : undefined}
        aria-label={screen.label}
        className={active ? 'wc-admin__nav-item on' : 'wc-admin__nav-item'}
        data-admin-nav-screen={screen.id}
        href={screen.href}
        onClick={onNavigate}
        title={screen.label}
      >
        <Icon name={group.icon} size={18} />
        <span className="wc-admin__nav-label">{screen.label}</span>
      </Link>
      <button
        aria-label={favorite ? `${screen.label} 즐겨찾기 해제` : `${screen.label} 즐겨찾기 추가`}
        aria-pressed={favorite}
        className={favorite ? 'admin-nav-favorite on' : 'admin-nav-favorite'}
        data-admin-nav-favorite={screen.id}
        onClick={() => onToggleFavorite(screen.id)}
        title={favorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
        type="button"
      >
        <Icon name="star" size={15} fill={favorite ? true : undefined} />
      </button>
    </div>
  );
}

function groupMatches(group: AdminNavGroup, query: string) {
  if (!query) return true;
  return group.label.toLocaleLowerCase('ko-KR').includes(query)
    || group.screens.some((screen) => screen.label.toLocaleLowerCase('ko-KR').includes(query));
}

function screensForQuery(group: AdminNavGroup, query: string) {
  if (!query || group.label.toLocaleLowerCase('ko-KR').includes(query)) return group.screens;
  return group.screens.filter((screen) => screen.label.toLocaleLowerCase('ko-KR').includes(query));
}

export function AdminSidebar({
  accountId,
  collapsed,
  onCollapsedChange,
  role,
}: {
  /** 계정별 로컬 메뉴 설정의 경계. 인증되지 않은 테스트·초기 셸은 role로 대체한다. */
  accountId?: string;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  role: string;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileSearchRef = useRef<HTMLInputElement>(null);
  const mobileDrawerRef = useRef<HTMLElement>(null);
  const wasMobileOpen = useRef(false);
  const groups = useMemo(() => visibleAdminNavGroups(role), [role]);
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLocaleLowerCase('ko-KR');
  const activeScreen = adminScreenForPath(pathname);
  const activeGroup = adminGroupForPath(pathname);
  const defaultCollapsedGroupIds = useMemo(
    () => groups
      .map((group) => group.id)
      .filter((groupId) => groupId !== 'home' && groupId !== activeGroup?.id),
    [activeGroup?.id, groups],
  );
  const navigationDefaults = useMemo<AdminNavigationPreferences>(
    () => ({ favoriteScreenIds: [], collapsedGroupIds: defaultCollapsedGroupIds }),
    [defaultCollapsedGroupIds],
  );
  const { preferences, update } = useAdminNavigationPreferences(accountId || role, navigationDefaults);

  useEffect(() => {
    if (mobileOpen) {
      mobileSearchRef.current?.focus();
    } else if (wasMobileOpen.current) {
      mobileTriggerRef.current?.focus();
    }
    wasMobileOpen.current = mobileOpen;
  }, [mobileOpen]);

  useEffect(() => {
    const narrowScreen = window.matchMedia('(max-width: 900px)');
    const leaveNarrowScreen = (event: MediaQueryListEvent) => {
      if (!event.matches) { setMobileOpen(false); setQuery(''); }
    };
    narrowScreen.addEventListener('change', leaveNarrowScreen);
    return () => narrowScreen.removeEventListener('change', leaveNarrowScreen);
  }, []);

  const visibleGroups = useMemo(
    () => groups
      .filter((group) => groupMatches(group, normalizedQuery))
      .map((group) => ({ ...group, screens: screensForQuery(group, normalizedQuery) })),
    [groups, normalizedQuery],
  );
  const favoriteIds = new Set(preferences.favoriteScreenIds);
  const favoriteItems = groups.flatMap((group) => group.screens
    .filter((screen) => screen.status === 'ready' && favoriteIds.has(screen.id))
    .map((screen) => ({ group, screen })));

  function toggleFavorite(screenId: string) {
    update((current) => ({
      ...current,
      favoriteScreenIds: current.favoriteScreenIds.includes(screenId)
        ? current.favoriteScreenIds.filter((id) => id !== screenId)
        : [...current.favoriteScreenIds, screenId],
    }));
  }

  function toggleGroup(groupId: string) {
    // 현재 화면을 숨기면 위치·세부 메뉴를 잃으므로 현재 그룹은 항상 열린다.
    if (activeGroup?.id === groupId) return;
    update((current) => ({
      ...current,
      collapsedGroupIds: current.collapsedGroupIds.includes(groupId)
        ? current.collapsedGroupIds.filter((id) => id !== groupId)
        : [...current.collapsedGroupIds, groupId],
    }));
  }

  const handleMobileKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (!mobileOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setMobileOpen(false);
      setQuery('');
      return;
    }
    if (event.key !== 'Tab' || !mobileDrawerRef.current) return;
    const focusable = Array.from(
      mobileDrawerRef.current.querySelectorAll<HTMLElement>(MOBILE_DRAWER_FOCUSABLE_SELECTOR),
    ).filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const activeElement = document.activeElement;
    if (event.shiftKey && (activeElement === first || !mobileDrawerRef.current.contains(activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (activeElement === last || !mobileDrawerRef.current.contains(activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }, [mobileOpen]);

  const handleMobileClose = useCallback(() => {
    setMobileOpen(false);
    setQuery('');
  }, []);

  return (
    <>
      {mobileOpen ? (
        <button
          aria-label="메뉴 닫기"
          className="admin-mobile-nav-scrim"
          onClick={handleMobileClose}
          type="button"
        />
      ) : null}
    <aside
      aria-label={mobileOpen ? '어드민 메뉴' : undefined}
      aria-modal={mobileOpen ? true : undefined}
      className={mobileOpen ? 'wc-admin__sidebar admin-mobile-open' : 'wc-admin__sidebar'}
      onKeyDown={handleMobileKeyDown}
      ref={mobileDrawerRef}
      role={mobileOpen ? 'dialog' : undefined}
    >
      <button
        aria-controls="admin-mobile-navigation"
        aria-expanded={mobileOpen}
        aria-label={mobileOpen ? '메뉴 닫기' : '메뉴 열기'}
        className="admin-mobile-nav-trigger"
        onClick={() => (mobileOpen ? handleMobileClose() : setMobileOpen(true))}
        ref={mobileTriggerRef}
        type="button"
      >
        <span aria-hidden="true" className="admin-mobile-nav-trigger__line" />
        <span aria-hidden="true" className="admin-mobile-nav-trigger__line" />
        <span aria-hidden="true" className="admin-mobile-nav-trigger__line" />
      </button>
      <Link aria-label="ICONS Admin 홈" className="wc-admin__brand" href="/admin">
        <span className="wc-admin__brand-dot" />
        <span className="wc-admin__nav-label">
          ICONS <span className="wc-admin__brand-caption">Admin</span>
        </span>
      </Link>
      <nav aria-label="관리자 메뉴" className="wc-admin__nav" id="admin-mobile-navigation">
        <div className="admin-nav-tools">
          <label className="admin-nav-search">
            <Icon name="search" size={17} />
            <span className="sr-only">어드민 메뉴 검색</span>
            <input
              aria-label="어드민 메뉴 검색"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="메뉴 검색"
              ref={mobileSearchRef}
              type="search"
              value={query}
            />
            {query ? (
              <button aria-label="메뉴 검색어 지우기" onClick={() => setQuery('')} type="button">×</button>
            ) : null}
          </label>
          <p className="admin-nav-current" aria-live="polite">
            현재 위치 · {activeGroup?.label ?? '어드민'}{activeScreen ? ` / ${activeScreen.label}` : ''}
          </p>
        </div>

        {favoriteItems.length ? (
          <div className="wc-admin__nav-group admin-nav-favorites" data-admin-nav-group="favorites">
            <p className="wc-admin__nav-group-label">즐겨찾기</p>
            {favoriteItems.map(({ group, screen }) => (
              <AdminNavItem
                favorite
                favoriteCopy
                group={group}
                key={`favorite-${screen.id}`}
                onToggleFavorite={toggleFavorite}
                onNavigate={handleMobileClose}
                pathname={pathname}
                screen={screen}
              />
            ))}
          </div>
        ) : null}

        {visibleGroups.map((group) => {
          const isExpanded = group.id === 'home'
            || collapsed
            || normalizedQuery.length > 0
            || activeGroup?.id === group.id
            || !preferences.collapsedGroupIds.includes(group.id);
          const groupPanelId = `admin-nav-group-${group.id}`;
          return (
            <div
              className={isExpanded ? 'wc-admin__nav-group on' : 'wc-admin__nav-group'}
              data-admin-nav-group={group.id}
              key={group.id}
            >
              <button
                aria-controls={groupPanelId}
                aria-expanded={isExpanded}
                className="wc-admin__nav-group-label admin-nav-group-toggle"
                onClick={() => toggleGroup(group.id)}
                type="button"
              >
                <span>{group.label}</span>
                <span aria-hidden="true">{isExpanded ? '−' : '+'}</span>
              </button>
              <div hidden={!isExpanded} id={groupPanelId}>
                {group.screens.map((screen) => (
                  <AdminNavItem
                    favorite={favoriteIds.has(screen.id)}
                    group={group}
                    key={screen.id}
                    onToggleFavorite={toggleFavorite}
                    onNavigate={handleMobileClose}
                    pathname={pathname}
                    screen={screen}
                  />
                ))}
              </div>
            </div>
          );
        })}
        {!visibleGroups.length ? <p className="admin-nav-empty" role="status">검색 결과가 없습니다.</p> : null}
      </nav>
      <div className="wc-admin__sidebar-foot">
        <Link aria-label="사이트로 돌아가기" className="wc-admin__nav-item" href="/" title="사이트로 돌아가기">
          <Icon name="arrow" size={18} style={{ transform: 'rotate(180deg)' }} />
          <span className="wc-admin__nav-label">사이트로 돌아가기</span>
        </Link>
        <button
          aria-expanded={!collapsed}
          aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'}
          className="wc-admin__nav-item wc-admin__collapse-btn"
          onClick={() => onCollapsedChange(!collapsed)}
          title={collapsed ? '펼치기' : '접기'}
          type="button"
        >
          <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} size={18} />
          <span className="wc-admin__nav-label">접기</span>
        </button>
      </div>
    </aside>
    </>
  );
}
