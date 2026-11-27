// @vitest-environment node
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAdminConfirmHandler, type AdminConfirmRequest } from '@/lib/admin/confirm';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, work: [] as Promise<void>[], effects: [] as (() => void | (() => void))[] }));
const mocks = vi.hoisted(() => ({ select: vi.fn(), record: vi.fn(), read: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: unknown) => { const index = hooks.index++; if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = typeof value === 'function' ? (value as (current: unknown) => unknown)(hooks.values[index]) : value; }]; },
  useRef: (initial: unknown) => { const index = hooks.index++; return hooks.values[index] ??= { current: initial }; },
  useTransition: () => [false, (action: () => Promise<void>) => { hooks.work.push(action()); }],
  useId: () => 'id',
  useMemo: (factory: () => unknown, deps: unknown[]) => { const index = hooks.index++; const saved = hooks.values[index] as { value: unknown; deps: unknown[] } | undefined;
    if (!saved || deps.some((dep, position) => dep !== saved.deps[position])) hooks.values[index] = { value: factory(), deps }; return (hooks.values[index] as { value: unknown }).value; },
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => { const index = hooks.index++; const saved = hooks.values[index] as unknown[] | undefined;
    if (!saved || deps.some((dep, position) => dep !== saved[position])) { hooks.values[index] = deps; hooks.effects.push(effect); } },
}));
vi.mock('@/app/admin/shipment-delivery-actions', () => ({ readShipmentDeliveryAction: mocks.read, recordShipmentDeliveryAction: mocks.record, selectShipmentDeliveryMethodAction: mocks.select }));
vi.mock('@/components/admin/screens/ShipmentConsoleDeliveryDialog', () => ({ ShipmentConsoleDeliveryDialog: function ShipmentConsoleDeliveryDialog() { return null; } }));
vi.mock('@/components/orders/claim-preview-busy', () => ({ useClaimPreviewBusy: vi.fn() }));
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { Button } from '@/components/admin/kit/ui/button';
import { ShipmentConsoleDeliveryDialog } from '@/components/admin/screens/ShipmentConsoleDeliveryDialog';
import { HandoffForm, MethodSelection, ShipmentDeliveryPanel, ShipmentDeliveryView } from './ShipmentDeliveryPanel';
import { deliveryPanelShipment, deliveryPolicyFixture } from '@/lib/admin/shipment-delivery-panel.fixture';

type Element = ReactElement<Record<string, unknown>>;
const nodes = (node: ReactNode): Element[] => Children.toArray(node).flatMap(value => isValidElement<Record<string, unknown>>(value) ? [value, ...nodes(value.props.children as ReactNode)] : []);
const text = (node: ReactNode): string => Children.toArray(node).map(value => isValidElement<Record<string, unknown>>(value) ? text(value.props.children as ReactNode) : String(value)).join('');
const OPERATION_A = 'c3a00000-0000-4009-8000-000000000071', OPERATION_B = 'c3a00000-0000-4009-8000-000000000072';
let confirms: AdminConfirmRequest[] = [];
let answer = true;
let restore: () => void;
let saved: string[] = [];

beforeEach(() => {
  vi.clearAllMocks(); hooks.values = []; hooks.work = []; hooks.effects = []; confirms = []; answer = true; saved = [];
  restore = setAdminConfirmHandler(async request => { confirms.push(request); return answer; });
  vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValueOnce(OPERATION_A).mockReturnValueOnce(OPERATION_B) });
  /* node의 FormData는 form 요소를 받지 못한다 — 폼 요소 대신 값 묶음을 받는 대역이다. */
  vi.stubGlobal('FormData', class { map = new Map<string, string>(); constructor(source?: { values?: Record<string, string> }) { for (const [key, value] of Object.entries(source?.values ?? {})) this.map.set(key, value); }
    get(key: string) { return this.map.get(key) ?? null; } set(key: string, value: string) { this.map.set(key, value); } entries() { return this.map.entries(); } });
});
afterEach(() => { restore(); vi.unstubAllGlobals(); });
const entries = (form: unknown) => Object.fromEntries((form as { entries(): Iterable<[string, string]> }).entries());

