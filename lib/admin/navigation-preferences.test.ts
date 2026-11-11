import { beforeEach, describe, expect, it } from 'vitest';
import {
  ADMIN_FAVORITE_TOGGLE_GUARD_MS,
  ADMIN_MENU_FOLLOW_FRAMES,
  ADMIN_MENU_USER_SCROLL_QUIET_MS,
  ADMIN_NAVIGATION_COOKIE_MAX_AGE,
  adminFavoriteToggleAllowed,
  adminMenuFollowEnabled,
  adminMenuQuery,
  adminMenuScrollTop,
  adminMenuUserScrolling,
  adminNavigationAccountId,
  adminNavigationCookieAssignment,
  adminNavigationCookieFromHeader,
  adminNavigationCookieName,
  adminNavigationFirstRender,
  createAdminNavigationStore,
  filterAdminNavGroups,
  followAdminMenuItem,
  legacyAdminNavigationStorageKeys,
  parseAdminNavigationCookie,
  parseLegacyAdminNavigationFavorites,
  serializeAdminNavigationCookie,
  withCurrentGroup,
  withFavoriteToggled,
  withGroupOpen,
  withGroupsClosed,
  type AdminNavigationChannel,
  type AdminNavigationEnvironment,
  type SavedAdminNavigation,
} from './navigation-preferences';
import { visibleAdminNavGroups } from './navigation';

const ACCOUNT = 'operator-a';

describe('어드민 메뉴 개인화 쿠키 계약', () => {
  it('열린 그룹·즐겨찾기·마지막 현재 그룹을 저장하고 그대로 읽는다', () => {
    const value = serializeAdminNavigationCookie({ openGroupIds: ['sales', 'sales'], favoriteScreenIds: ['orders'] }, 'sales');
    expect(parseAdminNavigationCookie(value)).toEqual({ openGroupIds: ['sales'], favoriteScreenIds: ['orders'], currentGroupId: 'sales' });
    /* next/headers는 값을 풀어서 준다. */
    expect(parseAdminNavigationCookie(decodeURIComponent(value))).toEqual({ openGroupIds: ['sales'], favoriteScreenIds: ['orders'], currentGroupId: 'sales' });
  });

  /* 공용 PC에서 B의 저장이 A의 즐겨찾기를 덮지 않게 쿠키를 계정마다 따로 둔다. */
  it('쿠키 이름에 계정이 들어가 계정마다 따로 저장된다', () => {
    expect(adminNavigationCookieName('c4df7bb0-76ec-43ac-9a63-6ce000564d2b')).toBe('icons_admin_nav_c4df7bb0-76ec-43ac-9a63-6ce000564d2b');
    expect(adminNavigationCookieName('user/a@example.com')).toBe('icons_admin_nav_user%2Fa%40example.com');
    expect(adminNavigationCookieName(' ')).toBe('icons_admin_nav_anonymous');
    expect(adminNavigationCookieName('operator-a')).not.toBe(adminNavigationCookieName('operator-b'));
  });

  it('망가진 값은 null로 닫고 목록의 잘못된 항목은 버린다', () => {
    expect(parseAdminNavigationCookie('{bad')).toBeNull();
    expect(parseAdminNavigationCookie('%ZZ')).toBeNull();
    expect(parseAdminNavigationCookie(null)).toBeNull();
    expect(parseAdminNavigationCookie(JSON.stringify({ open: ['sales', null, 3, ''], favorites: 'orders', current: 7 })))
      .toEqual({ openGroupIds: ['sales'], favoriteScreenIds: [], currentGroupId: null });
  });

  it('저장 줄은 계정별 이름·400일·전체 경로·SameSite=Lax다', () => {
    const assignment = adminNavigationCookieAssignment(ACCOUNT, { openGroupIds: [], favoriteScreenIds: [] }, null);
    expect(ADMIN_NAVIGATION_COOKIE_MAX_AGE).toBe(34_560_000);
    expect(assignment).toMatch(/^icons_admin_nav_operator-a=%7B/);
    expect(assignment.endsWith('; path=/; max-age=34560000; SameSite=Lax')).toBe(true);
  });

  it('document.cookie에서 이 계정의 쿠키만 꺼낸다', () => {
    const header = 'a=1; icons_admin_nav_operator-b=%7By%7D; icons_admin_nav_operator-a=%7Bx%7D; sidebar_state=true';
    expect(adminNavigationCookieFromHeader(header, ACCOUNT)).toBe('%7Bx%7D');
    expect(adminNavigationCookieFromHeader('a=1', ACCOUNT)).toBeNull();
  });

  it('셸과 사이드바가 같은 계정 키를 쓴다', () => {
    expect(adminNavigationAccountId({ id: 'uid', email: 'a@b', role: 'staff' })).toBe('uid');
    expect(adminNavigationAccountId({ id: '', email: 'a@b', role: 'staff' })).toBe('a@b');
    expect(adminNavigationAccountId({ id: '', email: null, role: 'staff' })).toBe('staff');
  });

  it('옛 localStorage 키에서 즐겨찾기만 꺼낸다', () => {
    expect(legacyAdminNavigationStorageKeys('user/a@example.com')).toEqual([
      'icons.admin.navigation.v3:user%2Fa%40example.com',
      'icons.admin.navigation.v2:user%2Fa%40example.com',
    ]);
    expect(parseLegacyAdminNavigationFavorites(JSON.stringify({ favoriteScreenIds: ['orders', 'orders', 3], collapsedGroupIds: ['sales'] }))).toEqual(['orders']);
    expect(parseLegacyAdminNavigationFavorites('{bad')).toEqual([]);
    expect(parseLegacyAdminNavigationFavorites(null)).toEqual([]);
  });
});

