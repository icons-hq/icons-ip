import { legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import AdminCsInquiryDetailPage from './page';

const INQUIRY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const mocks = vi.hoisted(() => ({
  inquiries: vi.fn(async () => ({ rows: [], counts: { open: 3, answered: 0, closed: 0 } })),
  detail: vi.fn(async () => ({ inquiry: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } })),
  navigation: vi.fn(async () => undefined),
  screen: vi.fn(() => null),
}));

vi.mock('@/components/admin/screens/InquiryDetailScreen', () => ({ InquiryDetailScreen: mocks.screen }));
vi.mock('@/lib/admin/inquiries.server', () => ({
  getAdminInquiryConsoleData: mocks.inquiries,
  getAdminInquiryNavigation: mocks.navigation,
  loadAdminInquiryDetail: mocks.detail,
}));
vi.mock('@/lib/auth/admin', () => ({
  getCurrentAdminAuthState: vi.fn(async () => ({
    isConfigured: true,
    user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' },
    role: 'staff',
    isStaff: true,
    operatorAccess: legacyOperatorAccessFixture(),
  })),
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); },
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));

describe('AdminCsInquiryDetailPage', () => {
  /* R1(D1①): 상세 화면도 목록과 같은 응답의 미답변 수로 배지를 그린다(추가 조회 없음). */
  it('상세 진입 때 읽은 목록 집계로 미답변 배지를 그린다', async () => {
    const html = renderToStaticMarkup(await AdminCsInquiryDetailPage({
      params: Promise.resolve({ inquiryId: INQUIRY_ID }),
      searchParams: Promise.resolve({}),
    } as never));
    expect(html).toContain('<strong>3건</strong>');
    expect(mocks.inquiries).toHaveBeenCalledTimes(1);
  });
});
