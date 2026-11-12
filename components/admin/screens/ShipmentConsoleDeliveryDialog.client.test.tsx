import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ read: vi.fn(), apply: vi.fn(), refresh: vi.fn(), states: [] as unknown[], refs: [] as { current: unknown }[], index: 0, refIndex: 0,
  effects: [] as (() => void | (() => void))[], work: [] as Promise<void>[] }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/app/admin/shipment-actions', () => ({ readDispatchDeliveryOptionsAction: mocks.read, applyDispatchDeliveryAction: mocks.apply }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => {
    const index = mocks.index++;
    if (!(index in mocks.states)) mocks.states[index] = typeof initial === 'function' ? initial() : initial;
    return [mocks.states[index], (next: unknown) => { mocks.states[index] = typeof next === 'function' ? next(mocks.states[index]) : next; }];
  },
  useRef: (initial: unknown) => { const index = mocks.refIndex++; mocks.refs[index] ??= { current: initial }; return mocks.refs[index]; },
  useId: () => 'dialog',
  useEffect: (effect: () => void | (() => void)) => { mocks.effects.push(effect); },
  useTransition: () => [false, (work: () => Promise<void>) => { mocks.work.push(work()); }],
}));
import { Button } from '@/components/admin/kit/ui/button';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { ShipmentConsoleDeliveryDialog } from './ShipmentConsoleDeliveryDialog';
import type { DispatchDeliveryShipment } from '@/lib/admin/dispatch-delivery';

type Element = ReactElement<Record<string, unknown>>;
const ORIGIN = '10000000-0000-4000-8000-000000000001';
const FIRST = '20000000-0000-4000-8000-000000000001', SECOND = '20000000-0000-4000-8000-000000000002';
const shipment = (overrides: Partial<DispatchDeliveryShipment>): DispatchDeliveryShipment => ({ id: FIRST, orderId: '30000000-0000-4000-8000-000000000001', orderNumber: '2026111110000001',
  shipmentNumber: '2026111130000001', originId: ORIGIN, originName: '김포', status: 'ready', orderStatus: 'confirmed', customerMethod: 'parcel', method: 'parcel',
  updatedAt: '2026-11-11T00:00:00.123456+00:00', exportedAt: null, hasTracking: false, packed: false, claimOpen: false, preorderReady: true, canSelect: true, canHandoff: true, ...overrides });
const options = { shipments: [shipment({}), shipment({ id: SECOND, shipmentNumber: '2026111130000002', canSelect: false, packed: true })],
  policies: [{ id: '40000000-0000-4000-8000-000000000001', originId: ORIGIN, method: 'quick', revision: 1, contactName: '퀵 담당', handoffLocation: '1층' }] };
const onClose = vi.fn(), onDone = vi.fn();
function nodes(value: ReactNode): Element[] { return Children.toArray(value).flatMap(node => isValidElement<Record<string, unknown>>(node) ? [node, ...nodes(node.props.children as ReactNode)] : []); }
function text(value: ReactNode): string { return Children.toArray(value).map(node => isValidElement<Record<string, unknown>>(node) ? text(node.props.children as ReactNode) : String(node)).join(''); }
function render() { mocks.index = 0; mocks.refIndex = 0; return ShipmentConsoleDeliveryDialog({ shipmentIds: [FIRST, SECOND], mode: 'dispatch', onClose, onDone }) as Element; }
function button(label: string) { const found = nodes(render()).find(node => node.type === Button && text(node.props.children as ReactNode) === label); if (!found) throw new Error(`Missing button: ${label}`); return found; }
function change(element: Element, value: string) { (element.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } }); }
/* 입력 칸의 onChange는 그 렌더의 값을 닫아 두므로 칸마다 다시 그려 최신 손잡이로 바꾼다. */
function fillHandoff() {
  ['출고 담당', '퀵 업체', '02-1234-5678', '2026-11-11T18:30'].forEach((value, index) => {
    change(nodes(render()).filter(node => typeof node.props.onChange === 'function' && node.props.required === true && node.type !== Textarea)[index], value);
  });
  change(nodes(render()).filter(node => node.type === Textarea).at(-1)!, '인계 메모');
}
async function open() { render(); mocks.effects.splice(0).forEach(effect => effect()); await new Promise(resolve => setTimeout(resolve, 0)); }
beforeEach(() => { vi.clearAllMocks(); mocks.states = []; mocks.refs = []; mocks.index = 0; mocks.refIndex = 0; mocks.effects = []; mocks.work = []; mocks.read.mockResolvedValue({ ok: true, options }); });

it('택배 외 발송처리는 켜진 택배 외 방법만 보이고, 합포장 건은 보내지 않고 이유를 보인다', async () => {
  await open();
  expect(mocks.read).toHaveBeenCalledWith([FIRST, SECOND]);
  const methods = nodes(render()).find(node => node.type === NativeSelect)!;
  expect(methods.props.value).toBe('quick');
  expect(nodes(methods.props.children as ReactNode).map(node => node.props.value)).toEqual(['quick']);
  expect(text(render())).toContain('합포장에 묶인 배송 건은 방법을 바꿀 수 없습니다');
  /* 고객이 택배를 골랐으므로 사유가 없으면 누를 수 없다. */
  expect(button('1건 발송처리').props.disabled).toBe(true);
});

