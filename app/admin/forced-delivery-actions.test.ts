import { beforeEach, describe, expect, it, vi } from 'vitest';
import { forceOrderDeliveredAction, previewForcedDeliveryAction } from './forced-delivery-actions';

const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));
const id = 'f0dd0000-0000-4000-8000-0000000000c1', orderId = 'f0dd0000-0000-4001-8000-000000000001', orderNumber = '2026111110000001';
const receipt = { orderId, orderNumber, status: 'delivered', deliveredShipments: 1, orderCount: 1, deliveredAt: '2026-11-11T02:00:00Z' };
const preview = { orderId, orderNumber, status: 'confirmed', createdAt: '2026-11-11T00:00:00Z', buyerName: '구매자', itemCount: 1, firstItemName: '굿즈', orderCount: 1,
  shipments: [{ id: 'f0dd0000-0000-4002-8000-000000000001', shipmentNumber: '2026111130000001', orderNumber, originName: '김포', status: 'ready', method: 'parcel', carrier: null, trackingNumber: null }], blockers: [] };
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue(true); });

describe('운영 강제 배송완료 (1014-083)', () => {
  it('운영 환경 판별 없이 배송 처리 권한만 확인하고, 하이픈·공백을 뺀 주문번호로 대상을 미리 본다', async () => {
    mocks.rpc.mockResolvedValue({ data: preview, error: null });
    expect(await previewForcedDeliveryAction('2026-1111-1000-0001')).toEqual({ preview });
    expect(mocks.access).toHaveBeenCalledWith('/admin/sales/dispatch', { capability: 'sales.manage' });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_force_order_delivery_preview', { p_order_number: orderNumber });
    mocks.access.mockResolvedValue(null);
    expect(await previewForcedDeliveryAction(orderNumber)).toEqual({ error: '현재 로그인 계정과 배송 처리 권한을 확인해주세요.' });
    mocks.access.mockResolvedValue(true);
    expect(await previewForcedDeliveryAction('12345')).toHaveProperty('error');
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('사유는 필수이고 500자까지이며, 같은 요청 번호로 DB에 맡긴 뒤 목록·주문 상세를 새로 그린다', async () => {
    expect(await forceOrderDeliveredAction(orderNumber, '   ', id)).toEqual({ error: '사유를 1~500자로 입력해주세요.' });
    expect(await forceOrderDeliveredAction(orderNumber, '가'.repeat(501), id)).toHaveProperty('error');
    expect(await forceOrderDeliveredAction(orderNumber, '시험', 'not-a-uuid')).toHaveProperty('error');
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: receipt, error: null });
    expect(await forceOrderDeliveredAction(orderNumber, ' 구매확정·리뷰 시험 ', id)).toEqual({ receipt });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_force_order_delivered', { p_order_number: orderNumber, p_reason: '구매확정·리뷰 시험', p_operation_id: id });
    expect(mocks.revalidate).toHaveBeenCalledWith(`/admin/sales/orders/${orderId}`);
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/sales/shipping');
  });

  it('DB 거절 사유를 운영자 문구로 보여 주고 다른 주문의 응답은 받지 않는다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '23514', message: 'forced_delivery_requires_confirmed' } });
    expect(await forceOrderDeliveredAction(orderNumber, '시험', id)).toEqual({ error: expect.stringContaining('발주확인 뒤') });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '23514', message: 'forced_delivery_parcel_only' } });
    expect(await forceOrderDeliveredAction(orderNumber, '시험', id)).toEqual({ error: expect.stringContaining('택배 외 배송 건') });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'operation_conflict' } });
    expect(await forceOrderDeliveredAction(orderNumber, '시험', id)).toEqual({ error: expect.stringContaining('같은 요청 번호') });
    mocks.rpc.mockResolvedValueOnce({ data: { ...receipt, orderNumber: '2026111110000002' }, error: null });
    expect(await forceOrderDeliveredAction(orderNumber, '시험', id)).toHaveProperty('error');
    mocks.rpc.mockResolvedValueOnce({ data: { ...preview, blockers: ['unknown'] }, error: null });
    expect(await previewForcedDeliveryAction(orderNumber)).toHaveProperty('error');
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
