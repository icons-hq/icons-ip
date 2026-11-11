import { leavesAdminPage } from './leave-guard';

/*
 * 메뉴·링크 이동의 대기 상태.
 *
 * 원칙: 메뉴를 눌러도 본문을 비우지 않는다. 새 화면이 준비될 때까지 이전 화면을 두고 단계별로만 알린다.
 * 0ms 사이드바 활성 표시 이동 → 500ms 진행 막대 → 1000ms 이전 본문 흐림·잠금·낭독 → 10초 지연 안내.
 *
 * 링크 클릭은 document 버블 단계에서 받는다. React가 같은 document의 리스너를 먼저 달기 때문에 Next Link는
 * 이미 preventDefault로 이동을 맡은 뒤이고, 이탈 경고(leave-guard)가 취소한 클릭은 캡처 단계에서 끊겨 여기 오지 않는다.
 * 끝나는 조건은 셸이 렌더한 주소(pathname + search)가 바뀌는 것이다.
 *
 * 링크가 아닌 화면 전환(router.push·replace)은 `startAdminNavigation`으로 같은 대기를 건다. 이동이 실패할 수 있는 링크
 * (서버 처리 뒤 router.push로 옮기는 알림 항목 등)는 `data-admin-nav-skip`으로 클릭 판정에서 빼고, 이동이 확정될 때 이 함수를 부른다.
 */

export const ADMIN_NAVIGATION_BAR_DELAY_MS = 500;
/** 막대가 나타났다면 이 시간은 보인다(깜빡임 방지). 본문 교체는 기다리지 않는다. */
export const ADMIN_NAVIGATION_BAR_MIN_VISIBLE_MS = 300;
export const ADMIN_NAVIGATION_DIM_DELAY_MS = 1_000;
export const ADMIN_NAVIGATION_SLOW_DELAY_MS = 10_000;
/** 주소가 끝내 바뀌지 않는 이동(같은 주소로의 리다이렉트 등)에서 본문이 잠긴 채 남지 않게 푼다. */
export const ADMIN_NAVIGATION_GIVE_UP_MS = 30_000;

export type AdminNavigationStage = 'idle' | 'waiting' | 'bar' | 'dim' | 'slow';

export interface AdminNavigationPending {
  /** 이동 중인 목적지(pathname + search). 없으면 null. */
  path: string | null;
  /** 다시 시도(전체 새로고침 이동)에 쓰는 주소. */
  href: string | null;
  stage: AdminNavigationStage;
  /** 진행 막대를 그리는가(최소 노출 시간 포함). */
  barVisible: boolean;
}

export const ADMIN_NAVIGATION_IDLE: AdminNavigationPending = Object.freeze({ path: null, href: null, stage: 'idle', barVisible: false });

/** `role="status"`가 읽을 문구. 없을 때는 빈 문자열이어야 다음 대기에서 다시 읽힌다. */
export function adminNavigationStatusMessage(stage: AdminNavigationStage) {
  if (stage === 'dim') return '화면을 불러오는 중입니다.';
  if (stage === 'slow') return '응답이 늦어지고 있습니다. 다시 시도할 수 있습니다.';
  return '';
}

interface ClickLike {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}

type AnchorLike = Pick<HTMLAnchorElement, 'href' | 'target' | 'hasAttribute' | 'getAttribute'>;

export type AdminLinkClickIntent = { kind: 'navigate'; path: string; href: string } | { kind: 'stay' };

/** 클릭만으로는 이동이 시작되지 않는 링크의 표식. 눌렀다가 실패해도 본문이 잠긴 채 남지 않는다. */
export const ADMIN_NAV_SKIP_ATTRIBUTE = 'data-admin-nav-skip';

/* 라우트 핸들러(파일 내려받기 등)는 화면이 아니다. Next Link로 잘못 걸려도 주소가 바뀌지 않아 대기가 풀리지 않는다. */
function isApiDestination(href: string, currentHref: string) {
  return new URL(href, currentHref).pathname.startsWith('/api/');
}

/**
 * 이 링크 클릭이 소프트 이동을 시작하는가. preventDefault가 안 된 클릭은 브라우저가 처리하므로(새 창·내려받기·외부 링크·
 * 일반 a 태그) 여기서 다루지 않는다. `stay`는 같은 주소로 가는 링크로, 진행 중이던 이동이 있으면 그 이동을 대신한다.
 */
