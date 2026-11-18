import { configuredOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), revalidate: vi.fn(), enqueue: vi.fn() }));
vi.mock('@/lib/email/order-shipment-jobs.server', () => ({ enqueueOrderShippedEmails: mocks.enqueue }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/orders/shipment.server', () => ({ getShippingCarrierRegistry: async () => [
  { code: 'hanjin', label: '한진택배', active: true, trackingUrlTemplate: 'https://example.test/{trackingNumber}', trackingNumberPattern: '^[0-9]{10,14}$', trackingNumberRule: '숫자 10~14자리' },
  { code: 'retired', label: '계약 종료 택배', active: false, trackingUrlTemplate: 'https://example.test/{trackingNumber}' },
] }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn(), redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); } }));
import { addShipmentExtraTrackingAction, registerDuplicateShipmentTrackingAction, removeShipmentExtraTrackingAction, swapShipmentTrackingAction } from './shipment-tracking-actions';

const shipmentId = '00000000-0000-4000-8000-000000000001';
const extraTrackingId = '00000000-0000-4000-8000-000000000002';
const operationId = '00000000-0000-4000-8000-000000000003';
const as = (role: Parameters<typeof configuredOperatorAccessFixture>[0]) =>
  mocks.auth.mockResolvedValue({ operatorAccess: configuredOperatorAccessFixture(role), isConfigured: true, user: { id: 'operator' }, role: 'staff', isStaff: true });
const form = (values: Record<string, string>) => { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; };
const add = (overrides: Record<string, string> = {}) => form({ shipmentId, operationId, carrier: 'hanjin', trackingNumber: '2234-5678-9012', reason: ' 서원 분리배송 연결 송장 ', ...overrides });

beforeEach(() => { vi.resetAllMocks(); as('logistics'); });

