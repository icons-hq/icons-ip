import { beforeEach, expect, it, vi } from 'vitest';
import { configuredOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import Page from './page';

const INQUIRY = 'a1030000-0000-4000-8000-000000000401';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), data: vi.fn(), context: vi.fn(), detail: vi.fn(), purchase: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/admin/inquiry-chat.server', () => ({ loadInquiryChatData: mocks.data, loadInquiryChatContext: mocks.context }));
vi.mock('@/lib/admin/inquiries.server', () => ({ loadAdminInquiryDetail: mocks.detail }));
vi.mock('@/lib/admin/inquiry-purchase-history.server', () => ({ loadInquiryPurchaseHistory: mocks.purchase }));
vi.mock('@/components/admin/screens/InquiryChatScreen', () => ({ InquiryChatScreen: () => null }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('not_found'); }, redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));

const staff = (role: Parameters<typeof configuredOperatorAccessFixture>[0]) => ({ isConfigured: true, user: { id: 'operator' }, role: 'staff', isStaff: true, operatorAccess: configuredOperatorAccessFixture(role) });
const history = { inquiryId: INQUIRY, customerId: 'a1030000-0000-4000-8000-000000000001', linkedOrder: null, items: [], page: 1, pageSize: 20, total: 0 };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.data.mockResolvedValue({ rows: [], total: 0, counts: { all: 0, open: 0, answered: 0, closed: 0 }, unreadMessages: 0, staffOptions: [] });
  mocks.context.mockResolvedValue(null);
  mocks.detail.mockResolvedValue({ inquiry: { id: INQUIRY }, buyer: { id: 'a1030000-0000-4000-8000-000000000001' } });
  mocks.purchase.mockResolvedValue(history);
});

/* 1014-103(사용자 결정 "전부 다 아무나 볼 수 있게"): 상담 화면을 여는 역할이면 주문 조회 권한 없이도 그 문의 고객의 구매이력을 미리 읽는다. */
it('deputy and agency preload the inquiry customer purchase history without the order permission', async () => {
  for (const role of ['deputy', 'agency'] as const) {
    mocks.auth.mockResolvedValue(staff(role));
    const page = await Page({ searchParams: Promise.resolve({ inquiryId: INQUIRY }) });
    expect(page.props).toMatchObject({ canReadOrders: false, purchaseHistory: history, purchaseHistoryError: false });
  }
  expect(mocks.purchase).toHaveBeenCalledTimes(2);
  expect(mocks.purchase).toHaveBeenCalledWith(INQUIRY);
  /* 연결 주문 상세(결제·클레임)는 지금처럼 주문 조회·처리 권한으로만 읽는다. */
  expect(mocks.detail).toHaveBeenCalledWith(INQUIRY, { canReadOrders: false, canManageSales: false });
});
it('a failed purchase history read still opens the conversation and offers a retry', async () => {
  mocks.auth.mockResolvedValue(staff('deputy'));
  mocks.purchase.mockRejectedValue(new Error('rpc down'));
  const page = await Page({ searchParams: Promise.resolve({ inquiryId: INQUIRY }) });
  expect(page.props).toMatchObject({ purchaseHistory: null, purchaseHistoryError: true });
});
it('the list without a selected conversation reads no purchase history', async () => {
  mocks.auth.mockResolvedValue(staff('primary'));
  await Page({ searchParams: Promise.resolve({}) });
  expect(mocks.purchase).not.toHaveBeenCalled();
  mocks.auth.mockResolvedValue(staff('logistics'));
  await expect(Page({ searchParams: Promise.resolve({ inquiryId: INQUIRY }) })).rejects.toThrow('not_found');
  expect(mocks.purchase).not.toHaveBeenCalled();
});