/* QA 라운드 1 m5: 고른 건이 맞는지 팝업 안에서 확인하도록 목록의 수령인·상품을 함께 보인다. 목록 밖 건은 그렇다고 적는다. */
it('처리 대상 표에 목록에서 넘겨받은 수취인·상품을 함께 보인다', async () => {
  await open();
  mocks.index = 0; mocks.refIndex = 0;
  const html = text(ShipmentConsoleDeliveryDialog({ shipmentIds: [FIRST, SECOND], mode: 'dispatch', onClose, onDone,
    summaries: { [FIRST]: { recipient: '수령인하나', items: ['QA 키링 · A형 × 2', 'QA 스티커 × 1'] } } }) as Element);
  expect(html).toContain('수취인 · 상품');
  expect(html).toContain('수령인하나');expect(html).toContain('QA 키링 · A형 × 2');expect(html).toContain('QA 스티커 × 1');
  expect(html).toContain('목록 밖 배송 건');
});

it('방문수령 완료 위치 안내는 주문 조회 권한이 없으면 발송관리 행의 인계·수령 확인을 가리킨다(QA 라운드 1b)', async () => {
  await open();
  mocks.index = 0; mocks.refIndex = 0;
  const html = (canReadOrders: boolean) => { mocks.index = 0; mocks.refIndex = 0; return text(ShipmentConsoleDeliveryDialog({ shipmentIds: [FIRST, SECOND], mode: 'dispatch', onClose, onDone, canReadOrders }) as Element); };
  expect(html(true)).toContain('주문 상세에서 완료합니다');
  expect(html(false)).toContain("발송관리 행의 '인계·수령 확인'에서 완료합니다");
  expect(html(false)).not.toContain('주문 상세');
});

it('사유와 인계 근거를 받아 보낼 건만 같은 요청 번호로 보내고, 일부 실패는 표 위 알림과 팝업에 남긴다', async () => {
  await open();
  change(nodes(render()).find(node => node.type === Textarea && node.props.required === true)!, '고객 전화 요청');
  fillHandoff();
  mocks.apply.mockResolvedValue({ ok: true, receipt: { operationId: 'op', method: 'quick', results: [{ shipmentId: FIRST, ok: false, error: 'shipment_delivery_changed' }], changed: 0, handedOff: 0, failed: 1, replayed: false } });
  (button('1건 발송처리').props.onClick as () => void)(); await Promise.all(mocks.work);
  const request = mocks.apply.mock.calls[0][0];
  expect(request).toMatchObject({ targets: [{ shipmentId: FIRST, updatedAt: '2026-11-11T00:00:00.123456+00:00' }], method: 'quick', reason: '고객 전화 요청',
    handoff: { operatorName: '출고 담당', providerName: '퀵 업체', providerPhone: '02-1234-5678', handoffReference: '인계 메모', occurredAt: '2026-11-11T09:30:00.000Z' } });
  expect(request.operationId).toMatch(/^[0-9a-f-]{36}$/);
  expect(onDone).toHaveBeenCalledWith({ tone: 'warning', message: expect.stringContaining('실패 1건 · 제외 1건') });
  expect(onClose).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled();
  /* 결과 요약은 별도 부품이라 그 부품을 그려 본다. */
  const summary = nodes(render()).find(node => typeof node.type === 'function' && (node.type as { name?: string }).name === 'DispatchReceipt')!;
  expect(text((summary.type as (props: unknown) => ReactNode)(summary.props))).toContain('배송 건이 그 사이 바뀌었습니다');
  expect(text(render())).toContain('닫기');
});

it('모두 처리되면 팝업을 닫고 목록을 새로 읽는다', async () => {
  mocks.read.mockResolvedValue({ ok: true, options: { ...options, shipments: [shipment({ method: 'quick', customerMethod: 'quick' })] } });
  await open();
  fillHandoff();
  mocks.apply.mockResolvedValue({ ok: true, receipt: { operationId: 'op', method: 'quick', results: [{ shipmentId: FIRST, ok: true, methodChanged: false, handedOff: true }], changed: 0, handedOff: 1, failed: 0, replayed: false } });
  (button('1건 발송처리').props.onClick as () => void)(); await Promise.all(mocks.work);
  expect(mocks.apply.mock.calls[0][0]).toMatchObject({ reason: '' });
  expect(onDone).toHaveBeenCalledWith({ tone: 'success', message: expect.stringContaining('인계 기록 1건') });
  expect(onClose).toHaveBeenCalledOnce(); expect(mocks.refresh).toHaveBeenCalledOnce();
});

it('결과를 모른 채 끊긴 요청은 같은 내용이면 같은 요청 번호로 다시 보낸다', async () => {
  mocks.read.mockResolvedValue({ ok: true, options: { ...options, shipments: [shipment({ method: 'quick', customerMethod: 'quick' })] } });
  await open();
  fillHandoff();
  mocks.apply.mockRejectedValueOnce(new Error('network'));
  (button('1건 발송처리').props.onClick as () => void)(); await Promise.all(mocks.work);
  expect(text(render())).toContain('같은 요청으로 확인합니다');
  mocks.apply.mockResolvedValue({ ok: true, receipt: { operationId: 'op', method: 'quick', results: [], changed: 0, handedOff: 1, failed: 0, replayed: true } });
  (button('1건 발송처리').props.onClick as () => void)(); await Promise.all(mocks.work);
  expect(mocks.apply.mock.calls[1][0].operationId).toBe(mocks.apply.mock.calls[0][0].operationId);
});
