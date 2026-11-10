import Link from 'next/link';
import { isValidElement, type Context, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

/*
 * R4 고객문의 팝업: 안의 패널이 답변 발송·종결·담당자 변경·내부 메모 저장을 기다리는 동안 ×·Esc·'← 문의 목록'으로
 * 팝업을 벗어나지 못한다. 닫히면 Next 액션 큐가 대기 중인 액션 상태를 버리고 패널이 사라져, 운영자가 실패 사유(다른
 * 운영자 답변 충돌 등)를 보지 못하고 성공해도 보낸 답변이 복구 초안으로 남는다(클레임 팝업 R8과 같은 이유).
 */

const hooks = vi.hoisted(() => ({
  scope: 'dialog',
  stores: {} as Record<string, unknown[]>,
  index: 0,
  contexts: new Map<unknown, unknown>(),
  cleanups: [] as (() => void)[],
  pending: [] as boolean[],
  actionIndex: 0,
}));
const mocks = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useActionState: (_action: unknown, initial: unknown) => [initial, () => undefined, hooks.pending[hooks.actionIndex++] ?? false],
    useCallback: (callback: unknown) => callback,
    useContext: (context: Context<unknown>) => (hooks.contexts.has(context) ? hooks.contexts.get(context) : (context as unknown as { _currentValue: unknown })._currentValue),
    useEffect: (effect: () => void | (() => void)) => {
      const cleanup = effect();
      if (cleanup) hooks.cleanups.push(cleanup);
    },
    useId: () => `${hooks.scope}-id`,
    useRef: (initial: unknown) => ({ current: initial }),
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
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock('@/app/admin/inquiry-actions', () => ({
  answerInquiryAction: () => undefined,
  closeInquiryAction: () => undefined,
  reassignInquiryAction: () => undefined,
  addInquiryInternalNoteAction: () => undefined,
}));
vi.mock('@/components/admin/useInquiryDraft', () => ({
  useInquiryDraft: () => ({ body: '', change: () => undefined, ready: true, blocked: false, recovery: null }),
}));
vi.mock('./InquiryReplyTemplateTools', () => ({ InquiryReplyTemplateTools: () => null }));
vi.mock('./InquiryDraftNotice', () => ({ InquiryDraftNotice: () => null }));

import { CustomerServiceDialog, InquiryPreviewBackLink, InquiryPreviewDialog, useInquiryPreviewBusy } from './CustomerServiceDialog';
import { InquiryReplyPanel } from './InquiryReplyPanel';
import { InquiryAssignmentPanel, InquiryInternalNotesPanel } from './InquiryWorkspacePanel';

type Element = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function all(node: ReactNode): Element[] {
  return Array.isArray(node) ? node.flatMap(all) : isValidElement(node) ? [node as Element, ...all((node as Element).props.children)] : [];
}

const CLOSE_HREF = '/admin/cs/inquiries?status=open&page=3';

/** 팝업을 그리고, 그 안의 Provider 값을 다음 훅 호출의 useContext로 넘긴다. */
function renderDialog() {
  hooks.scope = 'dialog'; hooks.index = 0;
  const tree = InquiryPreviewDialog({ children: null, closeHref: CLOSE_HREF });
  hooks.contexts.clear();
  for (const element of all(tree)) {
    const type = element.type as { $$typeof?: symbol };
    if (type?.$$typeof === Symbol.for('react.context')) hooks.contexts.set(type, element.props.value);
  }
  return all(tree).find((element) => element.type === CustomerServiceDialog)!;
}

/** 팝업 안 패널 하나를 그린다. `pending`은 그 패널의 useActionState 호출 순서대로의 대기 여부다. */
function renderPanel(scope: string, pending: boolean[], render: () => unknown) {
  hooks.scope = scope; hooks.index = 0; hooks.actionIndex = 0; hooks.pending = pending;
  render();
}

const panels = {
  reply: () => InquiryReplyPanel({ category: 'order', closed: false, inquiryId: 'inquiry-1' }),
  closedReply: () => InquiryReplyPanel({ category: 'order', closed: true, inquiryId: 'inquiry-1' }),
  assignment: () => InquiryAssignmentPanel({ inquiryId: 'inquiry-1', assigneeId: null, assigneeName: null, staffOptions: [] }),
  note: () => InquiryInternalNotesPanel({ inquiryId: 'inquiry-1', notes: [] }),
};

beforeEach(() => {
  hooks.stores = {};
  hooks.contexts.clear();
  hooks.cleanups = [];
  vi.clearAllMocks();
});

it('답변 발송을 기다리는 동안에는 ×·Esc로 닫히지 않고, 끝나면 같은 목록으로 스크롤을 두고 닫힌다', () => {
  expect(renderDialog().props.busy).toBe(false);

  renderPanel('reply', [true, false], panels.reply);
  const busy = renderDialog();
  expect(busy.props.busy).toBe(true);
  (busy.props.onClose as () => void)();
  expect(mocks.replace).not.toHaveBeenCalled();

  for (const cleanup of hooks.cleanups.splice(0)) cleanup();
  const idle = renderDialog();
  expect(idle.props.busy).toBe(false);
  (idle.props.onClose as () => void)();
  expect(mocks.replace).toHaveBeenCalledWith(CLOSE_HREF, { scroll: false });
});

it.each([
  ['지금 종결', 'reply', [false, true], panels.reply],
  ['담당자 변경', 'assignment', [true], panels.assignment],
  ['내부 메모 저장', 'note', [true], panels.note],
] as const)('%s을 기다리는 동안에도 팝업을 닫지 못한다', (_label, scope, pending, render) => {
  renderDialog();
  renderPanel(scope, [...pending], render);
  const busy = renderDialog();
  expect(busy.props.busy).toBe(true);
  (busy.props.onClose as () => void)();
  expect(mocks.replace).not.toHaveBeenCalled();
});

it('여러 패널이 함께 기다리면 모두 끝나야 닫힌다', () => {
  renderDialog();
  renderPanel('reply', [true, false], panels.reply);
  const replyCleanups = hooks.cleanups.splice(0);
  renderPanel('note', [true], panels.note);
  for (const cleanup of replyCleanups) cleanup();
  expect(renderDialog().props.busy).toBe(true);
  for (const cleanup of hooks.cleanups.splice(0)) cleanup();
  expect(renderDialog().props.busy).toBe(false);
});

it('기다리지 않는 패널과 종결된 문의, 팝업 밖(독립 상세)의 패널은 아무것도 막지 않는다', () => {
  renderDialog();
  renderPanel('reply', [false, false], panels.reply);
  renderPanel('closed', [false, false], panels.closedReply);
  renderPanel('assignment', [false], panels.assignment);
  renderPanel('note', [false], panels.note);
  expect(renderDialog().props.busy).toBe(false);

  hooks.contexts.clear();
  expect(() => useInquiryPreviewBusy(true)).not.toThrow();
});

it("기다리는 동안 '← 문의 목록'도 누를 수 없고, 끝나면 닫기처럼 스크롤을 두고 기록을 바꿔 쓴다", () => {
  renderDialog();
  const link = () => all(InquiryPreviewBackLink({ href: CLOSE_HREF }))[0];
  expect(link().type).toBe(Link);
  expect(link().props).toMatchObject({ href: CLOSE_HREF, replace: true, scroll: false });

  renderPanel('reply', [true, false], panels.reply);
  renderDialog();
  expect(link().type).toBe('span');
  expect(link().props['aria-disabled']).toBe('true');
  expect(link().props.href).toBeUndefined();
  expect(all(link()).map((element) => element.props.children).join('')).toContain('← 문의 목록');
});
