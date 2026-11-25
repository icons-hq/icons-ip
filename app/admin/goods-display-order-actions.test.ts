const { legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), slot: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
vi.mock('@/lib/admin/goods-display-order.server', () => ({
  GOODS_DISPLAY_ORDER_LOOKUP_ERROR: '진열 순서를 불러오지 못했습니다. 잠시 뒤 다시 열어주세요.',
  listGoodsDisplayOrder: mocks.list, readGoodsDisplayOrderSlot: mocks.slot,
}));
import { listGoodsDisplayOrderAction, readGoodsDisplayOrderSlotAction } from './goods-display-order-actions';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'staff1' }, isStaff: true, operatorAccess: legacyOperatorAccessFixture(), role: 'staff' });
});

describe('진열 순서 읽기 액션', () => {
  it('운영자가 아니면 읽지 않는다', async () => {
    mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'user1' }, isStaff: false, role: 'user' });
    expect(await listGoodsDisplayOrderAction({ query: '', page: 1 })).toMatchObject({ ok: false });
    expect(await readGoodsDisplayOrderSlotAction({ order: 1, goodId: null })).toMatchObject({ ok: false });
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.slot).not.toHaveBeenCalled();
  });

  it('번호를 적는 동안의 확인은 로그인이 끝나도 화면을 로그인으로 옮기지 않고 거절만 한다', async () => {
    /* next/navigation을 위처럼 막아 두었으니, 이동(redirect)을 부르면 이 시험이 오류로 끝난다. */
    mocks.auth.mockResolvedValue({ isConfigured: true, user: null, isStaff: false, role: 'user' });
    expect(await readGoodsDisplayOrderSlotAction({ order: 1, goodId: null })).toMatchObject({ ok: false });
    expect(mocks.slot).not.toHaveBeenCalled();
  });

  it('목록은 확인한 조건(앞뒤 공백을 뗀 검색어와 쪽)으로만 읽는다', async () => {
    const page = { rows: [], total: 0, page: 1, pageSize: 20 };
    mocks.list.mockResolvedValue(page);
    expect(await listGoodsDisplayOrderAction({ query: ' 키링 ', page: 2, extra: 'x' })).toEqual({ ok: true, data: page });
    expect(mocks.list).toHaveBeenCalledWith({ query: '키링', page: 2 });
  });

  it('조건의 모양이 틀리면 읽지 않고 고칠 방법을 알린다', async () => {
    expect(await listGoodsDisplayOrderAction({ query: '', page: 0 })).toEqual({ ok: false, error: '조회 조건을 확인해주세요.' });
    expect(await readGoodsDisplayOrderSlotAction({ order: -1, goodId: null })).toEqual({ ok: false, error: '조회 조건을 확인해주세요.' });
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.slot).not.toHaveBeenCalled();
  });

  it('읽다가 실패하면 서버 내용은 숨기고 다시 열라고 알린다', async () => {
    mocks.list.mockRejectedValue(new Error('relation "goods" does not exist'));
    expect(await listGoodsDisplayOrderAction({ query: '', page: 1 })).toEqual({ ok: false, error: '진열 순서를 불러오지 못했습니다. 잠시 뒤 다시 열어주세요.' });
    mocks.slot.mockRejectedValue(new Error('boom'));
    expect(await readGoodsDisplayOrderSlotAction({ order: 1, goodId: 'hw-1' })).toEqual({ ok: false, error: '진열 순서를 불러오지 못했습니다. 잠시 뒤 다시 열어주세요.' });
  });

  it('번호를 쓰는 상품은 번호와 지금 편집 중인 상품을 넘겨 읽는다', async () => {
    const slot = { order: 4, names: ['키링'], total: 1 };
    mocks.slot.mockResolvedValue(slot);
    expect(await readGoodsDisplayOrderSlotAction({ order: 4, goodId: 'hw-1' })).toEqual({ ok: true, slot });
    expect(mocks.slot).toHaveBeenCalledWith(4, 'hw-1');
  });
});