describe('배송 건 추가 운송장 액션 (QNA-019)', () => {
  it('출고 권한으로 추가 운송장을 정규화해 더하고 고객·운영 화면을 새로 읽게 한다', async () => {
    mocks.rpc.mockResolvedValue({ data: { status: 'added' }, error: null });
    expect(await addShipmentExtraTrackingAction(add())).toEqual({ ok: true, message: expect.stringContaining('223456789012') });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_add_shipment_extra_tracking', { p_shipment_id: shipmentId, p_carrier: 'hanjin', p_tracking_number: '223456789012',
      p_reason: '서원 분리배송 연결 송장', p_operation_id: operationId });
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/sales/shipping');
    expect(mocks.revalidate).toHaveBeenCalledWith('/orders/[orderId]', 'page');
  });
  it('사유·택배사·번호 형식이 틀리면 DB를 부르지 않는다', async () => {
    const invalid: Record<string, string>[] = [{ reason: '  ' }, { reason: 'x'.repeat(501) }, { carrier: 'retired' }, { carrier: 'unknown' }, { trackingNumber: '12' }, { shipmentId: 'nope' }, { operationId: '' }];
    // 택배사별 형식(레지스트리): 한진 숫자 10~14자리. 영문이 섞이거나 한 자리 넘치면 그 규칙을 알린다.
    expect(await addShipmentExtraTrackingAction(add({ trackingNumber: 'AB1234567890' }))).toEqual({ ok: false, error: expect.stringContaining('한진택배 운송장번호는 숫자 10~14자리') });
    expect(await addShipmentExtraTrackingAction(add({ trackingNumber: '123456789012345' }))).toMatchObject({ ok: false });
    for (const overrides of invalid) {
      expect(await addShipmentExtraTrackingAction(add(overrides))).toMatchObject({ ok: false });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('DB 거절은 운영 문구로 바꾼다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'tracking_number_in_use' } });
    expect(await addShipmentExtraTrackingAction(add())).toEqual({ ok: false, error: expect.stringContaining('다른 주문의 배송 건') });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'tracking_number_format_mismatch' } });
    expect(await addShipmentExtraTrackingAction(add())).toEqual({ ok: false, error: expect.stringContaining('형식(자릿수)') });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'order_not_shipped' } });
    expect(await addShipmentExtraTrackingAction(add())).toMatchObject({ ok: false });
    mocks.rpc.mockResolvedValue({ data: { status: 'mystery' }, error: null });
    expect(await addShipmentExtraTrackingAction(add())).toEqual({ ok: false, error: expect.stringContaining('확인하지 못했습니다') });
  });
  it('사유와 함께 지우고, 같은 요청은 한 번만 반영한다', async () => {
    mocks.rpc.mockResolvedValue({ data: { status: 'removed' }, error: null });
    expect(await removeShipmentExtraTrackingAction(form({ extraTrackingId, operationId, reason: '회신 오기 정정' }))).toMatchObject({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_remove_shipment_extra_tracking', { p_extra_tracking_id: extraTrackingId, p_reason: '회신 오기 정정', p_operation_id: operationId });
    mocks.rpc.mockResolvedValue({ data: { status: 'unchanged' }, error: null });
    expect(await removeShipmentExtraTrackingAction(form({ extraTrackingId, operationId, reason: '회신 오기 정정' }))).toMatchObject({ ok: true });
    mocks.rpc.mockClear();
    expect(await removeShipmentExtraTrackingAction(form({ extraTrackingId, operationId, reason: '' }))).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('출고 권한이 없는 운영자는 쓰지 못한다', async () => {
    for (const role of ['deputy', 'influencer', 'agency'] as const) {
      as(role);
      expect(await addShipmentExtraTrackingAction(add())).toMatchObject({ ok: false });
      expect(await removeShipmentExtraTrackingAction(form({ extraTrackingId, operationId, reason: '정정' }))).toMatchObject({ ok: false });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
    as('primary');
    mocks.rpc.mockResolvedValue({ data: { status: 'added' }, error: null });
    expect(await addShipmentExtraTrackingAction(add())).toMatchObject({ ok: true });
  });
});

describe('뒤바뀐 운송장 맞바꾸기 액션 (SHP-031)', () => {
  const swap = (overrides: Record<string, string> = {}) => form({ shipmentId, expectedTrackingNumber: '100000000001', otherReference: ' 2026 1118 3000 0002 ',
    otherTrackingNumber: '2000-0000-0002', reason: ' 김포 회신 두 주문 뒤바뀜 ', ...overrides });

  it('정규화한 두 번호와 상대 배송건번호로 DB 맞바꾸기를 부르고 두 화면을 새로 읽게 한다', async () => {
    mocks.rpc.mockResolvedValue({ data: { status: 'swapped', trackingNumber: '200000000002', otherTrackingNumber: '100000000001' }, error: null });
    expect(await swapShipmentTrackingAction(swap())).toEqual({ ok: true, message: expect.stringContaining('이 배송 건은 200000000002, 상대 배송 건은 100000000001') });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_swap_shipment_trackings', { p_shipment_id: shipmentId, p_expected_tracking: '100000000001',
      p_other_reference: '2026111830000002', p_expected_other_tracking: '200000000002', p_reason: '김포 회신 두 주문 뒤바뀜' });
    expect(mocks.revalidate).toHaveBeenCalledWith('/orders/[orderId]', 'page');
    // 전체 UUID 참조는 하이픈을 지우지 않는다.
    await swapShipmentTrackingAction(swap({ otherReference: extraTrackingId }));
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_swap_shipment_trackings', expect.objectContaining({ p_other_reference: extraTrackingId }));
  });

  it('입력이 비면 DB를 부르지 않고, DB 거절·모르는 응답은 운영 문구로 알린다', async () => {
    for (const overrides of [{ otherReference: ' ' }, { otherTrackingNumber: '12' }, { reason: '' }, { shipmentId: 'nope' }]) {
      expect(await swapShipmentTrackingAction(swap(overrides))).toMatchObject({ ok: false });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'shipment_tracking_changed' } });
    expect(await swapShipmentTrackingAction(swap())).toEqual({ ok: false, error: expect.stringContaining('이미 맞바꿨거나') });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'tracking_number_in_use' } });
    expect(await swapShipmentTrackingAction(swap())).toEqual({ ok: false, error: expect.stringContaining('다른 주문의 배송 건') });
    mocks.rpc.mockResolvedValue({ data: { status: 'mystery' }, error: null });
    expect(await swapShipmentTrackingAction(swap())).toEqual({ ok: false, error: expect.stringContaining('확인하지 못했습니다') });
  });

  it('출고 권한이 없으면 맞바꾸지 않는다', async () => {
    as('deputy');
    expect(await swapShipmentTrackingAction(swap())).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('중복 확인 후 운송장 등록 액션 (SHP-030 리뷰 2)', () => {
  const duplicate = (overrides: Record<string, string> = {}) => form({ shipmentId, carrier: 'hanjin', trackingNumber: '1000-0000-0001', reason: ' 김포 확인: 같은 상자 ', ...overrides });

  it('사유와 정규화한 번호로 DB를 부르고, 발송처리됐으면 묶음 배송 건의 배송 메일을 대기열에 넣는다', async () => {
    mocks.rpc.mockResolvedValue({ data: { status: 'dispatched', packedShipments: [{ orderId: 'o1', shipmentId }] }, error: null });
    expect(await registerDuplicateShipmentTrackingAction(duplicate())).toEqual({ ok: true, message: expect.stringContaining('배송 중으로 옮겼습니다') });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_register_shipment_tracking_duplicate', { p_shipment_id: shipmentId, p_carrier: 'hanjin', p_tracking_number: '100000000001',
      p_reason: '김포 확인: 같은 상자' });
    expect(mocks.enqueue).toHaveBeenCalledWith([{ orderId: 'o1', shipmentId }]);
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/sales/dispatch');
    mocks.rpc.mockResolvedValue({ data: { status: 'corrected' }, error: null }); mocks.enqueue.mockClear();
    expect(await registerDuplicateShipmentTrackingAction(duplicate())).toEqual({ ok: true, message: expect.stringContaining('고쳤습니다') });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('사유·택배사·형식이 틀리면 DB를 부르지 않고, DB 거절은 운영 문구로 알린다', async () => {
    for (const overrides of [{ reason: '  ' }, { carrier: 'retired' }, { trackingNumber: '12' }, { trackingNumber: 'AB1234567890' }, { shipmentId: 'nope' }]) {
      expect(await registerDuplicateShipmentTrackingAction(duplicate(overrides))).toMatchObject({ ok: false });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'tracking_duplicate_not_needed' } });
    expect(await registerDuplicateShipmentTrackingAction(duplicate())).toEqual({ ok: false, error: expect.stringContaining('일반 등록') });
  });

  it('출고 권한이 없으면 등록하지 않는다', async () => {
    as('deputy');
    expect(await registerDuplicateShipmentTrackingAction(duplicate())).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
