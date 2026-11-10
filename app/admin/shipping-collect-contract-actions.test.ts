import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/admin/revalidate-goods.server', () => ({ revalidateGoodsSurfaces: mocks.revalidate }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
import { readShippingCollectContractAction, readShippingCollectOperationAction, saveShippingCollectContractAction } from './shipping-collect-contract-actions';
import { SHIPPING_COLLECT_FIELDS, type ShippingCollectValues } from '@/lib/admin/shipping-collect-contract';
const id = '91000000-0000-4000-8000-000000000001', op = '91000000-0000-4000-8000-000000000002';
const values = Object.fromEntries(SHIPPING_COLLECT_FIELDS.map(key => [key, `${key} actual`])) as ShippingCollectValues;
const request = { originId: id, expectedActorId: id, expectedRevision: 0, operationId: op, status: 'active' as const, values };
const row = { originId: id, revision: 1, versionId: id, status: 'active' as const, values }, receipt = { ...row, operationId: op };
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ user: { id } }); mocks.rpc.mockImplementation(async name => ({ data: name === 'admin_get_shipping_collect_contract' ? row : receipt, error: null })); });
it('운영 관리자 권한·actor를 확인하고 write와 readback을 대조한다', async () => {
  expect(await saveShippingCollectContractAction(request)).toEqual({ ok: true, value: row });
  expect(mocks.access).toHaveBeenCalledWith('/admin/settings/origins', { capability: 'platform.manage', adminOnly: true });
  expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'admin_save_shipping_collect_contract', { p_origin_id: id, p_expected_revision: 0, p_status: 'active', p_values: values, p_operation_id: op, p_expected_actor_id: id });
  expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'admin_get_shipping_collect_contract', { p_origin_id: id });
});
it.each([null, { user: { id: op } }])('거절된 관리자/actor는 계약과 결과를 읽거나 쓸 수 없다: %j', async access => {
  mocks.access.mockResolvedValue(access);
  expect((await readShippingCollectContractAction(request)).ok).toBe(false); expect((await saveShippingCollectContractAction(request)).ok).toBe(false);
  expect((await readShippingCollectOperationAction(request)).ok).toBe(false); expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each(['PGRST000', '57014', 'XX000'])('write %s는 결과 불명확으로 남긴다', async code => {
  mocks.rpc.mockResolvedValueOnce({ error: { code, message: 'transport' } }); expect(await saveShippingCollectContractAction(request)).toMatchObject({ ok: false, uncertain: true });
});
it.each(['22023', '23514', 'PT409'])('확정 SQL 거절 %s는 불명확 재시도로 남기지 않는다', async code => {
  mocks.rpc.mockResolvedValueOnce({ error: { code, message: 'collect_contract_changed' } }); expect(await saveShippingCollectContractAction(request)).toMatchObject({ ok: false, uncertain: false });
});
it('lookup null은 미실행을 단정하거나 재저장하지 않는다', async () => {
  mocks.rpc.mockResolvedValueOnce({ data: null, error: null }); expect(await readShippingCollectOperationAction(request)).toEqual({ ok: true, value: { receipt: null, latest: row } });
  expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(['admin_get_shipping_collect_operation', 'admin_get_shipping_collect_contract']);
});
it('원래 결과와 현재 저장본을 구분하고 다른 출고지·요청 결과는 거절한다', async () => {
  mocks.rpc.mockResolvedValueOnce({ data: receipt, error: null }).mockResolvedValueOnce({ data: { ...row, revision: 2 }, error: null });
  expect(await readShippingCollectOperationAction(request)).toMatchObject({ ok: true, value: { receipt, latest: { revision: 2 } } });
  mocks.rpc.mockResolvedValueOnce({ data: { ...receipt, originId: op }, error: null }); expect((await readShippingCollectOperationAction(request)).ok).toBe(false);
});
it('잘못된 영수증은 불명확, 저장 후 다른 버전은 committed와 함께 반환한다', async () => {
  mocks.rpc.mockResolvedValueOnce({ data: { ...receipt, operationId: id }, error: null }); expect(await saveShippingCollectContractAction(request)).toMatchObject({ ok: false, uncertain: true });
  mocks.rpc.mockResolvedValueOnce({ data: receipt, error: null }).mockResolvedValueOnce({ data: { ...row, revision: 2 }, error: null });
  expect(await saveShippingCollectContractAction(request)).toMatchObject({ ok: false, committed: receipt, conflict: true, latest: { revision: 2 } });
});
