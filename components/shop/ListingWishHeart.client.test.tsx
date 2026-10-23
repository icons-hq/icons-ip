import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* 목록 하트의 동작 테스트 — jsdom 없이 훅을 얇게 흉내 내 컴포넌트 함수를 직접 부른다
   (선례: components/campaign/CampaignMoreList.client.test.tsx). 전환은 콜백을 붙잡아 두었다가
   테스트가 직접 기다린다 — 그 사이 화면이 낙관 상태를 그리는지 확인하려는 것이다. */

const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  stateIndex: 0,
  transitions: [] as Promise<void>[],
  effects: [] as (() => void)[],
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
    /* 마운트 effect 는 붙잡아 두었다가 mount() 가 돌린다 — 렌더 중에는 저장소를 바꾸지 않는다는 것도 함께 본다. */
    useEffect: (effect: () => void) => { hooks.effects.push(effect); },
  };
});

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock('@/app/shop/actions', () => ({ toggleWishlistAction: mocks.toggle }));

import { INQUIRY_DRAFT_SIGN_OUT_EVENT } from '@/lib/admin/inquiry-draft-lifecycle';
import { confirmedWish, forgetWishConfirmations, observeWishSignOut } from './wishlist-heart-store';
import { ListingWishHeart, type ListingWishHeartProps } from './ListingWishHeart';

function render(props: Partial<ListingWishHeartProps> = {}) {
  hooks.stateIndex = 0;
  return ListingWishHeart({ goodId: 'g1', initialWished: false, label: '홍실 키링', viewerId: 'member-a', ...props });
}

/** 렌더한 뒤 마운트 effect 를 돌린다(실제 마운트와 같은 순서). */
function mount(props: Partial<ListingWishHeartProps> = {}) {
  const tree = render(props);
  for (const effect of hooks.effects.splice(0)) effect();
  return tree;
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
  hooks.effects = [];
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
    expect(confirmedWish('member-a', 'g1')).toBe(true);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('rolls back to the pre-click state when the server refuses the change', async () => {
    mocks.toggle.mockResolvedValue({ ok: false, error: 'unavailable' });

    button(render({ initialWished: true })).onClick();
    expect(mocks.toggle).toHaveBeenCalledWith('g1', false);
    await settle();

    expect(button(render({ initialWished: true }))['aria-pressed']).toBe(true);
    expect(confirmedWish('member-a', 'g1')).toBeUndefined();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('treats a rejected action call like a refusal', async () => {
    mocks.toggle.mockRejectedValue(new Error('network'));

    button(render()).onClick();
    await settle();

    expect(button(render())['aria-pressed']).toBe(false);
    expect(confirmedWish('member-a', 'g1')).toBeUndefined();
  });

  /* 비로그인은 현행 로그인 벽이다 — 저장할 곳이 없으니 액션을 부르지도 않는다. */
  it('sends a guest straight to login with the current list as next', () => {
    button(render({ viewerId: null })).onClick();

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

/* 로그아웃·로그인은 server action redirect 라 소프트 내비게이션이다 — 모듈 저장소가 살아남는다.
   이전 회원의 확인값이 다음 회원(또는 같은 회원의 재로그인)의 서버 값을 덮으면 안 된다(l4-data-2 · l4-ui-2). */
describe('ListingWishHeart 회원 경계', () => {
  async function confirmAsMemberA() {
    mocks.toggle.mockResolvedValue({ ok: true, wished: true });
    button(mount()).onClick();
    await settle();
    expect(confirmedWish('member-a', 'g1')).toBe(true);
    hooks.states = [];
  }

  it('does not paint member A’s confirmed heart for member B in the same tab', async () => {
    await confirmAsMemberA();

    /* 첫 렌더부터 B 의 서버 값이다 — 저장소 정리는 마운트 effect 가 하지만 읽기가 이미 뷰어로 걸러진다. */
    expect(button(render({ viewerId: 'member-b', initialWished: false }))['aria-pressed']).toBe(false);
    hooks.states = [];
    expect(button(mount({ viewerId: 'member-b', initialWished: true }))['aria-pressed']).toBe(true);
    expect(confirmedWish('member-a', 'g1')).toBeUndefined();
  });

  it('empties the store when a guest heart mounts after sign-out', async () => {
    await confirmAsMemberA();

    expect(button(mount({ viewerId: null, initialWished: true }))['aria-pressed']).toBe(false);
    hooks.states = [];
    expect(button(render({ viewerId: 'member-a', initialWished: false }))['aria-pressed']).toBe(false);
  });

  it('starts from server values when the same member signs back in after the sign-out signal', async () => {
    const target = new EventTarget();
    const stop = observeWishSignOut(target);
    await confirmAsMemberA();

    target.dispatchEvent(new Event(INQUIRY_DRAFT_SIGN_OUT_EVENT));
    stop();

    expect(button(mount({ viewerId: 'member-a', initialWished: false }))['aria-pressed']).toBe(false);
  });

  it('keeps the store untouched while rendering — only the mount effect claims it', async () => {
    await confirmAsMemberA();

    render({ viewerId: 'member-b' });
    expect(confirmedWish('member-a', 'g1')).toBe(true);
    expect(hooks.effects).toHaveLength(1);
  });
});