describe('고객이 요청해서 배송 방식 바꾸기', () => {
  const shipment = deliveryPanelShipment({ policies: [deliveryPolicyFixture('quick')] });
  const render = () => { hooks.index = 0; return MethodSelection({ shipment, onSaved: message => { saved.push(message); } }); };
  const field = (placeholder: string) => nodes(render()).find(node => node.type === Textarea && String(node.props.placeholder).startsWith(placeholder))!;
  const typeIn = (placeholder: string, value: string) => (field(placeholder).props.onChange as (event: unknown) => void)({ target: { value } });
  const submit = async () => { const form = nodes(render()).find(node => node.type === 'form')!; await (form.props.onSubmit as (event: unknown) => void)({ preventDefault() {} }); await Promise.all(hooks.work); };
  const button = () => nodes(render()).find(node => node.type === Button)!;

  it('쓸 수 있는 방식만 고르게 하고, 처음에는 두 글이 비어 있어 누를 수 없다', () => {
    const select = nodes(render()).find(node => node.type === NativeSelect)!;
    expect(nodes(select).filter(node => node.type === 'option').map(node => text(node))).toEqual(['퀵']);
    expect(select.props.value).toBe('quick');
    expect(button().props.disabled).toBe(true);
    expect(text(button().props.children as ReactNode)).toBe('배송 방식 바꾸기');
  });
  it('확인 체크 없이 두 글과 켜진 운영 조건을 보내고, 배송비 유지 확인은 화면이 대신 보낸다', async () => {
    mocks.select.mockResolvedValue({ ok: true, message: '고객 요청과 배송비 유지 동의를 기록하고 배송 방식을 반영했습니다.' });
    typeIn('예: 11/26 고객이', ' 전화로 퀵 배송을 요청함 '); typeIn('예: 배송비 3,000원은', '그대로라고 안내하고 동의받음');
    expect(button().props.disabled).toBe(false);
    await submit();
    expect(mocks.select).toHaveBeenCalledTimes(1);
    expect(entries(mocks.select.mock.calls[0][0])).toEqual({
      orderId: shipment.orderId, shipmentId: shipment.shipmentId, updatedAt: shipment.updatedAt, method: 'quick', policyId: shipment.policies[0].id,
      customerRequestReference: '전화로 퀵 배송을 요청함', feeConsentReference: '그대로라고 안내하고 동의받음', feeUnchanged: 'on', operationId: OPERATION_A,
    });
    expect(saved).toEqual(['고객 요청과 배송비 유지 동의를 기록하고 배송 방식을 반영했습니다.']);
  });
  it('글이 비어 있으면 보내지 않는다', async () => {
    typeIn('예: 11/26 고객이', '요청'); await submit();
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it('결과를 모르면 [저장됐는지 확인]으로 바뀌고, 처음 보낸 내용 그대로 같은 처리 번호로 다시 보낸다', async () => {
    mocks.select.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ ok: true, message: '저장했습니다.' });
    typeIn('예: 11/26 고객이', '전화 요청'); typeIn('예: 배송비 3,000원은', '동의함');
    await submit();
    expect(text(button().props.children as ReactNode)).toBe('저장됐는지 확인');
    expect(button().props.disabled).toBe(false);
    expect(text(nodes(render()).find(node => node.props.role === 'alert')!)).toBe('저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.');
    expect(nodes(render()).find(node => node.type === 'fieldset')!.props.disabled).toBe(true);
    await submit();
    expect(mocks.select).toHaveBeenCalledTimes(2);
    expect(entries(mocks.select.mock.calls[1][0])).toEqual(entries(mocks.select.mock.calls[0][0]));
    expect(entries(mocks.select.mock.calls[1][0]).operationId).toBe(OPERATION_A);
    expect(saved).toEqual(['저장했습니다.']);
  });
  it('서버가 분명히 거절하면 오류만 보이고 다시 고칠 수 있다', async () => {
    mocks.select.mockResolvedValue({ ok: false, error: '배송 건이 변경되었습니다. 새로고침한 뒤 다시 확인해주세요.' });
    typeIn('예: 11/26 고객이', '전화 요청'); typeIn('예: 배송비 3,000원은', '동의함'); await submit();
    expect(text(nodes(render()).find(node => node.props.role === 'alert')!)).toBe('배송 건이 변경되었습니다. 새로고침한 뒤 다시 확인해주세요.');
    expect(nodes(render()).find(node => node.type === 'fieldset')!.props.disabled).toBe(false);
    expect(text(button().props.children as ReactNode)).toBe('배송 방식 바꾸기');
  });
});

