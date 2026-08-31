import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminCsQnaPage from './page';

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
  questions: vi.fn(async () => ({ rows: [] })),
  reviews: vi.fn(async () => ({ rows: [] })),
}));

vi.mock('@/components/admin/screens/QnaConsoleScreen', () => ({
  QnaConsoleScreen: mocks.screen,
}));
vi.mock('@/lib/admin/product-questions.server', () => ({
  getAdminProductQuestionConsoleData: mocks.questions,
}));
vi.mock('@/lib/admin/reviews.server', () => ({ getAdminReviewConsoleData: mocks.reviews }));
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

describe('AdminCsQnaPage', () => {
  beforeEach(() => {
    mocks.authState = {
      isConfigured: true,
      user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' },
      role: 'staff',
      isStaff: true,
    };
    mocks.screen.mockClear();
    mocks.questions.mockClear();
    mocks.reviews.mockClear();
  });

  /* 게이트가 로더보다 먼저다 — layout과 page는 병렬로 렌더된다. */
  it('로그인 전에는 Q&A 경로를 next로 실어 로그인으로 보낸다', async () => {
    mocks.authState = { isConfigured: true, user: null, role: null, isStaff: false };

    await expect(AdminCsQnaPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fadmin%2Fcs%2Fqna',
    );
    expect(mocks.questions).not.toHaveBeenCalled();
  });

  it('비스태프에게는 화면을 열지 않는다', async () => {
    mocks.authState = {
      isConfigured: true,
      user: { id: 'u1', email: 'fan@icons.gg' },
      role: 'user',
      isStaff: false,
    };

    await expect(AdminCsQnaPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(mocks.questions).not.toHaveBeenCalled();
  });

  it('URL 필터를 정규화해 로더에 넘긴다', async () => {
    await AdminCsQnaPage({
      searchParams: Promise.resolve({ page: '2', status: 'unanswered' }),
    });

    expect(mocks.questions).toHaveBeenCalledWith({ page: 2, status: 'unanswered' });
  });

  it('모르는 상태는 전체로 접어 넘긴다', async () => {
    await AdminCsQnaPage({ searchParams: Promise.resolve({ status: 'deleted' }) });

    expect(mocks.questions).toHaveBeenCalledWith({ page: 1, status: 'all' });
  });

  it('다른 화면의 로더는 부르지 않는다', async () => {
    await AdminCsQnaPage({ searchParams: Promise.resolve({}) });

    expect(mocks.reviews).not.toHaveBeenCalled();
  });
});