describe('열린 그룹 규칙(자동으로는 열기만, 닫기는 사용자만)', () => {
  const base = { openGroupIds: ['sales'], favoriteScreenIds: ['orders'] };

  it('현재 그룹을 합친다', () => {
    expect(withCurrentGroup(base, 'cs').openGroupIds).toEqual(['sales', 'cs']);
    expect(withCurrentGroup(base, 'sales')).toBe(base);
    expect(withCurrentGroup(base, null)).toBe(base);
  });

  describe('첫 렌더', () => {
    it('처음이면 현재 그룹만 연다', () => {
      expect(adminNavigationFirstRender(null, 'catalog')).toEqual({ openGroupIds: ['catalog'], favoriteScreenIds: [] });
      expect(adminNavigationFirstRender(undefined, null)).toEqual({ openGroupIds: [], favoriteScreenIds: [] });
    });

    it('다른 그룹에서 왔으면 현재 그룹을 연다', () => {
      expect(adminNavigationFirstRender({ openGroupIds: ['sales'], favoriteScreenIds: [], currentGroupId: 'sales' }, 'cs').openGroupIds).toEqual(['sales', 'cs']);
    });

    it('현재 그룹을 접고 새로고침해도 다시 열지 않는다', () => {
      expect(adminNavigationFirstRender({ openGroupIds: ['catalog'], favoriteScreenIds: [], currentGroupId: 'sales' }, 'sales').openGroupIds).toEqual(['catalog']);
    });

    it('모두 접기 뒤 새로고침해도 다시 열지 않는다', () => {
      expect(adminNavigationFirstRender({ openGroupIds: [], favoriteScreenIds: ['orders'], currentGroupId: 'sales' }, 'sales')).toEqual({ openGroupIds: [], favoriteScreenIds: ['orders'] });
    });

    it('홈처럼 그룹 없는 화면을 거쳐 돌아오면 다시 연다', () => {
      expect(adminNavigationFirstRender({ openGroupIds: [], favoriteScreenIds: [], currentGroupId: null }, 'sales').openGroupIds).toEqual(['sales']);
    });
  });

  it('머리글로 열고 닫는다', () => {
    expect(withGroupOpen(base, 'cs', true).openGroupIds).toEqual(['sales', 'cs']);
    expect(withGroupOpen(base, 'sales', false).openGroupIds).toEqual([]);
    expect(withGroupOpen(base, 'cs', false)).toBe(base);
  });

  it('모두 접기는 지금 콘솔의 그룹만 닫는다', () => {
    expect(withGroupsClosed({ openGroupIds: ['sales', 'content'], favoriteScreenIds: [] }, ['sales', 'cs']).openGroupIds).toEqual(['content']);
  });

  it('즐겨찾기를 토글한다', () => {
    expect(withFavoriteToggled(base, 'orders').favoriteScreenIds).toEqual([]);
    expect(withFavoriteToggled(base, 'dispatch').favoriteScreenIds).toEqual(['orders', 'dispatch']);
  });
});

