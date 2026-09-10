import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './page';

const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: { id: 'staff' }, isStaff: true, role: 'staff' },
  rpc: vi.fn(), range: vi.fn(), createClient: vi.fn(),
}));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: vi.fn(async () => mocks.auth) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('next/navigation', () => ({
  redirect: () => { throw new Error('NEXT_REDIRECT'); },
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));
vi.mock('@/app/admin/shipping-notice-template-actions', () => ({
  saveShippingNoticeTemplateAction: vi.fn(), activateShippingNoticeTemplateAction: vi.fn(), applyShippingNoticeTemplateAction: vi.fn(),
}));

beforeEach(() => {
  mocks.auth.isStaff = true;
  mocks.range.mockReset().mockResolvedValue({ data: [{
    id: 'template-1', code: 'basic-v2', version: 2, name: 'DB 배송', shipping_notice: 'DB 배송 안내',
    return_exchange_notice: 'DB 반품 안내', cs_name: 'DB CS', cs_phone: '02-000-0000', cs_email: 'help@example.com',
    confirmation_evidence: '', status: 'draft', confirmed_by: null, confirmed_at: null,
    created_at: '2026-09-10T00:00:00Z', updated_at: '2026-09-10T01:00:00Z',
  }], count: 1, error: null });
  mocks.rpc.mockReset().mockResolvedValue({ data: [], error: null });
  const query = { select() { return this; }, ilike() { return this; }, order() { return this; }, range: mocks.range };
  mocks.createClient.mockReset().mockResolvedValue({ from: () => query, rpc: mocks.rpc });
});

describe('배송정보 템플릿 관리 라우트', () => {
  it('일반 회원에게 템플릿과 상품 대상 조회를 허용하지 않는다', async () => {
    mocks.auth.isStaff = false;
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('DB 템플릿과 공개 미리보기 값을 화면으로 전달한다', async () => {
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    for (const value of ['DB 배송', 'DB 배송 안내', 'DB 반품 안내', 'DB CS', '02-000-0000']) expect(html).toContain(value);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_find_goods_for_shipping_notice_template', { target_template_id: null, search_query: '' });
  });
});
