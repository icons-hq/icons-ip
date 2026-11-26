import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ preview: vi.fn(), force: vi.fn(), search: vi.fn(), refresh: vi.fn(), states: [] as unknown[], refs: [] as { current: unknown }[], index: 0, refIndex: 0, fake: false }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/app/admin/forced-delivery-actions', () => ({ previewForcedDeliveryAction: mocks.preview, forceOrderDeliveredAction: mocks.force }));
vi.mock('@/app/admin/forced-delivery-picker-actions', () => ({ searchForcedDeliveryOrdersAction: mocks.search }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual,
    useState: (initial: unknown) => {
      if (!mocks.fake) return actual.useState(initial);
      const index = mocks.index++;
      if (!(index in mocks.states)) mocks.states[index] = typeof initial === 'function' ? initial() : initial;
      return [mocks.states[index], (next: unknown) => { mocks.states[index] = typeof next === 'function' ? next(mocks.states[index]) : next; }];
    },
    useRef: (initial: unknown) => { if (!mocks.fake) return actual.useRef(initial); const index = mocks.refIndex++; mocks.refs[index] ??= { current: initial }; return mocks.refs[index]; },
  };
});
import { AdminPickedBox } from '@/components/admin/AdminPickedValue';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { AdminPickerDialog, type AdminPickerPanelProps } from '@/components/admin/console/AdminPickerDialog';
import { Button } from '@/components/admin/kit/ui/button';
import { setAdminConfirmHandler, type AdminConfirmRequest } from '@/lib/admin/confirm';
import { ADMIN_ORDER_SEARCH_FIELDS } from '@/lib/admin/orders';
import { formatOrderDateTime } from '@/lib/orders';
import type { ForcedDeliveryOrderRow } from '@/lib/admin/forced-delivery-picker';
import { ForcedDeliveryPanel } from './ForcedDeliveryPanel';

type Element = ReactElement<Record<string, unknown>>;
type BoxProps = Parameters<typeof AdminPickedBox>[0];
type DialogProps = AdminPickerPanelProps<ForcedDeliveryOrderRow> & { title: string };
const orderNumber = '2026111110000001', orderId = 'f0dd0000-0000-4001-8000-000000000001';
const shipment = (id: number, method: 'parcel' | 'quick' | 'digital', extra: Record<string, unknown> = {}) => ({ id: `f0dd0000-0000-4002-8000-00000000000${id}`, shipmentNumber: `201111300000000${id}`, orderNumber,
  originName: '김포', status: 'ready' as const, method, carrier: null, trackingNumber: null, exportedAt: null as string | null, ...extra });
const preview = { orderId, orderNumber, status: 'confirmed', createdAt: '2026-11-11T00:00:00Z', buyerName: '시험 구매자', itemCount: 2, firstItemName: '시험 상품', orderCount: 2,
  shipments: [shipment(1, 'parcel'), shipment(2, 'quick')], blockers: [] as string[] };
const row: ForcedDeliveryOrderRow = { orderId, orderNumber, buyerName: '시험 구매자', status: 'confirmed', total: 12000, createdAt: '2026-11-11T00:00:00Z', cancellationInProgress: false };
const receipt = { orderId, orderNumber, status: 'delivered', deliveredShipments: 2, orderCount: 2, deliveredAt: '2026-11-11T02:00:00Z' };

function nodes(value: ReactNode): Element[] { return Children.toArray(value).flatMap(node => isValidElement<Record<string, unknown>>(node) ? [node, ...nodes(node.props.children as ReactNode)] : []); }
function text(value: ReactNode): string { return Children.toArray(value).map(node => isValidElement<Record<string, unknown>>(node) ? text(node.props.children as ReactNode) : String(node)).join(''); }
function render() { mocks.index = 0; mocks.refIndex = 0; return ForcedDeliveryPanel() as Element; }
const box = () => nodes(render()).find(node => node.type === AdminPickedBox)!.props as unknown as BoxProps;
const dialog = () => nodes(render()).find(node => node.type === AdminPickerDialog)?.props as unknown as DialogProps | undefined;
const startButton = () => nodes(render()).find(node => node.type === Button)!;
const notices = () => nodes(render()).filter(node => node.type === AdminNotice);
async function settle() { await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); }
/** [강제 배송완료]를 누르고 확인창·처리가 끝날 때까지 기다린다. */
async function start() { (startButton().props.onClick as () => void)(); await settle(); }
/** 확인창을 받아 줄 호스트 대신 쓰는 시험용 처리기. 사유를 넣고(reason) true를, reason이 null이면 돌아가기(false)를 돌려준다. */
const requests: AdminConfirmRequest[] = [];
let restore: (() => void) | null = null;
function answer(reason: string | null) {
  restore?.();
  restore = setAdminConfirmHandler(async (request) => { requests.push(request); if (reason === null) return false; request.receive?.(reason); return true; });
}
/** [주문 고르기] → 줄의 [선택]. 선택창은 고른 뒤 스스로 닫는다. */
function pick() { (box().onOpen as () => void)(); dialog()!.onSelect(row); dialog()!.onClose(); }

