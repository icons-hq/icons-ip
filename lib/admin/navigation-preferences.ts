/**
 * 어드민 탐색 개인화(열린 메뉴 그룹·즐겨찾기)의 저장 계약과 메뉴 동작 판단.
 *
 * 규칙 한 줄: 자동으로는 열기만 하고, 닫기는 사용자만 한다. 저장 상태는 '열린 그룹 집합' 하나이며
 * 자동으로 열린 그룹과 사용자가 연 그룹을 구분하지 않는다.
 *
 * 첫 HTML부터 같은 모양으로 그리려고 쿠키에 저장하고 셸 레이아웃이 읽는다. 쿠키는 계정마다 따로 둔다(이름에 계정 ID) —
 * 공용 PC에서 다른 계정의 저장이 내 즐겨찾기를 덮지 않게 한다. 메뉴 설정은 팀 공용 설정이나 권한이 아니라 화면·그룹 ID만 저장한다.
 */
import type { AdminNavGroup, AdminScreen } from './navigation';

export interface AdminNavigationPreferences {
  openGroupIds: string[];
  favoriteScreenIds: string[];
}

/** 쿠키에 저장된 값. 마지막으로 저장할 때의 현재 그룹을 함께 둬, 같은 그룹에 다시 들어오면 접어 둔 그룹을 열지 않는다. */
export interface SavedAdminNavigation extends AdminNavigationPreferences {
  currentGroupId: string | null;
}

export const EMPTY_ADMIN_NAVIGATION: AdminNavigationPreferences = { openGroupIds: [], favoriteScreenIds: [] };

export const ADMIN_NAVIGATION_COOKIE = 'icons_admin_nav';
/** 브라우저가 허용하는 쿠키 수명의 상한(400일). */
export const ADMIN_NAVIGATION_COOKIE_MAX_AGE = 60 * 60 * 24 * 400;

/* 옛 저장 위치. 즐겨찾기만 쿠키로 한 번 옮기고 지운다(v2는 IA 재정의 전, v3가 있으면 v3가 우선). */
const LEGACY_STORAGE_PREFIXES = ['icons.admin.navigation.v3', 'icons.admin.navigation.v2'] as const;

/* 화면·그룹 ID는 메뉴 정의에서 오므로 이 수를 넘을 일이 없다. 손으로 고친 쿠키가 화면을 키우지 못하게 막는다. */
const MAX_STORED_IDS = 200;

function stringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))].slice(0, MAX_STORED_IDS);
}

function storedGroupId(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function safeAccountKey(accountId: string) {
  return encodeURIComponent(accountId.trim() || 'anonymous');
}

function storageKeyFor(prefix: string, accountId: string) {
  return `${prefix}:${safeAccountKey(accountId)}`;
}

export function legacyAdminNavigationStorageKeys(accountId: string) {
  return LEGACY_STORAGE_PREFIXES.map((prefix) => storageKeyFor(prefix, accountId));
}

/** 옛 저장값에서 즐겨찾기(화면 ID)만 꺼낸다. 망가진 값은 빈 목록이다. */
export function parseLegacyAdminNavigationFavorites(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? stringList((parsed as { favoriteScreenIds?: unknown }).favoriteScreenIds) : [];
  } catch {
    return [];
  }
}

/** 셸 레이아웃(서버)과 사이드바(브라우저)가 같은 계정 키를 쓰게 한다. */
export function adminNavigationAccountId(admin: { id?: string | null; email?: string | null; role: string }) {
  return admin.id || admin.email || admin.role;
}

/** 계정별 쿠키 이름. 이메일을 키로 쓰는 경우에도 쿠키 이름에 쓸 수 있게 인코딩한다. */
export function adminNavigationCookieName(accountId: string) {
  return `${ADMIN_NAVIGATION_COOKIE}_${safeAccountKey(accountId)}`;
}