describe('메뉴 설정 저장소', () => {
  let cookie: string | null;
  let writes: string[];
  let storage: Map<string, string>;
  let posted: unknown[];
  let channel: AdminNavigationChannel;
  let closed: number;
  let readAccount: string | null;
  let clock: number;

  const environment: AdminNavigationEnvironment = {
    readCookie: (accountId) => { readAccount = accountId; return cookie; },
    writeCookie: (assignment) => { writes.push(assignment); },
    storage: () => ({ getItem: (key) => storage.get(key) ?? null, removeItem: (key) => { storage.delete(key); } }),
    openChannel: () => channel,
    now: () => clock,
  };

  function saved(openGroupIds: string[], currentGroupId: string | null, favoriteScreenIds: string[] = []): SavedAdminNavigation {
    return { openGroupIds, favoriteScreenIds, currentGroupId };
  }

  function createStore(openGroupIds: string[], currentGroupId: string | null, favoriteScreenIds: string[] = []) {
    return createAdminNavigationStore({ accountId: ACCOUNT, saved: saved(openGroupIds, currentGroupId, favoriteScreenIds), currentGroupId, environment });
  }

  const written = () => {
    const assignment = writes.at(-1)!;
    expect(assignment.startsWith('icons_admin_nav_operator-a=')).toBe(true);
    return parseAdminNavigationCookie(assignment.split(';')[0].slice(assignment.indexOf('=') + 1));
  };

  beforeEach(() => {
    cookie = null;
    writes = [];
    storage = new Map();
    posted = [];
    closed = 0;
    readAccount = null;
    clock = 10_000;
    channel = { postMessage: (message) => { posted.push(message); }, close: () => { closed += 1; }, onmessage: null };
  });

  it('첫 진입에서 같은 그룹이면 쓰지 않는다 — 현재 그룹이 바뀔 때만 연다', () => {
    const store = createStore(['catalog'], 'catalog');
    store.setCurrentGroup('catalog');
    expect(writes).toEqual([]);
    expect(store.getSnapshot().openGroupIds).toEqual(['catalog']);
  });

  it('다른 그룹으로 이동하면 그 그룹을 열어 저장하고 이전 그룹은 그대로 둔다', () => {
    const store = createStore(['catalog'], 'catalog');
    store.setCurrentGroup('cs');
    expect(store.getSnapshot().openGroupIds).toEqual(['catalog', 'cs']);
    expect(written()).toEqual({ openGroupIds: ['catalog', 'cs'], favoriteScreenIds: [], currentGroupId: 'cs' });
  });

  it('이미 열린 그룹으로 옮겨도 현재 그룹은 기록한다(다음 진입 판단용)', () => {
    const store = createStore(['catalog', 'cs'], 'catalog');
    store.setCurrentGroup('cs');
    expect(written()?.currentGroupId).toBe('cs');
    expect(posted).toEqual([]);
  });

  it('현재 그룹을 접으면 그 그룹에 있다는 사실과 함께 저장해 새로고침이 다시 열지 않는다', () => {
    const store = createStore(['sales'], 'sales');
    store.update((current) => withGroupOpen(current, 'sales', false));
    expect(written()).toEqual({ openGroupIds: [], favoriteScreenIds: [], currentGroupId: 'sales' });
    expect(adminNavigationFirstRender(written(), 'sales').openGroupIds).toEqual([]);
  });

  it('같은 그룹 안의 이동으로는 다시 열리지 않고, 다른 그룹을 다녀오면 다시 열린다', () => {
    const store = createStore(['sales'], 'sales');
    store.update((current) => withGroupOpen(current, 'sales', false));
    store.setCurrentGroup('sales');
    expect(store.getSnapshot().openGroupIds).toEqual([]);
    store.setCurrentGroup('catalog');
    store.setCurrentGroup('sales');
    expect(store.getSnapshot().openGroupIds).toEqual(['catalog', 'sales']);
  });

  it('달라진 게 없으면 쓰지도 알리지도 않는다', () => {
    const store = createStore(['sales'], 'sales');
    let notified = 0;
    store.subscribe(() => { notified += 1; });
    store.update((current) => withGroupOpen(current, 'sales', true));
    expect(writes).toEqual([]);
    expect(notified).toBe(0);
  });

  it('바꾸면 같은 계정의 다른 탭에 알린다', () => {
    const store = createStore(['sales'], 'sales');
    const disconnect = store.connect();
    store.update((current) => withGroupOpen(current, 'cs', true));
    expect(posted).toEqual([{ openGroupIds: ['sales', 'cs'], favoriteScreenIds: [], currentGroupId: 'sales' }]);
    disconnect();
    expect(closed).toBe(1);
  });

  it('다른 그룹에 있는 탭의 값을 받으면 이 탭의 현재 그룹은 닫지 않고 되돌려 보내지도 않는다', () => {
    const store = createStore(['sales'], 'sales');
    store.connect();
    writes = [];
    channel.onmessage?.({ data: { openGroupIds: ['cs'], favoriteScreenIds: ['orders'], currentGroupId: 'cs' } });
    expect(store.getSnapshot()).toEqual({ openGroupIds: ['cs', 'sales'], favoriteScreenIds: ['orders'] });
    expect(posted).toEqual([]);
    expect(writes).toEqual([]);
  });

  it('같은 그룹에 있는 탭에서 접은 것은 그대로 따른다(닫기는 사용자의 조작이다)', () => {
    const store = createStore(['sales'], 'sales');
    store.connect();
    channel.onmessage?.({ data: { openGroupIds: [], favoriteScreenIds: [], currentGroupId: 'sales' } });
    expect(store.getSnapshot().openGroupIds).toEqual([]);
  });

  /* 첫 즐겨찾기가 생기면 칸이 나타나 목록이 72px 밀린다. 같은 자리의 두 번째 클릭은 다른 줄에 맞는다. */
  it('별을 누른 직후의 추가 토글은 무시하고, 잠시 뒤에는 받는다', () => {
    const store = createStore(['sales'], 'sales');
    store.toggleFavorite('orders');
    expect(store.getSnapshot().favoriteScreenIds).toEqual(['orders']);
    clock += ADMIN_FAVORITE_TOGGLE_GUARD_MS - 1;
    store.toggleFavorite('dispatch');
    expect(store.getSnapshot().favoriteScreenIds).toEqual(['orders']);
    clock += 1;
    store.toggleFavorite('dispatch');
    expect(store.getSnapshot().favoriteScreenIds).toEqual(['orders', 'dispatch']);
  });

  it('처음 오면 현재 위치를 기록해 다음 진입이 같은 그룹인지 알게 한다', () => {
    const store = createAdminNavigationStore({ accountId: ACCOUNT, saved: null, currentGroupId: 'sales', environment });
    store.connect();
    expect(readAccount).toBe(ACCOUNT);
    expect(written()).toEqual({ openGroupIds: ['sales'], favoriteScreenIds: [], currentGroupId: 'sales' });
  });

  it('옛 localStorage 즐겨찾기를 한 번 옮기고 키를 지운다(접힘 목록은 버린다)', () => {
    const [v3, v2] = legacyAdminNavigationStorageKeys(ACCOUNT);
    storage.set(v3, JSON.stringify({ favoriteScreenIds: ['orders'], collapsedGroupIds: ['sales'] }));
    storage.set(v2, JSON.stringify({ favoriteScreenIds: ['goods'] }));
    const store = createStore(['sales'], 'sales', ['dispatch']);
    store.connect();
    expect(store.getSnapshot()).toEqual({ openGroupIds: ['sales'], favoriteScreenIds: ['dispatch', 'orders'] });
    expect(storage.size).toBe(0);
    expect(writes.length).toBeGreaterThan(0);
  });

  it('v3가 없으면 v2 즐겨찾기를 옮긴다', () => {
    const [, v2] = legacyAdminNavigationStorageKeys(ACCOUNT);
    storage.set(v2, JSON.stringify({ favoriteScreenIds: ['goods'] }));
    const store = createStore([], null);
    store.connect();
    expect(store.getSnapshot().favoriteScreenIds).toEqual(['goods']);
    expect(storage.size).toBe(0);
  });

  it('쿠키의 위치와 같고 옛 값이 없으면 연결만으로 쓰지 않는다', () => {
    cookie = serializeAdminNavigationCookie({ openGroupIds: ['sales'], favoriteScreenIds: [] }, 'sales');
    createStore(['sales'], 'sales').connect();
    expect(writes).toEqual([]);
  });

  it('저장소가 막혀 있어도 멈추지 않는다', () => {
    const store = createAdminNavigationStore({
      accountId: ACCOUNT,
      saved: saved(['sales'], 'sales'),
      currentGroupId: 'sales',
      environment: { ...environment, storage: () => ({ getItem: () => { throw new Error('blocked'); }, removeItem: () => {} }), openChannel: () => null },
    });
    expect(() => store.connect()).not.toThrow();
    expect(() => store.update((current) => withFavoriteToggled(current, 'orders'))).not.toThrow();
  });

  it('뒤로 가기로 되살아난 셸은 낡은 서버 값 대신 쿠키를 다시 읽고 같은 규칙을 적용한다', () => {
    cookie = serializeAdminNavigationCookie({ openGroupIds: ['catalog'], favoriteScreenIds: ['orders'] }, 'catalog');
    const store = createStore(['sales'], 'sales');
    store.connect();
    expect(store.getSnapshot()).toEqual({ openGroupIds: ['catalog', 'sales'], favoriteScreenIds: ['orders'] });
    cookie = serializeAdminNavigationCookie({ openGroupIds: ['catalog'], favoriteScreenIds: [] }, 'sales');
    const same = createStore(['sales'], 'sales');
    same.connect();
    expect(same.getSnapshot().openGroupIds).toEqual(['catalog']);
  });
});

