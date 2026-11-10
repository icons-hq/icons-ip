import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAdminCustomerDetail, getAdminCustomerHistory } from './customer-detail.server';
const { rpc, moderation } = vi.hoisted(() => ({ rpc: vi.fn(), moderation: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ rpc }) }));
vi.mock('./member-moderation.server', () => ({ getMemberModerationContext: moderation }));
beforeEach(() => { rpc.mockReset(); moderation.mockReset(); });
describe('customer detail authorization projection', () => {
  it('고객 상세의 제재 버튼은 현재 DB 결정으로만 연다', async () => {
    rpc.mockResolvedValue({ data: { customer: { id: 'customer', role: 'admin' }, items: [] }, error: null });
    moderation.mockResolvedValue({ managerRole: 'deputy', canModerate: true });
    await expect(getAdminCustomerDetail('customer', { tab: 'overview', page: 1 })).resolves.toMatchObject({
      customer: { role: 'admin', moderation: { managerRole: 'deputy', canModerate: true } },
    });
  });
  it('판매 이력만 읽는 경로는 회원 제재·전체 고객정보를 읽지 않는다', async () => {
    rpc.mockResolvedValue({ data: { items: [], tab: 'orders', page: 1, pageSize: 20, total: 0, customer: { email: 'private@example.test' } }, error: null });
    const result = await getAdminCustomerHistory('customer', { tab: 'orders', page: 1 });
    expect(result).not.toHaveProperty('customer');
    expect(moderation).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('admin_operator_customer_history', { target_user_id: 'customer', target_tab: 'orders', target_page: 1 });
  });
});