/** 쿠키 값(인코딩 여부 무관)을 읽는다. 망가졌으면 null — 호출부는 기본값을 쓴다. */
export function parseAdminNavigationCookie(value: string | null | undefined): SavedAdminNavigation | null {
  if (!value) return null;
  try {
    /* next/headers는 값을 풀어서 주고 document.cookie는 인코딩된 채로 준다. */
    const parsed: unknown = JSON.parse(value.startsWith('{') ? value : decodeURIComponent(value));
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as { open?: unknown; favorites?: unknown; current?: unknown };
    return {
      openGroupIds: stringList(candidate.open),
      favoriteScreenIds: stringList(candidate.favorites),
      currentGroupId: storedGroupId(candidate.current),
    };
  } catch {
    return null;
  }
}

export function serializeAdminNavigationCookie(preferences: AdminNavigationPreferences, currentGroupId: string | null) {
  return encodeURIComponent(JSON.stringify({
    open: [...new Set(preferences.openGroupIds)],
    favorites: [...new Set(preferences.favoriteScreenIds)],
    current: currentGroupId,
  }));
}

/** document.cookie에 대입하는 문자열 전체. */
export function adminNavigationCookieAssignment(accountId: string, preferences: AdminNavigationPreferences, currentGroupId: string | null) {
  return `${adminNavigationCookieName(accountId)}=${serializeAdminNavigationCookie(preferences, currentGroupId)}; path=/; max-age=${ADMIN_NAVIGATION_COOKIE_MAX_AGE}; SameSite=Lax`;
}

/** `document.cookie` 문자열에서 이 계정의 쿠키 값만 꺼낸다. */
export function adminNavigationCookieFromHeader(header: string, accountId: string): string | null {
  const prefix = `${adminNavigationCookieName(accountId)}=`;
  return header.split(/;\s*/).find((part) => part.startsWith(prefix))?.slice(prefix.length) ?? null;
}

export function withCurrentGroup(preferences: AdminNavigationPreferences, groupId: string | null | undefined): AdminNavigationPreferences {
  if (!groupId || preferences.openGroupIds.includes(groupId)) return preferences;
  return { ...preferences, openGroupIds: [...preferences.openGroupIds, groupId] };
}

/**
 * 첫 렌더의 열린 그룹. 저장할 때와 같은 그룹에 들어왔으면 저장값 그대로 그린다 — 사용자가 현재 그룹을 접거나 모두 접기를 누른 뒤
 * 새로고침해도 다시 열리지 않는다. 다른 그룹에서 왔거나 처음이면 현재 그룹을 연다.
 */
export function adminNavigationFirstRender(saved: SavedAdminNavigation | null | undefined, currentGroupId: string | null): AdminNavigationPreferences {
  if (!saved) return withCurrentGroup(EMPTY_ADMIN_NAVIGATION, currentGroupId);
  const preferences = { openGroupIds: saved.openGroupIds, favoriteScreenIds: saved.favoriteScreenIds };
  return saved.currentGroupId === currentGroupId ? preferences : withCurrentGroup(preferences, currentGroupId);
}

export function withGroupOpen(preferences: AdminNavigationPreferences, groupId: string, open: boolean): AdminNavigationPreferences {
  if (open) return withCurrentGroup(preferences, groupId);
  return preferences.openGroupIds.includes(groupId)
    ? { ...preferences, openGroupIds: preferences.openGroupIds.filter((id) => id !== groupId) }
    : preferences;
}

/** '모두 접기' — 지금 콘솔에서 보이는 그룹만 닫는다. 다른 콘솔의 접힘 상태는 건드리지 않는다. */
export function withGroupsClosed(preferences: AdminNavigationPreferences, groupIds: readonly string[]): AdminNavigationPreferences {
  const closing = new Set(groupIds);
  return { ...preferences, openGroupIds: preferences.openGroupIds.filter((id) => !closing.has(id)) };
}

export function withFavoriteToggled(preferences: AdminNavigationPreferences, screenId: string): AdminNavigationPreferences {
  return {
    ...preferences,
    favoriteScreenIds: preferences.favoriteScreenIds.includes(screenId)
      ? preferences.favoriteScreenIds.filter((id) => id !== screenId)
      : [...preferences.favoriteScreenIds, screenId],
  };
}