describe('메뉴 검색', () => {
  const groups = visibleAdminNavGroups('admin');
  const screenIds = (query: string) => filterAdminNavGroups(groups, adminMenuQuery(query)).flatMap((group) => group.screens.map((screen) => screen.id));

  it('평소 말(keywords)로 화면을 찾는다', () => {
    expect(screenIds('쿠폰')).toEqual(expect.arrayContaining(['coupon-register', 'coupons']));
    expect(screenIds('쿠폰 발급')).toEqual(expect.arrayContaining(['coupon-register', 'coupons']));
    expect(screenIds('쿠폰발급')).toEqual(expect.arrayContaining(['coupon-register', 'coupons']));
    expect(screenIds('택배')).toEqual(expect.arrayContaining(['shipping', 'shipping-carriers']));
    expect(screenIds('쿠폰')).not.toContain('orders');
  });

  it('메뉴 이름도 공백·대소문자와 무관하게 찾는다', () => {
    expect(screenIds('상품등록')).toContain('goods-create');
    expect(screenIds('ERP')).toContain('erp-items');
    expect(screenIds('erp')).toContain('erp-items');
  });

  it('그룹 이름이 맞으면 그 그룹 전체를 보인다', () => {
    const sales = filterAdminNavGroups(groups, adminMenuQuery('주문관리')).find((group) => group.id === 'sales');
    expect(sales?.screens.map((screen) => screen.id)).toContain('dispatch');
  });

  it('검색어가 없으면 그대로, 없는 말이면 빈 목록이다', () => {
    expect(filterAdminNavGroups(groups, '')).toHaveLength(groups.length);
    expect(filterAdminNavGroups(groups, adminMenuQuery('없는메뉴ㅋ'))).toEqual([]);
  });

  /* 다른 담당이 메뉴 이름을 고쳐도 검색어가 과하게 늘지 않게 묶어 둔다 */
  it('키워드는 일부 화면에만 몇 개씩 둔다', () => {
    const keyworded = groups.flatMap((group) => group.screens).filter((screen) => screen.keywords?.length);
    expect(keyworded.length).toBeLessThanOrEqual(8);
    for (const screen of keyworded) expect(screen.keywords!.length).toBeLessThanOrEqual(3);
  });
});

