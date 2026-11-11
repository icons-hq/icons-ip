import { beforeEach, describe, expect, it, vi } from 'vitest';

/* 장바구니·주문서가 견적 전에 기다리는 값(ADR-0026). jsdom 없이 훅을 얇게 흉내 내 effect·transition 을 손수 돌린다
   (선례: components/shop/GoodPurchasePanel.client.test.tsx). */
const hooks = vi.hoisted(() => ({
  ctx: { ready: true, mode: 'server' } as { ready: boolean; mode: string },
  states: [] as unknown[],
  stateIndex: 0,
  refs: [] as { current: unknown }[],
  refIndex: 0,
  effects: [] as (() => void)[],
  refreshing: false,
  release: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useContext: () => hooks.ctx,
    useState: (initial: unknown) => {
      const index = hooks.stateIndex++;
      if (!(index in hooks.states)) hooks.states[index] = initial;
      return [hooks.states[index], (next: unknown) => { hooks.states[index] = next; }];
    },
    useRef: (initial: unknown) => {
      const index = hooks.refIndex++;
      if (!(index in hooks.refs)) hooks.refs[index] = { current: initial };
      return hooks.refs[index];
    },
    useEffect: (effect: () => void) => { hooks.effects.push(effect); },
    useTransition: () => [hooks.refreshing, (callback: () => void) => { hooks.refreshing = true; callback(); }],
  };
});
vi.mock('next/navigation', () => ({ usePathname: () => '/cart', useRouter: () => ({ refresh: hooks.refresh }) }));
vi.mock('@/app/cart/actions', () => ({
  addCartSelectionAction: vi.fn(), deleteCartItemAction: vi.fn(), setCartItemQuantityAction: vi.fn(), syncCartAction: vi.fn(),
  releaseUnpaidCartOrdersAction: (...args: unknown[]) => hooks.release(...args),
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

import { useReleaseUnpaidCartOrders } from './CartProvider';

/* 훅을 컴포넌트처럼 한 번 그린다(이름이 대문자로 시작해야 hooks 규칙이 컴포넌트로 본다). */
function ReleaseProbe() {
  return useReleaseUnpaidCartOrders();
}

function render() {
  hooks.stateIndex = 0;
  hooks.refIndex = 0;
  hooks.effects = [];
  const value = ReleaseProbe();
  for (const effect of hooks.effects) effect();
  return value;
}

async function settle() {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

describe('useReleaseUnpaidCartOrders', () => {
  beforeEach(() => {
    hooks.ctx = { ready: true, mode: 'server' };
    hooks.states = [];
    hooks.refs = [];
    hooks.refreshing = false;
    hooks.release.mockReset();
    hooks.refresh.mockReset();
  });

  it('로그인 장바구니는 서버가 미결제 주문을 닫은 뒤에만 견적을 연다', async () => {
    hooks.release.mockResolvedValue({ released: 0 });
    expect(render()).toBe(false);
    expect(hooks.release).toHaveBeenCalledTimes(1);
    await settle();
    expect(render()).toBe(true);
    expect(hooks.release).toHaveBeenCalledTimes(1);
    expect(hooks.refresh).not.toHaveBeenCalled();
  });

  it('닫은 주문이 있으면 서버 화면을 다시 읽는 동안 견적을 기다린다', async () => {
    hooks.release.mockResolvedValue({ released: 1 });
    render();
    await settle();
    expect(hooks.refresh).toHaveBeenCalledTimes(1);
    expect(render()).toBe(false);
    hooks.refreshing = false;
    expect(render()).toBe(true);
  });

  it('요청이 실패해도 화면을 막지 않는다', async () => {
    hooks.release.mockRejectedValue(new Error('network'));
    render();
    await settle();
    expect(render()).toBe(true);
  });

  it('로그인하지 않은 장바구니는 기다리지 않고 서버에 요청하지 않는다', () => {
    hooks.ctx = { ready: true, mode: 'local' };
    expect(render()).toBe(true);
    expect(hooks.release).not.toHaveBeenCalled();
  });
});
