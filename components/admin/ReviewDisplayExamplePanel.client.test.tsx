import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ state: [] as unknown[], index: 0, mock: false, refs: [] as { current: unknown }[], refIndex: 0, effects: [] as { effect: () => void | (() => void); deps?: unknown[] }[] }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual,
    useState: (initial: unknown) => {
      if (!hooks.mock) return actual.useState(initial);
      const index = hooks.index++;
      if (!(index in hooks.state)) hooks.state[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.state[index]) : next; }];
    },
    useRef: (initial: unknown) => hooks.mock ? (hooks.refs[hooks.refIndex++] ??= { current: initial }) : actual.useRef(initial),
    useCallback: <T,>(callback: T, deps: unknown[]) => hooks.mock ? callback : actual.useCallback(callback as never, deps),
    useEffect: (effect: () => void | (() => void), deps?: unknown[]) => { if (hooks.mock) hooks.effects.push({ effect, deps }); else actual.useEffect(effect, deps); },
  };
});
import { REVIEW_EXAMPLE_VIEWPORTS, ReviewDisplayExamplePanel, ReviewExampleFrameContent, resetReviewExampleScroll } from './ReviewDisplayExamplePanel';
import { Button } from './kit/ui/button';

type Element = ReactElement<{ children?: ReactNode; onClick?: () => void; 'aria-pressed'?: boolean }>;
function all(node: ReactNode): Element[] { return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node.props as { children?: ReactNode }).children)] : []; }
function text(node: ReactNode): string { return Array.isArray(node) ? node.map(text).join('') : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''; }

beforeEach(() => { hooks.state = []; hooks.index = 0; hooks.mock = false; hooks.refs = []; hooks.refIndex = 0; hooks.effects = []; });

/* SHEET-027: 예시 안쪽은 아무것도 누르거나 보낼 수 없다 — 합성 리뷰로 신고·도움이 돼요·이동이 일어나면 안 된다. */
describe('ReviewExampleFrameContent', () => {
  it('is inert and blocks clicks, middle clicks and form submits in the capture phase', () => {
    const element = ReviewExampleFrameContent({ children: <form><button type="submit">신고</button></form> }) as ReactElement<Record<string, unknown>>;
    expect(renderToStaticMarkup(element)).toMatch(/^<div data-review-example-content="" inert=""/);
    for (const handler of ['onClickCapture', 'onAuxClickCapture', 'onSubmitCapture']) {
      const preventDefault = vi.fn();
      (element.props[handler] as (event: { preventDefault: () => void }) => void)({ preventDefault });
      expect(preventDefault, handler).toHaveBeenCalledOnce();
    }
    expect(element.props.style).toEqual({ '--wc-sticky-chrome-h': '0px' });
  });
});

describe('ReviewDisplayExamplePanel', () => {
  it('opens on mobile width first, explains it is example data, and points to the display setting', () => {
    const html = renderToStaticMarkup(<ReviewDisplayExamplePanel defaultOpen><p>예시 본문</p></ReviewDisplayExamplePanel>);
    expect(html).toMatch(/<details[^>]*\sopen=""/);
    expect(html).toContain('가짜(예시) 리뷰');
    expect(html).toContain('고객 화면·리뷰 집계·엑셀에 나오지 않습니다');
    expect(html).toContain('href="/admin/display/detail"');
    expect(html).toContain('선정한 리뷰가 3개 이상일 때만');
    expect(html).toMatch(/aria-pressed="true"[^>]*>모바일</);
    expect(html).toContain(`화면 폭 ${REVIEW_EXAMPLE_VIEWPORTS.mobile}px`);
    /* 서버 렌더에는 폭을 모르니 iframe 대신 준비 문구만 둔다. 예시 본문은 iframe 안에만 그린다. */
    expect(html).toContain('예시 화면을 준비하는 중…');
    expect(html).not.toContain('예시 본문');
  });

  it('switches the example to PC width', () => {
    hooks.mock = true;
    const render = () => { hooks.index = 0; return ReviewDisplayExamplePanel({ children: null, defaultOpen: true }); };
    const pc = all(render()).find(item => item.type === Button && text(item.props.children) === 'PC')!;
    expect(pc.props['aria-pressed']).toBe(false);
    pc.props.onClick?.();
    const screen = render();
    expect(all(screen).find(item => item.type === Button && text(item.props.children) === 'PC')!.props['aria-pressed']).toBe(true);
    expect(text(screen)).toContain(`화면 폭 ${REVIEW_EXAMPLE_VIEWPORTS.desktop}px`);
    expect(REVIEW_EXAMPLE_VIEWPORTS).toEqual({ mobile: 390, desktop: 1212 });
  });

  /* QA1 MD: 모바일 예시를 내려 본 뒤 PC로 바꾸면 같은 iframe의 스크롤 위치가 남아 목록 끝에서 열렸다 — 바꿀 때마다 예시 맨 위(①)부터 보인다. */
  it('scrolls the example back to the top whenever the device changes', () => {
    const scrollTo = vi.fn();
    resetReviewExampleScroll({ contentWindow: { scrollTo } as unknown as Window });
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
    expect(() => resetReviewExampleScroll(null)).not.toThrow();
    expect(() => resetReviewExampleScroll({ contentWindow: null })).not.toThrow();

    hooks.mock = true;
    const panel = ReviewDisplayExamplePanel({ children: null, defaultOpen: true });
    const frame = all(panel).find(item => typeof item.type === 'function' && item.type.name === 'ReviewExampleFrame')!;
    hooks.state = [];
    const draw = (device: 'mobile' | 'desktop') => {
      hooks.index = 0; hooks.refIndex = 0; hooks.effects = [];
      (frame.type as (props: Record<string, unknown>) => ReactNode)({ ...frame.props, device });
      return hooks.effects.find(item => item.deps?.length === 1)!;
    };
    const mobile = draw('mobile');
    expect(mobile.deps).toEqual(['mobile']);
    hooks.refs[0].current = { contentWindow: { scrollTo } };
    scrollTo.mockClear();
    const desktop = draw('desktop');
    expect(desktop.deps).toEqual(['desktop']);
    desktop.effect();
    expect(scrollTo).toHaveBeenCalledOnce();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
  });
});
