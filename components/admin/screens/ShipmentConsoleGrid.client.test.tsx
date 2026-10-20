import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ShipmentConsoleRow } from '@/lib/admin/shipment-dispatch';
const mocks = vi.hoisted(() => ({ complete: vi.fn(), export: vi.fn(), refresh: vi.fn(), states: [] as unknown[], index: 0, work: [] as Promise<void>[] }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }) }));
vi.mock('@/app/admin/order-actions', () => ({ bulkConfirmAdminOrdersAction: vi.fn() }));
vi.mock('@/app/admin/shipment-actions', () => ({ completeShipmentsAction: mocks.complete, exportShipmentsAction: mocks.export }));
vi.mock('./ShipmentPackPanel', () => ({ ShipmentPackPanel: () => null }));
vi.mock('./OrderDelayNoticePanel', () => ({ OrderDelayNoticePanel: () => null }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = mocks.index++;
    if (!(index in mocks.states)) mocks.states[index] = initial;
    return [mocks.states[index], (next: unknown) => { mocks.states[index] = typeof next === 'function' ? next(mocks.states[index]) : next; }];
  },
  useTransition: () => [false, (work: () => Promise<void>) => { mocks.work.push(work()); }],
}));
import { ConsoleGrid } from '@/components/admin/console';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { ShipmentConsoleGrid } from './ShipmentConsoleGrid';
type Element = ReactElement<Record<string, unknown>>;
const ids = ['60000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000003'];
const row: ShipmentConsoleRow = { id: ids[0], orderId: ids[0], originId: 'origin', originName: '합성 출고지', status: 'shipping', createdAt: '2026-10-16T00:00:00Z', confirmedAt: null, buyerName: '합성 구매자', recipientName: '합성 수령인', total: 10000, paymentMethod: 'card', shippingFee: 0, carrier: 'hanjin', trackingNumber: 'TEST12345', shippedAt: '2026-10-16T00:00:00Z', deliveredAt: null, exportedAt: null, updatedAt: '2026-10-16T00:00:00Z', delayReason: null, expectedShipDate: null, items: [], pack: { id: ids[2], revision: 1, count: 2, shipmentIds: ids.slice(0, 2), collectFee: 0, canRelease: false } };
const props: Parameters<typeof ShipmentConsoleGrid>[0] = { rows: [row, { ...row, id: ids[1] }, { ...row, id: ids[2], pack: null }], columns: [], gridRows: [], tab: 'transit', currentHref: '/admin/sales/shipping', readyHref: '/admin/sales/dispatch' };
function nodes(value: ReactNode): Element[] { return Children.toArray(value).flatMap(node => isValidElement<Record<string, unknown>>(node) ? [node, ...nodes(node.props.children as ReactNode)] : []); }
function text(value: ReactNode): string { return Children.toArray(value).map(node => isValidElement<Record<string, unknown>>(node) ? text(node.props.children as ReactNode) : String(node)).join(''); }
function render() { mocks.index = 0; return ShipmentConsoleGrid(props); }
function button(label: string) { const result = nodes(render()).find(node => node.type === 'button' && text(node.props.children as ReactNode) === label); if (!result) throw new Error(`Missing button: ${label}`); return result; }
function click(label: string) { const element = button(label); (element.props.onClick as () => void)(); }
function select(selected: string[]) { const grid = nodes(render()).find(node => node.type === ConsoleGrid)!; (grid.props.onSelectionChange as (ids: string[]) => void)(selected); }
beforeEach(() => { vi.clearAllMocks(); mocks.states = []; mocks.index = 0; mocks.work = []; mocks.complete.mockResolvedValue({ message: '2건 배송완료', failed: [] }); });
afterEach(() => vi.unstubAllGlobals());
it('선택한 합포장의 보이지 않는 구성 건을 포함해 확인하고 명시적으로 체크한 뒤에만 처리한다', async () => {
  select([ids[0]]); click('선택 배송완료');
  expect(text(render())).toContain('총 2건');
  expect(button('2건 배송완료 처리').props.disabled).toBe(true);
  click('2건 배송완료 처리'); expect(mocks.complete).not.toHaveBeenCalled();
  const checkbox = nodes(render()).find(node => node.type === 'input' && node.props.type === 'checkbox')!;
  (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } });
  // A background selection change cannot replace the batch the operator reviewed.
  select([ids[2]]); click('2건 배송완료 처리'); await Promise.all(mocks.work);
  expect(mocks.complete).toHaveBeenCalledOnce(); expect(mocks.complete).toHaveBeenCalledWith([ids[0]]);
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(nodes(render()).some(node => node.type === CustomerServiceDialog)).toBe(false);
});
it('같은 합포장의 두 행을 골라도 중복 계산하지 않으며 취소 후 재확인에는 체크가 남지 않는다', () => {
  select(ids.slice(0, 2)); click('선택 배송완료');
  expect(text(render())).not.toContain('총 4건'); expect(button('2건 배송완료 처리').props.disabled).toBe(true);
  click('취소'); expect(mocks.complete).not.toHaveBeenCalled();
  click('선택 배송완료'); expect(button('2건 배송완료 처리').props.disabled).toBe(true);
});
it('김포·남양주에 스마트스토어 양식을 기본으로 보내고 기존 창고 양식을 명시적으로 선택할 수 있다', async () => {
  const readyProps = { ...props, tab: 'ready' as const, rows: props.rows.map(value => ({ ...value, status: 'ready' as const })) };
  function ready() { mocks.index = 0; return ShipmentConsoleGrid(readyProps); }
  mocks.export.mockResolvedValue({ error: '합성 응답' });
  const grid = nodes(ready()).find(node => node.type === ConsoleGrid)!;
  (grid.props.onSelectionChange as (ids: string[]) => void)([ids[0]]);
  function exportFile() {
    const target = nodes(ready()).find(node => node.type === 'button' && text(node.props.children as ReactNode) === '출고지시 내보내기')!;
    (target.props.onClick as () => void)();
  }
  expect(nodes(ready()).find(node => node.type === 'select')!.props.value).toBe('smartstore');
  exportFile();
  expect(mocks.export).not.toHaveBeenCalled();
  expect(text(ready())).toContain('비밀번호 확인');
  const formData = new FormData();
  formData.set('password', 'Shipment-Test-1234'); formData.set('passwordConfirmation', 'Shipment-Test-1234');
  vi.stubGlobal('FormData', vi.fn(function() { return formData; }));
  const form = nodes(ready()).find(node => node.type === 'form')!;
  const reset = vi.fn();
  (form.props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn(), currentTarget: { reset } });
  await Promise.all(mocks.work);
  expect(reset).toHaveBeenCalledOnce();
  expect(formData.has('password')).toBe(false);
  expect(mocks.export).toHaveBeenLastCalledWith([ids[0]], 'xlsx', 'smartstore', { password: 'Shipment-Test-1234', passwordConfirmation: 'Shipment-Test-1234' });
  const cancel = nodes(ready()).find(node => node.type === 'button' && text(node.props.children as ReactNode) === '취소')!;
  (cancel.props.onClick as () => void)();
  const layout = nodes(ready()).find(node => node.type === 'select')!;
  (layout.props.onChange as (event: unknown) => void)({ target: { value: 'warehouse' } });
  exportFile(); await Promise.all(mocks.work);
  expect(mocks.export).toHaveBeenLastCalledWith([ids[0]], 'xlsx', 'warehouse', undefined);
});
