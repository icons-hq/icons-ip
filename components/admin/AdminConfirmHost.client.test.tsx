import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  states: [] as unknown[], refs: [] as { current: unknown }[],
  effects: [] as { deps: unknown[]; cleanup?: void | (() => void) }[],
  jobs: [] as (() => void)[], stateIndex: 0, refIndex: 0, effectIndex: 0,
}));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.states[index]) : next; }];
  },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; return hooks.refs[index] ??= { current: initial }; },
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
    const index = hooks.effectIndex++, previous = hooks.effects[index];
    if (previous && !deps.some((dep, i) => dep !== previous.deps[i])) return;
    hooks.effects[index] = { deps };
    hooks.jobs.push(() => { previous?.cleanup?.(); hooks.effects[index].cleanup = effect(); });
  },
}));

import { adminConfirm } from '@/lib/admin/confirm';
import { AdminConfirmHost } from './AdminConfirmHost';
import { AlertDialog, AlertDialogAction, AlertDialogCancel } from './kit/ui/alert-dialog';

type Node = ReactElement<{ children?: ReactNode; onClick?: () => void; onOpenChange?: (open: boolean) => void; variant?: string }>;
function all(node: ReactNode): Node[] {
  return Children.toArray(node).flatMap((child) => isValidElement(child) ? [child as Node, ...all((child.props as { children?: ReactNode }).children)] : []);
}
const text = (node: ReactNode): string => Children.toArray(node).map((child) => isValidElement(child) ? text((child.props as { children?: ReactNode }).children) : String(child)).join('');

function render() {
  hooks.stateIndex = 0; hooks.refIndex = 0; hooks.effectIndex = 0;
  const tree = AdminConfirmHost();
  for (const job of hooks.jobs.splice(0)) job();
  return tree;
}
const flush = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };
const action = () => all(render()).find((node) => node.type === AlertDialogAction)!;
const cancel = () => all(render()).find((node) => node.type === AlertDialogCancel)!;
const dialog = () => all(render()).find((node) => node.type === AlertDialog)!;

beforeEach(() => {
  hooks.states = []; hooks.refs = []; hooks.effects = []; hooks.jobs = [];
  render();
});
afterEach(() => { for (const effect of hooks.effects) if (typeof effect?.cleanup === 'function') effect.cleanup(); });

describe('AdminConfirmHost', () => {
  it('확인하기 전에는 약속이 풀리지 않고, 확인하면 true로 풀린다', async () => {
    const settled = vi.fn();
    void adminConfirm({ message: '이 주문을 전액 취소할까요?' }).then(settled);
    const tree = render();
    expect(text(tree)).toContain('이 주문을 전액 취소할까요?');
    await flush();
    expect(settled).not.toHaveBeenCalled();
    action().props.onClick!();
    await flush();
    expect(settled).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('취소·닫기(Esc·바깥 클릭)는 false이고, 닫힌 뒤에는 대화상자가 없다', async () => {
    const settled = vi.fn();
    void adminConfirm('환불할까요?').then(settled);
    render();
    dialog().props.onOpenChange!(false);
    await flush();
    expect(settled).toHaveBeenCalledExactlyOnceWith(false);
    expect(all(render()).some((node) => node.type === AlertDialog)).toBe(false);
    expect(cancel).toBeDefined();
  });

  it('확인 버튼을 여러 번 눌러도 한 번만 풀린다(이중 클릭)', async () => {
    const settled = vi.fn();
    void adminConfirm('환불할까요?').then(settled);
    render();
    const button = action();
    button.props.onClick!(); button.props.onClick!(); button.props.onClick!();
    await flush();
    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledWith(true);
  });

  it('확인 뒤 다시 닫힘 이벤트가 와도 이미 푼 확인은 바뀌지 않는다', async () => {
    const settled = vi.fn();
    void adminConfirm('환불할까요?').then(settled);
    render();
    const open = dialog();
    action().props.onClick!();
    open.props.onOpenChange!(false);
    await flush();
    expect(settled).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('서로 다른 확인이 겹치면 차례로 하나씩 보여 준다', async () => {
    const first = vi.fn(), second = vi.fn();
    void adminConfirm('첫째').then(first);
    void adminConfirm('둘째').then(second);
    expect(text(render())).toContain('첫째');
    expect(text(render())).not.toContain('둘째');
    action().props.onClick!();
    expect(text(render())).toContain('둘째');
    cancel();
    dialog().props.onOpenChange!(false);
    await flush();
    expect(first).toHaveBeenCalledWith(true);
    expect(second).toHaveBeenCalledWith(false);
  });

  it('되돌릴 수 없는 확인은 위험색 확인 버튼이고 라벨·제목을 바꿀 수 있다', () => {
    void adminConfirm({ message: '전액 취소', title: '결제 전액 취소', confirmLabel: '취소 승인', destructive: true });
    const tree = render();
    expect(text(tree)).toContain('결제 전액 취소');
    expect(text(action())).toBe('취소 승인');
    expect(action().props.variant).toBe('danger');
  });

  it('호스트가 사라지면 남은 확인은 모두 취소로 푼다', async () => {
    const settled = vi.fn();
    void adminConfirm('환불할까요?').then(settled);
    render();
    for (const effect of hooks.effects) if (typeof effect?.cleanup === 'function') effect.cleanup();
    await flush();
    expect(settled).toHaveBeenCalledExactlyOnceWith(false);
  });
});