function sameIds(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function samePreferences(a: AdminNavigationPreferences, b: AdminNavigationPreferences) {
  return sameIds(a.openGroupIds, b.openGroupIds) && sameIds(a.favoriteScreenIds, b.favoriteScreenIds);
}

export interface AdminNavigationChannel {
  postMessage: (message: SavedAdminNavigation) => void;
  close: () => void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

/** 저장소 접근을 한곳에 모은다(브라우저 없이 시험할 수 있게). */
export interface AdminNavigationEnvironment {
  readCookie: (accountId: string) => string | null;
  writeCookie: (assignment: string) => void;
  storage: () => Pick<Storage, 'getItem' | 'removeItem'> | null;
  openChannel: (name: string) => AdminNavigationChannel | null;
  now: () => number;
}

const browserEnvironment: AdminNavigationEnvironment = {
  readCookie: (accountId) => adminNavigationCookieFromHeader(document.cookie, accountId),
  writeCookie: (assignment) => { document.cookie = assignment; },
  storage: () => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  },
  openChannel: (name) => (typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(name) as unknown as AdminNavigationChannel),
  now: () => Date.now(),
};

export interface AdminNavigationStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => AdminNavigationPreferences;
  /** 브라우저 전용 연결(다른 탭 동기화·옛 저장값 이관). 돌려준 함수로 해제한다. */
  connect: () => () => void;
  /** 사용자 조작을 적용하고 저장한다. 바뀐 게 없으면 아무것도 쓰지 않는다. */
  update: (recipe: (current: AdminNavigationPreferences) => AdminNavigationPreferences) => void;
  /** 즐겨찾기를 토글한다. 첫 즐겨찾기로 목록이 밀린 직후의 잘못 맞은 클릭은 받지 않는다. */
  toggleFavorite: (screenId: string) => void;
  /** 현재 그룹이 바뀔 때만 그 그룹을 열어 저장한다. 이전 그룹은 그대로 둔다. */
  setCurrentGroup: (groupId: string | null) => void;
}

