import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findPurchaseRestrictionCustomerAction, registerPurchaseRestrictionAction, releasePurchaseRestrictionAction } from './purchase-restriction-actions';
const mocks = vi.hoisted(() => ({ gate:vi.fn(),rpc:vi.fn(),revalidate:vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.gate }));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ rpc:mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath:mocks.revalidate }));
const id = '11111111-1111-4111-8111-111111111111';
function form(extra: Record<string,string> = {}) {
  const form = new FormData();
  for (const [key,value] of Object.entries({ requestId:id,userId:id,reasonCode:'other',reasonDetail:'운영 근거',confirmed:'on',restrictionId:id,reason:'해제 근거',customerQuery:'fan@example.test',...extra })) form.set(key,value);
  return form;
}
describe('purchase restriction actions', () => {
  beforeEach(() => { vi.clearAllMocks();mocks.gate.mockResolvedValue({});mocks.rpc.mockResolvedValue({ data:{id,changed:true},error:null }); });
  it('guards every read and write before accessing the database', async () => {
    mocks.gate.mockRejectedValue(new Error('forbidden'));
    for (const action of [findPurchaseRestrictionCustomerAction, registerPurchaseRestrictionAction, releasePurchaseRestrictionAction]) await expect(action({},form())).rejects.toThrow('forbidden');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('validates registration scope and evidence before dispatching the mutation', async () => {
    expect(await registerPurchaseRestrictionAction({},form({ confirmed:'' }))).toHaveProperty('error');
    expect(mocks.rpc).not.toHaveBeenCalled();
    await registerPurchaseRestrictionAction({},form({ evidenceOrderId:id }));
    expect(mocks.rpc).toHaveBeenCalledWith('admin_register_purchase_restriction',{p_request_id:id,p_user_id:id,p_reason_code:'other',p_reason_detail:'운영 근거',p_evidence_order_id:id});
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/sales/purchase-restrictions');
  });
  it('reports a released registration replay without pretending to block again', async () => {
    mocks.rpc.mockResolvedValue({ data:{id,changed:false,releasedAt:'2026-10-12T00:00:00Z'},error:null });
    expect((await registerPurchaseRestrictionAction({},form())).message).toContain('이미 해제되었습니다');
  });
  it('preserves database ownership errors and does not claim success', async () => {
    mocks.rpc.mockResolvedValue({data:null,error:{message:'purchase_restriction_evidence_owner_mismatch'}});
    expect((await registerPurchaseRestrictionAction({},form())).error).toContain('해당 고객의 주문번호');
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('release uses the selected immutable record, not only a customer id', async () => {
    await releasePurchaseRestrictionAction({},form());
    expect(mocks.rpc).toHaveBeenCalledWith('admin_release_purchase_restriction',{p_restriction_id:id,p_reason:'해제 근거'});
  });
});
