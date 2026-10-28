import { configuredOperatorAccessFixture, legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminCsInquiriesPage from './page';

const mocks = vi.hoisted(() => ({
  authState: {
    isConfigured: true,
    user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' },
    role: 'staff',
    isStaff: true,
  } as {
    isConfigured: boolean;
    user: { id: string; email: string | null } | null;
    role: 'user' | 'staff' | 'admin' | null;
    isStaff: boolean;
  },
  screen: vi.fn(() => null),
  inquiries: vi.fn(async () => ({ rows: [], counts: { open: 0, answered: 0, closed: 0 } })),
  detail: vi.fn(async (): Promise<unknown> => null),
  navigation: vi.fn(async () => undefined),
  orders: vi.fn(async () => ({})),
}));

vi.mock('@/components/admin/screens/InquiryQueueScreen', () => ({
  InquiryQueueScreen: mocks.screen,
}));
vi.mock('@/components/admin/screens/InquiryDetailScreen', () => ({
  InquiryDetailScreen: ({ detail, embedded }: { detail: { inquiry: { id: string } }; embedded?: boolean }) => <p>상세 {detail.inquiry.id} {embedded ? 'embedded' : 'page'}</p>,
}));
vi.mock('@/lib/admin/inquiries.server', () => ({
  getAdminInquiryConsoleData: mocks.inquiries,
  getAdminInquiryNavigation: mocks.navigation,
  loadAdminInquiryDetail: mocks.detail,
}));
vi.mock('@/lib/admin/orders.server', () => ({ getAdminOrderRecords: mocks.orders }));
vi.mock('@/lib/auth/admin', () => ({
  getCurrentAdminAuthState: vi.fn(async () => ({ ...mocks.authState, operatorAccess: 'operatorAccess' in mocks.authState && mocks.authState.operatorAccess || legacyOperatorAccessFixture() })),
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

describe('AdminCsInquiriesPage', () => {
  beforeEach(() => {
    mocks.authState = {
      isConfigured: true,
      user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' },
      role: 'staff',
      isStaff: true,
    };
    mocks.screen.mockClear();
    mocks.inquiries.mockClear();
    mocks.detail.mockClear();
    mocks.orders.mockClear();
  });

  /* 게이트가 로더보다 먼저다 — layout과 page는 병렬로 렌더된다. */
  it('로그인 전에는 문의 경로를 next로 실어 로그인으로 보낸다', async () => {
    mocks.authState = { isConfigured: true, user: null, role: null, isStaff: false };

    await expect(AdminCsInquiriesPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fadmin%2Fcs%2Finquiries',
    );
    expect(mocks.inquiries).not.toHaveBeenCalled();
  });

  it('비스태프에게는 화면을 열지 않는다', async () => {
    mocks.authState = {
      isConfigured: true,
      user: { id: 'u1', email: 'fan@icons.gg' },
      role: 'user',
      isStaff: false,
    };

    await expect(AdminCsInquiriesPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(mocks.inquiries).not.toHaveBeenCalled();
  });

  it('URL 필터를 정규화해 로더에 넘긴다', async () => {
    await AdminCsInquiriesPage({
      searchParams: Promise.resolve({ status: 'answered', category: 'refund', page: '2' }),
    });

    expect(mocks.inquiries).toHaveBeenCalledWith(expect.objectContaining({
      category: 'all',
      page: 2,
      status: 'answered',
    }));
  });

  it('다른 화면의 로더는 부르지 않는다', async () => {
    await AdminCsInquiriesPage({ searchParams: Promise.resolve({}) });

    expect(mocks.orders).not.toHaveBeenCalled();
    expect(mocks.detail).not.toHaveBeenCalled();
  });

  it('정상 문의번호를 선택한 경우에만 상세를 함께 불러온다', async () => {
    await AdminCsInquiriesPage({ searchParams: Promise.resolve({ inquiryId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pageSize: '50' }) });
    expect(mocks.detail).toHaveBeenCalledWith('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { canReadOrders: true, canManageSales: true });
    expect(mocks.inquiries).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 50 }));
    mocks.detail.mockClear();
    await AdminCsInquiriesPage({ searchParams: Promise.resolve({ inquiryId: 'invalid' }) });
    expect(mocks.detail).not.toHaveBeenCalled();
  });
  it('configured deputy can answer inquiries without loading order context', async () => {
    Object.assign(mocks.authState, { operatorAccess: configuredOperatorAccessFixture('deputy') });
    await AdminCsInquiriesPage({ searchParams: Promise.resolve({ inquiryId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }) });
    expect(mocks.detail).toHaveBeenCalledWith('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { canReadOrders: false, canManageSales: false });
  });

  /* R1(D1①): 미답변 배지는 셸 공통이 아니라 고객문의 목록·상세에서만, 그 화면이 이미 읽은 집계로 그린다. */
  it('목록 응답의 미답변 수로 배지를 그리고 0건이면 그리지 않는다', async () => {
    mocks.inquiries.mockResolvedValueOnce({ rows: [], counts: { open: 7, answered: 2, closed: 1 } });
    const html = renderToStaticMarkup(await AdminCsInquiriesPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('<span>미답변 1:1 문의</span>');
    expect(html).toContain('<strong>7건</strong>');
    expect(mocks.inquiries).toHaveBeenCalledTimes(1);

    const empty = renderToStaticMarkup(await AdminCsInquiriesPage({ searchParams: Promise.resolve({}) }));
    expect(empty).not.toContain('미답변 1:1 문의');
  });

  /* R4: '답변처리'는 목록 아래 화면 밖 섹션이 아니라 목록 위 팝업(native dialog)으로 상세와 답변 패널을 연다. */
  it('선택한 문의를 목록 위 넓은 팝업으로 열고, 선택이 없으면 팝업을 그리지 않는다', async () => {
    mocks.detail.mockResolvedValueOnce({ inquiry: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } });
    const html = renderToStaticMarkup(await AdminCsInquiriesPage({ searchParams: Promise.resolve({ inquiryId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }) }));
    expect(html).toMatch(/<dialog[^>]*class="admin-cs-dialog admin-cs-dialog--wide"/);
    expect(html).toContain('고객문의 상세 · 답변');
    expect(html).toContain('상세 aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa embedded');
    expect(html).not.toContain('admin-inquiry-preview');

    const list = renderToStaticMarkup(await AdminCsInquiriesPage({ searchParams: Promise.resolve({}) }));
    expect(list).not.toContain('<dialog');
    expect(list).not.toContain('admin-inquiry-preview');
  });

  it('찾을 수 없는 문의를 고르면 팝업 안에서 이유를 알린다', async () => {
    const html = renderToStaticMarkup(await AdminCsInquiriesPage({ searchParams: Promise.resolve({ inquiryId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }) }));
    expect(html).toMatch(/<dialog[^>]*>[\s\S]*role="alert"[^>]*>문의를 찾을 수 없습니다/);
  });
});
