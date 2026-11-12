'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentProps, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowLeft, ChevronRight, Search, Star, X } from 'lucide-react';
import { MANAGER_ROLE_LABELS, type OperatorAccess } from '@/lib/admin/access';
import {
  ADMIN_CONSOLES,
  adminGroupForPath,
  adminScreenForPath,
  visibleAdminNavGroups,
  type AdminConsoleId,
  type AdminNavGroup,
  type AdminScreen,
} from '@/lib/admin/navigation';
import {
  adminMenuFollowEnabled,
  adminMenuQuery,
  adminMenuUserScrolling,
  createAdminNavigationStore,
  filterAdminNavGroups,
  followAdminMenuItem,
  withGroupOpen,
  withGroupsClosed,
  type SavedAdminNavigation,
} from '@/lib/admin/navigation-preferences';
import { Button } from '@/components/admin/kit/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/admin/kit/ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/admin/kit/ui/popover';
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
import { AdminNavGroupIcon } from './admin-nav-icons';
import { useAdminNavigationPendingPath } from './console/AdminNavigationPending';

/*
 * 어드민 사이드바 — kit Sidebar(shadcn/ui, ADR-0028). 메뉴 정의·권한 판정은 그대로이고, 룩과 접힘·모바일 시트는 kit이 맡는다.
 * 데스크톱은 아이콘 막대로 접히고(헤더의 사이드바 버튼·가장자리 레일·⌘/Ctrl+B), 768px 아래에서는 시트로 열린다.
 *
 * 그룹 접힘 규칙 한 줄: 자동으로는 열기만 하고, 닫기는 사용자만 한다. 열린 그룹·즐겨찾기·마지막 현재 그룹은 계정별 쿠키에 있어
 * 서버가 첫 HTML부터 같은 모양으로 그린다. 다른 그룹에서 왔을 때만 현재 그룹을 연다(lib/admin/navigation-preferences).
 */

export const ADMIN_NAVIGATION_ID = 'admin-navigation';

function isScreenActive(screen: AdminScreen, pathname: string): boolean {
  return adminScreenForPath(pathname)?.id === screen.id;
}

/*
 * 메뉴 키보드(ADM-016 #1·#16). 메뉴 링크는 Tab 정지 하나씩이고, 즐겨찾기 별은 Tab 순서에서 빼 대신 방향키로 닿는다:
 * 검색 상자에서 ↓ = 첫 메뉴, 메뉴 위에서 ↑↓ = 이전·다음 메뉴(첫 메뉴에서 ↑ = 검색 상자), → = 그 메뉴의 즐겨찾기 별, 별에서 ← 또는 Esc = 메뉴로.
 * 보이는 링크만 고른다 — 접힌 그룹의 링크는 hidden이라 클라이언트 사각형이 없다.
 */
function visibleMenuLinks(root: ParentNode, matchesOnly = false): HTMLElement[] {
  const selector = matchesOnly ? '[data-admin-nav-group]:not([data-admin-nav-group="favorites"]) a[data-admin-nav-screen]' : 'a[data-admin-nav-screen]';
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((link) => link.getClientRects().length > 0);
}

function focusMenuItem(element: HTMLElement | null | undefined, event: KeyboardEvent): boolean {
  if (!element) return false;
  event.preventDefault();
  element.focus();
  return true;
}

function handleMenuKeyDown(event: KeyboardEvent<HTMLElement>, searchInput: HTMLInputElement | null) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const target = event.target as HTMLElement;
  const link = target.closest<HTMLElement>('a[data-admin-nav-screen]');
  const star = target.closest<HTMLElement>('button[data-admin-nav-favorite]');
  const row = (link ?? star)?.closest('li');
  const owner = link ?? row?.querySelector<HTMLElement>('a[data-admin-nav-screen]') ?? null;
  if (!owner) return;
  const links = visibleMenuLinks(event.currentTarget);
  const index = links.indexOf(owner);
  if (event.key === 'ArrowDown') focusMenuItem(links[index + 1], event);
  else if (event.key === 'ArrowUp') focusMenuItem(links[index - 1] ?? (searchInput && searchInput.getClientRects().length > 0 ? searchInput : null), event);
  else if (link && event.key === 'ArrowRight') focusMenuItem(row?.querySelector<HTMLElement>('button[data-admin-nav-favorite]'), event);
  else if (star && (event.key === 'ArrowLeft' || event.key === 'Escape')) focusMenuItem(owner, event);
}

