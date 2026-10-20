import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn(), context: vi.fn(), receipt: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/admin/order-address.server', () => ({ getOrderAddressContext: mocks.context, getOrderAddressReceipt: mocks.receipt }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));
import { changeOrderAddressAction, loadOrderAddressContextAction, readOrderAddressChangeAction } from './order-address-actions';
import { orderAddressRequestFixture as request, orderAddressReceiptFixture as receipt } from '@/lib/admin/order-address.fixture';
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue(true); mocks.rpc.mockResolvedValue({ data: receipt, error: null }); });
describe('배송지 수정 서버 경계', () => {
  it('sales.manage를 먼저 확인하고 정확히 저장한 결과만 성공으로 돌려준다', async () => {
    expect(await changeOrderAddressAction(request)).toEqual({ receipt });
    expect(mocks.access).toHaveBeenCalledWith('/admin/sales/orders', { capability: 'sales.manage' });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_change_order_address', { p_operation_id: request.id, p_order_id: request.orderId, p_expected_revision: 3, p_address: request.address, p_reason: request.reason, p_customer_agreed: true });
    expect(mocks.revalidate).toHaveBeenCalledWith(`/orders/${request.orderId}`);
    mocks.access.mockResolvedValue(false); mocks.rpc.mockClear();
    expect(await changeOrderAddressAction(request)).toHaveProperty('error'); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('변경 경쟁은 입력 비교로 보내고 불확실한 전송·다른 본문 결과는 요청을 고정한다', async () => {
    mocks.rpc.mockResolvedValue({ error: { code: 'PT409' } }); expect(await changeOrderAddressAction(request)).toMatchObject({ conflict: true, uncertain: false });
    mocks.rpc.mockResolvedValue({ error: { code: '23505' } }); expect(await changeOrderAddressAction(request)).toMatchObject({ uncertain: true });
    mocks.rpc.mockRejectedValue(new Error('private connection')); expect(await changeOrderAddressAction(request)).toMatchObject({ uncertain: true });
    mocks.rpc.mockResolvedValue({ data: { ...receipt, address: { ...receipt.address, recipientName: '다른 수령자' } }, error: null });
    expect(await changeOrderAddressAction(request)).toMatchObject({ uncertain: true }); expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('없음·읽기 실패·잘못된 식별자를 구분하고 내부 오류를 노출하지 않는다', async () => {
    mocks.receipt.mockResolvedValue(null); expect(await readOrderAddressChangeAction(request.id)).toEqual({ receipt: null });
    mocks.receipt.mockRejectedValue(new Error('private data')); expect(await readOrderAddressChangeAction(request.id)).toMatchObject({ uncertain: true });
    mocks.context.mockClear(); expect(await loadOrderAddressContextAction('invalid')).toHaveProperty('error'); expect(mocks.context).not.toHaveBeenCalled();
  });
});
