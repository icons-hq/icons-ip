import { beforeEach, describe, expect, it, vi } from 'vitest';
import { revertShipmentDeliveryAction, revertShipmentDispatchAction } from './shipment-revert-actions';

const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));
const shipmentId = 'c3a00000-0000-4002-8000-000000000001', orderId = 'c3a00000-0000-4001-8000-000000000001', operationId = 'c3a00000-0000-4009-8000-000000000001';
const deliveredAt = '2026-11-18T03:00:00.123456+00:00';
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue(true); });

describe('배송 상태 되돌리기 서버 액션 (ADR-0045)', () => {
  it('판매 관리 권한을 먼저 보고, 사유는 5~500자이며 화면이 본 배송완료 일시와 작업 번호를 그대로 넘긴다', async () => {
    mocks.access.mockResolvedValueOnce(null);
    expect(await revertShipmentDeliveryAction({ shipmentId, reason: '엉뚱한 배송 건 처리', operationId, expectedDeliveredAt: deliveredAt })).toEqual({ ok: false, error: expect.stringContaining('판매 관리 권한') });
    expect(mocks.access).toHaveBeenCalledWith('/admin/sales/shipping', { capability: 'sales.manage' });
    expect(await revertShipmentDeliveryAction({ shipmentId, reason: '짧음', operationId, expectedDeliveredAt: deliveredAt })).toEqual({ ok: false, error: expect.stringContaining('5자 이상') });
    expect(await revertShipmentDeliveryAction({ shipmentId, reason: '엉뚱한 배송 건 처리', operationId: 'nope', expectedDeliveredAt: deliveredAt })).toHaveProperty('ok', false);
    expect(await revertShipmentDeliveryAction({ shipmentId, reason: '엉뚱한 배송 건 처리', operationId, expectedDeliveredAt: '어제' })).toHaveProperty('ok', false);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: { orderId, shipmentId, orderCount: 2, orderStatus: 'shipping' }, error: null });
    const result = await revertShipmentDeliveryAction({ shipmentId: shipmentId.toUpperCase(), reason: '  엉뚱한 배송 건 처리  ', operationId, expectedDeliveredAt: deliveredAt, reference: '2026111930000001' });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_revert_shipment_delivery', { p_shipment_id: shipmentId, p_reason: '엉뚱한 배송 건 처리', p_operation_id: operationId, p_expected_delivered_at: deliveredAt });
    expect(result).toEqual({ ok: true, tone: 'success', message: expect.stringContaining('배송 건 2026111930000001을 배송 중으로 되돌렸습니다(합포장으로 주문 2건 함께)') });
    expect(mocks.revalidate).toHaveBeenCalledWith(`/admin/sales/orders/${orderId}`);
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/sales/shipping');
    // 리뷰 R1: 운송장 없이 강제 배송완료한 건은 발송 대기·발주확인으로 돌아갔다고 알린다.
    mocks.rpc.mockResolvedValueOnce({ data: { orderId, shipmentId, orderCount: 1, orderStatus: 'confirmed', shipmentStatus: 'ready' }, error: null });
    expect(await revertShipmentDeliveryAction({ shipmentId, reason: '강제 배송완료를 잘못 누름', operationId, expectedDeliveredAt: deliveredAt, reference: '2026111930000001' }))
      .toEqual({ ok: true, tone: 'success', message: expect.stringContaining('발송 대기로 되돌렸습니다. 운송장 없이 강제 배송완료한 건이라 주문은 발주확인으로') });
  });

  it('발송 되돌리기는 화면이 본 대표 운송장(없으면 빈 값)을 넘기고, 이미 나간 메일은 주의로 알린다', async () => {
    mocks.rpc.mockResolvedValue({ data: { orderId, shipmentId, orderCount: 1, emailSent: true }, error: null });
    const sent = await revertShipmentDispatchAction({ shipmentId, reason: '다른 주문의 운송장을 등록', operationId, expectedTrackingNumber: ' 1000000012 ' });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_revert_shipment_dispatch', { p_shipment_id: shipmentId, p_reason: '다른 주문의 운송장을 등록', p_operation_id: operationId, p_expected_tracking_number: '1000000012' });
    expect(sent).toEqual({ ok: true, tone: 'warning', message: expect.stringContaining('고객에게 올바른 운송장을 직접 안내해주세요') });
    mocks.rpc.mockResolvedValue({ data: { orderId, shipmentId, orderCount: 1, emailSent: false }, error: null });
    expect(await revertShipmentDispatchAction({ shipmentId, reason: '운송장 없이 배송 중', operationId, expectedTrackingNumber: null })).toMatchObject({ ok: true, tone: 'success' });
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_revert_shipment_dispatch', expect.objectContaining({ p_expected_tracking_number: '' }));
    expect(await revertShipmentDispatchAction({ shipmentId, reason: '다른 주문의 운송장을 등록', operationId, expectedTrackingNumber: '12-34' })).toHaveProperty('ok', false);
  });

  it('DB 거절 사유를 운영 문구로 돌려주고 다른 배송 건의 응답은 받지 않는다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '23514', message: 'shipment_revert_review_exists' } });
    expect(await revertShipmentDeliveryAction({ shipmentId, reason: '엉뚱한 배송 건 처리', operationId, expectedDeliveredAt: deliveredAt })).toEqual({ ok: false, error: expect.stringContaining('리뷰가 작성된 주문') });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'shipment_revert_changed' } });
    expect(await revertShipmentDispatchAction({ shipmentId, reason: '엉뚱한 배송 건 처리', operationId, expectedTrackingNumber: '1000000012' })).toEqual({ ok: false, error: expect.stringContaining('그 사이 배송 건이 바뀌었습니다') });
    mocks.rpc.mockResolvedValueOnce({ data: { orderId, shipmentId: 'c3a00000-0000-4002-8000-000000000099' }, error: null });
    expect(await revertShipmentDeliveryAction({ shipmentId, reason: '엉뚱한 배송 건 처리', operationId, expectedDeliveredAt: deliveredAt })).toHaveProperty('ok', false);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