function useAdminNavigationStore(accountId: string, saved: SavedAdminNavigation | null | undefined, currentGroupId: string | null) {
  const [store] = useState(() => createAdminNavigationStore({ accountId, saved, currentGroupId }));
  const preferences = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => store.connect(), [store]);
  useEffect(() => { store.setCurrentGroup(currentGroupId); }, [store, currentGroupId]);
  return { preferences, toggleFavorite: store.toggleFavorite, update: store.update };
}

/* 현재 항목. 접혀 있어 보이지 않으면 활성 표시가 붙은 그룹 머리글이다. */
function currentMenuItem(scroller: HTMLElement) {
  const link = scroller.querySelector<HTMLElement>('[aria-current="page"]');
  if (link && link.getClientRects().length > 0) return link;
  return scroller.querySelector<HTMLElement>('[data-admin-nav-group] > [data-active]');
}

function menuStickyOffset(scroller: HTMLElement) {
  return scroller.querySelector('[data-admin-nav-sticky-label]')?.getBoundingClientRect().height ?? 0;
}

/**
 * 메뉴 스크롤 영역 안에서 현재 항목(또는 방금 펼친 그룹)이 보이게 맞춘다. 사이드바는 새로고침하면 맨 위로 돌아가고, 메뉴 밖 링크로 접혀 있던
 * 그룹의 화면에 가면 그 줄이 화면 밖에 있기 때문이다. 애니메이션 없이 필요한 만큼만 움직이고, 사용자가 메뉴를 만지는 중이면 그대로 둔다.
 */
function useAdminMenuScroll(screenId: string | undefined, enabled: boolean) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const lastUserScrollAt = useRef(Number.NEGATIVE_INFINITY);
  const lastOutsidePressAt = useRef(Number.NEGATIVE_INFINITY);
  const stopFollowing = useRef<(() => void) | null>(null);

  const follow = useCallback((item: (scroller: HTMLElement) => HTMLElement | null) => {
    stopFollowing.current?.();
    const startedAt = Date.now();
    stopFollowing.current = followAdminMenuItem<HTMLElement>({
      scroller: () => scrollerRef.current,
      item,
      stickyOffset: menuStickyOffset,
      interrupted: () => lastUserScrollAt.current > startedAt,
    });
  }, []);

  useEffect(() => {
    if (!enabled) {
      stopFollowing.current?.();
      return;
    }
    if (!adminMenuUserScrolling(lastUserScrollAt.current, Date.now(), lastOutsidePressAt.current)) follow(currentMenuItem);
  }, [enabled, follow, screenId]);

  useEffect(() => {
    const notePress = (event: MouseEvent) => {
      if (!scrollerRef.current?.contains(event.target as Node)) lastOutsidePressAt.current = Date.now();
    };
    document.addEventListener('click', notePress, true);
    return () => {
      document.removeEventListener('click', notePress, true);
      stopFollowing.current?.();
    };
  }, []);

  /* 사용자가 펼친 그룹은 전개되는 동안 그 내용이 보이게 따라간다. 머리글은 위로 밀려 사라지지 않는다. */
  const revealGroup = useCallback((groupId: string) => {
    follow((scroller) => scroller.querySelector<HTMLElement>(`[data-admin-nav-group="${groupId}"]`));
  }, [follow]);

  const markUserScroll = () => { lastUserScrollAt.current = Date.now(); };
  return {
    revealGroup,
    scrollerProps: {
      ref: scrollerRef,
      onWheel: markUserScroll,
      onTouchMove: markUserScroll,
      /* 스크롤바를 잡을 때는 스크롤 영역 자신이 대상이 된다. 메뉴 항목을 누른 것은 사용자 스크롤이 아니다. */
      onPointerDown: (event: { target: EventTarget; currentTarget: EventTarget }) => { if (event.target === event.currentTarget) markUserScroll(); },
    },
  };
}

