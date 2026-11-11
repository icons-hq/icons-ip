import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_NAVIGATION_BAR_DELAY_MS,
  ADMIN_NAVIGATION_BAR_MIN_VISIBLE_MS,
  ADMIN_NAVIGATION_DIM_DELAY_MS,
  ADMIN_NAVIGATION_GIVE_UP_MS,
  ADMIN_NAVIGATION_IDLE,
  ADMIN_NAVIGATION_SLOW_DELAY_MS,
  adminLinkClickIntent,
  adminNavigationStatusMessage,
  adminNavigationTarget,
  createAdminNavigationPendingStore,
  startAdminNavigation,
} from './navigation-pending';

const HERE = 'https://icons.test/admin/sales/orders?page=2';

function anchor(href: string, attributes: Record<string, string> = {}) {
  return {
    href,
    target: attributes.target ?? '',
    hasAttribute: (name: string) => name in attributes,
    getAttribute: (name: string) => attributes[name] ?? null,
  };
}

const click = (overrides = {}) => ({ button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: true, ...overrides });

describe('링크 클릭 판정', () => {
  it('Next Link가 맡은 내부 이동의 목적지를 잡는다', () => {
    expect(adminLinkClickIntent(click(), anchor('https://icons.test/admin/cs/chat?inquiryId=a#b'), HERE)).toEqual({
      kind: 'navigate',
      path: '/admin/cs/chat?inquiryId=a',
      href: 'https://icons.test/admin/cs/chat?inquiryId=a#b',
    });
  });

  it('브라우저가 처리할 클릭은 다루지 않는다', () => {
    expect(adminLinkClickIntent(click({ defaultPrevented: false }), anchor('https://icons.test/admin/cs/chat'), HERE)).toBeNull();
    expect(adminLinkClickIntent(click({ metaKey: true }), anchor('https://icons.test/admin/cs/chat'), HERE)).toBeNull();
    expect(adminLinkClickIntent(click({ ctrlKey: true }), anchor('https://icons.test/admin/cs/chat'), HERE)).toBeNull();
    expect(adminLinkClickIntent(click({ shiftKey: true }), anchor('https://icons.test/admin/cs/chat'), HERE)).toBeNull();
    expect(adminLinkClickIntent(click({ altKey: true }), anchor('https://icons.test/admin/cs/chat'), HERE)).toBeNull();
    expect(adminLinkClickIntent(click({ button: 1 }), anchor('https://icons.test/admin/cs/chat'), HERE)).toBeNull();
    expect(adminLinkClickIntent(click(), null, HERE)).toBeNull();
  });

  it('막혀 있는 링크는 대기를 시작하지 않는다', () => {
    expect(adminLinkClickIntent(click(), anchor('https://icons.test/admin/cs/chat', { 'aria-disabled': 'true' }), HERE)).toBeNull();
  });

  it('같은 주소·해시만 다른 링크는 진행 중인 이동을 대신한다', () => {
    expect(adminLinkClickIntent(click(), anchor(HERE), HERE)).toEqual({ kind: 'stay' });
    expect(adminLinkClickIntent(click(), anchor(`${HERE}#section`), HERE)).toEqual({ kind: 'stay' });
  });

  it('쿼리가 다르면 이동이다', () => {
    expect(adminLinkClickIntent(click(), anchor('https://icons.test/admin/sales/orders?page=3'), HERE)?.kind).toBe('navigate');
  });

  /* Link로 잘못 걸린 파일 내려받기는 주소가 바뀌지 않아 본문이 30초 잠겼다. */
  it('라우트 핸들러(/api/) 목적지는 화면 이동이 아니다', () => {
    expect(adminLinkClickIntent(click(), anchor('https://icons.test/api/admin/customer-demographics-workbook?from=a'), HERE)).toBeNull();
  });

  /* 알림 항목처럼 서버 처리에 실패하면 이동하지 않는 링크. */
  it('data-admin-nav-skip 표식이 있으면 클릭으로 대기를 시작하지 않는다', () => {
    expect(adminLinkClickIntent(click(), anchor('https://icons.test/admin/cs/chat', { 'data-admin-nav-skip': '' }), HERE)).toBeNull();
  });
});

