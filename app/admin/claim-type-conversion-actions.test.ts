import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn(), rows: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc, from: () => ({ select: () => ({ in: mocks.rows }) }) }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));
import { bulkConvertClaimTypesAction, convertClaimTypeAction, loadClaimTypeContextAction, readClaimTypeChangeAction } from './claim-type-conversion-actions';
import { conversionContext as context, conversionRequest as request, conversionReceipt as receipt } from '@/lib/orders/claim-type-conversion.fixture';
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue(true); mocks.rpc.mockResolvedValue({ data: receipt, error: null }); });
it('판매관리 권한과 정확한 첫 본문으로만 전환하고 새 화면 경로를 갱신한다', async () => {
  expect(await convertClaimTypeAction(request)).toEqual({ receipt });
  expect(mocks.rpc).toHaveBeenCalledWith('admin_convert_order_claim_type', { p_claim_id: request.claimId, p_operation_id: request.id, p_expected_revision: 2, p_to_type: 'exchange', p_agreement: request.agreement, p_confirmed: true, p_refund_account: null });
  expect(mocks.revalidate).toHaveBeenCalledWith(`/orders/${context.orderId}`, 'page');
  mocks.rpc.mockClear(); mocks.access.mockResolvedValue(false); expect(await convertClaimTypeAction(request)).toHaveProperty('error'); expect(mocks.rpc).not.toHaveBeenCalled();
});
it('버전 충돌은 다시 확인하고 늦은 응답·잘못된 receipt는 미확정으로 보존한다', async () => {
  mocks.rpc.mockResolvedValue({ error: { code: 'PT409' } }); expect(await convertClaimTypeAction(request)).toMatchObject({ uncertain: false, conflict: true });
  mocks.rpc.mockResolvedValue({ error: { code: '23505' } }); expect(await convertClaimTypeAction(request)).toMatchObject({ uncertain: true });
  mocks.rpc.mockResolvedValue({ data: { ...receipt, agreement: '다른 합의' } }); expect(await convertClaimTypeAction(request)).toMatchObject({ uncertain: true });
  mocks.rpc.mockRejectedValue(new Error('sensitive account detail')); expect(await convertClaimTypeAction(request)).toMatchObject({ uncertain: true }); expect(mocks.revalidate).not.toHaveBeenCalled();
});
it('없는 receipt, 잘못된 operation, 현재 문맥을 구분한다', async () => {
  mocks.rpc.mockResolvedValue({ data: null }); expect(await readClaimTypeChangeAction(request.id)).toEqual({ receipt: null });
  mocks.rpc.mockResolvedValue({ data: { ...receipt, id: context.orderId } }); expect(await readClaimTypeChangeAction(request.id)).toMatchObject({ uncertain: true });
  mocks.rpc.mockResolvedValue({ data: context }); expect(await loadClaimTypeContextAction(request.claimId)).toEqual({ context });
});

/* 목록 일괄 전환(10/27 회의 14:52 · MD-0032·0033): 규칙은 단건 전환과 같고, 건별로 결과가 갈린다. */
const SECOND = '44444444-4444-4444-8444-444444444444';
const AGREEMENT = '11/9 전화 상담 C-1 고객 합의';

function bulkForm(claimIds: string[], overrides: Record<string, string> = {}) {
  const form = new FormData();
  form.set('claimType', 'return');
  for (const id of claimIds) form.append('claimIds', id);
  form.set('agreement', AGREEMENT);
  form.set('confirmed', 'true');
  for (const [key, value] of Object.entries(overrides)) form.set(key, value);
  return form;
}

/** 건마다 최신 요청을 돌려주고, 전환은 보낸 값 그대로 저장된 영수증을 돌려주는 RPC. */
function stubBulkRpc(contexts: Record<string, Partial<typeof context>> = {}, convert?: (args: Record<string, unknown>) => unknown) {
  mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === 'admin_order_claim_type_change_context') {
      return { data: { ...context, revision: 7, claimId: args.p_claim_id, ...contexts[String(args.p_claim_id)] }, error: null };
    }
    if (convert) return convert(args);
    return { data: { ...receipt, id: args.p_operation_id, claimId: args.p_claim_id, revision: args.p_expected_revision, fromType: args.p_to_type === 'exchange' ? 'return' : 'exchange', toType: args.p_to_type, agreement: args.p_agreement, accountSupplied: false }, error: null };
  });
}
const convertCalls = () => mocks.rpc.mock.calls.filter(([name]) => name === 'admin_convert_order_claim_type').map(([, args]) => args);

beforeEach(() => { mocks.rows.mockResolvedValue({ data: [{ id: request.claimId, reference: 12 }, { id: SECOND, reference: 13 }], error: null }); });

