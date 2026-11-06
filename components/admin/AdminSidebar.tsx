'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useMemo, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from 'react';
import { ArrowLeft, ChevronRight, Search, Star, X } from 'lucide-react';
import { MANAGER_ROLE_LABELS, type OperatorAccess } from '@/lib/admin/access';
import {
  adminGroupForPath,
  adminScreenForPath,
  visibleAdminNavGroups,
  type AdminConsoleId,
  type AdminNavGroup,
  type AdminScreen,
} from '@/lib/admin/navigation';
import {
  adminNavigationStorageKey,
  DEFAULT_ADMIN_NAVIGATION_PREFERENCES,
  legacyAdminNavigationStorageKey,
  migrateLegacyAdminNavigationPreferences,
  parseAdminNavigationPreferences,
  serializeAdminNavigationPreferences,
  type AdminNavigationPreferences,
} from '@/lib/admin/navigation-preferences';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from '@/components/admin/kit/ui/sidebar';
import { adminNavGroupIcon } from './admin-nav-icons';

/*
 * 어드민 사이드바 — kit Sidebar(shadcn/ui, ADR-0028). 메뉴 정의·권한 판정·즐겨찾기와 그룹 접힘 저장(계정별
 * localStorage)은 그대로이고, 룩과 접힘·모바일 시트는 kit이 맡는다. 데스크톱은 아이콘 막대로 접히고(헤더의
 * 사이드바 버튼·가장자리 레일·⌘/Ctrl+B), 768px 아래에서는 시트로 열린다.
 */

export const ADMIN_NAVIGATION_ID = 'admin-navigation';

function isScreenActive(screen: AdminScreen, pathname: string): boolean {
  return adminScreenForPath(pathname)?.id === screen.id;
}