describe('router.push 목적지 판정', () => {
  it('내부 화면이면 대기 대상이다', () => {
    expect(adminNavigationTarget('/admin/cs/inquiries/1?back=a#b', HERE)).toEqual({ path: '/admin/cs/inquiries/1?back=a', href: 'https://icons.test/admin/cs/inquiries/1?back=a#b' });
  });

  it('같은 주소·다른 사이트·라우트 핸들러는 대기하지 않는다', () => {
    expect(adminNavigationTarget('/admin/sales/orders?page=2#x', HERE)).toBeNull();
    expect(adminNavigationTarget('https://other.test/admin', HERE)).toBeNull();
    expect(adminNavigationTarget('/api/admin/export', HERE)).toBeNull();
  });
});

describe('이동 대기 단계', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function started() {
    const store = createAdminNavigationPendingStore();
    store.routeChanged('/admin/sales/orders');
    store.start('/admin/cs/chat', 'https://icons.test/admin/cs/chat');
    return store;
  }

  it('처음에는 아무 표시도 없다', () => {
    expect(createAdminNavigationPendingStore().getSnapshot()).toBe(ADMIN_NAVIGATION_IDLE);
  });

  it('누른 즉시 목적지만 잡고 막대·흐림은 없다', () => {
    const store = started();
    expect(store.getSnapshot()).toEqual({ path: '/admin/cs/chat', href: 'https://icons.test/admin/cs/chat', stage: 'waiting', barVisible: false });
    vi.advanceTimersByTime(ADMIN_NAVIGATION_BAR_DELAY_MS - 1);
    expect(store.getSnapshot().barVisible).toBe(false);
  });

  it('500ms에 막대, 1000ms에 흐림, 10초에 지연 안내', () => {
    const store = started();
    vi.advanceTimersByTime(ADMIN_NAVIGATION_BAR_DELAY_MS);
    expect(store.getSnapshot()).toMatchObject({ stage: 'bar', barVisible: true });
    vi.advanceTimersByTime(ADMIN_NAVIGATION_DIM_DELAY_MS - ADMIN_NAVIGATION_BAR_DELAY_MS);
    expect(store.getSnapshot()).toMatchObject({ stage: 'dim', barVisible: true });
    vi.advanceTimersByTime(ADMIN_NAVIGATION_SLOW_DELAY_MS - ADMIN_NAVIGATION_DIM_DELAY_MS);
    expect(store.getSnapshot()).toMatchObject({ stage: 'slow', barVisible: true });
  });

  it('500ms 전에 끝나면 아무것도 나오지 않는다', () => {
    const store = started();
    vi.advanceTimersByTime(ADMIN_NAVIGATION_BAR_DELAY_MS - 100);
    store.routeChanged('/admin/cs/chat');
    expect(store.getSnapshot()).toEqual(ADMIN_NAVIGATION_IDLE);
    vi.advanceTimersByTime(ADMIN_NAVIGATION_GIVE_UP_MS);
    expect(store.getSnapshot()).toEqual(ADMIN_NAVIGATION_IDLE);
  });

  it('막대가 나왔다면 대기가 끝나도 최소 시간은 보이고, 그동안 흐림은 없다', () => {
    const store = started();
    vi.advanceTimersByTime(ADMIN_NAVIGATION_BAR_DELAY_MS + 20);
    store.routeChanged('/admin/cs/chat');
    expect(store.getSnapshot()).toEqual({ path: null, href: null, stage: 'idle', barVisible: true });
    vi.advanceTimersByTime(ADMIN_NAVIGATION_BAR_MIN_VISIBLE_MS - 21);
    expect(store.getSnapshot().barVisible).toBe(true);
    vi.advanceTimersByTime(1);
    expect(store.getSnapshot()).toEqual(ADMIN_NAVIGATION_IDLE);
  });

  it('최소 시간을 넘겼으면 끝나는 즉시 사라진다', () => {
    const store = started();
    vi.advanceTimersByTime(ADMIN_NAVIGATION_DIM_DELAY_MS + 500);
    store.routeChanged('/admin/cs/chat');
    expect(store.getSnapshot()).toEqual(ADMIN_NAVIGATION_IDLE);
  });

  it('연속 클릭은 마지막 목적지만 남기고 진행 단계는 되돌리지 않는다', () => {
    const store = started();
    vi.advanceTimersByTime(ADMIN_NAVIGATION_BAR_DELAY_MS + 100);
    store.start('/admin/catalog/goods', 'https://icons.test/admin/catalog/goods');
    expect(store.getSnapshot()).toMatchObject({ path: '/admin/catalog/goods', stage: 'bar', barVisible: true });
    vi.advanceTimersByTime(ADMIN_NAVIGATION_DIM_DELAY_MS - ADMIN_NAVIGATION_BAR_DELAY_MS - 100);
    expect(store.getSnapshot().stage).toBe('dim');
  });

  it('지연 안내 뒤 다른 메뉴를 누르면 안내를 거두고 시간을 다시 잰다', () => {
    const store = started();
    vi.advanceTimersByTime(ADMIN_NAVIGATION_SLOW_DELAY_MS);
    store.start('/admin/catalog/goods', 'https://icons.test/admin/catalog/goods');
    expect(store.getSnapshot().stage).toBe('dim');
    vi.advanceTimersByTime(ADMIN_NAVIGATION_SLOW_DELAY_MS - 1);
    expect(store.getSnapshot().stage).toBe('dim');
    vi.advanceTimersByTime(1);
    expect(store.getSnapshot().stage).toBe('slow');
  });

  it('주소가 끝내 바뀌지 않으면 안전 시간 뒤에 푼다', () => {
    const store = started();
    vi.advanceTimersByTime(ADMIN_NAVIGATION_GIVE_UP_MS - 1);
    expect(store.getSnapshot().path).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(store.getSnapshot()).toEqual(ADMIN_NAVIGATION_IDLE);
  });

  it('같은 주소를 다시 알려도 끝나지 않는다', () => {
    const store = started();
    store.routeChanged('/admin/sales/orders');
    expect(store.getSnapshot().path).toBe('/admin/cs/chat');
  });

  it('낭독 문구는 흐림 단계부터 나오고 평소에는 비어 있다', () => {
    expect(adminNavigationStatusMessage('idle')).toBe('');
    expect(adminNavigationStatusMessage('waiting')).toBe('');
    expect(adminNavigationStatusMessage('bar')).toBe('');
    expect(adminNavigationStatusMessage('dim')).toBe('화면을 불러오는 중입니다.');
    expect(adminNavigationStatusMessage('slow')).toContain('응답이 늦어지고 있습니다');
  });

  describe('브라우저 이벤트', () => {
    function connected(location = { href: HERE, pathname: '/admin/sales/orders', search: '?page=2' }) {
      const listeners = new Map<string, (event: never) => void>();
      const body = { tag: 'body' };
      const doc = { addEventListener: (name: string, listener: never) => { listeners.set(name, listener); }, removeEventListener: (name: string) => { listeners.delete(name); }, activeElement: body as unknown, body };
      const win = { addEventListener: doc.addEventListener, removeEventListener: doc.removeEventListener, location };
      const store = createAdminNavigationPendingStore();
      store.routeChanged('/admin/sales/orders?page=2');
      const disconnect = store.connect(doc as never, win as never);
      return { store, listeners, disconnect, location, doc, body };
    }

    function focusable(connectedToDocument = true) {
      return { isConnected: connectedToDocument, focus: vi.fn() };
    }

    const linkEvent = (href: string, overrides = {}) => ({ ...click(overrides), target: { closest: () => anchor(href) } }) as never;

    it('문서 버블 단계에서 링크 클릭을 받아 대기를 시작한다', () => {
      const { store, listeners } = connected();
      listeners.get('click')!(linkEvent('https://icons.test/admin/cs/chat'));
      expect(store.getSnapshot()).toMatchObject({ path: '/admin/cs/chat', stage: 'waiting' });
    });

    it('이탈 경고가 취소한 클릭은 이 리스너에 오지 않고, 처리 안 된 클릭은 무시한다', () => {
      const { store, listeners } = connected();
      listeners.get('click')!(linkEvent('https://icons.test/admin/cs/chat', { defaultPrevented: false }));
      expect(store.getSnapshot()).toBe(ADMIN_NAVIGATION_IDLE);
    });

    it('같은 주소 링크를 누르면 진행 중인 대기를 끝낸다', () => {
      const { store, listeners } = connected();
      listeners.get('click')!(linkEvent('https://icons.test/admin/cs/chat'));
      listeners.get('click')!(linkEvent(HERE));
      expect(store.getSnapshot()).toEqual(ADMIN_NAVIGATION_IDLE);
    });

    it('뒤로 가기는 바뀐 주소를 목적지로 삼는다', () => {
      const { store, listeners, location } = connected();
      Object.assign(location, { href: 'https://icons.test/admin/cs/chat', pathname: '/admin/cs/chat', search: '' });
      listeners.get('popstate')!({} as never);
      expect(store.getSnapshot()).toMatchObject({ path: '/admin/cs/chat', stage: 'waiting' });
      store.routeChanged('/admin/cs/chat');
      expect(store.getSnapshot()).toEqual(ADMIN_NAVIGATION_IDLE);
    });

    it('뒤로 가기로 화면이 그대로면(해시만 다름) 대기를 끝낸다', () => {
      const { store, listeners } = connected();
      listeners.get('click')!(linkEvent('https://icons.test/admin/cs/chat'));
      listeners.get('popstate')!({} as never);
      expect(store.getSnapshot()).toEqual(ADMIN_NAVIGATION_IDLE);
    });

    it('쿼리 표기만 다른 주소로 돌아와도 같은 화면으로 본다', () => {
      const { store, listeners, location } = connected();
      store.routeChanged('/admin/cs/chat?q=a+b');
      Object.assign(location, { href: 'https://icons.test/admin/cs/chat?q=a%20b', pathname: '/admin/cs/chat', search: '?q=a%20b' });
      listeners.get('popstate')!({} as never);
      expect(store.getSnapshot()).toEqual(ADMIN_NAVIGATION_IDLE);
    });

    it('bfcache로 돌아오면 멈춰 있던 대기를 끝낸다', () => {
      const { store, listeners } = connected();
      listeners.get('click')!(linkEvent('https://icons.test/admin/cs/chat'));
      listeners.get('pageshow')!({ persisted: false } as never);
      expect(store.getSnapshot().path).not.toBeNull();
      listeners.get('pageshow')!({ persisted: true } as never);
      expect(store.getSnapshot()).toEqual(ADMIN_NAVIGATION_IDLE);
    });

    it('연결돼 있으면 router.push 앞에서 같은 대기를 시작하고, 같은 주소면 시작하지 않는다', () => {
      const { store, disconnect } = connected();
      startAdminNavigation('/admin/sales/orders?page=2');
      expect(store.getSnapshot()).toBe(ADMIN_NAVIGATION_IDLE);
      startAdminNavigation('/admin/cs/inquiries/1');
      expect(store.getSnapshot()).toMatchObject({ path: '/admin/cs/inquiries/1', href: 'https://icons.test/admin/cs/inquiries/1', stage: 'waiting' });
      disconnect();
    });

    it('셸 밖에서는 아무 일도 하지 않는다', () => {
      const { store, disconnect } = connected();
      disconnect();
      expect(() => startAdminNavigation('/admin/cs/inquiries/1')).not.toThrow();
      expect(store.getSnapshot()).toBe(ADMIN_NAVIGATION_IDLE);
    });

    describe('흐림으로 잃은 포커스', () => {
      it('잠그기 전 포커스를 기억했다가 풀린 뒤 되돌린다', () => {
        const { store, listeners, doc, body } = connected();
        const element = focusable();
        doc.activeElement = element;
        listeners.get('click')!(linkEvent('https://icons.test/admin/sales/orders?page=3'));
        vi.advanceTimersByTime(ADMIN_NAVIGATION_DIM_DELAY_MS);
        expect(store.getSnapshot().stage).toBe('dim');
        doc.activeElement = body; /* inert가 포커스를 빼앗았다. */
        store.routeChanged('/admin/sales/orders?page=3');
        store.restoreFocus();
        expect(element.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
      });

      it('이미 사라진 요소로는 되돌리지 않는다(화면이 바뀐 경우)', () => {
        const { store, listeners, doc, body } = connected();
        const element = focusable(false);
        doc.activeElement = element;
        listeners.get('click')!(linkEvent('https://icons.test/admin/cs/chat'));
        vi.advanceTimersByTime(ADMIN_NAVIGATION_DIM_DELAY_MS);
        doc.activeElement = body;
        store.routeChanged('/admin/cs/chat');
        store.restoreFocus();
        expect(element.focus).not.toHaveBeenCalled();
      });

      it('사용자가 그사이 다른 곳에 포커스를 뒀으면 건드리지 않는다', () => {
        const { store, listeners, doc } = connected();
        const element = focusable();
        doc.activeElement = element;
        listeners.get('click')!(linkEvent('https://icons.test/admin/cs/chat'));
        vi.advanceTimersByTime(ADMIN_NAVIGATION_DIM_DELAY_MS);
        doc.activeElement = focusable();
        store.routeChanged('/admin/cs/chat');
        store.restoreFocus();
        expect(element.focus).not.toHaveBeenCalled();
      });

      it('흐리기 전에 끝난 이동은 포커스를 건드리지 않는다', () => {
        const { store, listeners, doc } = connected();
        const element = focusable();
        doc.activeElement = element;
        listeners.get('click')!(linkEvent('https://icons.test/admin/cs/chat'));
        vi.advanceTimersByTime(ADMIN_NAVIGATION_DIM_DELAY_MS - 1);
        store.routeChanged('/admin/cs/chat');
        doc.activeElement = doc.body;
        store.restoreFocus();
        expect(element.focus).not.toHaveBeenCalled();
      });

      it('되돌리기는 한 번뿐이다', () => {
        const { store, listeners, doc, body } = connected();
        const element = focusable();
        doc.activeElement = element;
        listeners.get('click')!(linkEvent('https://icons.test/admin/sales/orders?page=3'));
        vi.advanceTimersByTime(ADMIN_NAVIGATION_DIM_DELAY_MS);
        doc.activeElement = body;
        store.finish();
        store.restoreFocus();
        store.restoreFocus();
        expect(element.focus).toHaveBeenCalledOnce();
      });
    });

    it('해제하면 리스너와 타이머가 모두 사라진다', () => {
      const { store, listeners, disconnect } = connected();
      listeners.get('click')!(linkEvent('https://icons.test/admin/cs/chat'));
      disconnect();
      expect(listeners.size).toBe(0);
      vi.advanceTimersByTime(ADMIN_NAVIGATION_GIVE_UP_MS);
      expect(store.getSnapshot().stage).toBe('waiting');
    });
  });
});