describe('메뉴 스크롤·즐겨찾기 판단', () => {
  const scroller = { scrollTop: 100, top: 50, bottom: 450 };

  it('이미 보이는 항목이면 움직이지 않는다', () => {
    expect(adminMenuScrollTop(scroller, { top: 60, bottom: 90 })).toBeNull();
    expect(adminMenuScrollTop(scroller, { top: 50, bottom: 450 })).toBeNull();
  });

  it('위로 넘치면 윗변에, 아래로 넘치면 아랫변에 맞춘다(nearest)', () => {
    expect(adminMenuScrollTop(scroller, { top: 20, bottom: 50 })).toBe(70);
    expect(adminMenuScrollTop(scroller, { top: 470, bottom: 500 })).toBe(150);
  });

  it('영역보다 긴 그룹을 펼쳐도 머리글은 위로 밀려 사라지지 않는다', () => {
    /* 머리글(top)이 영역 안 60에 있고 내용이 900까지 내려간다: 머리글이 맨 위(50)에 올 만큼만 민다. */
    expect(adminMenuScrollTop(scroller, { top: 60, bottom: 900 })).toBe(110);
    /* 머리글이 이미 맨 위면 더 밀지 않는다. */
    expect(adminMenuScrollTop(scroller, { top: 50, bottom: 900 })).toBeNull();
  });

  it('사용자가 방금 메뉴를 스크롤했으면 끌어오지 않는다', () => {
    expect(adminMenuUserScrolling(1000, 1000 + ADMIN_MENU_USER_SCROLL_QUIET_MS - 1)).toBe(true);
    expect(adminMenuUserScrolling(1000, 1000 + ADMIN_MENU_USER_SCROLL_QUIET_MS)).toBe(false);
    expect(adminMenuUserScrolling(Number.NEGATIVE_INFINITY, 0)).toBe(false);
  });

  /* 상단 상담하기·홈 카드처럼 메뉴 밖에서 시작한 이동은 방금 메뉴를 만졌어도 따라온다. */
  it('스크롤한 뒤 메뉴 밖을 눌렀으면 더는 메뉴를 보는 중이 아니다', () => {
    expect(adminMenuUserScrolling(1000, 1200, 1100)).toBe(false);
    expect(adminMenuUserScrolling(1000, 1200, 900)).toBe(true);
  });

  it('검색 중·아이콘 막대·닫힌 모바일 시트에서는 맞추지 않고 검색이 끝나면 다시 맞춘다', () => {
    const base = { iconRail: false, isMobile: false, openMobile: false, searching: false };
    expect(adminMenuFollowEnabled(base)).toBe(true);
    expect(adminMenuFollowEnabled({ ...base, searching: true })).toBe(false);
    expect(adminMenuFollowEnabled({ ...base, iconRail: true })).toBe(false);
    expect(adminMenuFollowEnabled({ ...base, isMobile: true })).toBe(false);
    expect(adminMenuFollowEnabled({ ...base, isMobile: true, openMobile: true })).toBe(true);
  });

  it('별을 누른 직후의 추가 토글은 받지 않는다', () => {
    expect(ADMIN_FAVORITE_TOGGLE_GUARD_MS).toBe(300);
    expect(adminFavoriteToggleAllowed(Number.NEGATIVE_INFINITY, 0)).toBe(true);
    expect(adminFavoriteToggleAllowed(1000, 1299)).toBe(false);
    expect(adminFavoriteToggleAllowed(1000, 1300)).toBe(true);
  });
});

