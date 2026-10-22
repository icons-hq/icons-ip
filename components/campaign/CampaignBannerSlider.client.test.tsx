import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* 배너 자동 넘김의 동작 테스트 — 이 저장소 테스트는 jsdom 없이 돌므로 React 훅을 얇게 흉내 내
   컴포넌트 함수를 직접 부르고, effect 를 손으로 돌린다(선례: components/home/HomeAnnouncementPopup.client.test.tsx).
   render() 한 번이 React 의 렌더 + 커밋 한 번이다 — effect 안의 setState 를 화면에 반영하려면 다시 render() 한다. */

const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  stateIndex: 0,
  refs: [] as { current: unknown }[],
  refIndex: 0,
  effects: [] as (() => (() => void) | void)[],
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
    useRef: (initial: unknown) => {
      const index = hooks.refIndex++;
      if (!(index in hooks.refs)) hooks.refs[index] = { current: initial };
      return hooks.refs[index];
    },
    useEffect: (effect: () => (() => void) | void) => {
      hooks.effects.push(effect);
    },
  };
});

import { CAMPAIGN_BANNER_AUTOPLAY_MS, CampaignBannerSlider } from './CampaignBannerSlider';

type Listener = (event?: unknown) => void;

/* useRef 호출 순서: rootRef → trackRef → controlRef → touching */
const ROOT = 0;
const TRACK = 1;
const CONTROL = 2;

let cleanups: (() => void)[] = [];
let trackListeners: Record<string, Listener>;
let documentListeners: Record<string, Listener>;
let media: { matches: boolean; addEventListener: (type: string, fn: Listener) => void; removeEventListener: () => void };
let documentStub: { hidden: boolean; addEventListener: (type: string, fn: Listener) => void; removeEventListener: () => void };
let track: { children: { offsetLeft: number }[]; scrollLeft: number; addEventListener: (type: string, fn: Listener) => void; removeEventListener: (type: string) => void; scrollTo: ReturnType<typeof vi.fn> };
const insideNode = { name: 'banner link' };
const controlNode = { name: 'rotation control' };
const outsideNode = { name: 'outside' };

function render(slideCount = 3) {
  cleanups.forEach((cleanup) => cleanup());
  cleanups = [];
  hooks.stateIndex = 0;
  hooks.refIndex = 0;
  hooks.effects = [];
  const slides = Array.from({ length: slideCount }, (_, index) => <span key={`slide-${index}`}>{index}</span>);
  const tree = CampaignBannerSlider({ children: slides, label: '추천 캠페인' }) as ReactElement<Record<string, unknown>>;
  hooks.refs[ROOT]!.current = { contains: (node: unknown) => node === insideNode || node === controlNode };
  hooks.refs[TRACK]!.current = track;
  hooks.refs[CONTROL]!.current = { contains: (node: unknown) => node === controlNode };
  cleanups = hooks.effects.map((effect) => effect()).filter((cleanup): cleanup is () => void => typeof cleanup === 'function');
  return tree;
}

/** 렌더 + 커밋을 두 번 — effect 가 처음 읽은 값(현재 장·문서 상태)을 화면에 반영한다. */
function settle(slideCount = 3) {
  render(slideCount);
  return render(slideCount);
}

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...elements(element.props.children as ReactNode)];
}

function byLabel(tree: ReactNode, label: string) {
  return elements(tree).find((element) => element.props['aria-label'] === label);
}

