import { configuredOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadOrderWarehouseStopAction, recordWarehouseStopReplyAction, resolveCanceledShipmentDispatchAction } from './warehouse-stop-actions';

/*
 * 출고지시 뒤 취소의 창고 회신 기록·취소 뒤 출고 처리(ADR-0046). 권한은 기록 sales.dispatch(물류출고관리 포함)·처리 sales.manage·
 * 읽기 sales.read이고, 입력은 DB에 보내기 전에 다듬는다. DB 거절은 운영자 다음 행동 문구로 옮긴다.
 */

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const SHIPMENT_ID = '22222222-2222-4222-8222-222222222222';
const DISPATCH_ID = '44444444-4444-4444-8444-444444444444';
const OPERATION_ID = '33333333-3333-4333-8333-333333333333';

const mocks = vi.hoisted(() => ({
  adminState: { isConfigured: true, user: { id: 'staff-1', email: 'staff@icons.gg' }, role: 'staff', isStaff: true, operatorAccess: undefined as unknown },
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: () => mocks.adminState }));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); },
  unstable_rethrow: (error: unknown) => { if (error instanceof Error && error.message.startsWith('NEXT_REDIRECT')) throw error; },
}));

const reply = { orderId: ORDER_ID, shipmentIds: [SHIPMENT_ID], outcome: 'stopped', channel: 'messenger', repliedAt: '2026-11-19T14:05', note: '서원 담당 카카오톡', operationId: OPERATION_ID };

describe('창고 회신 기록·취소 뒤 출고 처리 액션', () => {
  beforeEach(() => {
    mocks.adminState.operatorAccess = configuredOperatorAccessFixture('primary');
    mocks.rpc.mockReset();
    mocks.revalidatePath.mockReset();
  });

  it('회신을 KST 시각으로 다듬어 기록 RPC에 보내고 주문 화면을 새로 그린다', async () => {
    mocks.rpc.mockResolvedValue({ data: { orderId: ORDER_ID, outcome: 'stopped', replayed: false, replyIds: ['r1'], discoveryIds: [] }, error: null });
    const result = await recordWarehouseStopReplyAction(reply);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_record_warehouse_stop_reply', {
      p_shipment_ids: [SHIPMENT_ID], p_outcome: 'stopped', p_channel: 'messenger', p_replied_at: '2026-11-19T05:05:00.000Z',
      p_note: '서원 담당 카카오톡', p_operation_id: OPERATION_ID,
    });
    expect(result).toEqual({ ok: true, value: { message: expect.stringContaining('출고 중단 회신을 기록했습니다') } });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/admin/sales/orders/${ORDER_ID}`);
  });

  it('이미 취소된 배송 건의 이미 출고 회신이 발견을 만들면 고객 연락·회수를 안내한다', async () => {
    mocks.rpc.mockResolvedValue({ data: { orderId: ORDER_ID, outcome: 'already_shipped', replayed: false, replyIds: ['r1'], discoveryIds: ['d1'] }, error: null });
    const result = await recordWarehouseStopReplyAction({ ...reply, outcome: 'already_shipped' });
    expect(result).toEqual({ ok: true, value: { message: expect.stringContaining('취소 뒤 출고 발견') } });
  });

  it('물류출고관리(sales.dispatch)는 회신을 기록하고, 출고 권한이 없는 매니저는 RPC 전에 막는다', async () => {
    mocks.adminState.operatorAccess = configuredOperatorAccessFixture('logistics');
    mocks.rpc.mockResolvedValue({ data: { orderId: ORDER_ID, outcome: 'stopped', replayed: false, replyIds: ['r1'], discoveryIds: [] }, error: null });
    expect((await recordWarehouseStopReplyAction(reply)).ok).toBe(true);
    /* 물류출고관리는 발견 처리(sales.manage)를 하지 못한다. */
    mocks.rpc.mockReset();
    expect(await resolveCanceledShipmentDispatchAction({ orderId: ORDER_ID, dispatchId: DISPATCH_ID, outcome: 'returned', note: '반송 입고 확인', operationId: OPERATION_ID }))
      .toEqual({ ok: false, error: '취소 뒤 출고를 처리할 권한이 없습니다.' });
    mocks.adminState.operatorAccess = configuredOperatorAccessFixture('agency');
    expect(await recordWarehouseStopReplyAction(reply)).toEqual({ ok: false, error: '창고 회신을 기록할 권한이 없습니다.' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('입력이 모자라면 RPC를 부르지 않고, DB 거절은 운영자 문구로 옮긴다', async () => {
    expect(await recordWarehouseStopReplyAction({ ...reply, repliedAt: '' })).toMatchObject({ ok: false, error: expect.stringContaining('시각') });
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'warehouse_stop_reply_before_export' } });
    expect(await recordWarehouseStopReplyAction(reply)).toMatchObject({ ok: false, error: expect.stringContaining('출고지시 파일을 보낸 시각') });
  });

  it('발견 처리는 결과·근거를 보내고 회수 입고면 되돌린 재고 수를 알린다', async () => {
    mocks.rpc.mockResolvedValue({ data: { dispatchId: DISPATCH_ID, orderId: ORDER_ID, state: 'returned', returnedQty: 2, replayed: false }, error: null });
    const result = await resolveCanceledShipmentDispatchAction({ orderId: ORDER_ID, dispatchId: DISPATCH_ID, outcome: 'returned', note: ' 반송 상자 입고 확인 ', operationId: OPERATION_ID });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_resolve_canceled_shipment_dispatch', {
      p_dispatch_id: DISPATCH_ID, p_outcome: 'returned', p_note: '반송 상자 입고 확인', p_operation_id: OPERATION_ID,
    });
    expect(result).toEqual({ ok: true, value: { message: expect.stringContaining('재고 2개를 되돌렸습니다') } });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'canceled_dispatch_already_resolved' } });
    expect(await resolveCanceledShipmentDispatchAction({ orderId: ORDER_ID, dispatchId: DISPATCH_ID, outcome: 'lost', note: '손실 처리 근거', operationId: OPERATION_ID }))
      .toMatchObject({ ok: false, error: expect.stringContaining('이미 처리') });
  });

  it('주문 조회 권한이면 회신·발견 문맥을 읽고, 모양이 다르면 읽지 못했다고 알린다', async () => {
    mocks.rpc.mockResolvedValue({ data: { orderId: ORDER_ID, orderStatus: 'confirmed', canRecord: true, canResolve: true, shipments: [], discoveries: [] }, error: null });
    expect(await loadOrderWarehouseStopAction(ORDER_ID)).toMatchObject({ ok: true, value: { orderId: ORDER_ID } });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_order_warehouse_stop_context', { p_order_id: ORDER_ID });
    mocks.rpc.mockResolvedValue({ data: { orderId: ORDER_ID }, error: null });
    expect(await loadOrderWarehouseStopAction(ORDER_ID)).toMatchObject({ ok: false });
    mocks.adminState.operatorAccess = configuredOperatorAccessFixture('logistics');
    mocks.rpc.mockReset();
    expect(await loadOrderWarehouseStopAction(ORDER_ID)).toEqual({ ok: false, error: '관리자 권한이 필요합니다.' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