export function createAdminNavigationStore({ accountId, saved, currentGroupId, environment = browserEnvironment }: {
  accountId: string;
  /** 서버가 쿠키에서 읽은 값. 서버와 같은 규칙으로 첫 상태를 만든다(첫 HTML과 일치). */
  saved: SavedAdminNavigation | null | undefined;
  currentGroupId: string | null;
  environment?: AdminNavigationEnvironment;
}): AdminNavigationStore {
  let state = adminNavigationFirstRender(saved, currentGroupId);
  let current = currentGroupId;
  let channel: AdminNavigationChannel | null = null;
  let lastFavoriteToggleAt = Number.NEGATIVE_INFINITY;
  const listeners = new Set<() => void>();

  function publish(next: AdminNavigationPreferences) {
    state = next;
    listeners.forEach((listener) => listener());
  }

  function persist() {
    environment.writeCookie(adminNavigationCookieAssignment(accountId, state, current));
  }

  function broadcast() {
    channel?.postMessage({ ...state, currentGroupId: current });
  }

  function update(recipe: (value: AdminNavigationPreferences) => AdminNavigationPreferences) {
    const next = recipe(state);
    if (samePreferences(next, state)) return;
    publish(next);
    persist();
    broadcast();
  }

  /* 다른 곳에서 정해진 값을 받는다. 첫 렌더와 같은 규칙이고, 저장·전파는 하지 않는다(탭끼리 메아리 치지 않게). */
  function applySaved(value: SavedAdminNavigation) {
    const next = adminNavigationFirstRender(value, current);
    if (!samePreferences(next, state)) publish(next);
  }

  function migrateLegacyFavorites() {
    const storage = environment.storage();
    if (!storage) return;
    const keys = legacyAdminNavigationStorageKeys(accountId);
    try {
      const raw = keys.map((key) => storage.getItem(key));
      const favorites = parseLegacyAdminNavigationFavorites(raw.find(Boolean) ?? null);
      if (favorites.length) update((value) => ({ ...value, favoriteScreenIds: [...new Set([...value.favoriteScreenIds, ...favorites])] }));
      keys.forEach((key, index) => { if (raw[index] !== null) storage.removeItem(key); });
    } catch {
      /* 저장소가 막혀 있으면 이관 없이 쓴다. */
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => state,
    update,
    toggleFavorite(screenId) {
      const now = environment.now();
      if (!adminFavoriteToggleAllowed(lastFavoriteToggleAt, now)) return;
      lastFavoriteToggleAt = now;
      update((value) => withFavoriteToggled(value, screenId));
    },
    setCurrentGroup(groupId) {
      if (groupId === current) return;
      current = groupId;
      const next = withCurrentGroup(state, groupId);
      /* 이미 열려 있어도 현재 그룹이 바뀐 사실은 남긴다. 그래야 다음 진입이 같은 그룹인지 알 수 있다. */
      if (samePreferences(next, state)) {
        persist();
        return;
      }
      publish(next);
      persist();
      broadcast();
    },
    connect() {
      /* 뒤로 가기로 되살아난 셸은 서버 값이 낡았을 수 있어 쿠키를 다시 읽는다. */
      const stored = parseAdminNavigationCookie(environment.readCookie(accountId));
      if (stored) applySaved(stored);
      migrateLegacyFavorites();
      /* 처음 왔거나 다른 그룹에서 바로 들어왔으면 여기서 기록한다. 다시 들어올 때 '같은 그룹'으로 보려면 지금 위치가 남아 있어야 한다. */
      if ((stored?.currentGroupId ?? null) !== current) persist();
      channel = environment.openChannel(`icons-admin-nav:${encodeURIComponent(accountId)}`);
      if (channel) {
        channel.onmessage = (event) => {
          const data = event.data as Partial<SavedAdminNavigation> | null;
          applySaved({
            openGroupIds: stringList(data?.openGroupIds),
            favoriteScreenIds: stringList(data?.favoriteScreenIds),
            currentGroupId: storedGroupId(data?.currentGroupId),
          });
        };
      }
      return () => {
        channel?.close();
        channel = null;
      };
    },
  };
}

/* ── 메뉴 동작 판단 ── */

function normalizeMenuText(value: string) {
  return value.toLocaleLowerCase('ko-KR').replace(/\s+/g, '');
}

export function adminMenuQuery(value: string) {
  return normalizeMenuText(value);
}

function screenMatches(screen: AdminScreen, query: string) {
  return normalizeMenuText(screen.label).includes(query) || (screen.keywords ?? []).some((word) => normalizeMenuText(word).includes(query));
}

/** 메뉴 검색 결과. 그룹 이름이 맞으면 그 그룹 전체를, 아니면 맞는 화면만 남긴다. 화면별 `keywords`(평소에 부르는 말)도 본다. */
export function filterAdminNavGroups(groups: readonly AdminNavGroup[], query: string): AdminNavGroup[] {
  if (!query) return [...groups];
  return groups.flatMap((group) => {
    if (normalizeMenuText(group.label).includes(query)) return [group];
    const screens = group.screens.filter((screen) => screenMatches(screen, query));
    return screens.length ? [{ ...group, screens }] : [];
  });
}

/**
 * `block: 'nearest'`와 같은 계산을 메뉴 스크롤 영역 안에서만 한다(페이지는 움직이지 않는다). 이미 보이면 null.
 * 영역보다 긴 그룹은 아래를 맞추느라 머리글이 위로 밀려 사라지지 않게 머리글을 맨 위에 둔다.
 */
export function adminMenuScrollTop(scroller: { scrollTop: number; top: number; bottom: number }, item: { top: number; bottom: number }): number | null {
  if (item.top < scroller.top) return scroller.scrollTop + (item.top - scroller.top);
  if (item.bottom > scroller.bottom) {
    const delta = Math.min(item.bottom - scroller.bottom, item.top - scroller.top);
    return delta > 0 ? scroller.scrollTop + delta : null;
  }
  return null;
}

/** 휠·터치·스크롤바를 만진 뒤 이 시간은 사용자가 메뉴를 보는 중으로 친다. 현재 항목으로 끌어오지 않는다. */
export const ADMIN_MENU_USER_SCROLL_QUIET_MS = 1_000;

/** 메뉴를 스크롤한 뒤 메뉴 밖을 눌렀으면(상단 상담하기·홈 카드 등) 더는 메뉴를 보는 중이 아니다. */
export function adminMenuUserScrolling(lastUserScrollAt: number, now: number, lastOutsidePressAt = Number.NEGATIVE_INFINITY) {
  return lastOutsidePressAt <= lastUserScrollAt && now - lastUserScrollAt < ADMIN_MENU_USER_SCROLL_QUIET_MS;
}

/** 메뉴를 현재 항목으로 맞춰도 되는 상태. 검색 중에는 맞추지 않고, 검색이 끝나는 순간 다시 맞춘다. */
export function adminMenuFollowEnabled({ iconRail, isMobile, openMobile, searching }: { iconRail: boolean; isMobile: boolean; openMobile: boolean; searching: boolean }) {
  return !iconRail && (!isMobile || openMobile) && !searching;
}

/**
 * 그룹이 열리는 전환은 이동한 화면이 무거우면 늦게 시작하고, 그 전에는 스크롤 범위가 모자라 맞춰도 항목이 영역 밖에 남는다.
 * 고정 시간 뒤 한 번 맞추는 대신 프레임 수만큼 따라가며 맞춘다(프레임을 세므로 화면이 바빠 멈춰도 전환을 놓치지 않는다).
 */
export const ADMIN_MENU_FOLLOW_FRAMES = 45;

interface MenuBox {
  getBoundingClientRect: () => { top: number; bottom: number };
}

export function followAdminMenuItem<Scroller extends MenuBox & { scrollTop: number }>({
  scroller,
  item,
  stickyOffset = () => 0,
  interrupted,
  requestFrame = (callback) => requestAnimationFrame(callback),
  cancelFrame = (handle) => cancelAnimationFrame(handle),
}: {
  scroller: () => Scroller | null;
  item: (scroller: Scroller) => MenuBox | null;
  /** 영역 위쪽에 붙어 있는 줄의 높이. 그 아래까지 보여야 보이는 것이다. */
  stickyOffset?: (scroller: Scroller) => number;
  /** 사용자가 이어서 메뉴를 만졌으면 그만 따라간다. */
  interrupted: () => boolean;
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
}): () => void {
  let frames = 0;
  let handle: number | null = null;
  function step() {
    handle = null;
    if (interrupted()) return;
    const box = scroller();
    const target = box ? item(box) : null;
    if (box && target) {
      const rect = box.getBoundingClientRect();
      const scrollTop = adminMenuScrollTop({ scrollTop: box.scrollTop, top: rect.top + stickyOffset(box), bottom: rect.bottom }, target.getBoundingClientRect());
      if (scrollTop !== null) box.scrollTop = scrollTop;
    }
    frames += 1;
    if (frames < ADMIN_MENU_FOLLOW_FRAMES) handle = requestFrame(step);
  }
  step();
  return () => { if (handle !== null) cancelFrame(handle); };
}

/** 첫 즐겨찾기가 생기면 칸이 나타나 목록이 밀린다. 그 직후의 클릭은 다른 줄에 맞으므로 잠깐 받지 않는다. */
export const ADMIN_FAVORITE_TOGGLE_GUARD_MS = 300;

export function adminFavoriteToggleAllowed(lastToggleAt: number, now: number) {
  return now - lastToggleAt >= ADMIN_FAVORITE_TOGGLE_GUARD_MS;
}