beforeEach(() => { vi.clearAllMocks(); mocks.states = []; mocks.refs = []; mocks.fake = true; requests.length = 0; answer(null); });
afterEach(() => { restore?.(); restore = null; });

it('접힌 카드는 주문 고르기와 [강제 배송완료]만 두고, 긴 설명·감사 기록 배지·번호 입력칸·확인 체크는 없다', () => {
  mocks.fake = false;
  const html = renderToStaticMarkup(<ForcedDeliveryPanel />);
  expect(html).toContain('강제 배송완료'); expect(html).toContain('거래확정·리뷰를 확인할 때처럼'); expect(html).toContain('강제 배송완료할 주문');
  expect(html).toContain('주문 고르기'); expect(html).toContain('아직 고르지 않았습니다');
  /* 결과 설명은 누른 뒤 확인창에서만 말한다. 카드에는 두 번 쓰지 않는다. */
  for (const gone of ['감사 기록', '배송 메일은 보내지 않습니다', '앱 알림', '디지털 파일 배송 건은', '주문번호 (전체)', '사유 (필수)', 'type="checkbox"', '<textarea', '확인했습니다', '스테이징']) expect(html).not.toContain(gone);
  expect(html).toMatch(/<details (?:(?!open)[^>])*data-sales-disclosure=""/);
  /* 번호는 읽기 전용 상자에만 보인다 — 직접 적는 칸이 없다. */
  expect(html).toMatch(/<input[^>]*id="forced-delivery-order"[^>]*readOnly=""/);
});

it('주문 상세에서 연 주문은 골라진 채로 카드를 펼치고 [강제 배송완료]에 포커스를 둔다(QA1 S-T04-05)', () => {
  mocks.fake = false;
  const html = renderToStaticMarkup(<ForcedDeliveryPanel initialOrderNumber="20261112140010000034" />);
  expect(html).toMatch(/<details[^>]*id="forced-delivery"[^>]*open=""/);
  expect(html).toContain('value="20261112140010000034"');
  expect(html).toMatch(/<button[^>]*autofocus=""[^>]*>강제 배송완료<\/button>/);
  expect(html).not.toContain('주문 상세에서 고른 주문');
  const plain = renderToStaticMarkup(<ForcedDeliveryPanel />);
  expect(plain).toMatch(/<details[^>]*id="forced-delivery"/);
  expect(plain).not.toContain('autofocus');
  expect(plain).not.toContain('value="2026');
});

it('[주문 고르기]가 공용 선택창을 열고, 발주확인·배송중 주문만 상태 조건으로 나눠 찾으며, 취소 요청이 진행 중인 줄은 막는다', async () => {
  expect(dialog()).toBeUndefined();
  (box().onOpen as () => void)();
  const picker = dialog()!;
  expect(picker).toMatchObject({ title: '주문 고르기', filterLabel: '주문 상태', unit: '건' });
  expect(picker.filterOptions).toEqual([{ value: 'confirmed', label: '발주확인' }, { value: 'shipping', label: '배송중' }]);
  /* 검색 대상 이름은 주문 통합검색과 같은 표에서 온다(이름을 따로 짓지 않는다). */
  expect(picker.searchFields?.map(field => field.value)).toEqual(['order', 'nickname', 'tracking', 'product']);
  expect(picker.searchFields?.map(field => field.label)).toEqual(['order', 'nickname', 'tracking', 'product'].map(value => ADMIN_ORDER_SEARCH_FIELDS.find(field => field.value === value)!.label));
  expect(picker.excludedNote).toBe('결제 대기·신규주문·배송완료·거래확정·취소 주문은 목록에서 뺐습니다.');
  /* 줄은 번호·구매자(굵게)와 주문일·금액만 말한다 — 목록이 한 상태만 보이므로 상태는 되풀이하지 않는다. */
  expect(picker.rowKey(row)).toBe(orderNumber);
  expect(text(picker.rowView(row).title)).toBe(`${orderNumber} · 시험 구매자`);
  expect(picker.rowView(row).meta).toBe(`${formatOrderDateTime(row.createdAt)} · 12,000원`);
  expect(picker.rowBlocked?.(row)).toBeNull();
  expect(picker.rowBlocked?.({ ...row, cancellationInProgress: true })).toBe('취소 요청이 진행 중입니다');
  mocks.search.mockResolvedValue({ ok: true, data: { rows: [row], total: 1, page: 1, pageSize: 20 } });
  expect(await picker.load({ query: '2026', field: 'order', filter: 'shipping', page: 2 })).toEqual({ rows: [row], total: 1, page: 1, pageSize: 20 });
  expect(mocks.search).toHaveBeenCalledWith({ query: '2026', field: 'order', filter: 'shipping', page: 2 });
  mocks.search.mockResolvedValue({ ok: false, error: '주문 목록을 불러오지 못했습니다.' });
  expect(await picker.load({ query: '', field: 'order', filter: 'confirmed', page: 1 })).toEqual({ error: '주문 목록을 불러오지 못했습니다.' });
  picker.onClose();
  expect(dialog()).toBeUndefined();
});