/** 메뉴 링크. 메뉴는 화면마다 수십 개라 프리페치하지 않는다(각 요청이 권한 조회를 돈다). 모바일 시트에서는 이동과 함께 시트를 닫는다. */
function NavLink({ onClick, ...props }: ComponentProps<typeof Link>) {
  const { isMobile, setOpenMobile } = useSidebar();
  return <Link prefetch={false} {...props} onClick={(event) => { onClick?.(event); if (isMobile) setOpenMobile(false); }} />;
}

/* 열기 200ms·닫기 150ms(화살표도 같은 값). 서버에서 열린 패널은 Base UI가 첫 전환을 건너뛰고, reduced-motion은 전역 규칙이 멈춘다. */
const GROUP_PANEL_CLASS = 'h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-[cubic-bezier(0,0,.38,.9)] data-[ending-style]:h-0 data-[ending-style]:duration-150 data-[ending-style]:ease-[cubic-bezier(.2,0,1,.9)] data-[starting-style]:h-0';
const GROUP_CHEVRON_OPEN_CLASS = 'ml-auto rotate-90 transition-transform duration-200 ease-[cubic-bezier(0,0,.38,.9)]';
const GROUP_CHEVRON_CLOSED_CLASS = 'ml-auto transition-transform duration-150 ease-[cubic-bezier(.2,0,1,.9)]';

