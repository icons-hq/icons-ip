import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setAdminConfirmHandler, type AdminConfirmRequest } from '@/lib/admin/confirm';

type Submit = (state: Record<string, unknown>, data: FormData) => Promise<unknown>;
const mocks = vi.hoisted(() => ({ save: vi.fn(), submit: null as null | Submit, states: [] as unknown[], index: 0 }));
vi.mock('@/app/admin/order-actions', () => ({ saveAdminOrderDispatchDelayAction: mocks.save }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = mocks.index++;
    if (!(index in mocks.states)) mocks.states[index] = typeof initial === 'function' ? initial() : initial;
    return [mocks.states[index], (next: unknown) => { mocks.states[index] = typeof next === 'function' ? next(mocks.states[index]) : next; }];
  },
  useActionState: (submit: Submit, initial: unknown) => { mocks.submit = submit; return [initial, vi.fn(), false]; },
}));
import { DispatchDelayNoteForm } from './DispatchDelayNoteForm';

/*
 * S-12: 사유를 비우고 [메모 저장]을 누르면 메모가 말없이 지워지던 것을 막고, 지우는 길은 무엇이 사라지는지 묻는 [메모 지우기] 하나로 둔다.
 * 서버 계약은 그대로다 — 지울 때는 사유를 비워 보낸다.
 */
type Element = ReactElement<Record<string, unknown>>;
const ORDER = '50000000-0000-4000-8000-000000000001';
const saved = { reason: '제조사 입고 지연', expectedShipDate: '2026-12-03', updatedAt: '2026-11-20T00:00:00Z' };
function nodes(value: ReactNode): Element[] { return Children.toArray(value).flatMap(node => isValidElement<Record<string, unknown>>(node) ? [node, ...nodes(node.props.children as ReactNode)] : []); }
function text(value: ReactNode): string { return Children.toArray(value).map(node => isValidElement<Record<string, unknown>>(node) ? text(node.props.children as ReactNode) : String(node)).join(''); }
function render(note: typeof saved | null = saved) { mocks.index = 0; return DispatchDelayNoteForm({ note, orderId: ORDER, reference: '2026111210000001' }) as Element; }
const onSubmit = (note: typeof saved | null = saved) => nodes(render(note)).find(node => node.type === 'form')!.props.onSubmit as (event: unknown) => void;
/* 양식에 적힌 지연 사유를 정해 준다(노드 환경에는 form 요소가 없다). */
function typed(reason: string) { vi.stubGlobal('FormData', vi.fn(function () { return { get: (name: string) => name === 'reason' ? reason : null }; })); }
const event = (submitterValue?: string) => ({ preventDefault: vi.fn(), currentTarget: { isConnected: true, requestSubmit: vi.fn() }, nativeEvent: { submitter: submitterValue ? { value: submitterValue } : null } });

beforeEach(() => { vi.clearAllMocks(); mocks.states = []; mocks.submit = null; });
afterEach(() => { vi.unstubAllGlobals(); setAdminConfirmHandler(null); });

it('사유를 비운 채 [메모 저장]을 누르면 보내지 않고, 지우려면 [메모 지우기]를 누르라고 말한다', () => {
  typed('   ');
  const submitted = event();
  onSubmit()(submitted);
  expect(submitted.preventDefault).toHaveBeenCalledOnce();
  expect(text(render())).toContain('지연 사유를 적어주세요. 메모를 없애려면 [메모 지우기]를 누릅니다.');
  /* 저장된 메모가 없으면 지우기 안내 없이 사유만 요구한다. */
  mocks.states = [];
  onSubmit(null)(event());
  expect(text(render(null))).toContain('지연 사유를 적어주세요.'); expect(text(render(null))).not.toContain('메모 지우기');
  /* 사유를 적으면 그대로 저장으로 넘어간다. */
  mocks.states = [];
  typed('입고 지연');
  const filled = event();
  onSubmit()(filled);
  expect(filled.preventDefault).not.toHaveBeenCalled();
});

it('[메모 지우기]는 무엇이 사라지는지 확인받은 뒤에만 진행한다', async () => {
  const asked: AdminConfirmRequest[] = [];
  setAdminConfirmHandler(async request => { asked.push(request); return false; });
  const clear = event('clear');
  onSubmit()(clear);
  expect(clear.preventDefault).toHaveBeenCalledOnce();
  await Promise.resolve();
  expect(asked).toEqual([{ title: '주문 2026111210000001의 지연 메모를 지울까요?', message: "'제조사 입고 지연' · 발송 예정일 2026-12-03 메모가 사라집니다. 고객에게는 보이지 않는 메모입니다.",
    confirmLabel: '메모 지우기', cancelLabel: '돌아가기', destructive: true }]);
  expect(clear.currentTarget.requestSubmit).not.toHaveBeenCalled();
});

it('지울 때는 사유와 발송 예정일을 비워 같은 저장으로 보내고, 저장할 때는 적은 값을 그대로 보낸다', async () => {
  render();
  mocks.save.mockResolvedValue({ message: '지연 메모를 지웠습니다.' });
  const clearing = new FormData();
  clearing.set('orderId', ORDER); clearing.set('reason', '제조사 입고 지연'); clearing.set('expectedShipDate', '2026-12-03'); clearing.set('intent', 'clear');
  await mocks.submit!({}, clearing);
  expect(Object.fromEntries((mocks.save.mock.calls[0][1] as FormData).entries())).toEqual({ orderId: ORDER, reason: '', expectedShipDate: '' });
  const saving = new FormData();
  saving.set('orderId', ORDER); saving.set('reason', '입고 지연'); saving.set('expectedShipDate', '2026-12-05');
  await mocks.submit!({}, saving);
  expect(Object.fromEntries((mocks.save.mock.calls[1][1] as FormData).entries())).toEqual({ orderId: ORDER, reason: '입고 지연', expectedShipDate: '2026-12-05' });
});
