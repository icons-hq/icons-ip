import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchForcedDeliveryOrdersAction } from './forced-delivery-picker-actions';

const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), note: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/admin/pii-access-log.server', () => ({ notePiiAccess: mocks.note }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));

const actor = 'a0a00000-0000-4000-8000-000000000001';
const row = (extra: Record<string, unknown> = {}) => ({ id: 'f0dd0000-0000-4001-8000-000000000001', user_id: 'abcdef01-0000-4000-8000-000000000001', buyer_name: '시험 구매자', status: 'confirmed',
  total: 12000, created_at: '2026-11-11T00:00:00Z', cancellation_request_status: null, total_count: 41, order_number: '2026111110000001', address: { recipientName: '개인정보' }, buyer_email: 'a@b.c', ...extra });
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ user: { id: actor } }); mocks.rpc.mockResolvedValue({ data: [row()], error: null }); });

describe('강제 배송완료 주문 고르기 조회', () => {
  it('강제 배송완료와 같은 권한(sales.manage)을 먼저 확인하고, 권한이 없으면 조회하지 않는다', async () => {
    mocks.access.mockResolvedValue(null);
    expect(await searchForcedDeliveryOrdersAction({ query: '', field: 'order', filter: 'confirmed', page: 1 })).toEqual({ ok: false, error: '판매 관리 권한이 없거나 로그인이 끝났습니다. 로그인한 계정을 확인하고, 권한이 없으면 계정 주매니저에게 요청해주세요.' });
    expect(mocks.access).toHaveBeenCalledWith('/admin/sales/dispatch', { capability: 'sales.manage' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('주문 통합검색과 같은 조회를 상태 하나로 20개씩 불러 줄만 돌려준다(이메일·주소는 싣지 않는다)', async () => {
    const result = await searchForcedDeliveryOrdersAction({ query: ' 20261111 ', field: 'order', filter: 'shipping', page: 2 });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_search_orders_console', { p_status: 'shipping', p_query: '20261111', p_field: 'order', p_date_field: 'ordered', p_sort: 'newest', p_limit: 20, p_offset: 20 });
    expect(result).toEqual({ ok: true, data: { total: 41, page: 2, pageSize: 20, rows: [{ orderId: 'f0dd0000-0000-4001-8000-000000000001', orderNumber: '2026111110000001', buyerName: '시험 구매자',
      status: 'confirmed', total: 12000, createdAt: '2026-11-11T00:00:00Z', cancellationInProgress: false }] } });
    expect(JSON.stringify(result)).not.toMatch(/a@b\.c|개인정보/);
  });

  it('모르는 조건은 주문번호·발주확인으로 돌리고, 검색어가 없으면 비워 보낸다', async () => {
    await searchForcedDeliveryOrdersAction({ query: '   ', field: 'email', filter: 'delivered', page: -3 });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_orders_console', expect.objectContaining({ p_status: 'confirmed', p_query: null, p_field: 'order', p_offset: 0 }));
    await searchForcedDeliveryOrdersAction(undefined);
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_search_orders_console', expect.objectContaining({ p_status: 'confirmed', p_field: 'order', p_offset: 0 }));
  });

  it('구매자 이름으로 찾은 결과만 개인정보 접속기록(검색)에 남기고, 검색어 원문은 싣지 않는다', async () => {
    await searchForcedDeliveryOrdersAction({ query: '홍길동', field: 'nickname', filter: 'confirmed', page: 1 });
    expect(mocks.note).toHaveBeenCalledExactlyOnceWith({ actorId: actor, action: 'search', surface: 'order.search', path: '/admin/sales/dispatch', subjectKind: 'order',
      subjectIds: ['f0dd0000-0000-4001-8000-000000000001'], subjectCount: 41, detail: { field: 'nickname', view: 'forced_delivery', page: 1 } });
    expect(JSON.stringify(mocks.note.mock.calls)).not.toContain('홍길동');
    mocks.note.mockClear();
    for (const [field, query] of [['order', '2026'], ['product', '시험'], ['tracking', '1234'], ['nickname', '']] as const) await searchForcedDeliveryOrdersAction({ query, field, filter: 'confirmed', page: 1 });
    expect(mocks.note).not.toHaveBeenCalled();
  });

  it('그사이 목록이 줄어 이 쪽이 비면 첫 쪽부터 다시 읽고 돌려준 쪽 번호를 따르게 한다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: [row({ total_count: 3 })], error: null });
    const result = await searchForcedDeliveryOrdersAction({ query: '', field: 'order', filter: 'confirmed', page: 5 });
    expect(mocks.rpc.mock.calls.map(call => call[1].p_offset)).toEqual([80, 0]);
    expect(result).toMatchObject({ ok: true, data: { total: 3, page: 1, pageSize: 20 } });
    /* 첫 쪽이 비면(주문이 없으면) 다시 읽지 않고 빈 목록을 돌려준다. */
    mocks.rpc.mockClear(); mocks.rpc.mockResolvedValue({ data: [], error: null });
    expect(await searchForcedDeliveryOrdersAction({ query: 'zzz', field: 'order', filter: 'confirmed', page: 1 })).toEqual({ ok: true, data: { rows: [], total: 0, page: 1, pageSize: 20 } });
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it('조회 권한 거절과 읽기 실패는 고칠 방법이 있는 문구로, 모르는 모양의 결과는 통째로 거절한다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'operator_capability_required' } });
    expect(await searchForcedDeliveryOrdersAction({})).toEqual({ ok: false, error: '판매 관리 권한이 없거나 로그인이 끝났습니다. 로그인한 계정을 확인하고, 권한이 없으면 계정 주매니저에게 요청해주세요.' });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });
    expect(await searchForcedDeliveryOrdersAction({})).toEqual({ ok: false, error: '주문 목록을 불러오지 못했습니다. 잠시 뒤 다시 검색해주세요.' });
    mocks.rpc.mockResolvedValueOnce({ data: [row({ status: 'paid' })], error: null });
    expect(await searchForcedDeliveryOrdersAction({})).toHaveProperty('error', '주문 목록을 불러오지 못했습니다. 잠시 뒤 다시 검색해주세요.');
    mocks.rpc.mockRejectedValueOnce(new Error('network'));
    expect(await searchForcedDeliveryOrdersAction({})).toHaveProperty('ok', false);
    expect(mocks.note).not.toHaveBeenCalled();
  });
});
