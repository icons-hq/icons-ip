import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* 호스트의 상태 기계(줄 세우기·한 번만 풀기·해제 때 취소)를 실제 렌더러 없이 본다. 대화상자 자체 모양은 아래 정적 렌더로 본다. */
const hooks = vi.hoisted(() => ({
  states: [] as unknown[], refs: [] as { current: unknown }[],
  effects: [] as { deps: unknown[]; cleanup?: void | (() => void) }[],
  jobs: [] as (() => void)[], stateIndex: 0, refIndex: 0, effectIndex: 0, hostMode: false,
}));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: (initial: unknown) => {
      if (!hooks.hostMode) return actual.useState(initial);
      const index = hooks.stateIndex++;
      if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.states[index]) : next; }];
    },
    useRef: (initial: unknown) => {
      if (!hooks.hostMode) return actual.useRef(initial);
      const index = hooks.refIndex++; return hooks.refs[index] ??= { current: initial };
    },
    useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
      if (!hooks.hostMode) return actual.useEffect(effect, deps);
      const index = hooks.effectIndex++, previous = hooks.effects[index];
      if (previous && !deps.some((dep, i) => dep !== previous.deps[i])) return;
      hooks.effects[index] = { deps };
      hooks.jobs.push(() => { previous?.cleanup?.(); hooks.effects[index].cleanup = effect(); });
    },
  };
});
vi.mock('./OverlayPortal', () => ({ OverlayPortal: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('./useOverlayA11y', () => ({ useOverlayA11y: () => undefined }));

import { customerConfirm } from '@/lib/customer-confirm';
import { CustomerConfirmDialog, CustomerConfirmHost } from './CustomerConfirmHost';

type DialogElement = ReactElement<{ request: { title: string }; onCancel: () => void; onConfirm: () => void }>;
function all(node: ReactNode): ReactElement[] {
  return Children.toArray(node).flatMap((child) => isValidElement(child) ? [child, ...all((child.props as { children?: ReactNode }).children)] : []);
}
function render() {
  hooks.hostMode = true; hooks.stateIndex = 0; hooks.refIndex = 0; hooks.effectIndex = 0;
  const tree = CustomerConfirmHost();
  for (const job of hooks.jobs.splice(0)) job();
  hooks.hostMode = false;
  return tree;
}
const dialog = () => all(render()).find((node) => node.type === CustomerConfirmDialog) as DialogElement | undefined;
const flush = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };

beforeEach(() => { hooks.states = []; hooks.refs = []; hooks.effects = []; hooks.jobs = []; render(); });
afterEach(() => { for (const effect of hooks.effects) if (typeof effect?.cleanup === 'function') effect.cleanup(); });

describe('CustomerConfirmHost (원장 재작업 후속 4)', () => {
  it('고객이 고르기 전에는 약속이 풀리지 않고, 확인하면 true로 풀린다', async () => {
    const settled = vi.fn();
    void customerConfirm({ title: '이 선물을 거절할까요?', confirmLabel: '선물 거절' }).then(settled);
    expect(dialog()?.props.request.title).toBe('이 선물을 거절할까요?');
    await flush();
    expect(settled).not.toHaveBeenCalled();
    dialog()!.props.onConfirm();
    await flush();
    expect(settled).toHaveBeenCalledWith(true);
    expect(dialog()).toBeUndefined();
  });
  it('취소·Esc·바깥 누르기(모두 onCancel)는 false이고, 확인을 거듭 눌러도 한 번만 풀린다', async () => {
    const results: boolean[] = [];
    void customerConfirm({ title: '진행 중인 요청을 철회할까요?', confirmLabel: '요청 철회' }).then((value) => results.push(value));
    const current = dialog()!;
    current.props.onCancel(); current.props.onConfirm(); current.props.onCancel();
    await flush();
    expect(results).toEqual([false]);
  });
  it('겹친 요청은 차례로 하나씩 보여 준다', async () => {
    const results: string[] = [];
    void customerConfirm({ title: '첫 번째', confirmLabel: '확인' }).then((value) => results.push(`first:${value}`));
    void customerConfirm({ title: '두 번째', confirmLabel: '확인' }).then((value) => results.push(`second:${value}`));
    expect(dialog()?.props.request.title).toBe('첫 번째');
    dialog()!.props.onConfirm(); await flush();
    expect(dialog()?.props.request.title).toBe('두 번째');
    dialog()!.props.onCancel(); await flush();
    expect(results).toEqual(['first:true', 'second:false']);
  });
  it('호스트가 사라지면 떠 있던 확인과 줄 선 확인을 모두 취소로 푼다', async () => {
    const results: boolean[] = [];
    void customerConfirm({ title: '하나', confirmLabel: '확인' }).then((value) => results.push(value));
    void customerConfirm({ title: '둘', confirmLabel: '확인' }).then((value) => results.push(value));
    render();
    for (const effect of hooks.effects) if (typeof effect?.cleanup === 'function') effect.cleanup();
    hooks.effects = [];
    await flush();
    expect(results).toEqual([false, false]);
    await expect(customerConfirm({ title: '셋', confirmLabel: '확인' })).resolves.toBe(false);
  });
});

describe('CustomerConfirmDialog', () => {
  it('제목·설명이 이름 붙은 경고 대화상자이고, 첫 버튼은 돌아가기다', () => {
    const html = renderToStaticMarkup(<CustomerConfirmDialog request={{ title: '이 선물을 취소할까요?', message: '아직 결제된 금액은 없어요.', confirmLabel: '선물 취소' }}
      onCancel={() => undefined} onConfirm={() => undefined} />);
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toMatch(/aria-labelledby="[^"]+"/);
    expect(html).toMatch(/aria-describedby="[^"]+"/);
    expect(html).toContain('<h2 class="wc-confirm__title"');
    expect(html).toContain('아직 결제된 금액은 없어요.');
    expect(html.indexOf('>돌아가기<')).toBeLessThan(html.indexOf('>선물 취소<'));
  });
  it('설명이 없으면 설명 연결도 없고, 취소 버튼 이름을 바꿀 수 있다', () => {
    const html = renderToStaticMarkup(<CustomerConfirmDialog request={{ title: '작성 중인 내용을 두고 이동할까요?', confirmLabel: '이동하기', cancelLabel: '계속 작성' }}
      onCancel={() => undefined} onConfirm={() => undefined} />);
    expect(html).not.toContain('aria-describedby');
    expect(html).toContain('>계속 작성<');
    expect(html).not.toContain('>돌아가기<');
  });
});
