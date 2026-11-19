import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setAdminConfirmHandler, type AdminConfirmRequest } from '@/lib/admin/confirm';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, work: [] as Promise<void>[], report: null as null | ((notice: unknown) => void) }));
const mocks = vi.hoisted(() => ({ delivery: vi.fn(), dispatch: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.values)) hooks.values[index] = initial; return [hooks.values[index], (value: unknown) => { hooks.values[index] = value; }]; },
  useRef: (initial: unknown) => { const index = hooks.index++; return hooks.values[index] ??= { current: initial }; },
  useContext: () => hooks.report,
  useTransition: () => [false, (action: () => Promise<void>) => { hooks.work.push(action()); }],
}));
vi.mock('@/app/admin/shipment-revert-actions', () => ({ revertShipmentDeliveryAction: mocks.delivery, revertShipmentDispatchAction: mocks.dispatch }));
import { Button } from '@/components/admin/kit/ui/button';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { ShipmentStatusRevertButton } from './ShipmentStatusRevertButton';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
const shipmentId = 'c3a00000-0000-4002-8000-000000000001', deliveredAt = '2026-11-18T03:00:00.123456+00:00';
const props = { shipmentId, reference: '2026111930000001', kind: 'delivery' as const, expected: deliveredAt, packCount: 2 };
function render(override: Partial<Parameters<typeof ShipmentStatusRevertButton>[0]> = {}) { hooks.index = 0; return ShipmentStatusRevertButton({ ...props, ...override }); }
async function click(override: Partial<Parameters<typeof ShipmentStatusRevertButton>[0]> = {}) {
  const button = nodes(render(override)).find(node => node.type === Button)!;
  await (button.props.onClick as () => Promise<void>)(); await Promise.all(hooks.work);
}
let requests: AdminConfirmRequest[] = [];
let answer: string | null = '다른 주문의 배송 건을 배송완료로 눌렀음';
let restore: () => void;
beforeEach(() => {
  vi.clearAllMocks(); hooks.values = []; hooks.work = []; hooks.report = null; requests = []; answer = '다른 주문의 배송 건을 배송완료로 눌렀음';
  restore = setAdminConfirmHandler(async request => { requests.push(request); if (answer === null) return false; request.receive?.(answer); return true; });
  vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValueOnce('c3a00000-0000-4009-8000-000000000001').mockReturnValueOnce('c3a00000-0000-4009-8000-000000000002') });
});
afterEach(() => { restore(); vi.unstubAllGlobals(); });

it('확인창에 되돌리는 결과·회수할 수 없는 안내를 보이고 사유 5~500자를 받아 화면이 본 배송완료 일시로 실행한다', async () => {
  mocks.delivery.mockResolvedValue({ ok: true, tone: 'success', message: '배송 중으로 되돌렸습니다.' });
  expect(text(render())).toBe('배송완료 되돌리기');
  await click();
  expect(requests[0]).toMatchObject({ title: '배송완료 되돌리기', destructive: true, input: { minLength: 5, maxLength: 500 } });
  expect(requests[0].message).toContain('합포장 묶음 2건이 함께 되돌아갑니다');
  expect(requests[0].message).toContain('이미 본 알림은 회수할 수 없으니');
  expect(mocks.delivery).toHaveBeenCalledWith({ shipmentId, reason: '다른 주문의 배송 건을 배송완료로 눌렀음', operationId: 'c3a00000-0000-4009-8000-000000000001', expectedDeliveredAt: deliveredAt, reference: '2026111930000001' });
  const notice = nodes(render()).find(node => node.type === AdminNotice)!;
  expect(notice.props.tone).toBe('success'); expect(text(notice.props.children as ReactNode)).toBe('배송 중으로 되돌렸습니다.');
});

it('닫으면 실행하지 않고, 실패 뒤 같은 사유로 다시 누르면 같은 작업 번호를 보낸다', async () => {
  answer = null; await click();
  expect(mocks.delivery).not.toHaveBeenCalled();
  answer = '다른 주문의 배송 건을 배송완료로 눌렀음';
  mocks.delivery.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ ok: false, error: '리뷰가 작성된 주문은 되돌릴 수 없습니다.' });
  await click();
  expect(text(nodes(render()).find(node => node.type === AdminNotice)!.props.children as ReactNode)).toContain('같은 사유로 다시 누르면 한 번만 반영됩니다');
  await click();
  expect(mocks.delivery.mock.calls.map(call => call[0].operationId)).toEqual(['c3a00000-0000-4009-8000-000000000001', 'c3a00000-0000-4009-8000-000000000001']);
  expect(nodes(render()).find(node => node.type === AdminNotice)!.props.tone).toBe('danger');
});

it('발송 되돌리기는 대표 운송장을 대조값으로 보내고, 표 안에서는 결과를 표 위 알림으로 올린다', async () => {
  const report = vi.fn(); hooks.report = report;
  mocks.dispatch.mockResolvedValue({ ok: true, tone: 'warning', message: '발송 대기로 되돌렸습니다. 발송 안내 메일이 이미 나갔습니다.' });
  await click({ kind: 'dispatch', expected: '1000000012', trackingLabel: '한진택배 1000000012', packCount: null });
  expect(requests[0].title).toBe('발송 되돌리기');
  expect(requests[0].message).toContain('운송장 한진택배 1000000012와 추가 운송장·발송 시각을 비워');
  expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({ shipmentId, expectedTrackingNumber: '1000000012' }));
  expect(report).toHaveBeenCalledWith({ tone: 'warning', message: '발송 대기로 되돌렸습니다. 발송 안내 메일이 이미 나갔습니다.' });
  expect(nodes(render({ kind: 'dispatch', expected: '1000000012' })).some(node => node.type === AdminNotice)).toBe(false);
});
