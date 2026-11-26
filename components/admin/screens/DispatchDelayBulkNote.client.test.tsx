import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ save: vi.fn(), states: [] as unknown[], refs: [] as { current: unknown }[], index: 0, refIndex: 0 }));
vi.mock('@/app/admin/order-actions', () => ({ saveAdminOrderDispatchDelayAction: mocks.save }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = mocks.index++;
    if (!(index in mocks.states)) mocks.states[index] = typeof initial === 'function' ? initial() : initial;
    return [mocks.states[index], (next: unknown) => { mocks.states[index] = typeof next === 'function' ? next(mocks.states[index]) : next; }];
  },
  useRef: (initial: unknown) => { const index = mocks.refIndex++; mocks.refs[index] ??= { current: initial }; return mocks.refs[index]; },
}));
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { DispatchDelayBulkNote } from './DispatchDelayBulkNote';

/*
 * S-12: 발송 지연 탭에서 고른 주문에 같은 지연 메모를 한 번에 넣는다. 새 저장 경로 없이 줄의 [메모 저장]과 같은 저장을
 * 주문마다 차례로 부르고, 넣지 못한 주문은 건너뛰어 주문번호로 알린다.
 */
type Element = ReactElement<Record<string, unknown>>;
const targets = [{ orderId: '50000000-0000-4000-8000-00000000000a', reference: '2026111210000001' },
  { orderId: '50000000-0000-4000-8000-00000000000b', reference: '2026111210000002' },
  { orderId: '50000000-0000-4000-8000-00000000000c', reference: '2026111210000003' }];
const onClose = vi.fn(), onDone = vi.fn();
function nodes(value: ReactNode): Element[] { return Children.toArray(value).flatMap(node => isValidElement<Record<string, unknown>>(node) ? [node, ...nodes(node.props.children as ReactNode)] : []); }
function text(value: ReactNode): string { return Children.toArray(value).map(node => isValidElement<Record<string, unknown>>(node) ? text(node.props.children as ReactNode) : String(node)).join(''); }
function render() { mocks.index = 0; mocks.refIndex = 0; return DispatchDelayBulkNote({ targets, onClose, onDone }) as Element; }
const submitButton = () => nodes(render()).find(node => node.type === Button && node.props.type === 'submit')!;
const field = (name: string) => nodes(render()).find(node => node.type === Input && node.props.name === name)!;
const type = (name: string, value: string) => (field(name).props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
const submit = () => (nodes(render()).find(node => node.type === 'form')!.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault: () => {} });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
beforeEach(() => { vi.clearAllMocks(); mocks.states = []; mocks.refs = []; });

it('몇 건에 넣는지와 이미 있는 메모가 바뀐다는 것을 말하고, 사유를 적기 전에는 누를 수 없는 이유를 보인다', () => {
  const shown = text(render());
  expect(shown).toContain('고른 주문 3건에 같은 메모를 넣습니다. 이미 메모가 있는 주문은 이 내용으로 바뀝니다. 고객에게는 보이지 않습니다.');
  expect(text(submitButton().props.children as ReactNode)).toBe('3건에 메모 넣기');
  expect(submitButton().props.disabled).toBe(true);
  expect(shown).toContain('지연 사유를 적으면 누를 수 있습니다.');
  submit();
  expect(mocks.save).not.toHaveBeenCalled();
});

it('고른 주문마다 같은 사유·발송 예정일로 저장하고, 모두 되면 결과를 표 위 알림으로 올리고 닫는다', async () => {
  mocks.save.mockResolvedValue({ message: '지연 메모를 저장했습니다.' });
  type('reason', '  제조사 입고 지연  '); type('expectedShipDate', '2026-12-03');
  expect(submitButton().props.disabled).toBe(false);
  submit(); await settle();
  expect(mocks.save).toHaveBeenCalledTimes(3);
  const sent = mocks.save.mock.calls.map(([, data]) => Object.fromEntries((data as FormData).entries()));
  expect(sent).toEqual(targets.map(target => ({ orderId: target.orderId, reason: '제조사 입고 지연', expectedShipDate: '2026-12-03' })));
  expect(onDone).toHaveBeenCalledWith({ tone: 'success', message: '주문 3건에 지연 메모를 넣었습니다.' });
  expect(onClose).toHaveBeenCalledOnce();
});

/* 화면 규칙 7: 적은 사유·예정일이 있으면 [닫기]가 닫기 전에 한 번 묻는다. 적은 것이 없으면 바로 닫는다. */
it('적은 내용이 없으면 바로 닫고, 사유를 적었으면 닫기 전에 묻는다', async () => {
  const { setAdminConfirmHandler } = await import('@/lib/admin/confirm');
  const asked: { title?: string }[] = [];
  const restore = setAdminConfirmHandler(async request => { asked.push(request); return true; });
  try {
    const close = () => (nodes(render()).find(node => node.type === Button && text(node.props.children as ReactNode) === '닫기')!.props.onClick as () => void)();
    close();
    expect(onClose).toHaveBeenCalledOnce(); expect(asked).toEqual([]);
    onClose.mockClear();
    type('reason', '제조사 입고 지연');
    close(); await settle();
    expect(asked.map(request => request.title)).toEqual(['적은 내용을 저장하지 않고 닫을까요?']);
    expect(onClose).toHaveBeenCalledOnce();
  } finally { restore(); }
});

it('넣지 못한 주문은 건너뛰고 주문번호와 다음 할 일을 알린다', async () => {
  mocks.save.mockResolvedValueOnce({ message: '지연 메모를 저장했습니다.' })
    .mockResolvedValueOnce({ errors: { form: '지연 메모를 저장하지 못했습니다. 최신 상태를 확인해주세요.' } })
    .mockRejectedValueOnce(new Error('network'));
  type('reason', '입고 지연');
  submit(); await settle();
  expect(mocks.save).toHaveBeenCalledTimes(3);
  expect(onDone).toHaveBeenCalledWith({ tone: 'warning',
    message: '주문 1건에 지연 메모를 넣었습니다. 넣지 못한 2건은 건너뛰었습니다: 2026111210000002, 2026111210000003. 이미 발송했거나 취소된 주문일 수 있으니 목록을 새로고침해 확인해주세요.' });
});

it('하나도 넣지 못하면 실패로 알린다', async () => {
  mocks.save.mockResolvedValue({ errors: { form: '저장 실패' } });
  type('reason', '입고 지연');
  submit(); await settle();
  expect(onDone).toHaveBeenCalledWith({ tone: 'danger', message: expect.stringContaining('지연 메모를 넣지 못했습니다. 넣지 못한 3건은 건너뛰었습니다: 2026111210000001') });
});
