import { isValidElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* 직전 목록 기록·읽기의 동작 테스트 — jsdom 없이 훅을 얇게 흉내 내 컴포넌트 함수를 직접 부른다
   (선례: components/shop/ListingWishHeart.client.test.tsx). 마운트 effect 는 붙잡아 두었다가 mount() 가 돌린다. */

const hooks = vi.hoisted(() => ({
  effects: [] as (() => void)[],
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
    useEffect: (effect: () => void) => { hooks.effects.push(effect); },
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
import { ListingReturnRecorder, currentListingReturnHref, useListingReturnHref } from './ListingReturn';

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

function visit(pathname: string, search = '') {
  nav.pathname = pathname;
  nav.search = search;
  expect(ListingReturnRecorder()).toBeNull();
  for (const effect of hooks.effects.splice(0)) effect();
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
  nav.back.mockReset();
  nav.push.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('직전 목록 기록 (셸 · CT-02)', () => {
  it('목록 화면을 볼 때마다 남기고, 상세·마이 같은 화면은 직전 목록을 덮지 않는다', () => {
    const { storage, values } = sessionStorageStub();
    vi.stubGlobal('window', { sessionStorage: storage });

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
    vi.stubGlobal('window', { sessionStorage: storage });
    nav.pathname = '/shop/new';
    nav.search = '';

    ListingReturnRecorder();
    expect(values.size).toBe(0);
    for (const effect of hooks.effects.splice(0)) effect();
    expect(values.get(LISTING_RETURN_STORAGE_KEY)).toBe('/shop/new');
  });

  it('세션 저장소 접근이 막힌 브라우저에서도 던지지 않고 굿즈샵으로 읽는다', () => {
    vi.stubGlobal('window', {
      get sessionStorage(): never { throw new Error('SecurityError'); },
    });

    expect(() => visit('/shop/best')).not.toThrow();
    expect(currentListingReturnHref()).toBe('/shop');
    expect(useListingReturnHref()).toBe('/shop');
  });
});

describe('빈 장바구니 둘러보기 목적지', () => {
  it('하이드레이션 뒤 클라이언트 렌더는 남겨 둔 직전 목록으로 CTA 를 잇는다', () => {
    const { storage } = sessionStorageStub({ [LISTING_RETURN_STORAGE_KEY]: '/ip/hong-sil-quest' });
    vi.stubGlobal('window', { sessionStorage: storage });

    const tree = CartEmptyState({});
    const cta = findElement(tree, (element) => element.props.className === 'wc-cart__empty-cta');

    expect(cta?.props.href).toBe('/ip/hong-sil-quest');
    expect(cta?.props.variant).toBe('accent');
  });

  it('저장소에 외부 주소가 들어 있어도 CTA 는 굿즈샵으로 간다', () => {
    const { storage } = sessionStorageStub({ [LISTING_RETURN_STORAGE_KEY]: 'https://evil.example/shop' });
    vi.stubGlobal('window', { sessionStorage: storage });

    const cta = findElement(CartEmptyState({}), (element) => element.props.className === 'wc-cart__empty-cta');
    expect(cta?.props.href).toBe('/shop');
  });

  it('일러스트(LG-7)를 넘기면 안내 위 장식 자리에 그린다', () => {
    vi.stubGlobal('window', { sessionStorage: sessionStorageStub().storage });

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
    vi.stubGlobal('window', { history: { length: 3 }, sessionStorage: sessionStorageStub().storage });

    backButton().onClick();
    expect(nav.back).toHaveBeenCalledTimes(1);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('새 탭·직접 입력으로 온 장바구니는 직전 목록(없으면 굿즈샵)으로 보낸다', () => {
    const { storage } = sessionStorageStub({ [LISTING_RETURN_STORAGE_KEY]: '/shop/best' });
    vi.stubGlobal('window', { history: { length: 1 }, sessionStorage: storage });
    backButton().onClick();
    expect(nav.push).toHaveBeenLastCalledWith('/shop/best');

    vi.stubGlobal('window', { history: { length: 1 }, sessionStorage: sessionStorageStub().storage });
    backButton().onClick();
    expect(nav.push).toHaveBeenLastCalledWith('/shop');
    expect(nav.back).not.toHaveBeenCalled();
  });
});
