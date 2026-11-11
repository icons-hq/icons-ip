import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ register: vi.fn(), refresh: vi.fn(), report: vi.fn(), openDelivery: vi.fn(), actions: true,
  states: [] as unknown[], index: 0, work: [] as Promise<void>[] }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/app/admin/shipment-actions', () => ({ registerShipmentTrackingAction: mocks.register }));
vi.mock('./ShipmentConsoleContext', () => ({ useShipmentConsoleActions: () => mocks.actions ? { report: mocks.report, openDelivery: mocks.openDelivery } : null }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = mocks.index++;
    if (!(index in mocks.states)) mocks.states[index] = typeof initial === 'function' ? initial() : initial;
    return [mocks.states[index], (next: unknown) => { mocks.states[index] = typeof next === 'function' ? next(mocks.states[index]) : next; }];
  },
  useId: () => 'row',
  useTransition: () => [false, (work: () => Promise<void>) => { mocks.work.push(work()); }],
}));
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Input } from '@/components/admin/kit/ui/input';
import { ShipmentConsoleRowTracking } from './ShipmentConsoleRowTracking';

type Element = ReactElement<Record<string, unknown>>;
const SHIPMENT = '60000000-0000-4000-8000-000000000001';
const carriers = [{ code: 'hanjin', label: '한진택배' }, { code: 'cj', label: 'CJ대한통운' }];
function nodes(value: ReactNode): Element[] { return Children.toArray(value).flatMap(node => isValidElement<Record<string, unknown>>(node) ? [node, ...nodes(node.props.children as ReactNode)] : []); }
function text(value: ReactNode): string { return Children.toArray(value).map(node => isValidElement<Record<string, unknown>>(node) ? text(node.props.children as ReactNode) : String(node)).join(''); }
function render(defaultCarrier: string | null = 'hanjin') { mocks.index = 0; return ShipmentConsoleRowTracking({ shipmentId: SHIPMENT, reference: '2026111130000001', carriers, defaultCarrier }) as Element; }
function select(tree: Element) { return nodes(tree).find(node => node.type === NativeSelect)!; }
function input(tree: Element) { return nodes(tree).find(node => node.type === Input)!; }
function submit() { (render().props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault: () => {} }); }
beforeEach(() => { vi.clearAllMocks(); mocks.states = []; mocks.index = 0; mocks.work = []; mocks.actions = true; });

it('출고지 기본 택배사가 사용 중이면 미리 고르고, 아니면 비워 운영자가 고르게 한다', () => {
  expect(select(render()).props.value).toBe('hanjin');
  mocks.states = [];
  expect(select(render('retired')).props.value).toBe('');
});

it('형식이 틀린 운송장은 서버에 보내지 않고 같은 칸 아래에 이유를 보인다', () => {
  render();
  (input(render()).props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '12-34' } });
  submit();
  expect(mocks.register).not.toHaveBeenCalled();
  expect(text(render())).toContain('8~30자리');
});

it('등록에 성공하면 하이픈을 뺀 번호로 보내고 결과를 표 위 알림에 올린 뒤 목록을 새로 읽는다', async () => {
  mocks.register.mockResolvedValue({ ok: true, message: '운송장 1건을 등록해 배송 중으로 옮겼습니다.', registered: [SHIPMENT], unchanged: [], failed: [], queueWarning: false });
  render();
  (input(render()).props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '1234-5678-9012' } });
  submit(); await Promise.all(mocks.work);
  expect(mocks.register).toHaveBeenCalledWith([{ shipmentId: SHIPMENT, carrier: 'hanjin', trackingNumber: '123456789012' }]);
  expect(mocks.report).toHaveBeenCalledWith({ tone: 'success', message: '배송 건 2026111130000001: 운송장 1건을 등록해 배송 중으로 옮겼습니다.' });
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(input(render()).props.value).toBe('');
});

it('이미 다른 운송장으로 발송된 건은 행에 사유를 남기고 알림·새로고침을 하지 않는다', async () => {
  mocks.register.mockResolvedValue({ ok: true, message: '운송장을 등록하지 못했습니다.', registered: [], unchanged: [], failed: [{ shipmentId: SHIPMENT, reason: '이미 다른 운송장으로 발송된 배송 건입니다.' }], queueWarning: false });
  render();
  (input(render()).props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '123456789012' } });
  submit(); await Promise.all(mocks.work);
  expect(text(render())).toContain('이미 다른 운송장으로 발송된 배송 건입니다.');
  expect(mocks.report).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled();
});