function useAdminNavigationPreferences(
  accountId: string,
  defaults: AdminNavigationPreferences = DEFAULT_ADMIN_NAVIGATION_PREFERENCES,
) {
  const storageKey = adminNavigationStorageKey(accountId);
  const legacyStorageKey = legacyAdminNavigationStorageKey(accountId);
  const readSnapshot = useCallback(() => {
    try {
      const current = window.localStorage.getItem(storageKey);
      if (current) return current;
      // v2(IA 재정의 전) 즐겨찾기를 이어받는다. 첫 변경 때 v3에 저장된다.
      const migrated = migrateLegacyAdminNavigationPreferences(window.localStorage.getItem(legacyStorageKey), defaults);
      return migrated ? serializeAdminNavigationPreferences(migrated) : '';
    } catch {
      // Private browsing and blocked storage keep the default in-memory state.
      return '';
    }
  }, [defaults, legacyStorageKey, storageKey]);
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

/** 메뉴 링크. 모바일 시트에서는 이동과 함께 시트를 닫는다. */
function NavLink({ onClick, ...props }: ComponentProps<typeof Link>) {
  const { isMobile, setOpenMobile } = useSidebar();
  return <Link {...props} onClick={(event) => { onClick?.(event); if (isMobile) setOpenMobile(false); }} />;
}

/** 그룹 펼치기 버튼. 아이콘 막대로 접힌 상태에서 누르면 사이드바를 펼치고 그 그룹을 연다. */
function GroupToggle({ children, expanded, label, onClick, ...props }: ComponentProps<'button'> & { expanded: boolean; label: string; onClick: () => void }) {
  const { isMobile, setOpen, state } = useSidebar();
  return (
    <SidebarMenuButton
      {...props}
      aria-expanded={expanded}
      onClick={() => {
        if (state === 'collapsed' && !isMobile) {
          setOpen(true);
          if (!expanded) onClick();
          return;
        }
        onClick();
      }}
      tooltip={label}
      type="button"
    >
      {children}
    </SidebarMenuButton>
  );
}

function FavoriteToggle({ favorite, label, onToggle, screenId, className }: {
  favorite: boolean;
  label: string;
  onToggle: () => void;
  screenId: string;
  className: string;
}) {
  return (
    <button
      aria-label={favorite ? `${label} 즐겨찾기 해제` : `${label} 즐겨찾기 추가`}
      aria-pressed={favorite}
      className={className}
      data-admin-nav-favorite={screenId}
      onClick={onToggle}
      title={favorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
      type="button"
    >
      <Star className={favorite ? 'fill-current' : undefined} />
    </button>
  );
}

const SUB_FAVORITE_CLASS = 'absolute top-1 right-1 flex size-5 items-center justify-center rounded-md text-sidebar-foreground/60 opacity-0 outline-hidden ring-sidebar-ring transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:opacity-100 focus-visible:ring-2 group-focus-within/menu-sub-item:opacity-100 group-hover/menu-sub-item:opacity-100 aria-pressed:text-sidebar-foreground aria-pressed:opacity-100 max-md:opacity-100 [&>svg]:size-3.5';

/** 맨 위 항목(홈·즐겨찾기 사본·사이트로 돌아가기)처럼 그룹 없이 바로 서는 메뉴 한 줄. */
function TopLevelItem({ active, favorite, favoriteCopy = false, group, onToggleFavorite, screen }: {
  active: boolean;
  favorite: boolean;
  favoriteCopy?: boolean;
  group: AdminNavGroup;
  onToggleFavorite: (screenId: string) => void;
  screen: AdminScreen;
}) {
  const Icon = favoriteCopy ? Star : adminNavGroupIcon(group.id);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active && !favoriteCopy}
        render={<NavLink
          aria-current={!favoriteCopy && active ? 'page' : undefined}
          aria-label={screen.label}
          data-admin-nav-screen={screen.id}
          href={screen.href}
        />}
        tooltip={screen.label}
      >
        <Icon />
        <span>{screen.label}</span>
      </SidebarMenuButton>
      <SidebarMenuAction
        aria-label={favorite ? `${screen.label} 즐겨찾기 해제` : `${screen.label} 즐겨찾기 추가`}
        aria-pressed={favorite}
        data-admin-nav-favorite={screen.id}
        onClick={() => onToggleFavorite(screen.id)}
        showOnHover={!favorite}
        title={favorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
        type="button"
      >
        <Star className={favorite ? 'fill-current' : undefined} />
      </SidebarMenuAction>
    </SidebarMenuItem>
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
  currentPath,
  role,
  operatorAccess,
  console: consoleId = 'commerce',
  homeHref = '/admin',
}: {
  /** 현재 콘솔. 사이드바는 이 콘솔의 메뉴만 보여 주고, 즐겨찾기는 콘솔을 가리지 않는다. */
  console?: AdminConsoleId;
  homeHref?: string;
  /** 계정별 로컬 메뉴 설정의 경계. 인증되지 않은 테스트·초기 셸은 role로 대체한다. */
  accountId?: string;
  currentPath?: string;
  role: string;
  operatorAccess?: OperatorAccess;
}) {
  const basePathname = usePathname();
  const pathname = currentPath ?? basePathname;
  const groups = useMemo(() => visibleAdminNavGroups(role, operatorAccess, consoleId), [role, operatorAccess, consoleId]);
  const allGroups = useMemo(() => visibleAdminNavGroups(role, operatorAccess), [role, operatorAccess]);
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLocaleLowerCase('ko-KR');
  const activeScreen = adminScreenForPath(pathname);
  const activeGroup = adminGroupForPath(pathname);
  /* 접힘 설정은 콘솔을 가리지 않고 계정마다 하나다. 처음 메뉴를 만질 때 기본값이 저장되므로, 현재 콘솔 그룹만으로 만들면
     다른 콘솔의 그룹이 저장 목록에 빠져 전부 펼쳐진다 — 볼 수 있는 모든 콘솔의 그룹으로 기본 접힘을 만든다. */
  const defaultCollapsedGroupIds = useMemo(
    () => allGroups
      .map((group) => group.id)
      .filter((groupId) => groupId !== 'home' && groupId !== activeGroup?.id),
    [activeGroup?.id, allGroups],
  );
  const navigationDefaults = useMemo<AdminNavigationPreferences>(
    () => ({ favoriteScreenIds: [], collapsedGroupIds: defaultCollapsedGroupIds }),
    [defaultCollapsedGroupIds],
  );
  const { preferences, update } = useAdminNavigationPreferences(accountId || role, navigationDefaults);

  const visibleGroups = useMemo(
    () => groups
      .filter((group) => groupMatches(group, normalizedQuery))
      .map((group) => ({ ...group, screens: screensForQuery(group, normalizedQuery) })),
    [groups, normalizedQuery],
  );
  const favoriteIds = new Set(preferences.favoriteScreenIds);
  const favoriteItems = allGroups.flatMap((group) => group.screens
    .filter((screen) => screen.status === 'ready' && favoriteIds.has(screen.id))
    .map((screen) => ({ group, screen })));
  const homeGroup = groups.find((group) => group.id === 'home');
  const roleCaption = operatorAccess?.managerRole ? MANAGER_ROLE_LABELS[operatorAccess.managerRole] : role === 'admin' ? '관리자' : '스토어 매니저';

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

  let groupList: ReactNode = null;
  if (visibleGroups.some((group) => group.id !== 'home')) {
    groupList = (
      <SidebarGroup>
        <SidebarGroupLabel>{consoleId === 'content' ? '콘텐츠 운영' : '판매자센터'}</SidebarGroupLabel>
        <SidebarMenu>
          {visibleGroups.map((group) => {
            if (group.id === 'home') return null;
            const isExpanded = normalizedQuery.length > 0
              || activeGroup?.id === group.id
              || !preferences.collapsedGroupIds.includes(group.id);
            const groupPanelId = `admin-nav-group-${group.id}`;
            const GroupIcon = adminNavGroupIcon(group.id);
            return (
              <SidebarMenuItem data-admin-nav-group={group.id} data-state={isExpanded ? 'open' : 'closed'} key={group.id}>
                <GroupToggle aria-controls={groupPanelId} expanded={isExpanded} label={group.label} onClick={() => toggleGroup(group.id)}>
                  <GroupIcon />
                  <span>{group.label}</span>
                  <ChevronRight aria-hidden="true" className={`ml-auto transition-transform duration-200${isExpanded ? ' rotate-90' : ''}`} />
                </GroupToggle>
                <SidebarMenuSub hidden={!isExpanded} id={groupPanelId}>
                  {group.screens.map((screen) => {
                    const active = isScreenActive(screen, pathname);
                    const favorite = favoriteIds.has(screen.id);
                    if (screen.status === 'planned') {
                      return (
                        <SidebarMenuSubItem key={screen.id}>
                          <SidebarMenuSubButton aria-disabled="true" render={<span title={`${screen.label} — 준비 중`} />}>
                            <span>{`${screen.label} · 준비 중`}</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      );
                    }
                    return (
                      <SidebarMenuSubItem key={screen.id}>
                        <SidebarMenuSubButton
                          className="pr-7"
                          isActive={active}
                          render={<NavLink
                            aria-current={active ? 'page' : undefined}
                            aria-label={screen.label}
                            data-admin-nav-screen={screen.id}
                            href={screen.href}
                            title={screen.label}
                          />}
                        >
                          <span>{screen.label}</span>
                        </SidebarMenuSubButton>
                        <FavoriteToggle
                          className={SUB_FAVORITE_CLASS}
                          favorite={favorite}
                          label={screen.label}
                          onToggle={() => toggleFavorite(screen.id)}
                          screenId={screen.id}
                        />
                      </SidebarMenuSubItem>
                    );
                  })}
                </SidebarMenuSub>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroup>
    );
  }

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<NavLink aria-label={consoleId === 'content' ? 'ICONS 콘텐츠 운영 홈' : 'ICONS 판매자센터 홈'} href={homeHref} />}
              size="lg"
            >
              <span aria-hidden="true" className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-[10px] font-bold tracking-tight text-sidebar-primary-foreground">ICONS</span>
              <span className="grid flex-1 text-left leading-tight">
                <span className="truncate font-semibold">{consoleId === 'content' ? 'ICONS 콘텐츠 운영' : 'ICONS 판매자센터'}</span>
                <span className="truncate text-xs text-sidebar-foreground/70">{roleCaption}</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <label className="relative group-data-[collapsible=icon]:hidden">
          <span className="sr-only">어드민 메뉴 검색</span>
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-sidebar-foreground/50" />
          <SidebarInput
            aria-label="어드민 메뉴 검색"
            className="pr-7 pl-8"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="메뉴 검색"
            type="search"
            value={query}
          />
          {query ? (
            <button
              aria-label="메뉴 검색어 지우기"
              className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-sidebar-foreground/60 hover:text-sidebar-foreground [&>svg]:size-3.5"
              onClick={() => setQuery('')}
              type="button"
            >
              <X aria-hidden="true" />
            </button>
          ) : null}
        </label>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label={consoleId === 'content' ? '콘텐츠 운영 메뉴' : '관리자 메뉴'} className="flex min-w-0 flex-col" id={ADMIN_NAVIGATION_ID}>
          <p className="sr-only" aria-live="polite">현재 위치 · {activeGroup?.label ?? '어드민'}{activeScreen ? ` / ${activeScreen.label}` : ''}</p>
          {homeGroup ? (
            <SidebarGroup className="pb-0">
              <SidebarMenu>
                {homeGroup.screens.map((screen) => (
                  <TopLevelItem
                    active={isScreenActive(screen, pathname)}
                    favorite={favoriteIds.has(screen.id)}
                    group={homeGroup}
                    key={screen.id}
                    onToggleFavorite={toggleFavorite}
                    screen={screen}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroup>
          ) : null}
          {favoriteItems.length ? (
            <SidebarGroup className="pb-0" data-admin-nav-group="favorites">
              <SidebarGroupLabel>즐겨찾기</SidebarGroupLabel>
              <SidebarMenu>
                {favoriteItems.map(({ group, screen }) => (
                  <TopLevelItem
                    active={isScreenActive(screen, pathname)}
                    favorite
                    favoriteCopy
                    group={group}
                    key={`favorite-${screen.id}`}
                    onToggleFavorite={toggleFavorite}
                    screen={screen}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroup>
          ) : null}
          {groupList}
          {!visibleGroups.length ? <p className="px-4 py-2 text-sm text-muted-foreground" role="status">검색 결과가 없습니다.</p> : null}
        </nav>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton render={<NavLink aria-label="사이트로 돌아가기" href="/" />} tooltip="사이트로 돌아가기">
              <ArrowLeft />
              <span>사이트로 돌아가기</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
