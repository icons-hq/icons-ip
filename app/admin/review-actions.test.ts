import { beforeEach, describe, expect, it, vi } from 'vitest';
import { replyToReviewAction, setReviewStatusAction } from './review-actions';

const REVIEW_ID = '11111111-1111-4111-8111-111111111111';
const REPORT_ID = '22222222-2222-4222-8222-222222222222';

const mocks = vi.hoisted(() => ({
  adminState: {
    isConfigured: true,
    user: { id: 'staff-1', email: 'staff@icons.gg' },
    role: 'staff',
    isStaff: true,
  } as {
    isConfigured: boolean;
    user: { id: string; email: string | null } | null;
    role: 'user' | 'staff' | 'admin' | null;
    isStaff: boolean;
  },
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: () => mocks.adminState }));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

function form(entries: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) formData.set(key, value);
  return formData;
}

beforeEach(() => {
  mocks.adminState = {
    isConfigured: true,
    user: { id: 'staff-1', email: 'staff@icons.gg' },
    role: 'staff',
    isStaff: true,
  };
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  mocks.revalidatePath.mockReset();
});

describe('replyToReviewAction', () => {
  it('답글을 RPC 한 번으로 저장한다', async () => {
    const state = await replyToReviewAction({}, form({
      reviewId: REVIEW_ID,
      reply: '불편을 드려 죄송합니다. 교환을 도와드리겠습니다.',
    }));

    expect(mocks.rpc).toHaveBeenCalledWith('admin_reply_to_review', {
      target_reply: '불편을 드려 죄송합니다. 교환을 도와드리겠습니다.',
      target_review_id: REVIEW_ID,
    });
    expect(state.message).toBeTruthy();
    expect(state.resultKey).toBeTruthy();
  });

  it('비스태프는 RPC에 닿지 않는다', async () => {
    mocks.adminState = {
      isConfigured: true,
      user: { id: 'fan-1', email: 'fan@icons.gg' },
      role: 'user',
      isStaff: false,
    };

    const state = await replyToReviewAction({}, form({ reviewId: REVIEW_ID, reply: '안녕하세요' }));

    expect(state.errors?.form).toBe('관리자 권한이 필요합니다.');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('빈 답글은 보내지 않는다', async () => {
    const state = await replyToReviewAction({}, form({ reviewId: REVIEW_ID, reply: '' }));

    expect(state.errors?.reply).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('setReviewStatusAction', () => {
  /* 사유 없는 비공개는 나중에 아무도 해제하지 못한다. DB도 같은 규칙을 강제한다. */
  it('사유 없는 블라인드는 RPC에 닿지 않는다', async () => {
    const state = await setReviewStatusAction({}, form({
      reviewId: REVIEW_ID,
      status: 'hidden',
      reason: '',
    }));

    expect(state.errors?.reason).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('블라인드는 사유와 연결 신고를 함께 넘긴다', async () => {
    await setReviewStatusAction({}, form({
      reviewId: REVIEW_ID,
      status: 'hidden',
      reason: '구매하지 않은 사용자로 의심',
      reportId: REPORT_ID,
    }));

    expect(mocks.rpc).toHaveBeenCalledWith('admin_set_review_status', {
      target_reason: '구매하지 않은 사용자로 의심',
      target_report_id: REPORT_ID,
      target_review_id: REVIEW_ID,
      target_status: 'hidden',
    });
  });

  /* 해제에는 사유가 없다 — 남아 있던 사유를 그대로 실어 보내면 해제 이력에
     블라인드 사유가 붙어 무엇을 한 것인지 뒤집힌다. */
  it('해제는 사유를 비워 보낸다', async () => {
    await setReviewStatusAction({}, form({
      reviewId: REVIEW_ID,
      status: 'visible',
      reason: '이전 블라인드 사유',
    }));

    expect(mocks.rpc).toHaveBeenCalledWith('admin_set_review_status', expect.objectContaining({
      target_reason: null,
      target_status: 'visible',
    }));
  });

  it('모르는 상태는 거절한다', async () => {
    const state = await setReviewStatusAction({}, form({ reviewId: REVIEW_ID, status: 'deleted' }));

    expect(state.errors?.form).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  /* 신고 대상이 어긋나면 DB가 막는다. 그 오류를 일반 실패로 접으면 운영자가
     "왜 안 되는지"를 알 수 없다. */
  it('신고 대상 불일치는 이유를 그대로 옮긴다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'report_target_mismatch' } });

    const state = await setReviewStatusAction({}, form({
      reviewId: REVIEW_ID,
      status: 'hidden',
      reason: '허위 후기',
      reportId: REPORT_ID,
    }));

    expect(state.errors?.form).toContain('이 리뷰를 가리키지 않습니다');
  });

  it('블라인드 성공은 모더레이션 화면도 다시 그리게 한다', async () => {
    await setReviewStatusAction({}, form({
      reviewId: REVIEW_ID,
      status: 'hidden',
      reason: '광고성 내용',
    }));

    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/cs/reviews');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/community/moderation');
  });
});
