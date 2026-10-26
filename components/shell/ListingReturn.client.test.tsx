import { readFileSync } from 'node:fs';
import { isValidElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* 직전 목록 기록·읽기의 동작 테스트 — jsdom 없이 훅을 얇게 흉내 내 컴포넌트 함수를 직접 부른다
   (선례: components/shop/ListingWishHeart.client.test.tsx). effect 는 의존값과 정리 함수까지 React 처럼 다룬다 —
   라우트가 바뀌면 앞 라우트의 정리(지켜보기 중단)가 먼저 돈다. */

type Cleanup = void | (() => void);
const hooks = vi.hoisted(() => ({
  effects: [] as { effect: () => Cleanup; deps?: readonly unknown[] }[],
  syncSnapshots: [] as string[],
}));

const nav = vi.hoisted(() => ({
  pathname: '/shop',
  search: '',
  back: vi.fn(),
  push: vi.fn(),
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useEffect: (effect: () => Cleanup, deps?: readonly unknown[]) => { hooks.effects.push({ effect, deps }); },
    /* 클라이언트 렌더는 getSnapshot 을 쓴다(서버 렌더는 getServerSnapshot — Cart.test 가 /shop 으로 본다). */
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => string) => {
      const value = getSnapshot();
      hooks.syncSnapshots.push(value);
      return value;
    },
  };
});

vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ back: nav.back, push: nav.push }),
}));

import { LISTING_RETURN_STORAGE_KEY } from '@/lib/listing-return';
import { CartEmptyState } from '@/components/cart/CartEmptyState';
import { CartSubheader } from '@/components/cart/CartSubheader';
import { ListingReturnRecorder, currentListingReturnHref, routeSurface, useListingReturnHref } from './ListingReturn';

function sessionStorageStub(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    },
  };
}

/* #root 의 라우트 표면 — 루트 경계 표식(.wc-loading·.wc-fallback)만 흉내 낸다. */
type Surface = 'rendered' | 'pending' | 'fallback';
const page = { surface: 'rendered' as Surface, hasRoot: true };
const root = {
  querySelector: (selector: string) => {
    if (selector === '.wc-fallback') return page.surface === 'fallback' ? {} : null;
    if (selector === '.wc-loading') return page.surface === 'pending' ? {} : null;
    return null;
  },
};

/* MutationObserver 흉내 — 지켜보는 중인 콜백을 모아 두고 mutate() 가 DOM 변화를 알린다. */
const observers = new Set<{ callback: () => void; target: unknown }>();
class FakeMutationObserver {
  private entry: { callback: () => void; target: unknown } | null = null;
  constructor(private readonly callback: () => void) {}
  observe(target: unknown) {
    this.entry = { callback: this.callback, target };
    observers.add(this.entry);
  }
  disconnect() {
    if (this.entry) observers.delete(this.entry);
    this.entry = null;
  }
}
function mutate(surface: Surface) {
  page.surface = surface;
  for (const observer of [...observers]) observer.callback();
}

function stubBrowser(storage: { getItem(key: string): string | null; setItem(key: string, value: string): void } | null, extra: Record<string, unknown> = {}) {
  /* extra 의 접근자(던지는 sessionStorage 등)를 펼치면 그 자리에서 불린다 — 서술자째 옮긴다. */
  vi.stubGlobal('window', Object.defineProperties({
    ...(storage ? { sessionStorage: storage } : {}),
    history: { length: 1 },
    addEventListener: () => {},
    removeEventListener: () => {},
  }, Object.getOwnPropertyDescriptors(extra)));
  vi.stubGlobal('document', { getElementById: (id: string) => (id === 'root' && page.hasRoot ? root : null) });
  vi.stubGlobal('MutationObserver', FakeMutationObserver);
}

/* 셸에 한 번 마운트된 기록기 — 라우트가 바뀔 때마다 다시 렌더하고, 의존값이 바뀐 effect 만 앞 정리 뒤에 다시 돌린다. */
const slots: { deps?: readonly unknown[]; cleanup: Cleanup }[] = [];
function renderRecorder() {
  hooks.effects = [];
  expect(ListingReturnRecorder()).toBeNull();
  hooks.effects.forEach(({ effect, deps }, index) => {
    const slot = slots[index];
    if (slot && deps && slot.deps && deps.length === slot.deps.length && deps.every((dep, i) => Object.is(dep, slot.deps![i]))) return;
    if (typeof slot?.cleanup === 'function') slot.cleanup();
    slots[index] = { deps, cleanup: effect() };
  });
}

function visit(pathname: string, search = '', surface: Surface = 'rendered') {
  nav.pathname = pathname;
  nav.search = search;
  page.surface = surface;
  renderRecorder();
}

type Props = Record<string, unknown> & { children?: unknown };
function findElement(node: unknown, match: (element: ReactElement<Props>) => boolean): ReactElement<Props> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, match);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const element = node as ReactElement<Props>;
  if (match(element)) return element;
  return findElement(element.props.children, match);
}

