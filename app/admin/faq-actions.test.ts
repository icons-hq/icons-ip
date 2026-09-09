import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveFaqAction, deleteFaqAction } from './faq-actions';

const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: { id: 'staff' }, isStaff: true },
  rpc: vi.fn(), revalidatePath: vi.fn(),
}));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: () => mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
const id = '00000000-0000-4000-8000-000000000431';
function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ category: 'order', question: '배송은 언제 되나요?', answer: '주문 상세에서 배송 상태를 확인해주세요.', sortOrder: '0', published: 'true', ...overrides })) data.set(key, value);
  return data;
}
beforeEach(() => {
  mocks.auth.isStaff = true;
  mocks.rpc.mockReset().mockResolvedValue({ data: id, error: null });
  mocks.revalidatePath.mockReset();
});
describe('FAQ 운영 액션', () => {
  it('검증 오류가 있어도 질문과 답변 제출값을 돌려준다', async () => {
    const state = await saveFaqAction({}, form({ question: '  작성 중인 질문  ', answer: '' }));
    expect(state.errors?.answer).toBeTruthy();
    expect(state.values?.question).toBe('  작성 중인 질문  ');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('FAQ 운영 권한과 게시', () => {
  it('스태프가 공개 저장하고 관련 공개 표면을 갱신한다', async () => {
    const state = await saveFaqAction({}, form());
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_faq_entry', {
      target_id: null, target_category: 'order', target_question: '배송은 언제 되나요?',
      target_answer: '주문 상세에서 배송 상태를 확인해주세요.', target_sort_order: 0,
      target_published: true, expected_updated_at: null,
    });
    expect(state.message).toContain('공개');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/help');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/my/inquiries/new');
  });
  it('일반 사용자의 저장과 삭제는 RPC 전에 거절한다', async () => {
    mocks.auth.isStaff = false;
    expect((await saveFaqAction({}, form())).errors?.form).toContain('권한');
    expect((await deleteFaqAction({}, form({ id, updatedAt: '2026-09-08T01:00:00Z', confirmed: 'true' }))).errors?.form).toContain('권한');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('공개 상태와 순서를 임의 값으로 우회할 수 없다', async () => {
    const state = await saveFaqAction({}, form({ sortOrder: '-1', published: 'yes' }));
    expect(state.errors?.sortOrder).toBeTruthy();
    expect(state.errors?.published).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('저장 충돌에서는 입력값과 실패 회차를 유지하고 성공으로 알리지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'faq_conflict' } });
    const state = await saveFaqAction({ revision: 2 }, form({ id, updatedAt: '2026-09-08T01:00:00Z' }));
    expect(state.errors?.form).toContain('다른 운영자');
    expect(state.values?.answer).toBe('주문 상세에서 배송 상태를 확인해주세요.');
    expect(state.revision).toBe(3);
    expect(state.message).toBeUndefined();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
  it('확인 없는 삭제는 거절하고 확인된 버전만 삭제한다', async () => {
    const input = { id, updatedAt: '2026-09-08T01:00:00Z' };
    expect((await deleteFaqAction({}, form(input))).errors?.form).toContain('삭제 확인');
    expect(mocks.rpc).not.toHaveBeenCalled();
    const state = await deleteFaqAction({}, form({ ...input, confirmed: 'true' }));
    expect(mocks.rpc).toHaveBeenCalledWith('admin_delete_faq_entry', { target_id: id, expected_updated_at: input.updatedAt });
    expect(state.message).toContain('삭제');
  });
});
