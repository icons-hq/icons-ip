import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/admin/revalidate-goods.server', () => ({ revalidateGoodsSurfaces: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
import { readGoodsSubscriptionPolicyAction, saveGoodsSubscriptionPolicyAction } from './goods-subscription-policy-actions';
import type { GoodsSubscriptionPolicyRequest } from '@/lib/admin/goods-subscription-policy';

const actor = 'b1711000-0000-4000-8000-000000000004', operation = 'b1711000-0000-4000-8000-000000000050';
const request: GoodsSubscriptionPolicyRequest = { goodId: 'subscription-policy-fixture', expectedActorId: actor,
  expectedRevision: 0, expectedGoodUpdatedAt: '2026-10-14T01:00:00.123456Z', operationId: operation,
  enabled: true, intervals: ['month_1'], message: '합성 안내' };
const saved = { goodId: request.goodId, revision: 1, goodUpdatedAt: '2026-10-14T01:00:01.123456Z',
  enabled: request.enabled, intervals: request.intervals, message: request.message };
const receipt = { ...saved, operationId: operation, changed: true };
beforeEach(() => {
  vi.clearAllMocks(); mocks.access.mockResolvedValue({ user: { id: actor } });
  mocks.rpc.mockImplementation(async name => ({ data: name === 'admin_save_goods_subscription_policy' ? receipt : saved, error: null }));
});
describe('정기배송 정책 서버 Action', () => {
  it('actor/capability/CAS를 전달하고 새 권한 검사 아래 readback을 대조한다', async () => {
    expect(await saveGoodsSubscriptionPolicyAction(request)).toEqual({ ok: true, value: saved });
    expect(mocks.access).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'admin_save_goods_subscription_policy', {
      p_expected_actor_id: actor, p_good_id: request.goodId, p_expected_revision: 0, p_expected_good_updated_at: request.expectedGoodUpdatedAt,
      p_operation_id: operation, p_enabled: true, p_intervals: ['month_1'], p_message: '합성 안내' });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'admin_get_goods_subscription_policy', { p_expected_actor_id: actor, p_good_id: request.goodId });
  });
  it.each([null, { user: { id: operation } }])('다른 actor는 저장 RPC를 호출하지 않는다: %j', async access => {
    mocks.access.mockResolvedValue(access); expect((await saveGoodsSubscriptionPolicyAction(request)).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(['PGRST000', '57014', 'XX000', ''])('write 오류 %s는 불명확으로 남긴다', async code => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: 'synthetic error' } });
    expect(await saveGoodsSubscriptionPolicyAction(request)).toMatchObject({ ok: false, uncertain: true });
  });
  it.each(['22023', '42501', 'PT409', '23505'])('DB 거절 %s는 입력을 비교할 수 있는 확정 실패다', async code => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: 'subscription_policy_conflict' } });
    expect(await saveGoodsSubscriptionPolicyAction(request)).toMatchObject({ ok: false, uncertain: false });
  });
  it('손실/잘못된 영수증의 UUID·내용을 새 성공으로 표시하지 않는다', async () => {
    mocks.rpc.mockRejectedValueOnce(new Error('synthetic lost response'));
    expect(await saveGoodsSubscriptionPolicyAction(request)).toMatchObject({ ok: false, uncertain: true });
    for (const patch of [{ operationId: actor }, { revision: 9 }, { enabled: false }, { intervals: ['week_1'] }]) {
      mocks.rpc.mockResolvedValueOnce({ data: { ...receipt, ...patch }, error: null });
      expect(await saveGoodsSubscriptionPolicyAction(request)).toMatchObject({ ok: false, uncertain: true });
    }
  });
  it('저장 뒤 변경/권한 상실은 committed와 미확인 readback으로 구분한다', async () => {
    const latest = { ...saved, revision: 2, message: '다른 관리자 변경' };
    mocks.rpc.mockResolvedValueOnce({ data: receipt, error: null }).mockResolvedValueOnce({ data: latest, error: null });
    expect(await saveGoodsSubscriptionPolicyAction(request)).toMatchObject({ ok: false, committed: receipt, latest, conflict: true });
    mocks.access.mockResolvedValueOnce({ user: { id: actor } }).mockResolvedValueOnce(null);
    expect(await saveGoodsSubscriptionPolicyAction(request)).toMatchObject({ ok: false, committed: receipt });
  });
  it('다른 상품 읽기와 잘못된 주기를 거절하며 동일 offset은 같은 저장값이다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ...saved, goodId: 'other' }, error: null });
    expect((await readGoodsSubscriptionPolicyAction(request)).ok).toBe(false);
    expect((await saveGoodsSubscriptionPolicyAction({ ...request, intervals: [] })).ok).toBe(false);
    mocks.rpc.mockResolvedValueOnce({ data: receipt, error: null }).mockResolvedValueOnce({ data: { ...saved, goodUpdatedAt: '2026-10-14T10:00:01.123456+09:00' }, error: null });
    expect((await saveGoodsSubscriptionPolicyAction(request)).ok).toBe(true);
  });
});
