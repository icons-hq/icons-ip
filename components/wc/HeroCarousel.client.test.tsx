import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomeHeroSlide } from '@/lib/home-catalog';

/*
 * 메인 배너 자동 넘김(MD 요청 11/12: 메인 배너도 일정 시간 후 자동 슬라이드)의 동작 시험 — DOM 이 없는 환경이라 훅을 직접 굴린다.
 * 핵심은 "화살표·진행 막대로 직접 넘겨 본 뒤에도 자동 넘김이 이어진다"(예전에는 한 번 누르면 영구 정지였다)와
 * 멈추는 조건이 정지 버튼·배너 위 포인터·키보드 포커스뿐이라는 것이다.
 * useEffect 는 React 처럼 의존성이 바뀔 때만 다시 실행한다(그래야 화면을 다시 그려도 타이머가 매번 처음부터 세어지지 않는다).
 */
type Effect = { effect: () => void | (() => void); deps?: readonly unknown[] };
const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  index: 0,
  effects: [] as { effect: () => void | (() => void); deps?: readonly unknown[] }[],
  memo: [] as ({ deps?: readonly unknown[]; cleanup?: () => void } | undefined)[],
}));

vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.states[index], (next: unknown) => {
      hooks.states[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.states[index]) : next;
    }];
  },
  useRef: () => ({ current: null }),
  useEffect: (effect: Effect['effect'], deps?: readonly unknown[]) => { hooks.effects.push({ effect, deps }); },
}));

import { HERO_AUTOPLAY_MS, HeroCarousel } from './HeroCarousel';

type El = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): El[] => Children.toArray(node).flatMap((value) => (
  isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []));

const slides: HomeHeroSlide[] = ['a', 'b', 'c'].map((id) => ({
  id, title: `배너 ${id}`, subtitle: null, imageUrl: `https://cdn.example/${id}.webp`, mobileImageUrl: null, href: `/events/${id}`,
}));

/** 현재 상태로 한 번 그린다(효과는 아직 반영하지 않는다). */
function draw(list: HomeHeroSlide[] = slides) {
  hooks.index = 0;
  hooks.effects = [];
  return nodes(HeroCarousel({ slides: list }));
}

/** 그린 효과를 React 처럼 반영한다 — 의존성이 바뀐 효과만 앞 정리(clearTimeout)를 돌린 뒤 다시 단다. */
function commit() {
  hooks.effects.forEach(({ effect, deps }, i) => {
    const prev = hooks.memo[i];
    if (prev?.deps && deps && deps.length === prev.deps.length && deps.every((dep, k) => Object.is(dep, prev.deps![k]))) return;
    prev?.cleanup?.();
    const cleanup = effect();
    hooks.memo[i] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined };
  });
}

function render(list?: HomeHeroSlide[]) {
  const tree = draw(list);
  commit();
  return tree;
}

const byLabel = (tree: El[], label: string) => tree.find((node) => node.props['aria-label'] === label)!;
const activeIndex = (tree: El[]) => tree
  .filter((node) => typeof node.props['aria-label'] === 'string' && /^\d번 슬라이드/.test(node.props['aria-label'] as string))
  .findIndex((node) => node.props['aria-current'] === 'true');
/** 이벤트를 일으키고 React 처럼 곧바로 다시 그려 효과(타이머)를 반영한다. */
const fire = (handler: unknown, ...args: unknown[]) => { (handler as (...values: unknown[]) => void)(...args); return render(); };
const click = (label: string) => fire(byLabel(render(), label).props.onClick);
const advance = (ms: number) => { vi.advanceTimersByTime(ms); return render(); };
const section = () => draw().find((node) => node.props['aria-roledescription'] === 'carousel')!;
const viewport = () => draw().find((node) => node.props.className === 'wc-hero__viewport')!;

beforeEach(() => {
  vi.useFakeTimers();
  hooks.states = [];
  hooks.index = 0;
  hooks.effects = [];
  hooks.memo = [];
  vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
});

