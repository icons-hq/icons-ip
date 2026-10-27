import { beforeEach, describe, expect, it, vi } from 'vitest';
import { markStagingTestDeliveredAction } from './staging-test-delivery-actions';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn(), runtime: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/admin/staging-test-tools.server', () => ({ stagingTestToolsRuntimeAllowed: mocks.runtime }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));
const id = 'a0c20000-0000-4000-8000-0000000000a1', orderId = 'a0c20000-0000-4001-8000-000000000001', orderNumber = '2026102710000001';
const receipt = { orderId, orderNumber, status: 'delivered', deliveredShipments: 1, deliveredAt: '2026-10-27T02:00:00Z' };
beforeEach(() => { vi.clearAllMocks(); mocks.runtime.mockReturnValue(true); mocks.access.mockResolvedValue(true); mocks.rpc.mockResolvedValue({ data: receipt, error: null }); });
describe('스테이징 테스트 배송완료', () => {
  it('운영 런타임에서는 권한·DB 확인 전에 거절한다', async () => {
    mocks.runtime.mockReturnValue(false);
    expect(await markStagingTestDeliveredAction(orderNumber, id)).toEqual({ error: '이 환경에서는 테스트 배송완료를 사용할 수 없습니다.' });
    expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('권한과 주문번호 형식을 확인한 뒤 같은 요청 ID로 DB에 맡긴다', async () => {
    expect(await markStagingTestDeliveredAction(orderNumber, id)).toEqual({ receipt });
    expect(mocks.access).toHaveBeenCalledWith('/admin/sales/dispatch', { capability: 'sales.manage' });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_mark_staging_test_delivered', { p_order_number: orderNumber, p_operation_id: id });
    expect(mocks.revalidate).toHaveBeenCalledWith(`/admin/sales/orders/${orderId}`);
    mocks.access.mockResolvedValue(null);
    expect(await markStagingTestDeliveredAction(orderNumber, id)).toHaveProperty('error');
    expect(await markStagingTestDeliveredAction('12345', id)).toHaveProperty('error');
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('DB 거절 사유를 운영자 문구로 보여 주고 다른 주문의 응답은 받지 않는다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'staging_test_delivery_unavailable' } });
    expect(await markStagingTestDeliveredAction(orderNumber, id)).toEqual({ error: '이 환경에서는 테스트 배송완료를 사용할 수 없습니다.' });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '23514', message: 'staging_test_delivery_requires_confirmed' } });
    expect(await markStagingTestDeliveredAction(orderNumber, id)).toEqual({ error: '발주확인 뒤 발송 전·배송 중인 주문만 테스트 배송완료할 수 있습니다.' });
    mocks.rpc.mockResolvedValueOnce({ data: { ...receipt, orderNumber: '2026102710000002' }, error: null });
    expect(await markStagingTestDeliveredAction(orderNumber, id)).toHaveProperty('error');
  });
});
