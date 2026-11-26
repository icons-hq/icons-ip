import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ access: vi.fn(), create: vi.fn(), rpc: vi.fn(), revalidate: vi.fn(), pii: vi.fn(), retry: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/admin/pii-access-log.server', () => ({ notePiiAccess: mocks.pii }));
vi.mock('@/lib/orders/virtual-account-refund-retry.server', () => ({ retryVirtualAccountRefund: mocks.retry }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.create }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: (error: unknown) => { if (error instanceof Error && error.message.startsWith('NEXT_REDIRECT:')) throw error; } }));
import { resolveVirtualAccountRefundAction, saveVirtualAccountRefundAccountAction } from './virtual-account-refund-actions';

const ACTOR = 'c6000000-0000-4000-8000-000000000001';
const CLAIM = 'c6000000-0000-4000-8000-000000000002';
const ORDER = 'c6000000-0000-4000-8000-000000000003';
const OPERATION = 'c6000000-0000-4000-8000-000000000004';
/* 계좌는 한눈에 가짜인 값만 쓴다. */
const entry = { claimId: CLAIM, orderId: ORDER, claimType: 'cancel', operationId: OPERATION,
  bankName: '신한은행', accountNumber: '000-000-123456', accountHolder: '김엑스', reason: '11/26 고객 전화로 계좌 확인' };
const saved = (claimType: 'cancel' | 'return' = 'cancel') => ({ data: { state: 'saved', replayed: false, claimId: CLAIM, orderId: ORDER, claimType, revision: 3 }, error: null });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue({ user: { id: ACTOR } });
  mocks.create.mockResolvedValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue(saved());
  mocks.retry.mockResolvedValue('started');
});

