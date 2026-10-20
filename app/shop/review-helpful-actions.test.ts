import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), active: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/participation-gate.server', () => ({ requireActiveUser: mocks.active }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
import { setReviewHelpfulAction } from './review-helpful-actions';

const reviewId = 'a6140000-0000-4000-8000-000000000001';
const request = { goodId: 'converted-good', reviewId, marked: true,
  options: { sort: 'helpful_desc', photoOnly: true, page: 2 } };
const state = { reviewId, helpfulCount: 2, helpfulByMe: true, canMarkHelpful: true };
beforeEach(() => { vi.resetAllMocks(); mocks.active.mockResolvedValue({ id: 'current-member' }); });

describe('리뷰 도움 표시 액션', () => {
  it('로그인 복귀 조건을 유지하고 현재 사용자 자격 뒤에 정확한 목표 상태만 보낸다', async () => {
    mocks.rpc.mockResolvedValue({ data: state, error: null });
    expect(await setReviewHelpfulAction(request)).toEqual({ ok: true, state });
    expect(mocks.active).toHaveBeenCalledExactlyOnceWith('/shop/converted-good?reviewSort=helpful_desc&reviewPhoto=1&reviewPage=2#reviews');
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('set_review_helpful', { p_good_id: 'converted-good', p_review_id: reviewId, p_marked: true });
    expect(mocks.revalidate).toHaveBeenCalledWith('/shop/[goodId]', 'page');
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/cs/reviews');
  });
  it('잘못된 요청과 참여 자격 거절 후 DB를 호출하지 않는다', async () => {
    expect(await setReviewHelpfulAction({ ...request, marked: 'true' })).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.active.mockRejectedValue(new Error('login redirect'));
    await expect(setReviewHelpfulAction(request)).rejects.toThrow('login redirect');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('네트워크 미확인 뒤에도 같은 true 목표로 재시도하며 뒤집기 요청을 만들지 않는다', async () => {
    mocks.rpc.mockRejectedValueOnce(new Error('response lost')).mockResolvedValueOnce({ data: state, error: null });
    expect(await setReviewHelpfulAction(request)).toMatchObject({ ok: false });
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(await setReviewHelpfulAction(request)).toEqual({ ok: true, state });
    expect(mocks.rpc.mock.calls.map(call => call[1].p_marked)).toEqual([true, true]);
  });
  it.each([
    { ...state, reviewId: 'a6140000-0000-4000-8000-000000000002' },
    { ...state, helpfulByMe: false },
    { ...state, helpfulCount: -1 },
    null,
  ])('다른 리뷰·다른 목표·잘못된 응답을 성공으로 표시하지 않는다', async (data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    expect(await setReviewHelpfulAction(request)).toMatchObject({ ok: false });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('철회도 서버의 0명·미선택 응답을 확인한 뒤 확정한다', async () => {
    const cleared = { ...state, helpfulCount: 0, helpfulByMe: false };
    mocks.rpc.mockResolvedValue({ data: cleared, error: null });
    expect(await setReviewHelpfulAction({ ...request, marked: false })).toEqual({ ok: true, state: cleared });
    expect(mocks.rpc).toHaveBeenLastCalledWith('set_review_helpful', expect.objectContaining({ p_marked: false }));
  });
});
