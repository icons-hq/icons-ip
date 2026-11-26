import { beforeEach, describe, expect, it, vi } from 'vitest';
import { previewPurchaseConfirmationAutoAction, readPurchaseConfirmationPolicyAction, savePurchaseConfirmationPolicyAction } from './purchase-confirmation-actions';

const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));

const ACTOR = 'b1000000-0000-4000-8000-000000000001', SESSION = 'b1000000-0000-4000-8000-000000000002', OPERATION = 'b1000000-0000-4000-8000-000000000003';
const identity = { actorId: ACTOR, sessionId: SESSION };
const policy = { revision: 3, autoEnabled: true, autoAfterDays: 7, buyerExtensionDays: null, evidence: '', updatedAt: '2026-11-26T03:00:00Z' };
const preview = { autoAfterDays: 7, orderCount: 12, storeCreditTotal: 3400, perRunLimit: 1000, asOf: '2026-11-26T03:00:00.123456+00:00' };
const values = { autoEnabled: true, autoAfterDays: 7, buyerExtensionDays: null };

beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ user: { id: ACTOR } }); });

describe('자동 거래확정 미리 읽기', () => {
  it('정책 화면과 같은 권한(sales.manage)으로 읽고, 읽은 값을 그대로 돌려준다', async () => {
    mocks.rpc.mockResolvedValue({ data: preview, error: null });
    expect(await previewPurchaseConfirmationAutoAction(7)).toEqual({ preview });
    expect(mocks.access).toHaveBeenCalledWith('/admin/sales/settled/policy', { capability: 'sales.manage' });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_preview_purchase_confirmation_auto', { p_auto_after_days: 7 });
    /* 읽기만 한다 — 화면을 다시 그리게 하지 않는다. */
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it('권한이 없으면 조회하지 않는다', async () => {
    mocks.access.mockResolvedValue(null);
    expect(await previewPurchaseConfirmationAutoAction(7)).toHaveProperty('error');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('기간이 1~36,500일이 아니면 조회하지 않는다', async () => {
    for (const days of [0, 36501, 7.5, '7', null, undefined]) expect(await previewPurchaseConfirmationAutoAction(days)).toHaveProperty('error');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('읽지 못했거나 모양이 다른 값은 수치로 쓰지 않고, 저장하지 않았다고 알린다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'boom' } });
    expect(await previewPurchaseConfirmationAutoAction(7)).toEqual({ error: '지금 켜면 거래확정될 주문 수를 불러오지 못해 저장하지 않았습니다. 잠시 뒤 다시 [저장]을 눌러주세요.' });
    mocks.rpc.mockResolvedValueOnce({ data: { ...preview, orderCount: '12' }, error: null });
    expect(await previewPurchaseConfirmationAutoAction(7)).toHaveProperty('error');
    mocks.rpc.mockRejectedValueOnce(new Error('network'));
    expect(await previewPurchaseConfirmationAutoAction(7)).toHaveProperty('error');
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'operator_capability_required' } });
    expect((await previewPurchaseConfirmationAutoAction(7)).error).toContain('권한이 없거나 로그인이 끝났습니다');
  });
});

describe('거래확정 정책 저장', () => {
  it('근거 글·확인 체크 없이 세 값만 보내 저장한다', async () => {
    mocks.rpc.mockResolvedValue({ data: policy, error: null });
    expect(await savePurchaseConfirmationPolicyAction(values, 2, OPERATION, identity)).toEqual({ policy });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_save_purchase_confirmation_policy', { p_values: values, p_revision: 2, p_operation_id: OPERATION, p_actor: ACTOR, p_session: SESSION });
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/sales/settled/policy');
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/sales/settled');
  });

  it('옛 화면의 근거·확인 값이나 모르는 값이 섞이면 저장하지 않는다', async () => {
    for (const bad of [{ ...values, evidence: '근거', acknowledged: true }, { ...values, memo: 'x' }, { autoEnabled: true, autoAfterDays: 7 }, { ...values, autoEnabled: 'true' }]) {
      expect(await savePurchaseConfirmationPolicyAction(bad, 2, OPERATION, identity)).toHaveProperty('error');
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('켜는데 기간이 없거나 기간이 범위를 벗어나면 어느 칸인지 알리고 저장하지 않는다', async () => {
    expect(await savePurchaseConfirmationPolicyAction({ ...values, autoAfterDays: null }, 2, OPERATION, identity))
      .toEqual({ error: "자동 거래확정을 켜려면 '배송완료 뒤 자동 확정까지 (일)'을 적어주세요." });
    expect(await savePurchaseConfirmationPolicyAction({ ...values, buyerExtensionDays: 36501 }, 2, OPERATION, identity)).toEqual({ error: '기간은 1~36,500 사이 숫자로 적어주세요.' });
    /* 끌 때는 기간이 없어도 된다. */
    mocks.rpc.mockResolvedValue({ data: { ...policy, autoEnabled: false, autoAfterDays: null }, error: null });
    expect(await savePurchaseConfirmationPolicyAction({ autoEnabled: false, autoAfterDays: null, buyerExtensionDays: null }, 2, OPERATION, identity)).toHaveProperty('policy');
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('권한이 없거나 로그인한 사람이 화면을 연 사람과 다르면 저장하지 않는다', async () => {
    mocks.access.mockResolvedValueOnce(null);
    expect(await savePurchaseConfirmationPolicyAction(values, 2, OPERATION, identity)).toHaveProperty('error');
    mocks.access.mockResolvedValueOnce({ user: { id: 'c1000000-0000-4000-8000-000000000009' } });
    expect(await savePurchaseConfirmationPolicyAction(values, 2, OPERATION, identity)).toHaveProperty('error');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('다른 사람이 먼저 바꿨으면 그렇게 말하고, 결과를 모르면 [저장됐는지 확인]으로 이끈다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'purchase_confirmation_changed' } });
    expect(await savePurchaseConfirmationPolicyAction(values, 2, OPERATION, identity))
      .toEqual({ error: '다른 사람이 먼저 바꿨습니다. [저장된 정책 다시 불러오기]로 지금 정책을 확인한 뒤 다시 저장해주세요.', conflict: true });
    mocks.rpc.mockRejectedValueOnce(new Error('network'));
    expect(await savePurchaseConfirmationPolicyAction(values, 2, OPERATION, identity))
      .toEqual({ error: '저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.', uncertain: true });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'boom' } });
    expect(await savePurchaseConfirmationPolicyAction(values, 2, OPERATION, identity)).toHaveProperty('uncertain', true);
    /* 거절이 분명한 경우(권한·값)는 결과를 모르는 것이 아니다. */
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'purchase_confirmation_auth_changed' } });
    expect(await savePurchaseConfirmationPolicyAction(values, 2, OPERATION, identity)).not.toHaveProperty('uncertain');
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'invalid_parameter_value' } });
    expect(await savePurchaseConfirmationPolicyAction(values, 2, OPERATION, identity)).not.toHaveProperty('uncertain');
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});

describe('저장된 정책 다시 읽기', () => {
  it('권한을 먼저 보고 읽는다', async () => {
    mocks.rpc.mockResolvedValue({ data: policy, error: null });
    expect(await readPurchaseConfirmationPolicyAction()).toEqual({ policy });
    mocks.access.mockResolvedValueOnce(null);
    expect(await readPurchaseConfirmationPolicyAction()).toHaveProperty('error');
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
