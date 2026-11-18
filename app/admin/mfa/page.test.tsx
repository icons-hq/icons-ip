import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { mfa: {} } }) }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); },
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));
import Page from './page';

const user = { id: 'operator', email: 'operator@icons.gg' };
const params = (next?: string) => ({ searchParams: Promise.resolve(next === undefined ? {} : { next }) });
beforeEach(() => { mocks.auth.mockReset(); });

it('미로그인은 인증 화면과 복귀 경로를 함께 담아 로그인으로 보낸다', async () => {
  mocks.auth.mockResolvedValue({ isConfigured: true, user: null, role: null, isStaff: false });
  await expect(Page(params('/admin/sales/orders'))).rejects.toThrow(
    `NEXT_REDIRECT:/login?next=${encodeURIComponent('/admin/mfa?next=%2Fadmin%2Fsales%2Forders')}`,
  );
});

it('인증이 필요 없는 운영자는 원래 화면으로, 운영자가 아니면 404다', async () => {
  mocks.auth.mockResolvedValue({ isConfigured: true, user, role: 'staff', isStaff: true });
  await expect(Page(params('/admin/settings/store'))).rejects.toThrow('NEXT_REDIRECT:/admin/settings/store');
  await expect(Page(params('https://evil.example'))).rejects.toThrow('NEXT_REDIRECT:/admin');
  mocks.auth.mockResolvedValue({ isConfigured: true, user, role: 'user', isStaff: false });
  await expect(Page(params('/admin'))).rejects.toThrow('NEXT_NOT_FOUND');
});

it('2단계 인증 대기 운영자에게 인증 화면을 그린다(셸·운영자 데이터 없이)', async () => {
  mocks.auth.mockResolvedValue({ isConfigured: true, user, role: 'staff', isStaff: false, mfaPending: true });
  const html = renderToStaticMarkup(await Page(params('/admin/sales/orders')));
  expect(html).toContain('wc-admin');
  expect(html).toContain('인증 정보를 확인하는 중');
  expect(html).toContain('operator@icons.gg');
  expect(html).toContain('통합 매니저에게 2단계 인증 초기화를 요청');
  expect(html).not.toContain('data-sidebar');
});
