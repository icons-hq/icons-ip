import { isValidElement, type Context, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

/*
 * R8 목록 위 상세 팝업(취소·반품·교환 공통 kit 팝업): 처리 패널이 결제사 취소(토스 승인·환불 완료 확정) 같은
 * 서버 액션을 기다리는 동안 Esc·×·바깥 누르기·'전체 화면으로 열기'로 팝업을 벗어나지 못한다. 닫히면 Next 액션
 * 큐가 대기 중인 액션 상태를 버리고 패널이 사라져, 운영자가 실패 코드·다음 할 일을 보지 못한다.
 */

const hooks = vi.hoisted(() => ({
  state: [] as unknown[],
  index: 0,
  contexts: new Map<unknown, unknown>(),
  cleanups: [] as (() => void)[],
}));
const mocks = vi.hoisted(() => ({ replace: vi.fn() }));

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
    useId: () => 'panel',
    useRef: (initial: unknown) => ({ current: initial }),
    useState: (initial: unknown) => {
      const index = hooks.index++;
      if (!(index in hooks.state)) hooks.state[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [hooks.state[index], (next: unknown) => {
        hooks.state[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.state[index]) : next;
      }];
    },
  };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace }) }));

import { Dialog, DialogContent } from '@/components/admin/kit/ui/dialog';
import { ClaimPreviewFullScreenLink, useClaimPreviewBusy } from './ClaimPreviewDialog';
import { ClaimPreviewKitDialog } from './ClaimPreviewKitDialog';

type Element = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function all(node: ReactNode): Element[] {
  return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node as Element).props.children)] : [];
}

/** 팝업을 그리고, 그 안의 Provider 값을 다음 훅 호출의 useContext로 넘긴다. */
function renderDialog() {
  hooks.index = 0;
  const tree = ClaimPreviewKitDialog({ children: null, closeHref: '/admin/sales/claims/returns?stage=open', title: '반품 C00001' });
  hooks.contexts.clear();
  for (const element of all(tree)) {
    const type = element.type as { $$typeof?: symbol };
    if (type?.$$typeof === Symbol.for('react.context')) hooks.contexts.set(type, element.props.value);
  }
  const elements = all(tree);
  return {
    dialog: elements.find((element) => element.type === Dialog)!,
    content: elements.find((element) => element.type === DialogContent)!,
  };
}

beforeEach(() => {
  hooks.state = [];
  hooks.contexts.clear();
  hooks.cleanups = [];
  vi.clearAllMocks();
});

it('처리 패널이 기다리는 동안에는 Esc·×·바깥 누르기로 닫히지 않고, 끝나면 같은 목록으로 닫힌다', () => {
  const idleAtStart = renderDialog();
  expect(idleAtStart.dialog.props.disablePointerDismissal).toBe(false);
  expect(idleAtStart.content.props.showCloseButton).toBe(true);

  useClaimPreviewBusy(true);
  const busy = renderDialog();
  expect(busy.dialog.props.disablePointerDismissal).toBe(true);
  expect(busy.content.props.showCloseButton).toBe(false);
  (busy.dialog.props.onOpenChange as (open: boolean) => void)(false);
  expect(mocks.replace).not.toHaveBeenCalled();

  for (const cleanup of hooks.cleanups.splice(0)) cleanup();
  const idle = renderDialog();
  expect(idle.dialog.props.disablePointerDismissal).toBe(false);
  (idle.dialog.props.onOpenChange as (open: boolean) => void)(false);
  expect(mocks.replace).toHaveBeenCalledWith('/admin/sales/claims/returns?stage=open', { scroll: false });
});

it('기다리지 않는 패널과 팝업 밖(독립 상세)의 패널은 아무것도 막지 않는다', () => {
  renderDialog();
  useClaimPreviewBusy(false);
  expect(renderDialog().dialog.props.disablePointerDismissal).toBe(false);

  hooks.contexts.clear();
  expect(() => useClaimPreviewBusy(true)).not.toThrow();
});

it("기다리는 동안 '전체 화면으로 열기'도 누를 수 없다", () => {
  renderDialog();
  const link = () => all(ClaimPreviewFullScreenLink({ href: '/admin/sales/claims/returns/1' }))[0];
  expect(link().props.href).toBe('/admin/sales/claims/returns/1');

  useClaimPreviewBusy(true);
  renderDialog();
  expect(link().type).toBe('button');
  expect(link().props.disabled).toBe(true);
});
