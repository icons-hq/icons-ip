import { configuredOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/orders/shipment.server', () => ({ getShippingCarrierRegistry: async () => [
  { code: 'hanjin', label: '한진택배', active: true, trackingUrlTemplate: 'https://example.test/{trackingNumber}' },
] }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn(), redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); } }));
import { searchTrackingSwapCandidatesAction } from './shipment-tracking-lookup-actions';

const SHIPMENT_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_ID = '00000000-0000-4000-8000-000000000002';
const THIRD_ID = '00000000-0000-4000-8000-000000000003';
const as = (role: Parameters<typeof configuredOperatorAccessFixture>[0]) =>
  mocks.auth.mockResolvedValue({ operatorAccess: configuredOperatorAccessFixture(role), isConfigured: true, user: { id: 'operator' }, role: 'staff', isStaff: true });
const row = (overrides: Record<string, unknown> = {}) => ({
  id: OTHER_ID, orderId: '11111111-1111-4111-8111-111111111111', orderNumber: '2026102710000042', shipmentNumber: '2026102730000007', originName: '김포',
  status: 'shipping', recipientName: '김팬', carrier: 'hanjin', trackingNumber: '123456789012', ...overrides,
});
const page = (rows: unknown[]) => ({ data: { total: rows.length, counts: {}, rows }, error: null });

beforeEach(() => { vi.resetAllMocks(); as('logistics'); });

/* 운송장 맞바꾸기의 상대 배송 건을 글자로 적지 않고 운송장번호로 찾아 고른다(화면 규칙 1). 읽기만 하고 쓰지 않는다. */
describe('searchTrackingSwapCandidatesAction', () => {
  it('배송중·배송완료 두 탭에서 운송장번호로 찾아 이 배송 건 자신과 운송장이 없는 배송 건을 뺀다', async () => {
    mocks.rpc.mockImplementation(async (_name: string, args: { p_tab: string }) => args.p_tab === 'transit'
      ? page([row(), row({ id: SHIPMENT_ID, trackingNumber: '123456789012' }), row({ id: THIRD_ID, trackingNumber: null })])
      : page([row({ id: '00000000-0000-4000-8000-000000000004', status: 'delivered', shipmentNumber: undefined, orderNumber: undefined, orderId: '22222222-2222-4222-8222-222222222222' })]));

    const result = await searchTrackingSwapCandidatesAction(SHIPMENT_ID, { query: ' 1234-5678-9012 ', page: 1 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.total).toBe(2);
    expect(result.data.rows).toEqual([
      { id: OTHER_ID, reference: '2026102730000007', orderReference: '2026102710000042', recipientName: '김팬', originName: '김포', carrierLabel: '한진택배', trackingNumber: '123456789012' },
      /* 번호가 없는 옛 배송 건·주문은 내부 번호 대신 끝 8자로 부른다. */
      expect.objectContaining({ id: '00000000-0000-4000-8000-000000000004', reference: '00000004', orderReference: '22222222' }),
    ]);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_shipments_console', expect.objectContaining({
      p_tab: 'transit', p_query: '123456789012', p_field: 'tracking', p_method: 'parcel', p_origin_id: null,
    }));
    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_shipments_console', expect.objectContaining({ p_tab: 'delivered' }));
  });

  it('추가 운송장으로만 걸린 배송 건은 뺀다 — 맞바꾸는 것은 대표 운송장이다', async () => {
    mocks.rpc.mockResolvedValue(page([row({ trackingNumber: '999999999999' })]));
    const result = await searchTrackingSwapCandidatesAction(SHIPMENT_ID, { query: '123456789012', page: 1 });
    expect(result).toMatchObject({ ok: true, data: { total: 0, rows: [] } });
  });

  it('검색어를 아직 적지 않았으면 오류가 아니라 빈 목록이고, 너무 짧거나 형식이 틀리면 고칠 방법을 말한다', async () => {
    expect(await searchTrackingSwapCandidatesAction(SHIPMENT_ID, { query: '   ', page: 1 })).toMatchObject({ ok: true, data: { total: 0 } });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(await searchTrackingSwapCandidatesAction(SHIPMENT_ID, { query: '1234', page: 1 })).toEqual({ ok: false, error: '운송장번호를 8자 이상, 하이픈 없이 영문·숫자로 적어주세요.' });
    expect(await searchTrackingSwapCandidatesAction(SHIPMENT_ID, { query: '한글운송장번호12345', page: 1 })).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('20개씩 나눠 보이고 범위를 벗어난 쪽은 마지막 쪽으로 보정한다', async () => {
    const rows = Array.from({ length: 25 }, (_, index) => row({ id: `00000000-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`, trackingNumber: `12345678901${index % 10}` }));
    mocks.rpc.mockImplementation(async (_name: string, args: { p_tab: string }) => page(args.p_tab === 'transit' ? rows : []));
    const first = await searchTrackingSwapCandidatesAction(SHIPMENT_ID, { query: '12345678901', page: 1 });
    expect(first).toMatchObject({ ok: true, data: { total: 25, page: 1, pageSize: 20 } });
    if (first.ok) expect(first.data.rows).toHaveLength(20);
    const last = await searchTrackingSwapCandidatesAction(SHIPMENT_ID, { query: '12345678901', page: 9 });
    expect(last).toMatchObject({ ok: true, data: { page: 2 } });
    if (last.ok) expect(last.data.rows).toHaveLength(5);
  });

  it('출고 권한이 없으면 DB를 부르지 않고, 배송 건이 이상하거나 조회가 실패하면 안내한다', async () => {
    /* 대행사 매니저는 출고 권한(sales.dispatch)이 없다. */
    as('agency');
    const denied = await searchTrackingSwapCandidatesAction(SHIPMENT_ID, { query: '123456789012', page: 1 });
    expect(denied).toMatchObject({ ok: false, error: expect.stringContaining('출고 권한이 없거나 로그인이 끝났습니다') });
    expect(mocks.rpc).not.toHaveBeenCalled();

    as('logistics');
    expect(await searchTrackingSwapCandidatesAction('not-a-uuid', { query: '123456789012', page: 1 })).toEqual({ ok: false, error: '배송 건을 다시 선택해주세요.' });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'private db detail' } });
    const failed = await searchTrackingSwapCandidatesAction(SHIPMENT_ID, { query: '123456789012', page: 1 });
    expect(failed).toEqual({ ok: false, error: '배송 건을 찾지 못했습니다. 잠시 뒤 다시 검색해주세요.' });
    expect(JSON.stringify(failed)).not.toContain('private');
  });
});
