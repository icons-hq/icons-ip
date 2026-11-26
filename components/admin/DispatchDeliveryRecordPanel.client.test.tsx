// @vitest-environment node
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAdminConfirmHandler, type AdminConfirmRequest } from '@/lib/admin/confirm';

/*
 * 발송관리 줄의 인계·수령 기록은 배송 건 상태를 바꾸고(배송중·배송완료) 고객 앱 알림이 가며, 배송완료는 청약철회·거래확정 기한을 시작한다.
 * 주문 상세의 같은 기록과 같은 확인창을 한 번 거친 뒤에만 보낸다 — 확인창은 전환(startTransition) 밖에서 먼저 받는다.
 */
const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, work: [] as Promise<void>[], inTransition: false, confirmedInTransition: [] as boolean[] }));
const mocks = vi.hoisted(() => ({ record: vi.fn(), read: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = typeof value === 'function' ? (value as (current: unknown) => unknown)(hooks.values[index]) : value; }]; },
  useRef: (initial: unknown) => { const index = hooks.index++; return hooks.values[index] ??= { current: initial }; },
  useTransition: () => [false, (action: () => Promise<void>) => { hooks.inTransition = true; const work = action(); hooks.inTransition = false; hooks.work.push(work); }],
  useId: () => 'id',
}));
vi.mock('@/app/admin/dispatch-delivery-actions', () => ({ readDispatchShipmentDeliveryAction: mocks.read, recordDispatchShipmentDeliveryAction: mocks.record }));
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { DispatchDeliveryRecordForm } from './DispatchDeliveryRecordPanel';
import { deliveryPanelShipment } from '@/lib/admin/shipment-delivery-panel.fixture';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
const OPERATION_A = 'c3a00000-0000-4009-8000-000000000071', OPERATION_B = 'c3a00000-0000-4009-8000-000000000072';
let confirms: AdminConfirmRequest[] = [];
let answer: boolean | 'throw' = true;
let restore: () => void;
let saved: string[] = [];

beforeEach(() => {
  vi.clearAllMocks(); hooks.values = []; hooks.work = []; hooks.confirmedInTransition = []; confirms = []; answer = true; saved = [];
  restore = setAdminConfirmHandler(async request => {
    hooks.confirmedInTransition.push(hooks.inTransition); confirms.push(request);
    if (answer === 'throw') throw new Error('host gone');
    return answer;
  });
  vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValueOnce(OPERATION_A).mockReturnValueOnce(OPERATION_B) });
  /* node의 FormData는 form 요소를 받지 못한다 — 폼 요소 대신 값 묶음을 받는 대역이다. */
  vi.stubGlobal('FormData', class { map = new Map<string, string>(); constructor(source?: { values?: Record<string, string> }) { for (const [key, value] of Object.entries(source?.values ?? {})) this.map.set(key, value); }
    get(key: string) { return this.map.get(key) ?? null; } set(key: string, value: string) { this.map.set(key, value); } entries() { return this.map.entries(); } });
});
afterEach(() => { restore(); vi.unstubAllGlobals(); });
const entries = (form: unknown) => Object.fromEntries((form as { entries(): Iterable<[string, string]> }).entries());

