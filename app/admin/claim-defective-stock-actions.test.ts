import { legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { planClaimDefectiveStockAction, planExchangeDefectiveStockAction, recordOrderClaimRefundAction, retryClaimDefectiveStockAction } from './claim-actions';

const CLAIM_ID = 'abcdef01-1234-4123-8123-123456789abc';
const ORDER_ID = 'abcdef03-1234-4123-8123-123456789abc';
const ITEM_A = 'abcdef0a-1234-4123-8123-123456789abc';
const ITEM_B = 'abcdef0b-1234-4123-8123-123456789abc';
const SHIPMENT = 'abcdef05-1234-4123-8123-123456789abc';

const mocks = vi.hoisted(() => ({
  getCurrentAdminAuthState: vi.fn(),
  createClient: vi.fn(),
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
  loadAdminClaimDetail: vi.fn(),
  reconcileOrderCancellation: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), unstable_rethrow: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.getCurrentAdminAuthState }));
/* 부분 반품(ADR-0047)이 아닌 주문 전체 반품 — 부분 반품 칸은 없다. */
vi.mock('@/lib/orders/partial-return.server', () => ({ loadAdminClaimPartialReturn: vi.fn(async () => null) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/admin/claims.server', () => ({ loadAdminClaimDetail: mocks.loadAdminClaimDetail }));
vi.mock('@/lib/orders/cancellation-orchestrator.server', () => ({ reconcileOrderCancellation: mocks.reconcileOrderCancellation }));
vi.mock('@/lib/payments/goods-manual-recovery.server', () => ({ recoverGoodsPaymentManually: vi.fn() }));

type Rpc = Record<string, { data?: unknown; error?: { message: string } | null }>;
let results: Rpc;
const calls: { name: string; args: unknown }[] = [];

function detail(stage = 'collected') {
  return {
    claim: { claimType: 'return', orderId: ORDER_ID, stage },
    payment: { provider: 'toss' },
    refund: { method: 'pg_cancel' },
    refundDeduction: null,
  };
}

function completeForm(selection: Record<string, 'restore' | 'defective'> = {}) {
  const form = new FormData();
  form.set('claimId', CLAIM_ID); form.set('claimType', 'return'); form.set('orderId', ORDER_ID);
  form.set('stage', 'completed'); form.set('method', 'pg_cancel');
  for (const [id, value] of Object.entries(selection)) form.set(`stockDisposition:${id}`, value);
  return form;
}

beforeEach(() => {
  vi.resetAllMocks();
  calls.length = 0;
  results = {
    admin_goods_manual_recovery_attempts: { data: [] },
    admin_begin_order_cancellation_reconcile: { error: null },
    admin_plan_claim_defective_stock: { data: { claimId: CLAIM_ID, planned: 1 } },
    admin_record_order_claim_refund: { data: 'completed' },
    admin_record_claim_defective_stock: { data: { claimId: CLAIM_ID, recorded: 1, total: 1, pending: 0 } },
  };
  mocks.getCurrentAdminAuthState.mockResolvedValue({
    operatorAccess: legacyOperatorAccessFixture(), isConfigured: true, user: { id: 'staff-1', email: 'staff@example.test' }, role: 'staff', isStaff: true,
  });
  mocks.rpc.mockImplementation(async (name: string, args: unknown) => {
    calls.push({ name, args });
    return { data: results[name]?.data ?? null, error: results[name]?.error ?? null };
  });
  mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
  mocks.loadAdminClaimDetail.mockResolvedValue(detail());
  mocks.reconcileOrderCancellation.mockResolvedValue({ ok: true, status: 'completed' });
});

const names = () => calls.map((call) => call.name);

describe('반품 환불 확정의 품목별 재고 처리(QNA-035)', () => {
  it('불량 선택은 재고 복원(정합화) 전에 저장하고 확정 뒤에 기록한다', async () => {
    const state = await recordOrderClaimRefundAction({}, completeForm({ [ITEM_A]: 'defective', [ITEM_B]: 'restore' }));
    expect(names()).toEqual([
      'admin_plan_claim_defective_stock',
      'admin_goods_manual_recovery_attempts',
      'admin_begin_order_cancellation_reconcile',
      'admin_record_order_claim_refund',
      'admin_record_claim_defective_stock',
    ]);
    expect(calls[0].args).toEqual({ p_claim_id: CLAIM_ID, p_order_item_ids: [ITEM_A] });
    expect(state.error).toBeUndefined();
    expect(state.message).toContain('불량 1개 품목은 판매 재고에 넣지 않고 불량 재고에 기록했습니다');
  });

  it('선택 필드가 없으면 지금처럼 저장·기록 RPC를 부르지 않는다', async () => {
    await recordOrderClaimRefundAction({}, completeForm());
    expect(names()).not.toContain('admin_plan_claim_defective_stock');
    expect(names()).not.toContain('admin_record_claim_defective_stock');
  });

  it('전부 복원을 고르면 빈 선택을 저장해 앞선 불량 선택을 비우고 기록은 부르지 않는다', async () => {
    await recordOrderClaimRefundAction({}, completeForm({ [ITEM_A]: 'restore', [ITEM_B]: 'restore' }));
    expect(calls[0]).toEqual({ name: 'admin_plan_claim_defective_stock', args: { p_claim_id: CLAIM_ID, p_order_item_ids: [] } });
    expect(names()).not.toContain('admin_record_claim_defective_stock');
  });

  it('선택 저장이 실패하면 결제사 취소·재고 복원을 시작하지 않는다', async () => {
    results.admin_plan_claim_defective_stock = { error: { message: 'defective_stock_item_in_other_claim' } };
    const state = await recordOrderClaimRefundAction({}, completeForm({ [ITEM_A]: 'defective' }));
    expect(state.error).toContain('다른 반품·교환 요청에서 이미 불량으로 고른 품목');
    expect(names()).toEqual(['admin_plan_claim_defective_stock']);
    expect(mocks.reconcileOrderCancellation).not.toHaveBeenCalled();
  });

  it('확정 뒤 불량 기록이 실패해도 확정은 되돌리지 않고 다시 환불하지 말라고 알린다', async () => {
    results.admin_record_claim_defective_stock = { error: { message: 'boom' } };
    const state = await recordOrderClaimRefundAction({}, completeForm({ [ITEM_A]: 'defective' }));
    expect(names()).toContain('admin_record_order_claim_refund');
    expect(state.message).toBeUndefined();
    expect(state.error).toContain('환불 완료와 재고 복원은 이미 확정됐습니다');
    expect(state.error).toContain('환불은 다시 하지 말고');
  });

  it('잘못된 선택 값은 어떤 RPC도 부르기 전에 거절한다', async () => {
    const form = completeForm();
    form.set(`stockDisposition:${ITEM_A}`, 'discard');
    const state = await recordOrderClaimRefundAction({}, form);
    expect(state.error).toContain('품목별 재고 처리 선택을 확인하지 못했습니다');
    expect(calls).toEqual([]);
  });

  it('반품이 아닌 클레임의 선택 필드는 무시한다', async () => {
    mocks.loadAdminClaimDetail.mockResolvedValue({ ...detail(), claim: { claimType: 'cancel', orderId: ORDER_ID, stage: 'collected' } });
    await recordOrderClaimRefundAction({}, completeForm({ [ITEM_A]: 'defective' }));
    expect(names()).not.toContain('admin_plan_claim_defective_stock');
  });
});

describe('불량 기록 다시 시도·선택만 저장', () => {
  it('다시 시도는 기록 RPC만 부른다', async () => {
    const form = new FormData();
    form.set('claimId', CLAIM_ID.toUpperCase()); form.set('claimType', 'return');
    const state = await retryClaimDefectiveStockAction({}, form);
    expect(calls).toEqual([{ name: 'admin_record_claim_defective_stock', args: { p_claim_id: CLAIM_ID } }]);
    expect(state.message).toContain('불량 재고 1개 품목을 기록했습니다');
  });

  it('다시 시도가 실패하면 환불을 다시 하지 말라고 알린다', async () => {
    results.admin_record_claim_defective_stock = { error: { message: 'defective_stock_claim_not_completed' } };
    const form = new FormData();
    form.set('claimId', CLAIM_ID);
    expect((await retryClaimDefectiveStockAction({}, form)).error).toBe('재고가 정해진 뒤에 불량 재고를 기록할 수 있습니다.');
  });

  it('선택만 저장하는 액션은 불량 품목 목록을 저장 RPC에 넘긴다', async () => {
    const form = new FormData();
    form.set('claimId', CLAIM_ID); form.set('claimType', 'return');
    form.set(`stockDisposition:${ITEM_A}`, 'defective'); form.set(`stockDisposition:${ITEM_B}`, 'restore');
    const state = await planClaimDefectiveStockAction({}, form);
    expect(calls).toEqual([{ name: 'admin_plan_claim_defective_stock', args: { p_claim_id: CLAIM_ID, p_order_item_ids: [ITEM_A] } }]);
    expect(state.message).toContain('불량 1개 품목을 저장했습니다');
  });
});

describe('교환 회수품 재고 처리(CLM-046)', () => {
  function exchangeForm(selection: Record<string, 'restore' | 'defective'>, shipmentId: string = SHIPMENT) {
    const form = new FormData();
    form.set('claimId', CLAIM_ID); form.set('claimType', 'exchange'); form.set('shipmentId', shipmentId); form.set('originName', '김포');
    for (const [id, value] of Object.entries(selection)) form.set(`stockDisposition:${id}`, value);
    return form;
  }

  it('출고지의 불량 품목만 저장 RPC에 넘기고 재고는 움직이지 않는다', async () => {
    results.admin_plan_claim_exchange_defective_stock = { data: { claimId: CLAIM_ID, shipmentId: SHIPMENT, planned: 1, decided: true } };
    const state = await planExchangeDefectiveStockAction({}, exchangeForm({ [ITEM_A]: 'defective', [ITEM_B]: 'restore' }));
    expect(calls).toEqual([{ name: 'admin_plan_claim_exchange_defective_stock', args: { p_claim_id: CLAIM_ID, p_shipment_id: SHIPMENT, p_order_item_ids: [ITEM_A] } }]);
    expect(state.message).toBe('불량 1개 품목을 저장했습니다. 김포 출고지를 재출고할 때 판매 재고에 넣지 않고 불량 재고에 기록합니다.');
  });

  it('모두 정상 복원도 결정으로 저장하고, 배송 건 없는 옛 주문은 출고지 없이 저장한다', async () => {
    const state = await planExchangeDefectiveStockAction({}, exchangeForm({ [ITEM_A]: 'restore' }, ''));
    expect(calls).toEqual([{ name: 'admin_plan_claim_exchange_defective_stock', args: { p_claim_id: CLAIM_ID, p_shipment_id: null, p_order_item_ids: [] } }]);
    expect(state.message).toContain('모두 정상 재고로 복원하도록 저장했습니다');
  });

  it('선택 칸이 없거나 값이 잘못되면 RPC를 부르지 않는다', async () => {
    expect((await planExchangeDefectiveStockAction({}, exchangeForm({}))).error).toContain('회수품 재고 처리를 저장하지 못했습니다');
    const broken = exchangeForm({ [ITEM_A]: 'defective' });
    broken.set(`stockDisposition:${ITEM_B}`, 'discard');
    expect((await planExchangeDefectiveStockAction({}, broken)).error).toContain('품목별 재고 처리 선택을 확인하지 못했습니다');
    expect((await planExchangeDefectiveStockAction({}, exchangeForm({ [ITEM_A]: 'defective' }, 'not-a-uuid'))).error).toContain('회수품 재고 처리를 저장하지 못했습니다');
    expect(calls).toEqual([]);
  });

  it('재출고한 출고지·회수 전·회수 생략 출고지 거절을 교환 문구로 알린다', async () => {
    for (const [code, text] of [
      ['defective_stock_claim_closed', '이미 재출고한 출고지'],
      ['exchange_defective_not_collected', '회수를 확인한 출고지만'],
      ['exchange_defective_collection_waived', '회수 생략을 결정한 출고지'],
      ['defective_stock_item_in_other_claim', '다른 반품·교환 요청에서'],
    ] as const) {
      results.admin_plan_claim_exchange_defective_stock = { error: { message: code } };
      expect((await planExchangeDefectiveStockAction({}, exchangeForm({ [ITEM_A]: 'defective' }))).error).toContain(text);
    }
  });
});