it('줄을 고르면 상자에 주문번호·구매자·상태가 보이고 선택창이 닫히며, 고른 줄은 선택됨으로 보인다', () => {
  pick();
  expect(box()).toMatchObject({ text: `${orderNumber} · 시험 구매자 · 발주확인`, value: orderNumber, pickLabel: '주문 고르기' });
  expect(dialog()).toBeUndefined();
  (box().onOpen as () => void)();
  expect(dialog()!.selectedKeys).toEqual([orderNumber]);
});

it('주문을 고르지 않고 누르면 먼저 고르라고 알리고 아무것도 부르지 않는다', async () => {
  await start();
  expect(text(notices()[0].props.children as ReactNode)).toBe('강제 배송완료할 주문을 먼저 골라주세요.');
  expect(mocks.preview).not.toHaveBeenCalled(); expect(requests).toHaveLength(0); expect(mocks.force).not.toHaveBeenCalled();
});

it('막는 사유가 있으면 카드에 이유를 보이고 확인창은 열지 않는다', async () => {
  pick();
  mocks.preview.mockResolvedValue({ preview: { ...preview, blockers: ['requires_confirmed', 'preorder_allocation_required'] } });
  await start();
  expect(mocks.preview).toHaveBeenCalledWith(orderNumber);
  const body = text(notices().map(notice => notice.props.children as ReactNode));
  expect(body).toContain('신규주문은 먼저 발주확인해주세요'); expect(body).toContain('실물이 없는 배송 건은 배송완료로 기록할 수 없습니다');
  expect(notices()[0].props.title).toBe('이 주문은 지금 강제 배송완료할 수 없습니다');
  expect(requests).toHaveLength(0); expect(mocks.force).not.toHaveBeenCalled();
});

it('확인창은 주문번호·구매자·상품·지금 상태와 결과를 말하고 사유를 필수로 받는다 — 돌아가면 처리하지 않는다', async () => {
  pick();
  mocks.preview.mockResolvedValue({ preview });
  await start();
  expect(requests).toHaveLength(1);
  const [request] = requests;
  expect(request).toMatchObject({ title: '강제 배송완료', confirmLabel: '강제 배송완료', cancelLabel: '돌아가기', destructive: true });
  expect(request.input).toMatchObject({ minLength: 1, maxLength: 500 });
  expect(request.input?.label).toContain('사유 (필수)'); expect(request.input?.label).toContain('감사 기록에 남습니다');
  for (const line of [`주문번호: ${orderNumber}`, '구매자: 시험 구매자', '상품: 시험 상품 외 1건', '주문 상태: 발주확인', '배송 건: 택배 발송 대기 1건, 퀵 발송 대기 1건',
    '고객에게 앱 알림 "배송이 완료됐어요"가 갑니다', '배송 메일은 보내지 않습니다', '반품 기한과 거래확정 기한을 셉니다', '[배송완료 되돌리기]', '이미 간 앱 알림은 회수할 수 없습니다',
    '합포장으로 묶인 주문 2개가 함께 배송완료됩니다']) expect(request.message).toContain(line);
  expect(request.message).not.toContain('출고지시를 이미 전달한');
  /* 돌아가면 처리하지 않고 고른 주문은 그대로다. */
  expect(mocks.force).not.toHaveBeenCalled();
  expect(box().value).toBe(orderNumber);
  expect(nodes(render()).some(node => node.type === 'input' && node.props.type === 'checkbox')).toBe(false);
});

