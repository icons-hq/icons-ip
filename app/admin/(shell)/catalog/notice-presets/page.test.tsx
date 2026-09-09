import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './page';

const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: { id: 'staff' }, isStaff: true, role: 'staff' },
  range: vi.fn(), createClient: vi.fn(),
}));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: vi.fn(async () => mocks.auth) }));
vi.mock('next/navigation', () => ({
  redirect: () => { throw new Error('NEXT_REDIRECT'); },
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/app/admin/goods-notice-preset-actions', () => ({ saveGoodsNoticePresetAction: vi.fn(), deleteGoodsNoticePresetAction: vi.fn() }));

beforeEach(() => {
  mocks.auth.isStaff = true;
  mocks.range.mockReset().mockResolvedValue({ data: [{
    id: 'preset-1', name: 'DB 프리셋', maker: 'DB 제조사', origin: '대한민국', material: '아크릴',
    size: '80mm', made_on: '2026-09', as_manager: 'DB 고객센터', as_contact: '02-000-0000',
    updated_at: '2026-09-08T01:00:00.123456Z',
  }], count: 1, error: null });
  const query = { select() { return this; }, order() { return this; }, ilike() { return this; }, range: mocks.range };
  mocks.createClient.mockReset().mockResolvedValue({ from: () => query });
});

describe('프리셋 관리 라우트', () => {
  it('일반 회원에게 프리셋 로딩과 화면을 허용하지 않는다', async () => {
    mocks.auth.isStaff = false;
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it('운영자는 DB의 7개 값을 폼에서 다시 읽을 수 있다', async () => {
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    for (const value of ['DB 프리셋', 'DB 제조사', '대한민국', '아크릴', '80mm', '2026-09', 'DB 고객센터', '02-000-0000']) {
      expect(html).toContain(`value="${value}"`);
    }
    expect(html).toContain('value="2026-09-08T01:00:00.123456Z"');
  });
});