beforeEach(() => {
  hooks.effects = [];
  hooks.syncSnapshots = [];
  slots.length = 0;
  observers.clear();
  page.surface = 'rendered';
  page.hasRoot = true;
  nav.back.mockReset();
  nav.push.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('라우트 표면 판정', () => {
  it('찾을 수 없음·오류 표면은 fallback, 로딩 경계는 pending, 나머지는 rendered', () => {
    page.surface = 'fallback';
    expect(routeSurface(root)).toBe('fallback');
    page.surface = 'pending';
    expect(routeSurface(root)).toBe('pending');
    page.surface = 'rendered';
    expect(routeSurface(root)).toBe('rendered');
  });

  /* 표식은 루트 경계 파일이 그린다 — 이름이 바뀌면 기록기가 404 를 목록으로 남기거나 아무것도 남기지 못한다. */
  it('루트 경계 파일이 기록기가 보는 표식을 그린다', () => {
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
    expect(read('../../app/not-found.tsx')).toMatch(/className="wc-fallback wc-not-found"/);
    expect(read('../../app/error.tsx')).toMatch(/className="wc-fallback"/);
    expect(read('../../app/loading.tsx')).toMatch(/className="wc-container wc-loading"/);
  });
});

describe('직전 목록 기록 (셸 · CT-02)', () => {
  it('목록 화면을 볼 때마다 남기고, 상세·마이 같은 화면은 직전 목록을 덮지 않는다', () => {
    const { storage, values } = sessionStorageStub();
    stubBrowser(storage);

    visit('/shop', 'type=%ED%82%A4%EB%A7%81&icm=TOKEN1234');
    expect(values.get(LISTING_RETURN_STORAGE_KEY)).toBe('/shop?type=%ED%82%A4%EB%A7%81');

    visit('/shop/g13');
    visit('/my');
    visit('/cart');
    expect(currentListingReturnHref()).toBe('/shop?type=%ED%82%A4%EB%A7%81');

    visit('/search', 'q=%EA%B3%B0');
    expect(currentListingReturnHref()).toBe('/search?q=%EA%B3%B0');
  });

  it('렌더 중에는 저장소를 건드리지 않는다 — 마운트 뒤 effect 에서만 남긴다', () => {
    const { storage, values } = sessionStorageStub();
    stubBrowser(storage);
    nav.pathname = '/shop/new';
    nav.search = '';

    ListingReturnRecorder();
    expect(values.size).toBe(0);
    for (const { effect } of hooks.effects.splice(0)) effect();
    expect(values.get(LISTING_RETURN_STORAGE_KEY)).toBe('/shop/new');
  });

  it('세션 저장소 접근이 막힌 브라우저에서도 던지지 않고 굿즈샵으로 읽는다', () => {
    stubBrowser(null, { get sessionStorage(): never { throw new Error('SecurityError'); } });

    expect(() => visit('/shop/best')).not.toThrow();
    expect(currentListingReturnHref()).toBe('/shop');
    expect(useListingReturnHref()).toBe('/shop');
  });

  /* l9-data-1: 팔로우·알림 액션 redirect 의 결과 플래그는 그 화면에서 한 번만 보여야 한다. */
  it('IP관 액션 결과 플래그가 붙은 주소는 플래그를 뗀 목록 주소로 남긴다', () => {
    const { storage, values } = sessionStorageStub();
    stubBrowser(storage);

    visit('/ip/hong-sil-quest', 'notification_saved=1');
    expect(values.get(LISTING_RETURN_STORAGE_KEY)).toBe('/ip/hong-sil-quest');
    visit('/ip/hong-sil-quest', 'type=a&follow_error=1');
    expect(values.get(LISTING_RETURN_STORAGE_KEY)).toBe('/ip/hong-sil-quest?type=a');
  });

  /* l9-data-2: 없는·보관된 IP관은 notFound() 를 부르지만 soft 404 라 주소와 200 만으로는 목록과 구별되지 않는다. */
  it('찾을 수 없음 화면은 직전 목록을 덮지 않는다 — 기록이 없으면 굿즈샵', () => {
    const { storage, values } = sessionStorageStub();
    stubBrowser(storage);

    visit('/ip/no-such-ip', '', 'fallback');
    expect(values.has(LISTING_RETURN_STORAGE_KEY)).toBe(false);
    expect(currentListingReturnHref()).toBe('/shop');

    visit('/shop/new');
    visit('/ip/archived-ip', '', 'fallback');
    expect(currentListingReturnHref()).toBe('/shop/new');
  });

  it('로딩 경계가 걷힌 뒤 목록이 그려지면 그때 남기고, 찾을 수 없음으로 끝나면 남기지 않는다', () => {
    const { storage, values } = sessionStorageStub({ [LISTING_RETURN_STORAGE_KEY]: '/shop/best' });
    stubBrowser(storage);

    visit('/ip/hong-sil-quest', 'sort=price_asc', 'pending');
    expect(values.get(LISTING_RETURN_STORAGE_KEY)).toBe('/shop/best');
    mutate('pending');
    expect(values.get(LISTING_RETURN_STORAGE_KEY)).toBe('/shop/best');
    mutate('rendered');
    expect(values.get(LISTING_RETURN_STORAGE_KEY)).toBe('/ip/hong-sil-quest?sort=price_asc');
    expect(observers.size).toBe(0);

    visit('/ip/no-such-ip', '', 'pending');
    mutate('fallback');
    expect(values.get(LISTING_RETURN_STORAGE_KEY)).toBe('/ip/hong-sil-quest?sort=price_asc');
  });

  it('오류 화면에서 다시 시도해 목록이 그려지면 그때 남긴다', () => {
    const { storage, values } = sessionStorageStub();
    stubBrowser(storage);

    visit('/shop', 'type=a', 'fallback');
    expect(values.has(LISTING_RETURN_STORAGE_KEY)).toBe(false);
    mutate('rendered');
    expect(values.get(LISTING_RETURN_STORAGE_KEY)).toBe('/shop?type=a');
  });

  it('그려지기 전에 다른 화면으로 떠나면 지켜보기를 그만둬 앞 목록을 늦게 남기지 않는다', () => {
    const { storage, values } = sessionStorageStub({ [LISTING_RETURN_STORAGE_KEY]: '/shop/new' });
    stubBrowser(storage);

    visit('/search', 'q=%ED%82%A4%EB%A7%81', 'pending');
    expect(observers.size).toBe(1);
    visit('/shop/g13', '', 'pending');
    expect(observers.size).toBe(0);
    mutate('rendered');
    expect(values.get(LISTING_RETURN_STORAGE_KEY)).toBe('/shop/new');
  });

  it('#root 가 없는 문서에서는 남기지 않는다', () => {
    const { storage, values } = sessionStorageStub();
    stubBrowser(storage);
    page.hasRoot = false;

    visit('/shop');
    expect(values.has(LISTING_RETURN_STORAGE_KEY)).toBe(false);
  });
});

describe('빈 장바구니 둘러보기 목적지', () => {
  it('하이드레이션 뒤 클라이언트 렌더는 남겨 둔 직전 목록으로 CTA 를 잇는다', () => {
    const { storage } = sessionStorageStub({ [LISTING_RETURN_STORAGE_KEY]: '/ip/hong-sil-quest' });
    stubBrowser(storage);

    const tree = CartEmptyState({});
    const cta = findElement(tree, (element) => element.props.className === 'wc-cart__empty-cta');

    expect(cta?.props.href).toBe('/ip/hong-sil-quest');
    expect(cta?.props.variant).toBe('accent');
  });

  it('저장소에 외부 주소가 들어 있어도 CTA 는 굿즈샵으로 간다', () => {
    const { storage } = sessionStorageStub({ [LISTING_RETURN_STORAGE_KEY]: 'https://evil.example/shop' });
    stubBrowser(storage);

    const cta = findElement(CartEmptyState({}), (element) => element.props.className === 'wc-cart__empty-cta');
    expect(cta?.props.href).toBe('/shop');
  });

  it('일러스트(LG-7)를 넘기면 안내 위 장식 자리에 그린다', () => {
    stubBrowser(sessionStorageStub().storage);

    const tree = CartEmptyState({ art: <svg data-art="cart-empty" viewBox="0 0 146 146" /> });
    const art = findElement(tree, (element) => element.props.className === 'wc-cart__empty-art');
    const children = (isValidElement(tree) ? (tree as ReactElement<Props>).props.children : []) as unknown[];

    expect(art?.props['aria-hidden']).toBe('true');
    expect(children.findIndex((child) => child === art)).toBe(0);
  });
});

describe('모바일 서브헤더 [← 이전] (CT-03)', () => {
  function backButton() {
    const button = findElement(CartSubheader(), (element) => element.props['aria-label'] === '이전 페이지');
    if (!button) throw new Error('back button missing');
    return button.props as { onClick: () => void };
  }

  it('이 탭에 돌아갈 기록이 있으면 뒤로 간다', () => {
    stubBrowser(sessionStorageStub().storage, { history: { length: 3 } });

    backButton().onClick();
    expect(nav.back).toHaveBeenCalledTimes(1);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('새 탭·직접 입력으로 온 장바구니는 직전 목록(없으면 굿즈샵)으로 보낸다', () => {
    const { storage } = sessionStorageStub({ [LISTING_RETURN_STORAGE_KEY]: '/shop/best' });
    stubBrowser(storage, { history: { length: 1 } });
    backButton().onClick();
    expect(nav.push).toHaveBeenLastCalledWith('/shop/best');

    stubBrowser(sessionStorageStub().storage, { history: { length: 1 } });
    backButton().onClick();
    expect(nav.push).toHaveBeenLastCalledWith('/shop');
    expect(nav.back).not.toHaveBeenCalled();
  });
});