describe('인계·수령 기록', () => {
  const quick = deliveryPanelShipment({ canTransition: true, summary: { method: 'quick', policy: null, providerName: null, canIssueReceipt: false } });
  const pickup = deliveryPanelShipment({ canTransition: true, summary: { method: 'pickup', policy: null, providerName: null, canIssueReceipt: false } });
  const submit = async (shipment: typeof quick, values: Record<string, string>) => {
    hooks.index = 0; const tree = HandoffForm({ shipment, reference: '2026112600010001', originName: '김포', onSaved: message => { saved.push(message); } });
    const form = nodes(tree).find(node => node.type === 'form')!;
    await (form.props.onSubmit as (event: unknown) => void)({ preventDefault() {}, currentTarget: { values } }); await Promise.all(hooks.work);
  };
  const handoffValues = { orderId: quick.orderId, shipmentId: quick.shipmentId, updatedAt: quick.updatedAt, kind: 'quick_handoff', operatorName: '김담당', occurredAt: '2026-11-26T10:00', providerName: '라인퀵', providerPhone: '010-0000-0000', handoffReference: '접수 12345' };

  it('발송처리는 확인창이 업체와 앱 알림을 말한 뒤에야 보낸다', async () => {
    mocks.record.mockResolvedValue({ ok: true, message: '실제 배송 인계 근거를 기록하고 배송 중으로 반영했습니다.' });
    await submit(quick, handoffValues);
    expect(confirms).toHaveLength(1);
    expect(confirms[0]).toMatchObject({ title: '퀵 인계를 기록하고 발송처리할까요?', confirmLabel: '발송처리', cancelLabel: '돌아가기' });
    expect(confirms[0].message).toContain('김포 · 배송 건 2026112600010001');
    expect(confirms[0].message).toContain('배송 업체(라인퀵)가 바로 보입니다');
    expect(mocks.record).toHaveBeenCalledTimes(1);
    expect(entries(mocks.record.mock.calls[0][0])).toMatchObject({ ...handoffValues, operationId: OPERATION_A });
    expect(saved).toHaveLength(1);
  });
  it('확인창에서 돌아가면 보내지 않고, 다시 눌러 확인하면 새 처리 번호 하나로 보낸다', async () => {
    answer = false; await submit(quick, handoffValues);
    expect(mocks.record).not.toHaveBeenCalled();
    answer = true; mocks.record.mockResolvedValue({ ok: true, message: '완료' }); await submit(quick, handoffValues);
    expect(mocks.record).toHaveBeenCalledTimes(1);
    expect(entries(mocks.record.mock.calls[0][0]).operationId).toBe(OPERATION_A);
  });
  it('수령 기록은 배송완료로 기록한다고 말하고 청약철회·거래확정 기한의 시작을 알린다', async () => {
    mocks.record.mockResolvedValue({ ok: true, message: '완료' });
    await submit(pickup, { ...handoffValues, kind: 'pickup_receive', receiptReference: '본인 수령', recipientKind: 'self', receiptCode: 'ABCDEF123456' });
    expect(confirms[0]).toMatchObject({ title: '방문수령 완료로 기록할까요?', confirmLabel: '배송완료로 기록' });
    expect(confirms[0].message).toContain('청약철회·거래확정 기한은 입력한 수령 시각부터 셉니다.');
  });
  it('결과를 모르면 같은 내용으로 다시 누르면 두 번 저장되지 않는다고 알린다', async () => {
    mocks.record.mockRejectedValue(new Error('network'));
    await submit(quick, handoffValues);
    hooks.index = 0; const tree = HandoffForm({ shipment: quick, reference: '2026112600010001', onSaved: () => {} });
    expect(text(nodes(tree).find(node => node.props.role === 'alert')!)).toBe('저장됐는지 확인하지 못했습니다. 같은 내용으로 다시 누르면 두 번 저장되지 않습니다.');
    expect(text(nodes(tree).find(node => node.type === Button)!.props.children as ReactNode)).toBe('인계 기록 · 발송처리');
  });
  it('인계 시각 칸의 처음 값은 지금이고 입력 칸 이름은 발송관리 창과 같다', () => {
    hooks.index = 0; const tree = nodes(HandoffForm({ shipment: quick, reference: 'x', onSaved: () => {} }));
    const occurred = tree.find(node => node.type === Input && node.props.name === 'occurredAt')!;
    expect(occurred.props.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(occurred.props.step).toBeUndefined();
    expect(tree.map(node => node.props.name).filter(Boolean)).toEqual(expect.arrayContaining(['operatorName', 'occurredAt', 'providerName', 'providerPhone', 'handoffReference']));
  });
});

describe('배송 방식·인계 확인 패널 — 읽기와 발송관리 창', () => {
  const shipment = deliveryPanelShipment({ policies: [deliveryPolicyFixture('quick')] });
  const props = { shipmentId: shipment.shipmentId, shipmentNumber: '2026112630000001', orderId: shipment.orderId, originName: '김포', summary: { recipient: '박수령', items: ['각인 키링 × 2'] } };
  const render = () => { hooks.index = 0; return ShipmentDeliveryPanel(props) as ReactElement<{ children: ReactNode[] }>; };
  const parts = (tree: ReactElement<{ children: ReactNode[] }>) => { const [body, dialog] = Children.toArray(tree.props.children) as Element[]; return { body, dialog }; };
  const settle = async () => { const run = hooks.effects.splice(0); for (const effect of run) effect(); for (let i = 0; i < 6; i++) await Promise.resolve(); };

  it('읽는 동안은 한 줄 안내이고, 읽고 나면 배송 건 한 건의 화면을 그린다', async () => {
    mocks.read.mockResolvedValue({ ok: true, shipment });
    expect(text(parts(render()).body)).toContain('김포 · 배송 방식·인계 확인을 불러오는 중입니다…');
    await settle();
    expect(mocks.read).toHaveBeenCalledWith(shipment.shipmentId, shipment.orderId);
    const { body, dialog } = parts(render());
    expect(body.type).toBe(ShipmentDeliveryView);
    expect(body.props).toMatchObject({ shipment, shipmentId: shipment.shipmentId, reference: '2026112630000001', originName: '김포', notice: null });
    expect(dialog).toBeUndefined();
  });
  it('읽지 못하면 오류와 [다시 불러오기]를 보인다', async () => {
    mocks.read.mockResolvedValue({ ok: false, error: '배송 인계 정보를 불러오지 못했습니다.' });
    render(); await settle();
    const { body } = parts(render());
    expect(text(body)).toContain('배송 인계 정보를 불러오지 못했습니다.');
    expect(text(body)).toContain('다시 불러오기');
  });
  it('‘판매자가 정했습니다’는 발송관리와 같은 창을 이 배송 건 하나로 열고, 창이 끝나면 결과를 보이고 다시 읽는다', async () => {
    mocks.read.mockResolvedValue({ ok: true, shipment });
    render(); await settle();
    const first = parts(render());
    (first.body.props.onOpenStoreDialog as () => void)();
    const open = parts(render());
    expect(open.dialog.type).toBe(ShipmentConsoleDeliveryDialog);
    expect(open.dialog.props).toMatchObject({ mode: 'method', shipmentIds: [shipment.shipmentId], summaries: { [shipment.shipmentId]: props.summary } });
    /* 다시 그려도 같은 배열이라 창이 배송 건 목록을 다시 읽지 않는다. */
    expect(parts(render()).dialog.props.shipmentIds).toBe(open.dialog.props.shipmentIds);
    (open.dialog.props.onDone as (notice: unknown) => void)({ tone: 'warning', message: '배송 방식 바꾸기: 방식 변경 1건 · 실패 1건. 배송비·결제 금액은 바뀌지 않았습니다.' });
    render(); await settle();
    expect(mocks.read).toHaveBeenCalledTimes(2);
    const done = parts(render());
    expect(done.body.props.notice).toEqual({ shipmentId: shipment.shipmentId, text: '배송 방식 바꾸기: 방식 변경 1건 · 실패 1건. 배송비·결제 금액은 바뀌지 않았습니다.', tone: 'warning' });
    /* 일부가 실패해 창이 영수증을 보여 주는 동안에도 다시 읽는 사이에 창이 사라지지 않는다. */
    expect(done.dialog?.type).toBe(ShipmentConsoleDeliveryDialog);
    (done.dialog.props.onClose as () => void)();
    expect(parts(render()).dialog).toBeUndefined();
  });
  it('요청 양식으로 저장하면 결과 문구를 보이고 다시 읽는다', async () => {
    mocks.read.mockResolvedValue({ ok: true, shipment });
    render(); await settle();
    (parts(render()).body.props.onSaved as (message: string) => void)('고객 요청과 배송비 유지 동의를 기록하고 배송 방식을 반영했습니다.');
    render(); await settle();
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(parts(render()).body.props.notice).toMatchObject({ text: '고객 요청과 배송비 유지 동의를 기록하고 배송 방식을 반영했습니다.', tone: 'success' });
  });
});