/** 펼친 사이드바의 그룹: 머리글 버튼 + 접히는 화면 목록. 접힌 패널의 링크는 hidden이라 Tab 순서에서 빠진다. */
function ExpandedNavGroup({ children, current, expanded, group, instant, label, onOpenChange }: {
  children: ReactNode;
  /** 현재(또는 대기 중인) 화면이 이 그룹에 있다. */
  current: boolean;
  expanded: boolean;
  group: AdminNavGroup;
  /** 검색으로 일괄 펼칠 때는 애니메이션 없이 바꾼다. */
  instant: boolean;
  label: string | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  const panelId = `admin-nav-group-${group.id}`;
  return (
    <Collapsible onOpenChange={onOpenChange} open={expanded} render={<SidebarMenuItem data-admin-nav-group={group.id} data-state={expanded ? 'open' : 'closed'} />}>
      <CollapsibleTrigger
        aria-controls={panelId}
        aria-label={label}
        render={<SidebarMenuButton className={current && expanded ? 'font-semibold text-primary-soft-foreground' : undefined} isActive={current && !expanded} />}
      >
        <AdminNavGroupIcon groupId={group.id} />
        <span>{group.label}</span>
        <ChevronRight aria-hidden="true" className={instant ? `ml-auto${expanded ? ' rotate-90' : ''}` : expanded ? GROUP_CHEVRON_OPEN_CLASS : GROUP_CHEVRON_CLOSED_CLASS} />
      </CollapsibleTrigger>
      <CollapsibleContent className={instant ? 'overflow-hidden' : GROUP_PANEL_CLASS} id={panelId} keepMounted>
        <SidebarMenuSub>{children}</SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * 아이콘 막대의 그룹: 누르면 사이드바를 펼치지 않고 오른쪽에 그 그룹의 화면 목록을 연다. 사용자가 일부러 접어 둔 상태라 넓은 표를
 * 다시 배치시키지 않는다. 메뉴 역할 대신 내비게이션 묶음이다(APG disclosure navigation). Esc로 닫으면 Base UI가 포커스를 되돌린다.
 */
function IconRailNavGroup({ children, current, group, label }: {
  children: ReactNode;
  current: boolean;
  group: AdminNavGroup;
  label: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  /* 링크를 골라 닫힐 때는 아이콘으로 포커스를 되돌리지 않는다. 되돌리면 말풍선이 이동한 화면 위에 남는다. */
  const closedByNavigation = useRef(false);
  return (
    <SidebarMenuItem data-admin-nav-group={group.id} data-state="closed">
      <Popover onOpenChange={(next) => { if (next) closedByNavigation.current = false; setOpen(next); }} open={open}>
        <PopoverTrigger
          aria-haspopup={undefined}
          render={<SidebarMenuButton aria-label={label ?? group.label} isActive={current} tooltip={{ children: group.label, hidden: open }} />}
        >
          <AdminNavGroupIcon groupId={group.id} />
          <span>{group.label}</span>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-60 gap-0 p-1.5" data-admin-nav-flyout={group.id} finalFocus={() => !closedByNavigation.current} role={undefined} side="right" sideOffset={22}>
          <nav aria-label={`${group.label} 메뉴`} className="flex flex-col gap-1">
            <p className="px-2 pt-1 pb-0.5 text-xs font-medium text-muted-foreground">{group.label}</p>
            <ul
              className="flex flex-col gap-0.5"
              onClick={(event) => {
                /* 수정자 키로 새 탭을 여는 클릭은 이 화면에 머무르므로 닫지 않는다. */
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target as Element).closest('a[href]')) return;
                closedByNavigation.current = true;
                setOpen(false);
              }}
            >
              {children}
            </ul>
          </nav>
        </PopoverContent>
      </Popover>
    </SidebarMenuItem>
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
      tabIndex={-1}
      title={favorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
      type="button"
    >
      <Star className={favorite ? 'fill-current' : undefined} />
    </button>
  );
}

const SUB_FAVORITE_CLASS = 'absolute top-0.5 right-1 flex size-6 items-center justify-center rounded-md text-sidebar-foreground/60 opacity-0 outline-hidden ring-sidebar-ring transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:opacity-100 focus-visible:ring-2 group-focus-within/menu-sub-item:opacity-100 group-hover/menu-sub-item:opacity-100 aria-pressed:text-sidebar-foreground aria-pressed:opacity-100 max-md:opacity-100 [&>svg]:size-3.5';

/** 맨 위 항목(홈·즐겨찾기 사본·사이트로 돌아가기)처럼 그룹 없이 바로 서는 메뉴 한 줄. */
function TopLevelItem({ active, current, favorite, favoriteCopy = false, group, iconRail, onToggleFavorite, screen }: {
  /** 활성 표시. 이동을 기다리는 동안 목적지로 먼저 옮겨 간다. */
  active: boolean;
  /** 실제 현재 화면. aria-current는 이동이 끝나야 옮긴다. */
  current: boolean;
  favorite: boolean;
  favoriteCopy?: boolean;
  group: AdminNavGroup;
  /** 아이콘 막대에서는 별만 줄지어 구분이 안 되므로 즐겨찾기도 그룹 아이콘으로 보인다. */
  iconRail: boolean;
  onToggleFavorite: (screenId: string) => void;
  screen: AdminScreen;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active && !favoriteCopy}
        render={<NavLink
          aria-current={!favoriteCopy && current ? 'page' : undefined}
          aria-label={screen.label}
          data-admin-nav-screen={screen.id}
          href={screen.href}
        />}
        tooltip={screen.label}
      >
        {favoriteCopy && !iconRail ? <Star /> : <AdminNavGroupIcon groupId={group.id} />}
        <span>{screen.label}</span>
      </SidebarMenuButton>
      <SidebarMenuAction
        aria-label={favorite ? `${screen.label} 즐겨찾기 해제` : `${screen.label} 즐겨찾기 추가`}
        aria-pressed={favorite}
        className="w-6 peer-data-[size=default]/menu-button:top-1"
        data-admin-nav-favorite={screen.id}
        onClick={() => onToggleFavorite(screen.id)}
        showOnHover={!favorite}
        tabIndex={-1}
        title={favorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
        type="button"
      >
        <Star className={favorite ? 'fill-current' : undefined} />
      </SidebarMenuAction>
    </SidebarMenuItem>
  );
}

export function AdminSidebar({
  accountId,
  currentPath,
  initialNavigation,
  role,
  operatorAccess,
  console: consoleId = 'shopping',
  homeHref = '/admin',
}: {
  /** 현재 콘솔. 사이드바는 이 콘솔의 메뉴만 보여 주고, 즐겨찾기는 콘솔을 가리지 않는다. */
  console?: AdminConsoleId;
  homeHref?: string;
  /** 계정별 메뉴 설정의 경계. 인증되지 않은 테스트·초기 셸은 role로 대체한다. */
  accountId?: string;
  currentPath?: string;
  /** 서버가 쿠키에서 읽은 지난번 메뉴 설정. */
  initialNavigation?: SavedAdminNavigation | null;
  role: string;
  operatorAccess?: OperatorAccess;
}) {
  const basePathname = usePathname();
  const pathname = currentPath ?? basePathname;
  const { isMobile, openMobile, state: sidebarState } = useSidebar();
  const iconRail = sidebarState === 'collapsed' && !isMobile;
  const consoleTitle = ADMIN_CONSOLES.find((item) => item.id === consoleId)?.title ?? '판매자센터';
  const groups = useMemo(() => visibleAdminNavGroups(role, operatorAccess, consoleId), [role, operatorAccess, consoleId]);
  const allGroups = useMemo(() => visibleAdminNavGroups(role, operatorAccess), [role, operatorAccess]);
  const [query, setQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  /* 검색 중에 임시로 접은 그룹. 저장하지 않고 검색어가 바뀌면 사라진다. */
  const [searchClosedGroupIds, setSearchClosedGroupIds] = useState<string[]>([]);
  const normalizedQuery = adminMenuQuery(query);
  const searching = normalizedQuery.length > 0;
  const activeScreen = adminScreenForPath(pathname);
  const activeGroup = adminGroupForPath(pathname);
  /* 메뉴 검색으로 화면을 옮겼으면 검색어를 비운다. 필터가 남아 X를 또 누르게 하지 않는다. */
  const [screenAtSearch, setScreenAtSearch] = useState(activeScreen?.id);
  if (activeScreen?.id !== screenAtSearch) {
    setScreenAtSearch(activeScreen?.id);
    if (query) {
      setQuery('');
      setSearchClosedGroupIds([]);
    }
  }
  /* 클릭 즉시(0ms) 활성 표시만 목적지로 옮긴다. 본문·제목은 이동이 끝날 때까지 그대로다. 메뉴 밖(쇼핑몰)으로 가는 이동은 지금 위치를 둔다. */
  const pendingPath = useAdminNavigationPendingPath();
  const displayPath = pendingPath && adminScreenForPath(pendingPath) ? pendingPath : pathname;
  const displayScreen = adminScreenForPath(displayPath);
  const displayGroup = adminGroupForPath(displayPath);
  const { preferences, toggleFavorite, update } = useAdminNavigationStore(accountId || role, initialNavigation, activeGroup && activeGroup.id !== 'home' ? activeGroup.id : null);

  const visibleGroups = useMemo(() => filterAdminNavGroups(groups, normalizedQuery), [groups, normalizedQuery]);
  const favoriteIds = new Set(preferences.favoriteScreenIds);
  const favoriteItems = allGroups.flatMap((group) => group.screens
    .filter((screen) => screen.status === 'ready' && favoriteIds.has(screen.id))
    .map((screen) => ({ group, screen })));
  const homeGroup = groups.find((group) => group.id === 'home');
  const roleCaption = operatorAccess?.managerRole ? MANAGER_ROLE_LABELS[operatorAccess.managerRole] : role === 'admin' ? '관리자' : '스토어 매니저';
  const collapsibleGroupIds = groups.filter((group) => group.id !== 'home').map((group) => group.id);
  const anyGroupOpen = collapsibleGroupIds.some((groupId) => preferences.openGroupIds.includes(groupId));
  const menuScroll = useAdminMenuScroll(activeScreen?.id, adminMenuFollowEnabled({ iconRail, isMobile, openMobile, searching }));

  function setGroupOpen(groupId: string, open: boolean) {
    if (searching) {
      setSearchClosedGroupIds((closed) => (open ? closed.filter((id) => id !== groupId) : [...closed, groupId]));
      return;
    }
    update((current) => withGroupOpen(current, groupId, open));
    if (open) menuScroll.revealGroup(groupId);
  }

  function changeQuery(value: string) {
    setQuery(value);
    setSearchClosedGroupIds([]);
  }

  function screenLinks(group: AdminNavGroup, { flyout = false }: { flyout?: boolean } = {}) {
    return (
      <>
        {group.screens.map((screen) => {
          const active = isScreenActive(screen, displayPath);
          const current = isScreenActive(screen, pathname);
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
                className={flyout ? 'h-auto min-h-7 translate-x-0 py-1 [&>span:last-child]:whitespace-normal' : 'h-auto min-h-7 py-1 pr-7 [&>span:last-child]:whitespace-normal'}
                isActive={active}
                render={<NavLink
                  aria-current={current ? 'page' : undefined}
                  aria-label={screen.label}
                  data-admin-nav-screen={screen.id}
                  href={screen.href}
                  title={screen.label}
                />}
              >
                <span>{screen.label}</span>
              </SidebarMenuSubButton>
              {flyout ? null : <FavoriteToggle
                className={SUB_FAVORITE_CLASS}
                favorite={favorite}
                label={screen.label}
                onToggle={() => toggleFavorite(screen.id)}
                screenId={screen.id}
              />}
            </SidebarMenuSubItem>
          );
        })}
        {/* 메뉴에서만 숨긴 화면(선물·정기구매·그룹상품 등)으로 들어오면 현재 위치를 잃지 않게 이 그룹 아래에 잠깐 보인다. */}
        {activeScreen?.navHidden && activeGroup?.id === group.id ? (
          <SidebarMenuSubItem key={activeScreen.id}>
            <SidebarMenuSubButton aria-current="page" isActive render={<span title={activeScreen.label} />}>
              <span>{activeScreen.label}</span>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        ) : null}
      </>
    );
  }

  let groupList: ReactNode = null;
  if (visibleGroups.some((group) => group.id !== 'home')) {
    groupList = (
      <SidebarGroup>
        {/* 긴 목록을 내려도 모두 접기가 손에 닿게 메뉴 영역 위에 붙인다. */}
        <SidebarGroupLabel className={iconRail ? 'justify-between' : 'sticky top-0 z-10 justify-between rounded-none bg-sidebar'} data-admin-nav-sticky-label={iconRail ? undefined : ''}>
          <span>{consoleTitle}</span>
          {searching ? null : (
            <Button
              className="-mr-1 h-6 px-1.5 text-xs font-normal text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              data-admin-nav-collapse-all=""
              disabled={!anyGroupOpen}
              onClick={() => update((current) => withGroupsClosed(current, collapsibleGroupIds))}
              size="xs"
              type="button"
              variant="ghost"
            >
              모두 접기
            </Button>
          )}
        </SidebarGroupLabel>
        <SidebarMenu>
          {visibleGroups.map((group) => {
            if (group.id === 'home') return null;
            const expanded = searching ? !searchClosedGroupIds.includes(group.id) : preferences.openGroupIds.includes(group.id);
            const current = displayGroup?.id === group.id;
            /* 목록이 안 보이는 그룹은 머리글이 현재 위치를 대신 알린다. 펼쳐져 있으면 아래 항목이 알린다. */
            const label = current && displayScreen && (iconRail || !expanded) ? `${group.label}, 현재 위치 ${displayScreen.label}` : undefined;
            if (iconRail) {
              return (
                <IconRailNavGroup current={current} group={group} key={group.id} label={label}>
                  {screenLinks(group, { flyout: true })}
                </IconRailNavGroup>
              );
            }
            return (
              <ExpandedNavGroup
                current={current}
                expanded={expanded}
                group={group}
                instant={searching}
                key={group.id}
                label={label}
                onOpenChange={(open) => setGroupOpen(group.id, open)}
              >
                {screenLinks(group)}
              </ExpandedNavGroup>
            );
          })}
        </SidebarMenu>
      </SidebarGroup>
    );
  }

  return (
    <Sidebar collapsible="icon" variant="inset">
      {/* 사이드바 전체가 탐색 랜드마크다(모든 콘텐츠가 랜드마크 안에 있도록 — axe region). */}
      {/* 펼치는 동안 사이드바 폭이 커지는 사이 글자가 세로로 쌓이지 않게, 내용 폭을 처음부터 다 펼친 폭으로 고정하고 바깥에서 자른다. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <nav aria-label={`${consoleTitle} 사이드바`} className="flex min-h-0 flex-1 flex-col group-data-[state=expanded]:w-[calc(var(--sidebar-width)-1rem)]">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<NavLink aria-label={`ICONS ${consoleTitle} 홈`} href={homeHref} />}
              size="lg"
            >
              <span aria-hidden="true" className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-[10px] font-bold tracking-tight text-sidebar-primary-foreground">ICONS</span>
              <span className="grid flex-1 text-left leading-tight">
                <span className="truncate font-semibold">ICONS {consoleTitle}</span>
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
            className="pr-7 pl-8 [&::-webkit-search-cancel-button]:hidden"
            onChange={(event) => changeQuery(event.target.value)}
            onKeyDown={(event) => {
              /* ↓ = 첫 메뉴(검색 중이면 첫 검색 결과), Enter = 첫 검색 결과 열기, Esc = 검색어 지우기. 한글 조합 중 Enter는 건드리지 않는다. */
              if (event.nativeEvent.isComposing) return;
              const menu = document.getElementById(ADMIN_NAVIGATION_ID);
              if (event.key === 'ArrowDown' && menu) focusMenuItem(visibleMenuLinks(menu, searching)[0], event);
              else if (event.key === 'Enter' && searching && menu) {
                const first = visibleMenuLinks(menu, true)[0];
                if (first) { event.preventDefault(); first.click(); }
              } else if (event.key === 'Escape' && query) { event.preventDefault(); changeQuery(''); }
            }}
            placeholder="메뉴 검색"
            ref={searchInputRef}
            type="search"
            value={query}
          />
          {query ? (
            <button
              aria-label="메뉴 검색어 지우기"
              className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-sidebar-foreground/60 hover:text-sidebar-foreground [&>svg]:size-3.5"
              onClick={() => changeQuery('')}
              type="button"
            >
              <X aria-hidden="true" />
            </button>
          ) : null}
        </label>
      </SidebarHeader>
      {/* 스크롤바가 생겨도 줄이 밀리지 않게 자리를 늘 잡아 둔다(아이콘 막대는 스크롤이 없어 자리도 두지 않는다). 포커스는 붙어 있는 줄 아래에 멈춘다. */}
      <SidebarContent className="scroll-pt-8 [scrollbar-gutter:stable] group-data-[collapsible=icon]:[scrollbar-gutter:auto]" {...menuScroll.scrollerProps}>
        <nav aria-label={consoleId === 'shopping' ? '관리자 메뉴' : `${consoleTitle} 메뉴`} className="flex min-w-0 flex-col" id={ADMIN_NAVIGATION_ID} onKeyDown={(event) => handleMenuKeyDown(event, searchInputRef.current)}>
          <p className="sr-only">메뉴에서 위·아래 화살표로 항목을 옮기고, 오른쪽 화살표로 즐겨찾기 별로 이동합니다.</p>
          <p className="sr-only" aria-live="polite">현재 위치 · {activeGroup?.label ?? '어드민'}{activeScreen ? ` / ${activeScreen.label}` : ''}</p>
          {homeGroup ? (
            <SidebarGroup className="pb-0">
              <SidebarMenu>
                {homeGroup.screens.map((screen) => (
                  <TopLevelItem
                    active={isScreenActive(screen, displayPath)}
                    current={isScreenActive(screen, pathname)}
                    favorite={favoriteIds.has(screen.id)}
                    group={homeGroup}
                    iconRail={iconRail}
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
                    active={isScreenActive(screen, displayPath)}
                    current={isScreenActive(screen, pathname)}
                    favorite
                    favoriteCopy
                    group={group}
                    iconRail={iconRail}
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
      </nav>
      </div>
      <SidebarRail />
    </Sidebar>
  );
}
