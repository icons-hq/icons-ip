import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), user: vi.fn(), create: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.create }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
import { GET, POST } from './route';
import { withdrawalRequestFixture as request, withdrawalReceiptFixture as operatorReceipt, withdrawalContextFixture as claimContext } from '@/lib/orders/claim-withdrawal.fixture';
const receipt = { ...operatorReceipt, actorKind: 'customer' };
const url = `https://icons.local/api/orders/claims/${request.claimId}/withdrawal`;
const context = () => ({ params: Promise.resolve({ claimId: request.claimId }) });
const post = (body: unknown = request, origin = 'https://icons.local') => new Request(url, { method: 'POST', headers: { host: 'icons.local', origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocks.create.mockResolvedValue({ auth: { getUser: mocks.user }, rpc: mocks.rpc }); mocks.user.mockResolvedValue({ data: { user: { id: 'buyer' } } }); mocks.rpc.mockResolvedValue({ data: receipt, error: null }); });
it('다른 origin, 전체주문 금액 주입, 다른 claim 식별자는 인증·DB 전에 거절한다', async () => {
  expect((await POST(post(request, 'https://other.local'), context())).status).toBe(403);
  expect((await POST(post({ ...request, total: 0 }), context())).status).toBe(400);
  expect((await POST(post({ ...request, claimId: request.id }), context())).status).toBe(400);
  expect(mocks.create).not.toHaveBeenCalled();
});
it('고객 세션 RPC만 사용하며 일치하는 결과를 확인한 뒤 상세를 갱신한다', async () => {
  const response = await POST(post(), context()); expect(response.status).toBe(200); expect(await response.json()).toEqual({ receipt });
  expect(mocks.rpc).toHaveBeenCalledWith('withdraw_my_order_claim', { p_claim_id: request.claimId, p_operation_id: request.id, p_expected_revision: request.revision, p_reason: request.reason, p_confirmed: true });
  expect(mocks.revalidate).toHaveBeenCalledWith(`/orders/${receipt.orderId}`);
  mocks.user.mockResolvedValue({ data: { user: null } }); mocks.rpc.mockClear(); expect((await POST(post(), context())).status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled();
});
it('다른 고객·운영자 receipt를 숨기며 읽기에는 캐시를 사용하지 않는다', async () => {
  mocks.rpc.mockResolvedValue({ data: operatorReceipt }); expect((await GET(new Request(`${url}?operation=${request.id}`), context())).status).toBe(404);
  mocks.rpc.mockResolvedValue({ data: null }); const empty = await GET(new Request(`${url}?operation=${request.id}`), context()); expect(await empty.json()).toEqual({ receipt: null }); expect(empty.headers.get('cache-control')).toBe('no-store');
  mocks.rpc.mockResolvedValue({ data: claimContext }); expect(await (await GET(new Request(url), context())).json()).toEqual({ context: claimContext });
});
it('응답 유실과 다른 본문의 receipt는 불확정으로 남긴다', async () => {
  mocks.rpc.mockRejectedValue(new Error('private connection')); expect(await (await POST(post(), context())).json()).toMatchObject({ uncertain: true });
  mocks.rpc.mockResolvedValue({ data: { ...receipt, reason: '다른 사유' } }); expect(await (await POST(post(), context())).json()).toMatchObject({ uncertain: true }); expect(mocks.revalidate).not.toHaveBeenCalled();
});
