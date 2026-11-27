const { legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './page';

const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: { id: 'staff' }, isStaff: true, operatorAccess: legacyOperatorAccessFixture(), role: 'staff' },
  rpc: vi.fn(), createClient: vi.fn(),
}));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: vi.fn(async () => mocks.auth) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('next/navigation', () => ({
  redirect: () => { throw new Error('NEXT_REDIRECT'); },
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('@/app/admin/shipping-notice-template-actions', () => ({
  saveShippingNoticeTemplateAction: vi.fn(), readShippingNoticeTemplateAction: vi.fn(), applyShippingNoticeTemplateToGoodsAction: vi.fn(),
}));

beforeEach(() => {
  mocks.auth.isStaff = true;
  mocks.rpc.mockReset().mockResolvedValue({ data: { total: 1, rows: [{
    id: 'b9000000-0000-4000-8000-000000000001', code: 'n-3fa9c21b7d04', version: 2, name: 'DB 배송', shippingNotice: 'DB 배송 안내',
    returnExchangeNotice: 'DB 반품 안내', remoteAreaNotice: '', csName: 'DB CS', csPhone: '02-000-0000', csEmail: 'help@example.com',
    status: 'active', updatedAt: '2026-09-10T01:00:00+00:00', goodsCount: 7,
  }] }, error: null });
  mocks.createClient.mockReset().mockResolvedValue({ rpc: mocks.rpc });
});

describe('배송 안내 템플릿 관리 라우트', () => {
  it('일반 회원에게 템플릿 조회를 허용하지 않는다', async () => {
    mocks.auth.isStaff = false;
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('목록 조회 한 번으로 템플릿과 쓰는 상품 수를 읽어 화면에 넘긴다', async () => {
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ q: ' DB ', page: '1', good: 'acrylic', focus: 'b9000000-0000-4000-8000-000000000001' }) }));
    for (const value of ['DB 배송', 'DB 배송 안내', '7개']) expect(html).toContain(value);
    /* 상품 찾기 조건과 '방금 만든 초안 열어 두기'는 없어졌다. 예전 주소로 들어와도 그 값은 쓰지 않는다. */
    expect(mocks.rpc.mock.calls).toEqual([['admin_list_shipping_notice_templates', { p_query: 'DB', p_limit: 20, p_offset: 0 }]]);
    expect(html).not.toContain('acrylic');
    expect(html).not.toContain('n-3fa9c21b7d04');
  });
});