describe('메뉴 따라가기', () => {
  function harness({ top = 100, bottom = 500 } = {}) {
    const frames: (() => void)[] = [];
    let itemRect = { top: 120, bottom: 150 };
    let interrupted = false;
    const scroller = { scrollTop: 0, getBoundingClientRect: () => ({ top, bottom }) };
    const cancelled: number[] = [];
    const run = (options: { available?: () => boolean; stickyOffset?: () => number } = {}) => followAdminMenuItem({
      scroller: () => (options.available?.() === false ? null : scroller),
      item: () => ({ getBoundingClientRect: () => itemRect }),
      stickyOffset: options.stickyOffset,
      interrupted: () => interrupted,
      requestFrame: (callback) => { frames.push(callback); return frames.length; },
      cancelFrame: (handle) => { cancelled.push(handle); },
    });
    return {
      scroller, frames, cancelled, run,
      moveItem: (next: { top: number; bottom: number }) => { itemRect = next; },
      interrupt: () => { interrupted = true; },
      nextFrame: () => frames.shift()!(),
    };
  }

  /* 전환이 늦게 시작해도 프레임마다 다시 맞춘다. 고정 시간 뒤 한 번 맞추던 방식은 이 경우 항목을 밖에 남겼다. */
  it('열리는 동안 항목이 내려가면 프레임마다 따라간다', () => {
    const test = harness();
    test.run();
    expect(test.scroller.scrollTop).toBe(0);
    test.moveItem({ top: 480, bottom: 520 });
    test.nextFrame();
    expect(test.scroller.scrollTop).toBe(20);
    test.moveItem({ top: 490, bottom: 560 });
    test.nextFrame();
    expect(test.scroller.scrollTop).toBe(80);
  });

  it('정해진 프레임 수까지만 따라간다', () => {
    const test = harness();
    test.run();
    for (let i = 1; i < ADMIN_MENU_FOLLOW_FRAMES; i += 1) test.nextFrame();
    expect(test.frames).toHaveLength(0);
  });

  it('사용자가 이어서 메뉴를 만지면 멈춘다', () => {
    const test = harness();
    test.run();
    test.interrupt();
    test.moveItem({ top: 480, bottom: 520 });
    test.nextFrame();
    expect(test.scroller.scrollTop).toBe(0);
    expect(test.frames).toHaveLength(0);
  });

  it('위에 붙어 있는 줄에 가리는 항목도 보이게 맞춘다', () => {
    const test = harness();
    test.scroller.scrollTop = 40;
    test.moveItem({ top: 110, bottom: 140 });
    test.run({ stickyOffset: () => 32 });
    expect(test.scroller.scrollTop).toBe(18);
  });

  it('스크롤 영역이 아직 없어도(모바일 시트) 나타나면 맞춘다', () => {
    const test = harness();
    let available = false;
    test.moveItem({ top: 480, bottom: 520 });
    test.run({ available: () => available });
    expect(test.scroller.scrollTop).toBe(0);
    available = true;
    test.nextFrame();
    expect(test.scroller.scrollTop).toBe(20);
  });

  it('해제하면 예약한 프레임을 취소한다', () => {
    const test = harness();
    const stop = test.run();
    stop();
    expect(test.cancelled).toEqual([1]);
  });
});