export function adminLinkClickIntent(event: ClickLike, anchor: AnchorLike | null | undefined, currentHref: string): AdminLinkClickIntent | null {
  if (!anchor || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !event.defaultPrevented) return null;
  if (anchor.getAttribute('aria-disabled') === 'true' || anchor.hasAttribute(ADMIN_NAV_SKIP_ATTRIBUTE) || isApiDestination(anchor.href, currentHref)) return null;
  if (!leavesAdminPage(anchor, currentHref)) return { kind: 'stay' };
  const destination = new URL(anchor.href, currentHref);
  return { kind: 'navigate', path: `${destination.pathname}${destination.search}`, href: destination.href };
}

/** `router.push`의 목적지를 대기 대상으로 바꾼다. 같은 주소·다른 사이트·라우트 핸들러는 화면 이동이 아니라 null이다. */
export function adminNavigationTarget(href: string, currentHref: string): { path: string; href: string } | null {
  const current = new URL(currentHref);
  const destination = new URL(href, current);
  if (destination.origin !== current.origin || isApiDestination(destination.href, currentHref)) return null;
  if (destination.pathname === current.pathname && destination.search === current.search) return null;
  return { path: `${destination.pathname}${destination.search}`, href: destination.href };
}

export interface AdminNavigationPendingStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => AdminNavigationPending;
  /** 셸이 렌더한 주소를 알린다. 바뀌었으면 대기를 끝낸다. */
  routeChanged: (path: string) => void;
  start: (path: string, href: string) => void;
  finish: () => void;
  /** 흐림이 풀린 뒤 부른다. 잠기면서 잃은 키보드 포커스를 아직 화면에 남아 있는 요소로 돌려준다. */
  restoreFocus: () => void;
  /** 브라우저 이벤트 연결. 돌려준 함수로 해제한다. */
  connect: (doc?: PendingDocument, win?: PendingWindow) => () => void;
}

type PendingDocument = Pick<Document, 'addEventListener' | 'removeEventListener' | 'activeElement' | 'body'>;
type PendingWindow = Pick<Window, 'addEventListener' | 'removeEventListener' | 'location'>;

/* 셸은 한 번에 하나다. 이벤트에 연결된 저장소를 기억해 링크가 아닌 이동도 같은 대기를 쓰게 한다. */
let connected: { store: AdminNavigationPendingStore; win: PendingWindow } | null = null;

/** `router.push`·`replace` 직전에 부른다. 셸 밖에서는 아무 일도 하지 않는다. */
export function startAdminNavigation(href: string) {
  if (!connected) return;
  const target = adminNavigationTarget(href, connected.win.location.href);
  if (target) connected.store.start(target.path, target.href);
}

type Timer = ReturnType<typeof setTimeout> | undefined;

