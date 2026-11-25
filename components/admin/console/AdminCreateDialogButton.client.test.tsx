import { isValidElement, type Context, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { stubAdminConfirm } from '@/lib/admin/confirm.test-support';

/*
 * 템플릿 화면군의 등록 팝업: 안의 폼이 저장(서버 액션)을 기다리는 동안 ×·Esc로 닫히지 않는다. 닫히면 폼이 사라져
 * 검증 오류·완료 안내와 입력을 잃는다(고객문의 팝업 R4와 같은 이유). 저장이 끝나면 닫힌다.
 * confirmDiscard를 켠 화면은 적은 내용이 있을 때 닫기 전에 묻는다(화면 규칙 7). 켜지 않은 화면은 그대로 묻지 않고 닫는다.
 */

const hooks = vi.hoisted(() => ({
  scope: 'dialog',
  stores: {} as Record<string, unknown[]>,
  index: 0,
  refs: {} as Record<string, { current: unknown }[]>,
  refIndex: 0,
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
    useRef: (initial: unknown) => {
      const store = (hooks.refs[hooks.scope] ??= []);
      return (store[hooks.refIndex++] ??= { current: initial });
    },
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
import { ADMIN_CREATE_DIALOG_DISCARD_CONFIRM, AdminCreateDialogButton, adminCreateDialogInputs, useAdminCreateDialogBusy, useAdminCreateDialogClose } from './AdminCreateDialogButton';

type Element = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function all(node: ReactNode): Element[] {
  return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node as Element).props.children)] : [];
}

/** 버튼과 팝업을 그리고, 팝업을 감싼 Provider 값을 다음 훅 호출의 useContext로 넘긴다. */
function render(props: { confirmDiscard?: boolean } = {}) {
  hooks.scope = 'dialog'; hooks.index = 0; hooks.refIndex = 0;
  const tree = AdminCreateDialogButton({ children: null, label: '새 템플릿 등록', title: '새 템플릿 등록', ...props });
  hooks.contexts.clear();
  for (const element of all(tree)) {
    const type = element.type as { $$typeof?: symbol };
    if (type?.$$typeof === Symbol.for('react.context')) hooks.contexts.set(type, element.props.value);
  }
  return {
    button: all(tree).find((element) => element.type === Button)!,
    dialog: all(tree).find((element) => element.type === CustomerServiceDialog),
    /** confirmDiscard일 때만 있는 팝업 본문. ref로 입력칸을 읽는다. */
    body: all(tree).find((element) => element.props['data-admin-create-dialog-body'] !== undefined),
  };
}
/** 팝업 안 폼 하나(저장 대기 여부를 알리는 부품). */
function PendingForm({ pending }: { pending: boolean }) {
  useAdminCreateDialogBusy(pending);
  return null;
}
function form(pending: boolean) {
  hooks.scope = 'form'; hooks.index = 0; hooks.refIndex = 0;
  PendingForm({ pending });
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** 입력칸 둘(이름·체크)이 든 팝업 본문과 그 팝업 dialog. */
function fakeBody() {
  const controls = [{ name: 'name', type: 'text', value: '' }, { name: 'withKc', type: 'checkbox', value: 'on', checked: false }];
  const dialog = { isConnected: true, open: true, showModal: vi.fn() };
  return { controls, dialog, root: { querySelectorAll: () => controls, closest: () => dialog } };
}
/** confirmDiscard를 켠 팝업을 열고 본문을 붙인다(붙는 순간의 값이 '연 때의 값'이다). */
function openWithBody(body = fakeBody()) {
  (render({ confirmDiscard: true }).button.props.onClick as () => void)();
  const opened = render({ confirmDiscard: true });
  (opened.body!.props.ref as (node: unknown) => void)(body.root);
  return { ...body, close: opened.dialog!.props.onClose as () => void };
}

let confirm: ReturnType<typeof stubAdminConfirm> | undefined;
beforeEach(() => {
  hooks.stores = {};
  hooks.refs = {};
  hooks.contexts.clear();
  hooks.cleanups = [];
});
afterEach(() => { confirm?.restore(); confirm = undefined; });

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

it('confirmDiscard를 켜지 않으면 본문을 감싸지 않고, 묻지 않고 닫는다', () => {
  confirm = stubAdminConfirm(false);
  (render().button.props.onClick as () => void)();
  const opened = render();
  expect(opened.body).toBeUndefined();
  (opened.dialog!.props.onClose as () => void)();
  expect(render().dialog).toBeUndefined();
  expect(confirm).not.toHaveBeenCalled();
});

it('confirmDiscard: 적은 내용이 없으면 묻지 않고, 적었다가 도로 지워도 묻지 않는다', () => {
  confirm = stubAdminConfirm(false);
  const untouched = openWithBody();
  untouched.close();
  expect(render({ confirmDiscard: true }).dialog).toBeUndefined();

  const erased = openWithBody();
  erased.controls[0].value = '아크릴';
  erased.controls[0].value = '';
  erased.close();
  expect(render({ confirmDiscard: true }).dialog).toBeUndefined();
  expect(confirm).not.toHaveBeenCalled();
});

it('confirmDiscard: 적은 내용이 있으면 닫기 전에 묻고, 취소하면 팝업이 그대로 남는다', async () => {
  confirm = stubAdminConfirm(false);
  const typed = openWithBody();
  typed.controls[0].value = '아크릴 기본';
  typed.close();
  await flush();
  expect(confirm).toHaveBeenCalledExactlyOnceWith(ADMIN_CREATE_DIALOG_DISCARD_CONFIRM.message);
  expect(render({ confirmDiscard: true }).dialog).toBeDefined();
  expect(typed.dialog.showModal).not.toHaveBeenCalled();

  /* 체크만 바꿔도 적은 내용이다. 확인하면 닫힌다. */
  confirm.restore();
  confirm = stubAdminConfirm(true);
  const checked = openWithBody();
  checked.controls[1].checked = true;
  checked.close();
  await flush();
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(render({ confirmDiscard: true }).dialog).toBeUndefined();
});

it('confirmDiscard: 브라우저가 창을 먼저 닫았으면 다시 띄운 뒤 묻는다', async () => {
  confirm = stubAdminConfirm(false);
  const typed = openWithBody();
  typed.controls[0].value = '아크릴 기본';
  typed.dialog.open = false;
  typed.close();
  await flush();
  expect(typed.dialog.showModal).toHaveBeenCalledTimes(1);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(render({ confirmDiscard: true }).dialog).toBeDefined();
});

it('confirmDiscard: 저장을 기다리는 동안에는 묻지도 닫지도 않고, 폼이 스스로 닫을 때(저장 성공)는 묻지 않는다', () => {
  confirm = stubAdminConfirm(false);
  const typed = openWithBody();
  typed.controls[0].value = '아크릴 기본';
  form(true);
  (render({ confirmDiscard: true }).dialog!.props.onClose as () => void)();
  expect(confirm).not.toHaveBeenCalled();
  expect(render({ confirmDiscard: true }).dialog).toBeDefined();

  for (const cleanup of hooks.cleanups.splice(0)) cleanup();
  render({ confirmDiscard: true });
  hooks.scope = 'form'; hooks.index = 0; hooks.refIndex = 0;
  useAdminCreateDialogClose()!();
  expect(confirm).not.toHaveBeenCalled();
  expect(render({ confirmDiscard: true }).dialog).toBeUndefined();
});

it('입력칸 값은 이름과 값(체크·라디오는 체크 여부)으로 읽는다', () => {
  const read = (controls: { name: string; type: string; value: string; checked?: boolean }[]) => adminCreateDialogInputs({ querySelectorAll: () => controls });
  expect(read([{ name: 'a', type: 'text', value: '1' }])).not.toBe(read([{ name: 'a', type: 'text', value: '2' }]));
  expect(read([{ name: 'a', type: 'checkbox', value: 'on', checked: false }])).not.toBe(read([{ name: 'a', type: 'checkbox', value: 'on', checked: true }]));
  expect(read([{ name: 'a', type: 'hidden', value: 'x' }])).not.toBe(read([{ name: 'a', type: 'hidden', value: 'y' }]));
  expect(read([{ name: 'a', type: 'text', value: '1' }])).toBe(read([{ name: 'a', type: 'text', value: '1' }]));
});
