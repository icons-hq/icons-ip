const { configuredOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  editor: vi.fn(() => null), list: vi.fn(() => null),
  loadList: vi.fn(), loadOptions: vi.fn(),
}));
vi.mock('@/lib/admin/guard.server', () => ({
  requireAdminScreenAccess: vi.fn(async () => ({ user: { id: '11111111-1111-4111-8111-111111111111' }, operatorAccess: configuredOperatorAccessFixture('primary'), isStaff: true, role: 'staff' })),
}));
vi.mock('@/lib/admin/discount-promotions.server', () => ({ loadDiscountPromotionList: mocks.loadList, loadDiscountPromotionTargetOptions: mocks.loadOptions }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }) }));
vi.mock('@/components/admin/screens/DiscountPromotionEditorScreen', () => ({ DiscountPromotionEditorScreen: mocks.editor }));
vi.mock('@/components/admin/screens/DiscountPromotionListScreen', () => ({ DiscountPromotionListScreen: mocks.list }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));

import NewDiscountPromotionPage from './new/page';
import AdminDiscountPromotionsPage from './page';

const options = {
  campaigns: [{ id: 'qa-open', title: 'QA 오픈 기획전', status: 'published', startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-30T00:00:00Z', goodsCount: 5 }],
  ips: [{ id: 'qa-gamma', title: 'QA 감마', goodsCount: 3 }],
};
const props = <T,>(element: unknown) => (element as { props: T }).props;
beforeEach(() => { vi.clearAllMocks(); mocks.loadOptions.mockResolvedValue(options); });

/* QA1 MD: 캠페인 편집에서 연 새 프로모션만 취소·돌아가기가 그 캠페인 편집으로 간다. 나머지는 프로모션 목록이다. */
describe('새 할인 프로모션의 돌아갈 곳', () => {
  it.each([
    ['campaign=qa-open&from=campaign', { href: '/admin/display/campaigns?campaign=qa-open', label: '캠페인 편집으로' }],
    ['campaign=qa-open', { href: '/admin/sales/discount-promotions?campaign=qa-open', label: '목록으로' }],
    ['campaign=deleted&from=campaign', { href: '/admin/sales/discount-promotions', label: '목록으로' }],
    ['ip=qa-gamma', { href: '/admin/sales/discount-promotions', label: '목록으로' }],
  ])('%s', async (query, returnTo) => {
    const element = await NewDiscountPromotionPage({ searchParams: Promise.resolve(Object.fromEntries(new URLSearchParams(query))) });
    expect(props<{ returnTo: unknown }>(element).returnTo).toEqual(returnTo);
  });
});

/* QA1 MD: 상세 [목록으로] 뒤 기획전 필터 안내가 내부 ID 대신 기획전 제목으로 보인다. */
describe('기획전으로 거른 할인 프로모션 목록', () => {
  const row = { target: { kind: 'campaign', id: 'qa-open', label: 'QA 오픈 기획전(목록)' } };
  it('목록에 그 기획전 행이 있으면 그 제목을, 없으면 대상 목록의 제목을 쓴다', async () => {
    mocks.loadList.mockResolvedValueOnce({ checkedAt: '2026-11-12T00:00:00Z', total: 1, rows: [row] });
    const listed = await AdminDiscountPromotionsPage({ searchParams: Promise.resolve({ campaign: 'qa-open' }) });
    expect(props<{ campaignTitle: string | null }>(listed).campaignTitle).toBe('QA 오픈 기획전(목록)');
    expect(mocks.loadOptions).not.toHaveBeenCalled();
    mocks.loadList.mockResolvedValueOnce({ checkedAt: '2026-11-12T00:00:00Z', total: 0, rows: [] });
    const empty = await AdminDiscountPromotionsPage({ searchParams: Promise.resolve({ campaign: 'qa-open' }) });
    expect(props<{ campaignTitle: string | null }>(empty).campaignTitle).toBe('QA 오픈 기획전');
  });
  it('제목을 못 찾으면 ID 안내로 두고, 거르지 않으면 대상 목록을 읽지 않는다', async () => {
    mocks.loadList.mockResolvedValue({ checkedAt: '2026-11-12T00:00:00Z', total: 0, rows: [] });
    mocks.loadOptions.mockRejectedValueOnce(new Error('프로모션 대상 목록을 불러오지 못했습니다.'));
    expect(props<{ campaignTitle: string | null }>(await AdminDiscountPromotionsPage({ searchParams: Promise.resolve({ campaign: 'qa-open' }) })).campaignTitle).toBeNull();
    mocks.loadOptions.mockClear();
    expect(props<{ campaignTitle: string | null }>(await AdminDiscountPromotionsPage({ searchParams: Promise.resolve({}) })).campaignTitle).toBeNull();
    expect(mocks.loadOptions).not.toHaveBeenCalled();
  });
});