export function createAdminNavigationPendingStore(): AdminNavigationPendingStore {
  let snapshot = ADMIN_NAVIGATION_IDLE;
  let renderedPath: string | null = null;
  let barHeld = false;
  let barTimer: Timer;
  let dimTimer: Timer;
  let slowTimer: Timer;
  let giveUpTimer: Timer;
  let holdTimer: Timer;
  let boundDocument: PendingDocument | null = null;
  let focusBeforeDim: HTMLElement | null = null;
  const listeners = new Set<() => void>();

  function publish(next: Omit<AdminNavigationPending, 'barVisible'>) {
    const barVisible = barHeld || next.stage === 'bar' || next.stage === 'dim' || next.stage === 'slow';
    if (snapshot.path === next.path && snapshot.href === next.href && snapshot.stage === next.stage && snapshot.barVisible === barVisible) return;
    snapshot = { ...next, barVisible };
    listeners.forEach((listener) => listener());
  }

  function clearStageTimers() {
    clearTimeout(barTimer);
    clearTimeout(dimTimer);
    clearTimeout(slowTimer);
    clearTimeout(giveUpTimer);
  }

  function holdBar() {
    barHeld = true;
    clearTimeout(holdTimer);
    /* 대기가 먼저 끝나도 이 타이머는 남아 최소 노출을 채운다. 본문은 이미 교체된 뒤다. */
    holdTimer = setTimeout(() => {
      barHeld = false;
      publish(snapshot);
    }, ADMIN_NAVIGATION_BAR_MIN_VISIBLE_MS);
  }

  function setStage(stage: AdminNavigationStage) {
    publish({ ...snapshot, stage });
  }

  /* inert가 걸리면 안쪽 포커스가 사라진다. 잠그기 전에 어디 있었는지 기억한다. */
  function rememberFocus() {
    const active = boundDocument?.activeElement;
    focusBeforeDim = active && active !== boundDocument?.body ? active as HTMLElement : null;
  }

  /* 지연 안내와 포기는 마지막 클릭부터 다시 잰다. 막대·흐림은 첫 클릭 기준이라 연속 클릭에 깜빡이지 않는다. */
  function scheduleSlowTimers() {
    clearTimeout(slowTimer);
    clearTimeout(giveUpTimer);
    slowTimer = setTimeout(() => setStage('slow'), ADMIN_NAVIGATION_SLOW_DELAY_MS);
    giveUpTimer = setTimeout(finish, ADMIN_NAVIGATION_GIVE_UP_MS);
  }

  function start(path: string, href: string) {
    if (snapshot.path !== null) {
      publish({ path, href, stage: snapshot.stage === 'slow' ? 'dim' : snapshot.stage });
      scheduleSlowTimers();
      return;
    }
    clearStageTimers();
    publish({ path, href, stage: 'waiting' });
    barTimer = setTimeout(() => {
      holdBar();
      setStage('bar');
    }, ADMIN_NAVIGATION_BAR_DELAY_MS);
    dimTimer = setTimeout(() => {
      rememberFocus();
      setStage('dim');
    }, ADMIN_NAVIGATION_DIM_DELAY_MS);
    scheduleSlowTimers();
  }

  function finish() {
    clearStageTimers();
    publish({ path: null, href: null, stage: 'idle' });
  }

  const store: AdminNavigationPendingStore = {
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => snapshot,
    start,
    finish,
    restoreFocus() {
      const element = focusBeforeDim;
      focusBeforeDim = null;
      if (!element || !boundDocument) return;
      /* 그사이 사용자가 다른 곳으로 옮겼으면 건드리지 않는다. 화면이 바뀌어 사라진 요소도 마찬가지다. */
      if (boundDocument.activeElement && boundDocument.activeElement !== boundDocument.body) return;
      if (element.isConnected) element.focus({ preventScroll: true });
    },
    routeChanged(path) {
      if (path === renderedPath) return;
      const changed = renderedPath !== null;
      renderedPath = path;
      if (changed) finish();
    },
    connect(doc = document, win = window) {
      boundDocument = doc;
      connected = { store, win };
      function handleClick(event: MouseEvent) {
        const anchor = (event.target as Partial<Element> | null)?.closest?.('a[href]') as AnchorLike | null | undefined;
        const intent = adminLinkClickIntent(event, anchor, win.location.href);
        if (intent?.kind === 'navigate') start(intent.path, intent.href);
        else if (intent?.kind === 'stay') finish();
      }
      /* 뒤로·앞으로 가기는 주소가 먼저 바뀌고 화면은 나중에 바뀐다. 같은 화면이면(해시만 다름) 기다릴 것이 없다. */
      function handlePopState() {
        /* 셸이 렌더한 주소(URLSearchParams.toString)와 같은 표기로 맞춘다. 표기만 달라 대기가 끝나지 않는 일을 막는다. */
        const search = new URLSearchParams(win.location.search).toString();
        const path = search ? `${win.location.pathname}?${search}` : win.location.pathname;
        if (path === renderedPath) finish();
        else start(path, win.location.href);
      }
      /* bfcache로 돌아오면 멈췄던 대기가 되살아난다. */
      function handlePageShow(event: PageTransitionEvent) {
        if (event.persisted) finish();
      }
      doc.addEventListener('click', handleClick);
      win.addEventListener('popstate', handlePopState);
      win.addEventListener('pageshow', handlePageShow);
      return () => {
        doc.removeEventListener('click', handleClick);
        win.removeEventListener('popstate', handlePopState);
        win.removeEventListener('pageshow', handlePageShow);
        clearStageTimers();
        clearTimeout(holdTimer);
        boundDocument = null;
        if (connected?.store === store) connected = null;
      };
    },
  };
  return store;
}
