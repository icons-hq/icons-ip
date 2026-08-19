import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminCsReviewsPage from './page';

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
  reviews: vi.fn(async () => ({ rows: [] })),
  inquiries: vi.fn(async () => ({ rows: [] })),
}));

vi.mock('@/components/admin/screens/ReviewConsoleScreen', () => ({
  ReviewConsoleScreen: mocks.screen,
}));
vi.mock('@/lib/admin/reviews.server', () => ({
  getAdminReviewConsoleData: mocks.reviews,
}));
vi.mock('@/lib/admin/inquiries.server', () => ({
  getAdminInquiryConsoleData: mocks.inquiries,
}));
vi.mock('@/lib/auth/admin', () => ({
  getCurrentAdminAuthState: vi.fn(async () => mocks.authState),
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

describe('AdminCsReviewsPage', () => {
  beforeEach(() => {
    mocks.authState = {
      isConfigured: true,
      user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' },
      role: 'staff',
      isStaff: true,
    };
    mocks.screen.mockClear();
    mocks.reviews.mockClear();
    mocks.inquiries.mockClear();
  });

  /* 게이트가 로더보다 먼저다 — layout과 page는 병렬로 렌더된다. */
  it('로그인 전에는 리뷰 경로를 next로 실어 로그인으로 보낸다', async () => {
    mocks.authState = { isConfigured: true, user: null, role: null, isStaff: false };

    await expect(AdminCsReviewsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fadmin%2Fcs%2Freviews',
    );
    expect(mocks.reviews).not.toHaveBeenCalled();
  });

  it('비스태프에게는 화면을 열지 않는다', async () => {
    mocks.authState = {
      isConfigured: true,
      user: { id: 'u1', email: 'fan@icons.gg' },
      role: 'user',
      isStaff: false,
    };

    await expect(AdminCsReviewsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(mocks.reviews).not.toHaveBeenCalled();
  });

  it('URL 필터를 정규화해 로더에 넘긴다', async () => {
    await AdminCsReviewsPage({
      searchParams: Promise.resolve({ low: '1', page: '2', rating: '9', status: 'hidden' }),
    });

    expect(mocks.reviews).toHaveBeenCalledWith(expect.objectContaining({
      lowRating: true,
      page: 2,
      rating: 'all',
      status: 'hidden',
    }));
  });

  it('다른 화면의 로더는 부르지 않는다', async () => {
    await AdminCsReviewsPage({ searchParams: Promise.resolve({}) });

    expect(mocks.inquiries).not.toHaveBeenCalled();
  });
});
