import { beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './page';
import { blankGoodsAnnouncement } from '@/lib/admin/goods-announcements';
const mocks = vi.hoisted(() => ({ access: vi.fn(), list: vi.fn(), detail: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.access }));
vi.mock('@/lib/admin/goods-announcements.server', () => ({ loadGoodsAnnouncements: mocks.list, loadGoodsAnnouncement: mocks.detail }));
vi.mock('@/components/admin/screens/GoodsAnnouncementEditor', () => ({ GoodsAnnouncementEditor: () => null }));
vi.mock('@/components/admin/screens/GoodsAnnouncementsScreen', () => ({ GoodsAnnouncementsScreen: () => null }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('not-found'); }, redirect: (href: string) => { throw new Error(`redirect:${href}`); } }));
const ID = '00000000-0000-4000-8000-000000062211';
const ACCOUNT = '00000000-0000-4000-8000-000000062210';
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ isStaff: true, user: { id: ACCOUNT } }); mocks.list.mockResolvedValue({ rows: [], total: 0 }); mocks.detail.mockResolvedValue(null); });
describe('상품 공지 라우트', () => {
  it('권한 게이트가 목록 및 상세 로딩보다 먼저 실행된다', async () => {
    mocks.access.mockRejectedValue(new Error('forbidden'));
    await expect(Page({ searchParams: Promise.resolve({ edit: ID }) })).rejects.toThrow('forbidden');
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.detail).not.toHaveBeenCalled();
  });
  it('새 공지에는 URL에 유지되는 ID를 부여하고 같은 URL 재조회는 저장 결과를 읽는다', async () => {
    await expect(Page({ searchParams: Promise.resolve({ create: '1' }) })).rejects.toThrow(/redirect:.*create=[0-9a-f-]{36}/);
    const existing = { ...blankGoodsAnnouncement(ID), revision: 1, reference: 2 };
    mocks.detail.mockResolvedValue(existing);
    const element = await Page({ searchParams: Promise.resolve({ create: ID, category: 'shipping' }) });
    expect(element.props.announcement).toEqual(existing); expect(element.props.backHref).toContain('category=shipping');
    expect(element.props.accountId).toBe(ACCOUNT); expect(element.key).toBe(`${ACCOUNT}:${ID}`);
    expect(mocks.detail).toHaveBeenCalledWith(ID, true);
  });
  it('기존 공지 편집도 화면 권한에서 확인한 계정에 묶는다', async () => {
    mocks.detail.mockResolvedValue({ ...blankGoodsAnnouncement(ID), revision: 1, reference: 2 });
    const element = await Page({ searchParams: Promise.resolve({ edit: ID }) });
    expect(element.props.accountId).toBe(ACCOUNT); expect(element.key).toBe(`${ACCOUNT}:${ID}`);
  });
  it('잘못된 상세 ID는 로더 호출 전에 거절한다', async () => {
    await expect(Page({ searchParams: Promise.resolve({ edit: 'bad' }) })).rejects.toThrow('not-found');
    expect(mocks.detail).not.toHaveBeenCalled();
  });
});
