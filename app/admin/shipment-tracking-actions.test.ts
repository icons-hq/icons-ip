import { configuredOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/orders/shipment.server', () => ({ getShippingCarrierRegistry: async () => [
  { code: 'hanjin', label: '한진택배', active: true, trackingUrlTemplate: 'https://example.test/{trackingNumber}' },
  { code: 'retired', label: '계약 종료 택배', active: false, trackingUrlTemplate: 'https://example.test/{trackingNumber}' },
] }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn(), redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); } }));
import { addShipmentExtraTrackingAction, removeShipmentExtraTrackingAction } from './shipment-tracking-actions';

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
    for (const overrides of invalid) {
      expect(await addShipmentExtraTrackingAction(add(overrides))).toMatchObject({ ok: false });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('DB 거절은 운영 문구로 바꾼다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'tracking_number_in_use' } });
    expect(await addShipmentExtraTrackingAction(add())).toEqual({ ok: false, error: expect.stringContaining('다른 배송 건에 등록된 운송장번호') });
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
