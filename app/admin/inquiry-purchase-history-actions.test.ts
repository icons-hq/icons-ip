import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configuredOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
import { loadInquiryPurchaseHistoryAction } from './inquiry-purchase-history-actions';

const INQUIRY = 'a1030000-0000-4000-8000-000000000401';
const history = { inquiryId: INQUIRY, customerId: 'a1030000-0000-4000-8000-000000000001', linkedOrder: null, page: 2, pageSize: 20, total: 23,
  items: [{ id: 'a1030000-0000-4000-8000-000000000103', orderNumber: null, status: 'paid', amount: 3000, createdAt: '2026-09-01T03:00:00+00:00', title: '주문 상품', itemCount: 0 }] };
const form = (fields: Record<string, string>) => { const data = new FormData(); for (const [key, value] of Object.entries(fields)) data.set(key, value); return data; };
const staff = (role: Parameters<typeof configuredOperatorAccessFixture>[0]) => ({ isConfigured: true, user: { id: 'operator' }, role: 'staff', isStaff: true, operatorAccess: configuredOperatorAccessFixture(role) });

beforeEach(() => { vi.clearAllMocks(); mocks.rpc.mockResolvedValue({ data: history, error: null }); });

describe('상담 중 고객 구매이력 불러오기(1014-103)', () => {
  it('주문 조회 권한이 없는 부매니저도 문의 번호와 페이지로 그 고객의 구매이력을 읽는다', async () => {
    mocks.auth.mockResolvedValue(staff('deputy'));
    const result = await loadInquiryPurchaseHistoryAction({}, form({ inquiryId: INQUIRY.toUpperCase(), page: '2' }));
    expect(result.history?.total).toBe(23);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_inquiry_purchase_history', { target_inquiry_id: INQUIRY, target_page: 2 });
  });
  it('문의 응대 권한이 없으면 DB에 닿지 않는다', async () => {
    mocks.auth.mockResolvedValue(staff('logistics'));
    expect((await loadInquiryPurchaseHistoryAction({}, form({ inquiryId: INQUIRY, page: '1' }))).error).toBe('문의 응대 권한이 필요합니다.');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('미로그인은 문의 상세로 돌아오는 로그인으로 보낸다', async () => {
    mocks.auth.mockResolvedValue({ isConfigured: true, user: null, role: null, isStaff: false });
    await expect(loadInquiryPurchaseHistoryAction({}, form({ inquiryId: INQUIRY, page: '1' }))).rejects.toThrow(`redirect:/login?next=${encodeURIComponent(`/admin/cs/inquiries/${INQUIRY}`)}`);
  });
  it('잘못된 입력·없는 문의·읽기 실패를 구분하고 내부 오류를 드러내지 않는다', async () => {
    mocks.auth.mockResolvedValue(staff('agency'));
    expect((await loadInquiryPurchaseHistoryAction({}, form({ inquiryId: 'x', page: '1' }))).error).toBe('구매이력을 다시 열어주세요.');
    expect((await loadInquiryPurchaseHistoryAction({}, form({ inquiryId: INQUIRY, page: '0' }))).error).toBe('구매이력을 다시 열어주세요.');
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0002', message: 'inquiry_not_found' } });
    expect((await loadInquiryPurchaseHistoryAction({}, form({ inquiryId: INQUIRY, page: '1' }))).error).toBe('문의를 찾을 수 없습니다.');
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'operator_capability_required secret' } });
    const failed = await loadInquiryPurchaseHistoryAction({}, form({ inquiryId: INQUIRY, page: '1' }));
    expect(failed.error).toBe('구매이력을 불러오지 못했습니다. 다시 시도해주세요.'); expect(JSON.stringify(failed)).not.toContain('secret');
    mocks.rpc.mockResolvedValueOnce({ data: { ...history, inquiryId: 'a1030000-0000-4000-8000-000000000402' }, error: null });
    expect((await loadInquiryPurchaseHistoryAction({}, form({ inquiryId: INQUIRY, page: '1' }))).error).toBe('구매이력을 불러오지 못했습니다. 다시 시도해주세요.');
  });
});
