import { legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bulkDecideOrderClaimsAction } from './claim-actions';

/*
 * 클레임 일괄 처리(R8 · D8). 새 배열 RPC 없이 선택한 건마다 단건 경로를 순서대로 태운다.
 * 토스는 결제 단건 취소뿐이라 앞 건이 끝나기 전에 다음 건(결제사 취소)을 시작하지 않는다.
 */

const ID = (n: number) => `abcdef${String(n).padStart(2, '0')}-1234-4123-8123-123456789abc`;
const ORDER = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

const mocks = vi.hoisted(() => ({
  getCurrentAdminAuthState: vi.fn(),
  createClient: vi.fn(),
  rpc: vi.fn(),
  select: vi.fn(),
  inFilter: vi.fn(),
  from: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  loadAdminClaimDetail: vi.fn(),
  reconcileOrderCancellation: vi.fn(),
  recoverGoodsPaymentManually: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, unstable_rethrow: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.getCurrentAdminAuthState }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/admin/claims.server', () => ({ loadAdminClaimDetail: mocks.loadAdminClaimDetail }));
vi.mock('@/lib/orders/cancellation-orchestrator.server', () => ({
  reconcileOrderCancellation: mocks.reconcileOrderCancellation,
}));
vi.mock('@/lib/payments/goods-manual-recovery.server', () => ({
  recoverGoodsPaymentManually: mocks.recoverGoodsPaymentManually,
}));

function bulkForm(ids: string[], decision: string, claimType = 'cancel', note?: string) {
  const form = new FormData();
  form.set('claimType', claimType);
  form.set('decision', decision);
  for (const id of ids) form.append('claimIds', id);
  if (note !== undefined) form.set('note', note);
  return form;
}

function claimRows(rows: { id: string; reference: number; claim_type?: string; order_id?: string }[]) {
  mocks.inFilter.mockResolvedValue({
    data: rows.map((row, index) => ({ claim_type: 'cancel', order_id: ORDER(index), ...row })),
    error: null,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getCurrentAdminAuthState.mockResolvedValue({
    operatorAccess: legacyOperatorAccessFixture(),
    isConfigured: true,
    user: { id: 'staff-1' },
    role: 'staff',
    isStaff: true,
  });
  mocks.select.mockReturnValue({ in: mocks.inFilter });
  mocks.from.mockReturnValue({ select: mocks.select });
  mocks.createClient.mockResolvedValue({ rpc: mocks.rpc, from: mocks.from });
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('bulkDecideOrderClaimsAction', () => {
  it('선택한 순서대로 단건 결정 RPC를 한 건씩 부르고 건별 결과표를 돌려준다', async () => {
    claimRows([{ id: ID(1), reference: 12 }, { id: ID(2), reference: 13 }]);
    mocks.rpc.mockResolvedValue({ data: 'in_review', error: null });

    const state = await bulkDecideOrderClaimsAction({}, bulkForm([ID(1), ID(2)], 'review'));

    expect(mocks.from).toHaveBeenCalledWith('order_cancellation_requests');
    expect(mocks.select).toHaveBeenCalledWith('id,reference,claim_type,order_id');
    expect(mocks.inFilter).toHaveBeenCalledWith('id', [ID(1), ID(2)]);
    expect(mocks.rpc.mock.calls).toEqual([
      ['admin_decide_order_claim', { p_claim_id: ID(1), p_decision: 'review', p_note: null }],
      ['admin_decide_order_claim', { p_claim_id: ID(2), p_decision: 'review', p_note: null }],
    ]);
    expect(state.results).toEqual([
      { claimId: ID(1), reference: 'C00012', outcome: 'done', message: '검토중으로 표시했습니다.' },
      { claimId: ID(2), reference: 'C00013', outcome: 'done', message: '검토중으로 표시했습니다.' },
    ]);
    expect(state.summary).toBe('처리됨 2건 · 실패 0건');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/sales/claims/cancels');
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/admin/sales/claims/cancels/${ID(2)}`);
  });

  it('토스 취소 승인은 건마다 결제사 취소까지 끝낸 뒤 다음 건을 시작한다', async () => {
    claimRows([{ id: ID(1), reference: 1 }, { id: ID(2), reference: 2 }]);
    const events: string[] = [];
    mocks.rpc.mockImplementation(async (_name: string, args: { p_claim_id: string }) => {
      events.push(`decide:${args.p_claim_id.slice(0, 8)}`);
      return { data: 'processing', error: null };
    });
    mocks.loadAdminClaimDetail.mockResolvedValue({ payment: { provider: 'toss' } });
    mocks.reconcileOrderCancellation.mockImplementation(async ({ requestId }: { requestId: string }) => {
      events.push(`cancel:start:${requestId.slice(0, 8)}`);
      await new Promise((resolve) => setTimeout(resolve, 1));
      events.push(`cancel:end:${requestId.slice(0, 8)}`);
      return { ok: true, status: 'completed' };
    });

    const state = await bulkDecideOrderClaimsAction({}, bulkForm([ID(1), ID(2)], 'approve'));

    expect(events).toEqual([
      'decide:abcdef01', 'cancel:start:abcdef01', 'cancel:end:abcdef01',
      'decide:abcdef02', 'cancel:start:abcdef02', 'cancel:end:abcdef02',
    ]);
    expect(mocks.reconcileOrderCancellation).toHaveBeenCalledWith({ requestId: ID(1), actorId: 'staff-1' });
    expect(state.results?.map((result) => result.outcome)).toEqual(['done', 'done']);
    expect(state.results?.[0].message).toContain('토스 전액 취소까지 확인했습니다');
  });

  it('일부가 실패해도 나머지를 처리하고, 실패는 운영자 문구로 사유를 남긴다', async () => {
    claimRows([{ id: ID(1), reference: 1 }, { id: ID(2), reference: 2 }, { id: ID(3), reference: 3 }]);
    mocks.rpc
      .mockResolvedValueOnce({ data: 'processing', error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'claim_not_decidable' } })
      .mockResolvedValueOnce({ data: 'processing', error: null });
    mocks.loadAdminClaimDetail.mockResolvedValue({ payment: { provider: 'toss' } });
    mocks.reconcileOrderCancellation
      .mockResolvedValueOnce({ ok: false, code: 'provider_cancel_failed' })
      .mockResolvedValueOnce({ ok: true, status: 'completed' });

    const state = await bulkDecideOrderClaimsAction({}, bulkForm([ID(1), ID(2), ID(3)], 'approve'));

    expect(mocks.rpc).toHaveBeenCalledTimes(3);
    expect(state.results?.map((result) => [result.reference, result.outcome])).toEqual([
      ['C00001', 'failed'], ['C00002', 'failed'], ['C00003', 'done'],
    ]);
    expect(state.results?.[0].message).toContain('provider_cancel_failed');
    expect(state.results?.[1].message).toBe('지금 단계에서는 처리할 수 없습니다. 최신 상태를 확인해주세요.');
    expect(state.summary).toBe('처리됨 1건 · 실패 2건');
  });

  it('시간 예산을 넘기면 남은 건은 시작하지 않고 미처리로 돌려준다', async () => {
    claimRows([{ id: ID(1), reference: 1 }, { id: ID(2), reference: 2 }, { id: ID(3), reference: 3 }]);
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    mocks.rpc.mockImplementation(async () => {
      now += 30_000;
      return { data: 'in_review', error: null };
    });

    const state = await bulkDecideOrderClaimsAction({}, bulkForm([ID(1), ID(2), ID(3)], 'review'));

    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(state.results?.map((result) => result.outcome)).toEqual(['done', 'done', 'skipped']);
    expect(state.summary).toBe('처리됨 2건 · 실패 0건 · 처리 시간이 길어 1건은 처리하지 않았습니다. 다시 실행하세요.');
    expect(mocks.revalidatePath).not.toHaveBeenCalledWith(`/admin/sales/claims/cancels/${ID(3)}`);
  });

  it('목록 유형과 다른 요청·사라진 요청은 처리하지 않는다', async () => {
    claimRows([{ id: ID(1), reference: 7, claim_type: 'return' }]);
    const state = await bulkDecideOrderClaimsAction({}, bulkForm([ID(1), ID(2)], 'approve'));
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(state.results).toEqual([
      { claimId: ID(1), reference: 'C00007', outcome: 'failed', message: '취소 요청이 아닙니다. 해당 목록에서 처리해주세요.' },
      { claimId: ID(2), reference: null, outcome: 'failed', message: '클레임을 찾을 수 없습니다.' },
    ]);
  });

  it('거부는 공통 사유를 모든 건에 같이 보낸다', async () => {
    claimRows([{ id: ID(1), reference: 1, claim_type: 'return' }, { id: ID(2), reference: 2, claim_type: 'return' }]);
    mocks.rpc.mockResolvedValue({ data: 'rejected', error: null });
    const note = '회수한 상품에 사용 흔적이 있어 반품할 수 없습니다.';

    const state = await bulkDecideOrderClaimsAction({}, bulkForm([ID(1), ID(2)], 'reject', 'return', ` ${note} `));

    expect(mocks.rpc.mock.calls.map(([, args]) => args)).toEqual([
      { p_claim_id: ID(1), p_decision: 'reject', p_note: note },
      { p_claim_id: ID(2), p_decision: 'reject', p_note: note },
    ]);
    expect(state.results?.every((result) => result.outcome === 'done')).toBe(true);
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/sales/claims/returns');
  });

  it('DB가 거부 사유를 거절하면 운영자 문구로 옮긴다', async () => {
    claimRows([{ id: ID(1), reference: 1 }]);
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'invalid rejection reason' } });
    const state = await bulkDecideOrderClaimsAction({}, bulkForm([ID(1)], 'reject', 'cancel', '이미 발송되어 취소할 수 없습니다.'));
    expect(state.results?.[0]).toMatchObject({ outcome: 'failed', message: '거부 사유는 앞뒤 공백 없이 10자 이상 200자 이하로 입력해주세요.' });
  });

  it('50건을 넘기거나 권한이 없으면 아무 건도 처리하지 않는다', async () => {
    const ids = Array.from({ length: 51 }, (_, index) => ID(index));
    expect(await bulkDecideOrderClaimsAction({}, bulkForm(ids, 'review'))).toEqual({
      error: '한 번에 50건까지 처리할 수 있습니다. 선택을 줄여 다시 실행해주세요.',
    });
    mocks.getCurrentAdminAuthState.mockResolvedValue({ isConfigured: true, user: { id: 'u' }, isStaff: false, role: 'fan' });
    expect(await bulkDecideOrderClaimsAction({}, bulkForm([ID(1)], 'review'))).toEqual({ error: '관리자 권한이 필요합니다.' });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('목록 유형이 없거나 잘못되면 처리하지 않는다', async () => {
    const state = await bulkDecideOrderClaimsAction({}, bulkForm([ID(1)], 'review', 'unknown'));
    expect(state.error).toBe('목록을 새로고침한 뒤 다시 실행해주세요.');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
