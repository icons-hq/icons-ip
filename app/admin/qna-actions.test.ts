const { legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  answerProductQuestionAction,
  setProductQuestionVisibilityAction,
} from './qna-actions';

const QUESTION_ID = '55555555-5555-4555-8555-555555555555';

const mocks = vi.hoisted(() => ({
  adminState: {
    isConfigured: true,
    user: { id: '33333333-3333-4333-8333-333333333333', email: 'staff@icons.gg' },
    role: 'staff',
    isStaff: true, operatorAccess: legacyOperatorAccessFixture(),
  } as {
    isConfigured: boolean;
    user: { id: string; email: string | null } | null;
    role: 'user' | 'staff' | 'admin' | null;
    isStaff: boolean; operatorAccess?: ReturnType<typeof legacyOperatorAccessFixture>;
  },
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: () => mocks.adminState }));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  unstable_rethrow: vi.fn(),
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

function form(entries: Record<string, string>) {
  const formData = new FormData();
  formData.set('operationId','44444444-4444-4444-8444-444444444444');
  formData.set('accountId','33333333-3333-4333-8333-333333333333');
  formData.set('expectedRevision','7');
  for (const [key, value] of Object.entries(entries)) formData.set(key, value);
  return formData;
}

beforeEach(() => {
  mocks.adminState = {
    isConfigured: true,
    user: { id: '33333333-3333-4333-8333-333333333333', email: 'staff@icons.gg' },
    role: 'staff',
    isStaff: true, operatorAccess: legacyOperatorAccessFixture(),
  };
  mocks.rpc.mockReset();
  mocks.rpc.mockImplementation(async (name, args) => name === 'admin_save_cs_reply' ? { data: {
    operationId: args.p_operation_id, accountId: args.p_actor_id, surface: args.p_surface, id: args.p_target_id,
    body: args.p_body, expectedRevision: args.p_expected_revision, revision: String(BigInt(args.p_expected_revision)+BigInt(1)),
    changed: true, savedAt: '2026-10-14T00:00:00Z',
  }, error: null } : { data: null, error: null });
  mocks.revalidatePath.mockReset();
});

describe('answerProductQuestionAction', () => {
  it('답변을 RPC 한 번으로 저장한다', async () => {
    const state = await answerProductQuestionAction({}, form({
      questionId: QUESTION_ID,
      answer: '235mm 까지 나옵니다.',
    }));

    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_cs_reply', {
      p_operation_id: '44444444-4444-4444-8444-444444444444', p_actor_id: '33333333-3333-4333-8333-333333333333', p_surface: 'product_question', p_expected_revision: '7',
      p_body: '235mm 까지 나옵니다.',
      p_target_id: QUESTION_ID,
    });
    expect(state.message).toBeTruthy();
    expect(state.resultKey).toBeTruthy();
  });

  it('비스태프는 RPC 에 닿지 않는다', async () => {
    mocks.adminState = {
      isConfigured: true,
      user: { id: 'fan-1', email: 'fan@icons.gg' },
      role: 'user',
      isStaff: false,
    };

    const state = await answerProductQuestionAction({}, form({
      questionId: QUESTION_ID,
      answer: '안녕하세요',
    }));

    expect(state.errors?.form).toBe('관리자 권한이 필요합니다.');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('빈 답변은 보내지 않는다', async () => {
    const state = await answerProductQuestionAction({}, form({
      questionId: QUESTION_ID,
      answer: '   ',
    }));

    expect(state.errors?.answer).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('2000자를 넘는 답변은 보내지 않는다', async () => {
    const state = await answerProductQuestionAction({}, form({
      questionId: QUESTION_ID,
      answer: 'ㄱ'.repeat(2001),
    }));

    expect(state.errors?.answer).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('질문 id 가 UUID 가 아니면 거절한다', async () => {
    const state = await answerProductQuestionAction({}, form({
      questionId: 'question-1',
      answer: '답변',
    }));

    expect(state.errors?.form).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  /* 작성자가 지운 질문은 행이 없다. 일반 실패로 접으면 운영자가 같은 답변을
     계속 다시 시도한다. */
  it('사라진 질문은 이유를 그대로 옮긴다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0002', message: 'cs_reply_target_not_found' } });

    const state = await answerProductQuestionAction({}, form({
      questionId: QUESTION_ID,
      answer: '답변',
    }));

    expect(state.errors?.form).toContain('삭제했을 수 있습니다');
  });

  /* Q&A 는 굿즈 상세에 공개로 붙는다 — 상세가 옛 목록을 보여 주면 운영자는
     저장이 안 된 줄 알고 같은 답변을 또 넣는다(그때마다 알림이 다시 간다). */
  it('저장 성공은 콘솔과 굿즈 상세를 다시 그리게 한다', async () => {
    await answerProductQuestionAction({}, form({
      questionId: QUESTION_ID,
      answer: '답변',
    }));

    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/cs/qna');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/shop/[goodId]', 'page');
  });

  it('모르는 오류는 일반 실패로 접는다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'deadlock detected' } });

    const state = await answerProductQuestionAction({}, form({
      questionId: QUESTION_ID,
      answer: '답변',
    }));

    expect(state.errors?.form).toContain('저장 결과를 확인하지 못했습니다');
  });
});

describe('setProductQuestionVisibilityAction', () => {
  it('비노출은 hidden=true 로 보낸다', async () => {
    const state = await setProductQuestionVisibilityAction({}, form({
      questionId: QUESTION_ID,
      hidden: 'true',
    }));

    expect(mocks.rpc).toHaveBeenCalledWith('admin_set_product_question_visibility', {
      target_hidden: true,
      target_question_id: QUESTION_ID,
    });
    expect(state.message).toContain('비노출');
  });

  it('복원은 hidden=false 로 보낸다', async () => {
    const state = await setProductQuestionVisibilityAction({}, form({
      questionId: QUESTION_ID,
      hidden: 'false',
    }));

    expect(mocks.rpc).toHaveBeenCalledWith(
      'admin_set_product_question_visibility',
      expect.objectContaining({ target_hidden: false }),
    );
    expect(state.message).toContain('다시 공개');
  });

  it('모르는 상태 값은 거절한다', async () => {
    const state = await setProductQuestionVisibilityAction({}, form({
      questionId: QUESTION_ID,
      hidden: 'deleted',
    }));

    expect(state.errors?.form).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('비스태프는 RPC 에 닿지 않는다', async () => {
    mocks.adminState = {
      isConfigured: true,
      user: { id: 'fan-1', email: 'fan@icons.gg' },
      role: 'user',
      isStaff: false,
    };

    const state = await setProductQuestionVisibilityAction({}, form({
      questionId: QUESTION_ID,
      hidden: 'true',
    }));

    expect(state.errors?.form).toBe('관리자 권한이 필요합니다.');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('상태 변경도 굿즈 상세를 다시 그리게 한다', async () => {
    await setProductQuestionVisibilityAction({}, form({
      questionId: QUESTION_ID,
      hidden: 'true',
    }));

    expect(mocks.revalidatePath).toHaveBeenCalledWith('/shop/[goodId]', 'page');
  });
});