describe('발송관리 줄의 인계·수령 기록 — 확인창', () => {
  const quick = deliveryPanelShipment({ canTransition: true, summary: { method: 'quick', policy: null, providerName: null, canIssueReceipt: false } });
  const pickup = deliveryPanelShipment({ canTransition: true, summary: { method: 'pickup', policy: null, providerName: null, canIssueReceipt: false } });
  const render = (shipment: typeof quick, kind: 'quick_handoff' | 'pickup_receive') => { hooks.index = 0; return DispatchDeliveryRecordForm({ shipment, kind, reference: '2026112600010001', onSaved: message => { saved.push(message); } }); };
  const submit = async (shipment: typeof quick, kind: 'quick_handoff' | 'pickup_receive', values: Record<string, string>) => {
    const form = nodes(render(shipment, kind)).find(node => node.type === 'form')!;
    await (form.props.onSubmit as (event: unknown) => void)({ preventDefault() {}, currentTarget: { values } }); await Promise.all(hooks.work);
  };
  const handoffValues = { shipmentId: quick.shipmentId, updatedAt: quick.updatedAt, kind: 'quick_handoff', operatorName: '김담당', occurredAt: '2026-11-26T10:00', providerName: '라인퀵', providerPhone: '010-0000-0000', handoffReference: '접수 12345' };

  it('발송처리는 주문 상세와 같은 확인창이 업체와 앱 알림을 말한 뒤에야 보낸다(확인은 전환 밖에서)', async () => {
    mocks.record.mockResolvedValue({ ok: true, message: '인계를 기록하고 배송중으로 바꿨습니다.' });
    await submit(quick, 'quick_handoff', handoffValues);
    expect(confirms).toHaveLength(1);
    expect(hooks.confirmedInTransition).toEqual([false]);
    expect(confirms[0]).toMatchObject({ title: '퀵 인계를 기록하고 발송처리할까요?', confirmLabel: '발송처리', cancelLabel: '돌아가기' });
    expect(confirms[0].message).toContain('배송 건 2026112600010001');
    expect(confirms[0].message).toContain('배송 업체(라인퀵)가 바로 보입니다');
    expect(mocks.record).toHaveBeenCalledTimes(1);
    expect(entries(mocks.record.mock.calls[0][0])).toMatchObject({ ...handoffValues, operationId: OPERATION_A });
    expect(saved).toEqual(['인계를 기록하고 배송중으로 바꿨습니다.']);
  });

  it('확인창에서 돌아가거나 확인창을 띄우지 못하면 보내지 않고, 다시 누르면 보낼 수 있다', async () => {
    answer = false; await submit(quick, 'quick_handoff', handoffValues);
    answer = 'throw'; await submit(quick, 'quick_handoff', handoffValues);
    expect(mocks.record).not.toHaveBeenCalled();
    answer = true; mocks.record.mockResolvedValue({ ok: true, message: '완료' }); await submit(quick, 'quick_handoff', handoffValues);
    expect(mocks.record).toHaveBeenCalledTimes(1);
    expect(entries(mocks.record.mock.calls[0][0]).operationId).toBe(OPERATION_A);
  });

  it('수령 기록은 배송완료로 기록한다고 말하고 청약철회·거래확정 기한의 시작을 알린다', async () => {
    mocks.record.mockResolvedValue({ ok: true, message: '완료' });
    await submit(pickup, 'pickup_receive', { shipmentId: pickup.shipmentId, updatedAt: pickup.updatedAt, kind: 'pickup_receive', operatorName: '김담당', occurredAt: '2026-11-26T10:00', receiptReference: '본인 수령', recipientKind: 'self', receiptCode: 'ABCDEF123456' });
    expect(confirms[0]).toMatchObject({ title: '방문수령 완료로 기록할까요?', confirmLabel: '배송완료로 기록' });
    expect(confirms[0].message).toContain('청약철회·거래확정 기한은 입력한 수령 시각부터 셉니다.');
  });

  it('결과를 모르면 같은 내용으로 다시 누르면 두 번 저장되지 않는다고 알리고, 서버가 거절하면 그 문구를 보인다', async () => {
    mocks.record.mockRejectedValue(new Error('network'));
    await submit(quick, 'quick_handoff', handoffValues);
    const alert = () => text(nodes(render(quick, 'quick_handoff')).find(node => node.props.role === 'alert')!);
    expect(alert()).toBe('저장됐는지 확인하지 못했습니다. 같은 내용으로 다시 누르면 두 번 저장되지 않습니다.');
    mocks.record.mockResolvedValue({ ok: false, error: '담당자·시각·확인 내용을 모두 적어주세요. 수령 기록에는 고객이 보여 준 확인값 12자리도 필요합니다.' });
    await submit(quick, 'quick_handoff', handoffValues);
    expect(alert()).toBe('담당자·시각·확인 내용을 모두 적어주세요. 수령 기록에는 고객이 보여 준 확인값 12자리도 필요합니다.');
    /* 같은 처리 번호로 다시 보낸다 — 앞의 것이 저장됐어도 두 번 저장되지 않는다. */
    expect(mocks.record.mock.calls.map(call => entries(call[0]).operationId)).toEqual([OPERATION_A, OPERATION_A]);
  });

  it('시각 칸의 처음 값은 지금(분 단위)이고 [현재 시각 입력] 버튼은 없다', () => {
    const tree = nodes(render(quick, 'quick_handoff'));
    const occurred = tree.find(node => node.type === Input && node.props.name === 'occurredAt')!;
    expect(occurred.props.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(occurred.props.step).toBeUndefined();
    expect(tree.filter(node => node.type === Button).map(node => text(node.props.children as ReactNode))).toEqual(['인계 기록 · 발송처리']);
  });
});
