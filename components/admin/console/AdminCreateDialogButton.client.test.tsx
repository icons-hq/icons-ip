import { isValidElement, type Context, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

/*
 * 템플릿 화면군의 등록 팝업: 안의 폼이 저장(서버 액션)을 기다리는 동안 ×·Esc로 닫히지 않는다. 닫히면 폼이 사라져
 * 검증 오류·완료 안내와 입력을 잃는다(고객문의 팝업 R4와 같은 이유). 저장이 끝나면 닫힌다.
 */

const hooks = vi.hoisted(() => ({
  scope: 'dialog',
  stores: {} as Record<string, unknown[]>,
  index: 0,
  contexts: new Map<unknown, unknown>(),
  cleanups: [] as (() => void)[],
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useCallback: (callback: unknown) => callback,
    useContext: (context: Context<unknown>) => (hooks.contexts.has(context) ? hooks.contexts.get(context) : (context as unknown as { _currentValue: unknown })._currentValue),
    useEffect: (effect: () => void | (() => void)) => {
      const cleanup = effect();
      if (cleanup) hooks.cleanups.push(cleanup);
    },
    useId: () => `${hooks.scope}-id`,
    useState: (initial: unknown) => {
      const store = (hooks.stores[hooks.scope] ??= []);
      const index = hooks.index++;
      if (!(index in store)) store[index] = initial;
      return [store[index], (next: unknown) => {
        store[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(store[index]) : next;
      }];
    },
  };
});

import { CustomerServiceDialog } from '@/components/admin/screens/CustomerServiceDialog';
import { Button } from '@/components/admin/kit/ui/button';
import { AdminCreateDialogButton, useAdminCreateDialogBusy } from './AdminCreateDialogButton';

type Element = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function all(node: ReactNode): Element[] {
  return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node as Element).props.children)] : [];
}

/** 버튼과 팝업을 그리고, 팝업을 감싼 Provider 값을 다음 훅 호출의 useContext로 넘긴다. */
function render() {
  hooks.scope = 'dialog'; hooks.index = 0;
  const tree = AdminCreateDialogButton({ children: null, label: '새 프리셋 등록', title: '새 프리셋 등록' });
  hooks.contexts.clear();
  for (const element of all(tree)) {
    const type = element.type as { $$typeof?: symbol };
    if (type?.$$typeof === Symbol.for('react.context')) hooks.contexts.set(type, element.props.value);
  }
  return {
    button: all(tree).find((element) => element.type === Button)!,
    dialog: all(tree).find((element) => element.type === CustomerServiceDialog),
  };
}
/** 팝업 안 폼 하나(저장 대기 여부를 알리는 부품). */
function PendingForm({ pending }: { pending: boolean }) {
  useAdminCreateDialogBusy(pending);
  return null;
}
function form(pending: boolean) {
  hooks.scope = 'form'; hooks.index = 0;
  PendingForm({ pending });
}

beforeEach(() => {
  hooks.stores = {};
  hooks.contexts.clear();
  hooks.cleanups = [];
});

it('등록 버튼이 팝업을 열고, 저장을 기다리는 동안에는 ×·Esc로 닫히지 않으며 끝나면 닫힌다', () => {
  expect(render().dialog).toBeUndefined();
  (render().button.props.onClick as () => void)();
  expect(render().dialog?.props.busy).toBe(false);

  form(true);
  const busy = render().dialog!;
  expect(busy.props.busy).toBe(true);
  (busy.props.onClose as () => void)();
  expect(render().dialog).toBeDefined();

  for (const cleanup of hooks.cleanups.splice(0)) cleanup();
  const idle = render().dialog!;
  expect(idle.props.busy).toBe(false);
  (idle.props.onClose as () => void)();
  expect(render().dialog).toBeUndefined();
});

it('팝업 밖(목록 안 수정 폼)에서는 아무 일도 하지 않는다', () => {
  hooks.contexts.clear();
  expect(() => form(true)).not.toThrow();
  expect(hooks.cleanups).toHaveLength(0);
});