it('사유를 적고 확인하면 같은 요청 번호로 실행하고, 결과를 알린 뒤 고른 주문을 비운다. 결과를 모르면 같은 사유로 다시 눌러도 한 번만 처리된다', async () => {
  pick();
  mocks.preview.mockResolvedValue({ preview });
  answer('거래확정·리뷰 시험');
  mocks.force.mockRejectedValueOnce(new Error('network'));
  await start();
  expect(text(notices()[0].props.children as ReactNode)).toContain('배송완료로 기록됐는지 확인하지 못했습니다');
  expect(text(notices()[0].props.children as ReactNode)).toContain('같은 사유로 [강제 배송완료]를 다시 누르면 두 번 처리되지 않습니다');
  expect(box().value).toBe(orderNumber);
  mocks.force.mockResolvedValue({ receipt });
  await start();
  expect(mocks.force.mock.calls[1].slice(0, 2)).toEqual([orderNumber, '거래확정·리뷰 시험']);
  expect(mocks.force.mock.calls[1][2]).toBe(mocks.force.mock.calls[0][2]);
  expect(box()).toMatchObject({ text: '', value: '' });
  const done = text(notices().map(notice => notice.props.children as ReactNode));
  expect(done).toContain(`주문 ${orderNumber}의 배송 건 2건을 배송완료로 기록했습니다.`);
  expect(done).toContain('합포장으로 묶인 주문 2건을 함께 처리했습니다'); expect(done).toContain('고객에게 앱 알림 "배송이 완료됐어요"가 갔습니다'); expect(done).toContain('사유는 감사 기록에 남았습니다');
  expect(mocks.refresh).toHaveBeenCalledOnce();
  /* 사유가 바뀌면 새 요청 번호다. */
  pick();
  answer('다른 사유');
  mocks.force.mockResolvedValueOnce({ error: '배송완료로 옮길 배송 건이 없습니다. 이미 배송완료됐거나 취소된 주문입니다.' });
  await start();
  expect(mocks.force.mock.calls[2][2]).not.toBe(mocks.force.mock.calls[0][2]);
  expect(text(notices()[0].props.children as ReactNode)).toContain('이미 배송완료됐거나 취소된 주문');
  expect(mocks.refresh).toHaveBeenCalledOnce();
});

it('출고지시를 이미 보낸 배송 건·디지털 파일 배송 건·합포장 동반 주문은 확인창이 말하고, 체크 없이 사유만으로 실행한다', async () => {
  pick();
  const mixed = { ...preview, orderCount: 3, shipments: [shipment(1, 'parcel', { exportedAt: '2026-11-11T01:00:00Z' }), shipment(2, 'quick', { orderNumber: '2026111110000002' }), shipment(3, 'digital')] };
  mocks.preview.mockResolvedValue({ preview: mixed });
  answer('시험');
  mocks.force.mockResolvedValue({ receipt: { ...receipt, status: 'shipping', deliveredShipments: 2 } });
  await start();
  const message = requests[0].message;
  expect(message).toContain('배송 건: 택배 발송 대기 1건, 퀵 발송 대기 1건');
  expect(message).toContain('출고지시를 이미 보낸 배송 건 1건이 있습니다'); expect(message).toContain('창고에 출고 보류를 먼저 요청해주세요');
  expect(message).toContain('디지털 파일 배송 건 1건은 구매자가 내려받을 때 완료되므로 뺍니다'); expect(message).toContain('"배송이 시작됐어요" 앱 알림이 갈 수 있습니다');
  expect(message).not.toContain('"배송이 완료됐어요"가 갑니다');
  expect(message).toContain('합포장으로 묶인 주문 3개가 함께 배송완료됩니다(다른 주문: 2026111110000002)');
  expect(mocks.force).toHaveBeenCalledOnce();
  expect(text(notices()[0].props.children as ReactNode)).toContain('주문에 남은 배송 건(디지털 파일 등)이 있어 주문은 아직 배송완료가 아닙니다');
});

it('미리보기를 불러오지 못하면 이유를 보이고, 처리 중에는 다시 누르거나 선택창을 열지 않는다', async () => {
  pick();
  mocks.preview.mockRejectedValue(new Error('network'));
  await start();
  expect(text(notices()[0].props.children as ReactNode)).toBe('대상을 불러오지 못했습니다. 잠시 뒤 다시 눌러주세요.');
  mocks.preview.mockResolvedValue({ error: '선택한 주문을 찾지 못했습니다. 주문을 다시 골라주세요.' });
  await start();
  expect(text(notices()[0].props.children as ReactNode)).toBe('선택한 주문을 찾지 못했습니다. 주문을 다시 골라주세요.');
  expect(requests).toHaveLength(0);
  let release: (value: unknown) => void = () => {};
  mocks.preview.mockReturnValue(new Promise(resolve => { release = resolve; }));
  (startButton().props.onClick as () => void)();
  expect(startButton().props.disabled).toBe(true);
  expect(text(startButton().props.children as ReactNode)).toBe('확인 중…');
  (startButton().props.onClick as () => void)();
  (box().onOpen as () => void)();
  expect(mocks.preview).toHaveBeenCalledTimes(3);
  expect(dialog()).toBeUndefined();
  release({ error: '그만' });
  await settle();
  expect(startButton().props.disabled).toBe(false);
});
