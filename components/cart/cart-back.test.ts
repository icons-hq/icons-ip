import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CART_BACK_PROBE_MS, cartBackPlan, goBackFromCart, probeBack, type CartBackEnv, type ProbeWindow } from './cart-back';

/* 모바일 카트 서브헤더 [← 이전] 판정(CT-03 · l9-data-4·l9-ui-1). history.length 만으로는 지금 위치·앞 기록의 출처를 모른다. */

type Listener = () => void;
function fakeWindow({ length, canGoBack, href = 'https://icons.test/cart' }: { length: number; canGoBack?: boolean; href?: string }) {
  const listeners = new Map<string, Set<Listener>>();
  const win = {
    location: { href },
    history: { length },
    ...(canGoBack === undefined ? {} : { navigation: { canGoBack } }),
    addEventListener: (type: string, listener: Listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type: string, listener: Listener) => listeners.get(type)?.delete(listener),
    setTimeout: (handler: () => void, timeout: number) => setTimeout(handler, timeout),
  };
  const fire = (type: string) => listeners.get(type)?.forEach((listener) => listener());
  const listening = () => [...listeners.values()].reduce((total, set) => total + set.size, 0);
  return { win: win as CartBackEnv & ProbeWindow & { location: { href: string } }, fire, listening };
}

describe('[← 이전] 판정', () => {
  it('Navigation API 가 있으면 앞에 같은 출처(ICONS) 기록이 있을 때만 뒤로 간다', () => {
    expect(cartBackPlan({ navigation: { canGoBack: true }, history: { length: 2 } })).toBe('back');
    /* 첫 기록인 장바구니에서 앞으로 갔다 돌아온 경우 — 길이는 2 지만 앞에 기록이 없다. */
    expect(cartBackPlan({ navigation: { canGoBack: false }, history: { length: 2 } })).toBe('listing');
    /* 빈 탭·다른 사이트에서 들어온 경우 — 길이는 2 지만 앞 기록이 다른 출처라 목록에 없다. */
    expect(cartBackPlan({ navigation: { canGoBack: false }, history: { length: 5 } })).toBe('listing');
  });

  it('Navigation API 가 없으면 기록이 하나뿐일 때 직전 목록, 그보다 길면 뒤로 가 본다', () => {
    expect(cartBackPlan({ history: { length: 1 } })).toBe('listing');
    expect(cartBackPlan({ navigation: null, history: { length: 1 } })).toBe('listing');
    expect(cartBackPlan({ history: { length: 3 } })).toBe('probe');
    /* canGoBack 이 불리언이 아니면 믿지 않는다. */
    expect(cartBackPlan({ navigation: {}, history: { length: 3 } })).toBe('probe');
  });
});

describe('뒤로 가 보기(Navigation API 가 없는 브라우저)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('뒤로 가기가 아무 일도 하지 않으면(첫 기록) 잠시 뒤 직전 목록으로 보낸다', () => {
    const { win, listening } = fakeWindow({ length: 2 });
    const back = vi.fn();
    const fallback = vi.fn();

    probeBack(win, back, fallback);
    expect(back).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(CART_BACK_PROBE_MS - 1);
    expect(fallback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(listening()).toBe(0);
  });

  it('기록을 옮겼으면(popstate) 직전 목록으로 보내지 않는다', () => {
    const { win, fire } = fakeWindow({ length: 3 });
    const fallback = vi.fn();

    probeBack(win, () => fire('popstate'), fallback);
    vi.advanceTimersByTime(CART_BACK_PROBE_MS);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('다른 문서로 돌아가 이 문서를 떠났으면(pagehide) bfcache 에서 되살아나도 늦게 보내지 않는다', () => {
    const { win, fire } = fakeWindow({ length: 3 });
    const fallback = vi.fn();

    probeBack(win, () => fire('pagehide'), fallback);
    vi.advanceTimersByTime(CART_BACK_PROBE_MS * 2);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('popstate 없이 주소가 바뀌었으면 보내지 않는다', () => {
    const { win } = fakeWindow({ length: 3 });
    const fallback = vi.fn();

    probeBack(win, () => { win.location.href = 'https://icons.test/shop/g13'; }, fallback);
    vi.advanceTimersByTime(CART_BACK_PROBE_MS);
    expect(fallback).not.toHaveBeenCalled();
  });
});

describe('서브헤더 동작', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('판정대로 뒤로 가거나 직전 목록으로 보낸다 — 첫 기록에서는 죽은 버튼이 되지 않는다', () => {
    const cases = [
      { env: { length: 4, canGoBack: true }, back: 1, listing: 0 },
      { env: { length: 2, canGoBack: false }, back: 0, listing: 1 },
      { env: { length: 1 }, back: 0, listing: 1 },
    ];
    for (const { env, back: backs, listing } of cases) {
      const { win } = fakeWindow(env);
      const back = vi.fn();
      const toListing = vi.fn();
      goBackFromCart(win, back, toListing);
      vi.advanceTimersByTime(CART_BACK_PROBE_MS);
      expect([back.mock.calls.length, toListing.mock.calls.length]).toEqual([backs, listing]);
    }
  });

  it('Navigation API 없이 기록이 길면 뒤로 가 보고, 아무 일도 없을 때만 직전 목록으로 보낸다', () => {
    const { win } = fakeWindow({ length: 2 });
    const back = vi.fn();
    const toListing = vi.fn();

    goBackFromCart(win, back, toListing);
    expect(back).toHaveBeenCalledTimes(1);
    expect(toListing).not.toHaveBeenCalled();
    vi.advanceTimersByTime(CART_BACK_PROBE_MS);
    expect(toListing).toHaveBeenCalledTimes(1);
  });
});
