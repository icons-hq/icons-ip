import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* 목록 하트의 동작 테스트 — jsdom 없이 훅을 얇게 흉내 내 컴포넌트 함수를 직접 부른다
   (선례: components/campaign/CampaignMoreList.client.test.tsx). 전환은 콜백을 붙잡아 두었다가
   테스트가 직접 기다린다 — 그 사이 화면이 낙관 상태를 그리는지 확인하려는 것이다. */

const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  stateIndex: 0,
  transitions: [] as Promise<void>[],
}));

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  toggle: vi.fn(),
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = hooks.stateIndex++;
      if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      const set = (next: unknown) => {
        hooks.states[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.states[index]) : next;
      };
      return [hooks.states[index], set];
    },
    useTransition: () => [false, (callback: () => Promise<void>) => { hooks.transitions.push(callback()); }],
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  };
});

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock('@/app/shop/actions', () => ({ toggleWishlistAction: mocks.toggle }));

import { confirmedWish, forgetWishConfirmations } from './wishlist-heart-store';
import { ListingWishHeart, type ListingWishHeartProps } from './ListingWishHeart';

function render(props: Partial<ListingWishHeartProps> = {}) {
  hooks.stateIndex = 0;
  return ListingWishHeart({ goodId: 'g1', initialWished: false, label: '홍실 키링', signedIn: true, ...props });
}

function button(tree: ReactNode) {
  const element = isValidElement(tree) ? (tree as ReactElement<Record<string, unknown>>) : null;
  if (!element || element.type !== 'button') throw new Error('heart is not a button');
  return element.props as { 'aria-pressed': boolean; onClick: () => void };
}

async function settle() {
  await Promise.all(hooks.transitions.splice(0));
}

beforeEach(() => {
  hooks.states = [];
  hooks.transitions = [];
  mocks.push.mockReset();
  mocks.refresh.mockReset();
  mocks.toggle.mockReset();
  forgetWishConfirmations();
  vi.stubGlobal('window', { location: { pathname: '/shop', search: '?type=%ED%82%A4%EB%A7%81' } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ListingWishHeart 토글 (CL-01 · 12 LD-4)', () => {
  it('flips first, records the server-confirmed state, and never refreshes the whole list', async () => {
    let resolve: (value: unknown) => void = () => {};
    mocks.toggle.mockReturnValue(new Promise((done) => { resolve = done; }));

    button(render()).onClick();
    expect(mocks.toggle).toHaveBeenCalledWith('g1', true);
    /* 서버 응답 전에도 하트는 이미 켜져 있다 — 여러 개를 연달아 누를 때 어느 것을 눌렀는지 보인다. */
    expect(button(render())['aria-pressed']).toBe(true);

    resolve({ ok: true, wished: true });
    await settle();

    expect(button(render())['aria-pressed']).toBe(true);
    expect(confirmedWish('g1')).toBe(true);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('rolls back to the pre-click state when the server refuses the change', async () => {
    mocks.toggle.mockResolvedValue({ ok: false, error: 'unavailable' });

    button(render({ initialWished: true })).onClick();
    expect(mocks.toggle).toHaveBeenCalledWith('g1', false);
    await settle();

    expect(button(render({ initialWished: true }))['aria-pressed']).toBe(true);
    expect(confirmedWish('g1')).toBeUndefined();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('treats a rejected action call like a refusal', async () => {
    mocks.toggle.mockRejectedValue(new Error('network'));

    button(render()).onClick();
    await settle();

    expect(button(render())['aria-pressed']).toBe(false);
    expect(confirmedWish('g1')).toBeUndefined();
  });

  /* 비로그인은 현행 로그인 벽이다 — 저장할 곳이 없으니 액션을 부르지도 않는다. */
  it('sends a guest straight to login with the current list as next', () => {
    button(render({ signedIn: false })).onClick();

    expect(mocks.toggle).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith(`/login?next=${encodeURIComponent('/shop?type=%ED%82%A4%EB%A7%81')}`);
  });

  it('reverts and goes to login when the session ended before the click reached the server', async () => {
    mocks.toggle.mockResolvedValue({ ok: false, error: 'auth_required' });

    button(render()).onClick();
    await settle();

    expect(button(render())['aria-pressed']).toBe(false);
    expect(mocks.push).toHaveBeenCalledWith(`/login?next=${encodeURIComponent('/shop?type=%ED%82%A4%EB%A7%81')}`);
  });

  /* 같은 굿즈가 한 화면에 두 번 있거나 뒤로 가기가 옛 서버 렌더를 되살려도 확인된 값이 이긴다. */
  it('prefers the session-confirmed state over a stale server snapshot', async () => {
    mocks.toggle.mockResolvedValue({ ok: true, wished: true });

    button(render()).onClick();
    await settle();

    hooks.states = [];
    expect(button(render({ initialWished: false }))['aria-pressed']).toBe(true);
  });
});
