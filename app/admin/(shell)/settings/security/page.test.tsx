import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ guard: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { mfa: {} } }) }));
import Page from './page';

beforeEach(() => { vi.clearAllMocks(); mocks.guard.mockResolvedValue({ user: { id: 'operator' } }); });

it('운영자 누구나 여는 화면이다(별도 권한 없이 화면 게이트만)', async () => {
  await Page();
  expect(mocks.guard).toHaveBeenCalledWith('/admin/settings/security');
});

it('스위치가 꺼져 있으면 미리 등록을 권하고, 켜져 있으면 사용 중이라고 알린다', async () => {
  const off = renderToStaticMarkup(await Page());
  expect(off).toContain('미리 등록해 주세요');
  expect(off).toContain('인증 정보를 확인하는 중');
  mocks.guard.mockResolvedValue({ user: { id: 'operator' }, mfaRequired: true });
  const on = renderToStaticMarkup(await Page());
  expect(on).toContain('2단계 인증 사용 중');
  expect(on).not.toContain('미리 등록해 주세요');
});