/* 화면 규칙 PR 3(D-34·D-35): 저장·재시도·접속기록의 순서와 인자는 그대로이고, 문구와 '저장됐는지 모름' 표시만 다룬다. */
describe('가상계좌 환불 계좌 대신 입력 저장', () => {
  it('취소 건은 계좌를 저장하고 접속기록을 남긴 뒤 같은 요청에서 환불을 다시 요청한다', async () => {
    expect(await saveVirtualAccountRefundAccountAction(entry)).toEqual({ ok: true, message: '환불 계좌를 저장하고 이 계좌로 환불을 다시 요청했습니다. 잠시 뒤 새로고침해 결과를 확인해주세요.' });
    expect(mocks.access).toHaveBeenCalledWith(`/admin/sales/claims/cancels/${CLAIM}`, { capability: 'sales.manage' });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_set_order_claim_refund_account', {
      p_claim_id: CLAIM, p_operation_id: OPERATION, p_bank_name: entry.bankName, p_account_number: entry.accountNumber, p_account_holder: entry.accountHolder, p_reason: entry.reason });
    expect(mocks.pii).toHaveBeenCalledExactlyOnceWith({ actorId: ACTOR, action: 'correct', surface: 'refund_account', path: `/admin/sales/claims/cancels/${CLAIM}`,
      subjectKind: 'claim', subjectIds: [CLAIM], detail: { mode: 'virtual_account', claimType: 'cancel' } });
    expect(JSON.stringify(mocks.pii.mock.calls)).not.toContain(entry.accountNumber);
    expect(mocks.retry).toHaveBeenCalledExactlyOnceWith(CLAIM);
    for (const path of [`/admin/sales/orders/${ORDER}`, `/admin/sales/claims/cancels/${CLAIM}`, `/orders/${ORDER}`]) expect(mocks.revalidate).toHaveBeenCalledWith(path);
  });

  it('반품 건은 저장만 했고 환불은 버튼을 눌러야 한다고 답한다', async () => {
    mocks.rpc.mockResolvedValue(saved('return')); mocks.retry.mockResolvedValue('operator_required');
    const result = await saveVirtualAccountRefundAccountAction({ ...entry, claimType: 'return' });
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.message).toContain('아직 환불하지 않았습니다. 요청 상세의 [환불 완료 확정]');
    expect(mocks.access).toHaveBeenCalledWith(`/admin/sales/claims/returns/${CLAIM}`, { capability: 'sales.manage' });
  });

  it('형식이 맞지 않으면 DB에 닿기 전에 어느 칸을 고칠지 말한다', async () => {
    expect(await saveVirtualAccountRefundAccountAction({ ...entry, accountNumber: '0000000' }))
      .toEqual({ ok: false, error: '계좌번호를 다시 확인해주세요. 숫자 8~20자리. 하이픈(-)은 넣어도 됩니다.' });
    expect(await saveVirtualAccountRefundAccountAction({ ...entry, reason: '확' })).toMatchObject({ ok: false, error: expect.stringContaining('입력 사유를 2자 이상') });
    /* 칸은 맞는데 요청 자체가 어긋나면(작업 번호 등) 모든 칸을 확인하라는 안내로 돌아간다. */
    expect(await saveVirtualAccountRefundAccountAction({ ...entry, operationId: 'x' })).toMatchObject({ ok: false, error: expect.stringContaining('은행, 계좌번호, 예금주, 입력 사유') });
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.retry).not.toHaveBeenCalled(); expect(mocks.pii).not.toHaveBeenCalled();
  });

  it('권한이 없으면 저장하지 않는다', async () => {
    mocks.access.mockResolvedValue(null);
    expect(await saveVirtualAccountRefundAccountAction(entry)).toEqual({ ok: false, error: '주문 관리 권한이 있는 계정만 환불 계좌를 입력할 수 있습니다.' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('이유를 아는 거절은 그대로 알리고 환불을 다시 요청하지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'invalid_virtual_account_refund_account' } });
    const result = await saveVirtualAccountRefundAccountAction(entry);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('이 계좌로는 결제사가 환불할 수 없습니다.') });
    expect(result).not.toHaveProperty('uncertain');
    expect(mocks.retry).not.toHaveBeenCalled(); expect(mocks.pii).not.toHaveBeenCalled();
  });

  it.each([
    ['모르는 DB 오류', () => mocks.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'boom 000-000-123456' } })],
    ['prototype 이름의 오류', () => mocks.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'toString' } })],
    ['다른 요청의 영수증', () => mocks.rpc.mockResolvedValue({ data: { state: 'saved', claimId: ORDER, orderId: ORDER, claimType: 'cancel' }, error: null })],
    ['끊긴 호출', () => mocks.rpc.mockRejectedValue(new Error('TEST network'))],
  ])('%s는 저장됐는지 모르는 결과로 돌려주고 환불을 다시 요청하지 않는다', async (_name, arrange) => {
    arrange();
    const result = await saveVirtualAccountRefundAccountAction(entry);
    expect(result).toEqual({ ok: false, uncertain: true, error: '저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.' });
    expect(JSON.stringify(result)).not.toContain(entry.accountNumber);
    expect(mocks.retry).not.toHaveBeenCalled(); expect(mocks.pii).not.toHaveBeenCalled();
  });
});

/* 주문 상세가 쓰는 액션 — 이름·인자·동작은 바뀌지 않았다. */
describe('환불 송금 처리 완료로 표시', () => {
  it('주문과 처리 내용만 넘겨 기록한다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'resolved', error: null });
    expect(await resolveVirtualAccountRefundAction({ orderId: ORDER, note: ' 11/27 회사 계좌에서 직접 송금 ' })).toMatchObject({ ok: true });
    expect(mocks.access).toHaveBeenCalledWith(`/admin/sales/orders/${ORDER}`, { capability: 'sales.manage' });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_resolve_virtual_account_refund_watch', { p_order_id: ORDER, p_note: '11/27 회사 계좌에서 직접 송금' });
    expect(await resolveVirtualAccountRefundAction({ orderId: ORDER, note: '가' })).toEqual({ ok: false, error: '처리 내용을 2자 이상 200자 이하로 적어주세요.' });
  });
});