beforeEach(() => {
  vi.useFakeTimers();
  hooks.states = [];
  hooks.refs = [];
  trackListeners = {};
  documentListeners = {};
  track = {
    children: [{ offsetLeft: 0 }, { offsetLeft: 375 }, { offsetLeft: 750 }],
    scrollLeft: 0,
    addEventListener: (type, fn) => { trackListeners[type] = fn; },
    removeEventListener: (type) => { delete trackListeners[type]; },
    scrollTo: vi.fn(({ left }: { left: number }) => { track.scrollLeft = left; }),
  };
  media = { matches: false, addEventListener: () => {}, removeEventListener: () => {} };
  documentStub = {
    hidden: false,
    addEventListener: (type, fn) => { documentListeners[type] = fn; },
    removeEventListener: () => {},
  };
  vi.stubGlobal('document', documentStub);
  vi.stubGlobal('window', { matchMedia: () => media });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => setTimeout(() => callback(0), 16));
  vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
});

afterEach(() => {
  cleanups.forEach((cleanup) => cleanup());
  cleanups = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('이벤트 허브 배너 자동 넘김 (11 §6 B21)', () => {
  it('5초 뒤 다음 장으로 부드럽게 넘긴다', () => {
    settle();
    vi.advanceTimersByTime(CAMPAIGN_BANNER_AUTOPLAY_MS - 1);
    expect(track.scrollTo).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(track.scrollTo).toHaveBeenCalledWith({ left: 375, behavior: 'smooth' });
  });

  /* loop 없음 — 마지막 장에서 멈추고 정지 버튼도 걷는다. */
  it('마지막 장에서는 더 넘기지 않고 정지 버튼을 걷는다', () => {
    track.scrollLeft = 750;
    const tree = settle();
    vi.advanceTimersByTime(CAMPAIGN_BANNER_AUTOPLAY_MS * 2);

    expect(track.scrollTo).not.toHaveBeenCalled();
    expect(byLabel(tree, '자동 넘김 일시정지')).toBeUndefined();
    expect(byLabel(tree, '자동 넘김 재생')).toBeUndefined();
  });

  it('손가락으로 트랙을 넘기면 자동 넘김을 멈추고 재생 버튼으로 바꾼다', () => {
    settle();
    trackListeners.touchstart?.();
    track.scrollLeft = 120;
    trackListeners.scroll?.();
    trackListeners.touchend?.();
    const tree = render();
    vi.advanceTimersByTime(CAMPAIGN_BANNER_AUTOPLAY_MS * 2);

    expect(track.scrollTo).not.toHaveBeenCalled();
    expect(byLabel(tree, '자동 넘김 재생')).toBeDefined();
  });

  /* 리사이즈 뒤 스냅 보정·스크립트 scrollTo 는 손가락 없이 생긴다 — 조작으로 세지 않는다. */
  it('손가락 없이 생긴 트랙 스크롤은 조작으로 세지 않는다', () => {
    settle();
    trackListeners.scroll?.();
    const tree = render();
    vi.advanceTimersByTime(CAMPAIGN_BANNER_AUTOPLAY_MS);

    expect(byLabel(tree, '자동 넘김 일시정지')).toBeDefined();
    expect(track.scrollTo).toHaveBeenCalledTimes(1);
  });

  it('가로 휠은 멈추고 세로 휠은 그대로 둔다', () => {
    settle();
    trackListeners.wheel?.({ deltaX: 2, deltaY: 40, shiftKey: false });
    expect(byLabel(render(), '자동 넘김 일시정지')).toBeDefined();

    trackListeners.wheel?.({ deltaX: 30, deltaY: 4, shiftKey: false });
    expect(byLabel(render(), '자동 넘김 재생')).toBeDefined();
  });

  it('배너 링크에 포커스가 머무는 동안 멈추고, 빠져나가면 다시 넘긴다', () => {
    const tree = settle();
    (tree.props.onFocusCapture as Listener)({ target: insideNode });
    render();
    vi.advanceTimersByTime(CAMPAIGN_BANNER_AUTOPLAY_MS * 2);
    expect(track.scrollTo).not.toHaveBeenCalled();

    (tree.props.onBlurCapture as Listener)({ relatedTarget: outsideNode });
    render();
    vi.advanceTimersByTime(CAMPAIGN_BANNER_AUTOPLAY_MS);
    expect(track.scrollTo).toHaveBeenCalledTimes(1);
  });

  /* APG 회전 컨트롤 — 키보드로 정지 버튼을 눌러 "재생"을 고르면 그 버튼에 포커스가 있어도 바로 다시 돈다. */
  it('정지 버튼 자신의 포커스는 자동 넘김을 막지 않아 "재생"이 곧바로 듣는다', () => {
    let tree = settle();
    (tree.props.onFocusCapture as Listener)({ target: controlNode });
    tree = render();
    (byLabel(tree, '자동 넘김 일시정지')!.props.onClick as Listener)();
    tree = render();
    vi.advanceTimersByTime(CAMPAIGN_BANNER_AUTOPLAY_MS * 2);
    expect(track.scrollTo).not.toHaveBeenCalled();

    (byLabel(tree, '자동 넘김 재생')!.props.onClick as Listener)();
    render();
    vi.advanceTimersByTime(CAMPAIGN_BANNER_AUTOPLAY_MS);
    expect(track.scrollTo).toHaveBeenCalledWith({ left: 375, behavior: 'smooth' });
  });

  /* 터치의 호환 마우스 이벤트는 leave 가 오지 않아 hover 가 굳는다 — 실제 마우스만 hover 로 센다. */
  it('마우스 hover 만 멈추고 터치 포인터는 hover 로 세지 않는다', () => {
    const tree = settle();
    (tree.props.onPointerEnter as Listener)({ pointerType: 'touch' });
    render();
    vi.advanceTimersByTime(CAMPAIGN_BANNER_AUTOPLAY_MS);
    expect(track.scrollTo).toHaveBeenCalledTimes(1);

    (tree.props.onPointerEnter as Listener)({ pointerType: 'mouse' });
    render();
    vi.advanceTimersByTime(CAMPAIGN_BANNER_AUTOPLAY_MS * 2);
    expect(track.scrollTo).toHaveBeenCalledTimes(1);

    (tree.props.onPointerLeave as Listener)({ pointerType: 'mouse' });
    render();
    vi.advanceTimersByTime(CAMPAIGN_BANNER_AUTOPLAY_MS);
    expect(track.scrollTo).toHaveBeenCalledTimes(2);
  });

  it('문서가 가려지면 멈춘다', () => {
    settle();
    documentStub.hidden = true;
    documentListeners.visibilitychange?.();
    render();
    vi.advanceTimersByTime(CAMPAIGN_BANNER_AUTOPLAY_MS * 2);

    expect(track.scrollTo).not.toHaveBeenCalled();
  });

  /* DESIGN §5 — prefers-reduced-motion 이면 자동 넘김 자체가 없다. 누를 일이 없는 정지 버튼도 걷는다. */
  it('모션 축소 설정이면 자동으로 넘기지 않고 정지 버튼도 두지 않는다', () => {
    media.matches = true;
    const tree = settle();
    vi.advanceTimersByTime(CAMPAIGN_BANNER_AUTOPLAY_MS * 2);

    expect(track.scrollTo).not.toHaveBeenCalled();
    expect(byLabel(tree, '자동 넘김 일시정지')).toBeUndefined();
    expect(byLabel(tree, '1 / 3')).toBeDefined();
  });

  it('화살표로 넘기면 멈추고, 끝의 화살표는 눌러도 넘기지 않는다', () => {
    let tree = settle();
    (byLabel(tree, '이전 배너')!.props.onClick as Listener)();
    expect(track.scrollTo).not.toHaveBeenCalled();
    tree = render();
    expect(byLabel(tree, '자동 넘김 일시정지')).toBeDefined();

    (byLabel(tree, '다음 배너')!.props.onClick as Listener)();
    expect(track.scrollTo).toHaveBeenCalledWith({ left: 375, behavior: 'smooth' });
    tree = render();
    expect(byLabel(tree, '자동 넘김 재생')).toBeDefined();
  });
});