it('고른 순서대로 최신 버전을 읽어 같은 합의 근거로 한 건씩 전환하고 건별 결과를 돌려준다', async () => {
  stubBulkRpc();
  const state = await bulkConvertClaimTypesAction({}, bulkForm([request.claimId, SECOND]));
  expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
    'admin_order_claim_type_change_context', 'admin_convert_order_claim_type',
    'admin_order_claim_type_change_context', 'admin_convert_order_claim_type',
  ]);
  expect(convertCalls()).toEqual([
    expect.objectContaining({ p_claim_id: request.claimId, p_expected_revision: 7, p_to_type: 'exchange', p_agreement: AGREEMENT, p_confirmed: true, p_refund_account: null }),
    expect.objectContaining({ p_claim_id: SECOND, p_expected_revision: 7, p_to_type: 'exchange', p_agreement: AGREEMENT, p_confirmed: true, p_refund_account: null }),
  ]);
  /* 건마다 다른 operation이어야 DB 멱등 키가 겹치지 않는다. */
  expect(new Set(convertCalls().map((args) => args.p_operation_id)).size).toBe(2);
  expect(state).toEqual({
    summary: '처리됨 2건 · 실패 0건',
    results: [
      { claimId: request.claimId, reference: 'C00012', outcome: 'done', message: '교환 요청으로 전환했습니다.' },
      { claimId: SECOND, reference: 'C00013', outcome: 'done', message: '교환 요청으로 전환했습니다.' },
    ],
  });
  expect(mocks.revalidate).toHaveBeenCalledWith('/admin/sales/claims', 'layout');
  expect(mocks.revalidate).toHaveBeenCalledWith(`/orders/${context.orderId}`, 'page');
});

it('이미 다른 유형이거나 전환할 수 없는 건은 저장하지 않고 사유를 남긴 채 나머지를 처리한다', async () => {
  stubBulkRpc({ [request.claimId]: { claimType: 'exchange' } });
  let state = await bulkConvertClaimTypesAction({}, bulkForm([request.claimId, SECOND]));
  expect(state.results?.map((result) => [result.outcome, result.message])).toEqual([
    ['failed', '반품 요청이 아닙니다. 해당 목록에서 처리해주세요.'],
    ['done', '교환 요청으로 전환했습니다.'],
  ]);
  expect(convertCalls()).toHaveLength(1);

  mocks.rpc.mockClear();
  stubBulkRpc({ [request.claimId]: { allowed: false, blocker: 'claim_conversion_reshipped' } });
  state = await bulkConvertClaimTypesAction({}, bulkForm([request.claimId]));
  expect(state.results?.[0]).toMatchObject({ outcome: 'failed', message: '이미 교환품을 재출고하여 반품으로 전환할 수 없습니다.' });
  expect(convertCalls()).toHaveLength(0);
});

it('교환→반품은 저장된 계좌가 없는 무통장 건만 상세로 돌리고, 계좌가 있으면 그대로 전환한다', async () => {
  stubBulkRpc({
    [request.claimId]: { claimType: 'exchange', bankRequired: true, savedAccount: null },
    [SECOND]: { claimType: 'exchange', bankRequired: true, savedAccount: { account: '신한 ***', holder: '홍*동' } },
  });
  const state = await bulkConvertClaimTypesAction({}, bulkForm([request.claimId, SECOND], { claimType: 'exchange' }));
  expect(state.results?.map((result) => [result.outcome, result.message])).toEqual([
    ['failed', '무통장 주문을 반품으로 전환하려면 환불계좌가 필요합니다. 요청번호를 눌러 상세에서 입력해주세요.'],
    ['done', '반품 요청으로 전환했습니다.'],
  ]);
  expect(convertCalls()).toEqual([expect.objectContaining({ p_claim_id: SECOND, p_to_type: 'return', p_refund_account: null })]);
});

it('버전 충돌·불확실한 저장은 실패로 알리고 화면을 갱신하지 않는다', async () => {
  stubBulkRpc({}, () => ({ data: null, error: { code: 'PT409', message: 'claim_changed' } }));
  let state = await bulkConvertClaimTypesAction({}, bulkForm([request.claimId]));
  expect(state.results?.[0]).toMatchObject({ outcome: 'failed', message: '다른 처리가 먼저 진행됐습니다. 최신 상태를 확인한 뒤 다시 실행해주세요.' });

  stubBulkRpc({}, () => ({ data: null, error: { code: '57014', message: 'statement timeout' } }));
  state = await bulkConvertClaimTypesAction({}, bulkForm([request.claimId]));
  expect(state.results?.[0]).toMatchObject({ outcome: 'failed', message: '저장 결과를 확인하지 못했습니다. 요청번호를 눌러 현재 유형을 확인해주세요.' });

  stubBulkRpc({}, () => ({ data: { ...receipt, agreement: '다른 합의' }, error: null }));
  state = await bulkConvertClaimTypesAction({}, bulkForm([request.claimId]));
  expect(state.results?.[0]).toMatchObject({ outcome: 'failed', message: '저장 결과를 확인하지 못했습니다. 요청번호를 눌러 현재 유형을 확인해주세요.' });
  expect(mocks.revalidate).not.toHaveBeenCalled();
});

it('권한이 없거나 합의 확인·근거가 없거나 취소 목록이면 아무 건도 건드리지 않는다', async () => {
  stubBulkRpc();
  expect(await bulkConvertClaimTypesAction({}, bulkForm([request.claimId], { confirmed: 'false' }))).toEqual({ error: '선택한 건 모두 고객과 합의했는지 확인해주세요.' });
  expect(await bulkConvertClaimTypesAction({}, bulkForm([request.claimId], { agreement: '한' }))).toEqual({ error: '고객 합의 근거를 2자 이상 500자 이하로 입력해주세요.' });
  expect(await bulkConvertClaimTypesAction({}, bulkForm([request.claimId], { claimType: 'cancel' }))).toEqual({ error: '반품과 교환 요청만 서로 전환할 수 있습니다.' });
  mocks.access.mockResolvedValue(false);
  expect(await bulkConvertClaimTypesAction({}, bulkForm([request.claimId]))).toEqual({ error: '현재 계정과 판매관리 권한을 확인해주세요.' });
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.rows).not.toHaveBeenCalled();
});
