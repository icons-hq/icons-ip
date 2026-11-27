import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));
import { readClaimFeePolicyAction, saveClaimFeePolicyAction } from './claim-fee-policy-actions';

const ACTOR = 'a1000000-0000-4000-8000-000000000001', SESSION = 'a1000000-0000-4000-8000-000000000002', OPERATION = 'a1000000-0000-4000-8000-000000000003';
const identity = { actorId: ACTOR, sessionId: SESSION };
const values = { enabled: true, returnAmount: 3000, exchangeAmount: null };
const policy = { revision: 4, enabled: true, returnAmount: 3000, exchangeAmount: null, evidence: '예전에 적어 둔 근거', updatedAt: '2026-11-27T00:00:00Z', accountReady: true };
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ user: { id: ACTOR } }); mocks.rpc.mockResolvedValue({ data: policy, error: null }); });

it('사용 여부와 기본 청구 금액만 보낸다 — 근거·확인 체크는 받지도 보내지도 않는다', async () => {
  expect(await saveClaimFeePolicyAction(values, 3, OPERATION, identity)).toEqual({ policy });
  expect(mocks.access).toHaveBeenCalledWith('/admin/sales/claims/returns', { capability: 'sales.manage' });
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_save_claim_fee_policy', { p_values: { enabled: true, returnAmount: 3000, exchangeAmount: null }, p_revision: 3, p_operation: OPERATION, p_actor: ACTOR, p_session: SESSION });
  expect(mocks.revalidate).toHaveBeenCalledWith('/admin/sales/claims/returns/fee-policy');
  /* 옛 화면처럼 근거·확인 체크를 붙여 보낸 값은 받지 않는다. */
  mocks.rpc.mockClear();
  expect(await saveClaimFeePolicyAction({ ...values, evidence: '근거', confirmed: true }, 3, OPERATION, identity)).toMatchObject({ saved: 'no' });
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it('금액 형식·저장 번호·로그인 정보가 맞지 않으면 DB를 부르지 않는다', async () => {
  const wrong: unknown[][] = [
    [{ ...values, returnAmount: 0 }, 3, OPERATION, identity], [{ ...values, returnAmount: 1000001 }, 3, OPERATION, identity], [{ ...values, exchangeAmount: 3000.5 }, 3, OPERATION, identity],
    [{ ...values, returnAmount: '3000' }, 3, OPERATION, identity], [{ ...values, enabled: 'true' }, 3, OPERATION, identity], [{ enabled: true, returnAmount: 3000 }, 3, OPERATION, identity],
    [values, 0, OPERATION, identity], [values, 3, 'not-a-uuid', identity], [values, 3, OPERATION, { actorId: ACTOR }], [null, 3, OPERATION, identity],
  ];
  for (const args of wrong) expect(await saveClaimFeePolicyAction(args[0], args[1], args[2], args[3])).toMatchObject({ saved: 'no' });
  expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.access).not.toHaveBeenCalled();
});

it('권한이 없거나 다른 계정이면 저장하지 않는다', async () => {
  mocks.access.mockResolvedValueOnce(null);
  expect(await saveClaimFeePolicyAction(values, 3, OPERATION, identity)).toEqual({ error: '로그인 상태나 판매 관리 권한이 바뀌었습니다. 새로고침한 뒤 다시 저장해 주세요.', saved: 'no' });
  mocks.access.mockResolvedValueOnce({ user: { id: SESSION } });
  expect(await saveClaimFeePolicyAction(values, 3, OPERATION, identity)).toMatchObject({ saved: 'no' });
  expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.revalidate).not.toHaveBeenCalled();
});

it('다른 사람이 먼저 바꿨으면 지금 저장된 설정을 함께 돌려준다', async () => {
  const latest = { ...policy, revision: 9, returnAmount: 4000 };
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'claim_fee_changed' } }).mockResolvedValueOnce({ data: latest, error: null });
  const result = await saveClaimFeePolicyAction(values, 3, OPERATION, identity);
  expect(result).toMatchObject({ saved: 'no', changed: true, latest });
  expect(mocks.rpc.mock.calls[1]).toEqual(['admin_get_claim_fee_policy']); expect(mocks.revalidate).not.toHaveBeenCalled();
  /* 지금 설정을 못 읽으면 문구만 돌려준다. */
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'claim_fee_changed' } }).mockResolvedValueOnce({ data: null, error: { code: '57014' } });
  const unread = await saveClaimFeePolicyAction(values, 3, OPERATION, identity);
  expect(unread).toMatchObject({ saved: 'no', changed: true }); expect(unread).not.toHaveProperty('latest');
});

it('계좌가 없어 켤 수 없는 것과 금액 거절은 저장되지 않은 것이 분명하고, 그 밖의 실패는 저장됐는지 모른다', async () => {
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'claim_fee_account_missing' } });
  const account = await saveClaimFeePolicyAction(values, 3, OPERATION, identity);
  expect(account).toMatchObject({ saved: 'no' }); expect(account).not.toHaveProperty('changed'); expect('error' in account && account.error).toContain('[무통장 계좌 등록하러 가기]');
  expect(mocks.rpc).toHaveBeenCalledOnce();
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '22023' } }); expect(await saveClaimFeePolicyAction(values, 3, OPERATION, identity)).toMatchObject({ saved: 'no' });
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '57014', message: 'private detail' } });
  expect(await saveClaimFeePolicyAction(values, 3, OPERATION, identity)).toEqual({ error: '저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.', saved: 'unknown' });
  mocks.rpc.mockRejectedValueOnce(new Error('network')); expect(await saveClaimFeePolicyAction(values, 3, OPERATION, identity)).toMatchObject({ saved: 'unknown' });
  /* 저장은 됐을 수 있는데 받은 내용을 읽지 못한 경우도 모르는 것이다. */
  mocks.rpc.mockResolvedValueOnce({ data: { revision: 4 }, error: null }); expect(await saveClaimFeePolicyAction(values, 3, OPERATION, identity)).toMatchObject({ saved: 'unknown' });
  expect(mocks.revalidate).not.toHaveBeenCalled();
});

it('[저장됐는지 확인]은 지금 저장된 설정을 읽기만 한다', async () => {
  expect(await readClaimFeePolicyAction()).toEqual({ policy });
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_get_claim_fee_policy');
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '57014', message: 'private detail' } });
  expect(await readClaimFeePolicyAction()).toEqual({ error: '저장된 설정을 불러오지 못했습니다. 잠시 뒤 [저장됐는지 확인]을 다시 눌러 주세요.' });
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } });
  expect(await readClaimFeePolicyAction()).toEqual({ error: '로그인 상태나 판매 관리 권한이 바뀌었습니다. 새로고침한 뒤 다시 저장해 주세요.' });
  mocks.rpc.mockClear(); mocks.access.mockResolvedValueOnce(null);
  expect(await readClaimFeePolicyAction()).toEqual({ error: '로그인 상태나 판매 관리 권한이 바뀌었습니다. 새로고침한 뒤 다시 저장해 주세요.' }); expect(mocks.rpc).not.toHaveBeenCalled();
});
