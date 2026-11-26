const { legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './page';

const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: { id: 'staff' }, isStaff: true, operatorAccess: legacyOperatorAccessFixture(), role: 'staff' },
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

describe('상품정보제공고시 템플릿 관리 라우트', () => {
  it('일반 회원에게 템플릿 로딩과 화면을 허용하지 않는다', async () => {
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
  it('칸을 비워 둔 템플릿은 빈 칸 그대로 읽고, 비운 칸은 상품 값을 그대로 둔다고 되읽는다', async () => {
    mocks.range.mockResolvedValue({ data: [{
      id: 'preset-2', name: '키링 공통', maker: 'DB 제조사', origin: '대한민국', material: '아크릴',
      size: '', made_on: '', as_manager: 'DB 고객센터', as_contact: '02-000-0000', kc_template: null,
      updated_at: '2026-11-25T01:00:00Z',
    }], count: 1, error: null });
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    for (const name of ['noticeSize', 'noticeMadeOn']) expect(html).toMatch(new RegExp(`<input(?=[^>]*name="${name}")(?=[^>]*value="")[^>]*>`));
    expect(html).toContain('상품에 가져오면 5개 칸이 이 내용으로 바뀝니다. 비운 칸(크기 · 중량, 제조연월)은 상품에 적어 둔 값 그대로입니다.');
    expect(html).toContain('제조사 DB 제조사 · 소재 아크릴');
  });
});