afterEach(() => {
  for (const entry of hooks.memo) entry?.cleanup?.();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('HeroCarousel autoplay with manual moves', () => {
  it('advances on its own every interval and wraps to the first slide', () => {
    expect(activeIndex(render())).toBe(0);
    expect(activeIndex(advance(HERO_AUTOPLAY_MS - 1))).toBe(0);
    expect(activeIndex(advance(1))).toBe(1);
    expect(activeIndex(advance(HERO_AUTOPLAY_MS))).toBe(2);
    expect(activeIndex(advance(HERO_AUTOPLAY_MS))).toBe(0);
  });

  /* 직접 넘긴 뒤에도 정지 버튼은 '일시정지'(누르지 않은 상태)로 남고, 자동 넘김은 직접 넘긴 시점부터 다시 5초를 센다. */
  it('keeps autoplaying after the next arrow, restarting the countdown from the click', () => {
    render();
    advance(3000);
    click('다음 슬라이드');

    const after = render();
    expect(activeIndex(after)).toBe(1);
    expect(byLabel(after, '자동재생 일시정지').props['aria-pressed']).toBe(false);
    expect(activeIndex(advance(HERO_AUTOPLAY_MS - 1))).toBe(1);
    expect(activeIndex(advance(1))).toBe(2);
  });

  it('keeps autoplaying after the previous arrow and wraps backwards from the first slide', () => {
    render();
    click('이전 슬라이드');
    expect(activeIndex(render())).toBe(2);
    expect(activeIndex(advance(HERO_AUTOPLAY_MS))).toBe(0);
  });

  it('keeps autoplaying after picking a slide on the progress bar', () => {
    render();
    click('3번 슬라이드: 배너 c');
    expect(activeIndex(render())).toBe(2);
    expect(byLabel(render(), '자동재생 일시정지').props['aria-pressed']).toBe(false);
    expect(activeIndex(advance(HERO_AUTOPLAY_MS))).toBe(0);
  });

  /* 멈추는 것은 정지 버튼뿐이고, 같은 버튼이 다시 재생한다. */
  it('stops only through the pause button, which also resumes', () => {
    render();
    click('자동재생 일시정지');
    const paused = render();
    expect(byLabel(paused, '자동재생 재생').props['aria-pressed']).toBe(true);
    expect(activeIndex(advance(HERO_AUTOPLAY_MS * 3))).toBe(0);

    /* 멈춘 동안에도 직접 넘길 수는 있고, 그래도 멈춘 채다. */
    click('다음 슬라이드');
    expect(activeIndex(render())).toBe(1);
    expect(activeIndex(advance(HERO_AUTOPLAY_MS * 2))).toBe(1);

    click('자동재생 재생');
    expect(activeIndex(advance(HERO_AUTOPLAY_MS))).toBe(2);
  });

  /* 포인터 정지는 배너 이미지 위에서만이다 — 아래 조작 줄의 화살표 위에 포인터가 있어도 넘어간다(조작 줄에는 hover 핸들러가 없다). */
  it('pauses while the pointer is over the banner box and resumes when it leaves', () => {
    render();
    fire(viewport().props.onMouseEnter);
    expect(activeIndex(advance(HERO_AUTOPLAY_MS * 2))).toBe(0);
    fire(viewport().props.onMouseLeave);
    expect(activeIndex(advance(HERO_AUTOPLAY_MS))).toBe(1);
    expect(section().props.onMouseEnter).toBeUndefined();
  });

  it('does not pause for a pointer-press focus on a control, only for keyboard focus', () => {
    render();
    fire(section().props.onFocusCapture, { target: { matches: () => false } });
    expect(activeIndex(advance(HERO_AUTOPLAY_MS))).toBe(1);

    fire(section().props.onFocusCapture, { target: { matches: (selector: string) => selector === ':focus-visible' } });
    expect(activeIndex(advance(HERO_AUTOPLAY_MS * 2))).toBe(1);

    fire(section().props.onBlurCapture, { relatedTarget: null });
    expect(activeIndex(advance(HERO_AUTOPLAY_MS))).toBe(2);
  });

  it('never arms a timer for a single slide', () => {
    render([slides[0]]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
