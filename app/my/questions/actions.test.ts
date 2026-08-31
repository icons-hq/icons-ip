import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteMyProductQuestionAction } from './actions';

const USER_ID = '33333333-3333-4333-8333-333333333333';
const QUESTION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const mocks = vi.hoisted(() => ({
  authState: {} as Record<string, unknown>,
  onboarded: true,
  suspended: false,
  /** [table, operation, column, value] — 액션이 건 조건만 기록한다. */
  filters: [] as [string, string, string, unknown][],
  deleted: [] as string[],
  lookupResult: { data: { good_id: 'g13' } as { good_id: string } | null, error: null },
  /* vi.hoisted 는 상수 선언보다 먼저 돈다 — 여기서는 id 리터럴을 그대로 쓴다. */
  deleteResult: {
    data: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }] as unknown,
    error: null as { message: string } | null,
  },
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: async () => mocks.authState }));
/* 게이트 판정은 이 액션의 안전 계약이라 실물을 쓴다(question-actions 테스트와 같은 관례). */
vi.mock('@/lib/auth/onboarding', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/onboarding')>();
  return {
    ...actual,
    isAccountSuspended: () => mocks.suspended,
    isOnboarded: () => mocks.onboarded,
  };
});
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from(table: string) {
      let operation = 'select';
      const query = {
        select() {
          return query;
        },
        delete() {
          operation = 'delete';
          mocks.deleted.push(table);
          return query;
        },
        eq(column: string, value: unknown) {
          mocks.filters.push([table, operation, column, value]);
          return query;
        },
        maybeSingle: () => Promise.resolve(mocks.lookupResult),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(mocks.deleteResult).then(resolve),
      };
      return query;
    },
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

function deleteForm(questionId: string = QUESTION_ID) {
  const formData = new FormData();
  formData.set('questionId', questionId);
  return formData;
}

beforeEach(() => {
  mocks.authState = {
    isConfigured: true,
    user: { id: USER_ID, email: 'fan@icons.gg' },
    profile: {},
    isStaff: false,
  };
  mocks.onboarded = true;
  mocks.suspended = false;
  mocks.filters = [];
  mocks.deleted = [];
  mocks.lookupResult = { data: { good_id: 'g13' }, error: null };
  mocks.deleteResult = { data: [{ id: QUESTION_ID }], error: null };
  mocks.revalidatePath.mockReset();
});

describe('deleteMyProductQuestionAction', () => {
  /* 소유권은 RLS delete 정책이 판정한다. 액션이 user_id 조건을 한 번 더 걸면 같은
     규칙이 두 곳에 살고, 나중에 한쪽만 고쳐진다. */
  it('id 조건만 걸어 삭제하고 소유권 조건은 정책에 맡긴다', async () => {
    const state = await deleteMyProductQuestionAction({}, deleteForm());

    expect(mocks.deleted).toEqual(['product_questions']);
    expect(mocks.filters).toContainEqual(['product_questions', 'delete', 'id', QUESTION_ID]);
    expect(mocks.filters.some(([, , column]) => column === 'user_id')).toBe(false);
    expect(state).toEqual({ status: 'success', message: '질문을 삭제했어요.' });
  });

  /* 질문은 두 곳에 걸려 있다 — 내 Q&A 목록과 굿즈 상세의 Q&A 탭. */
  it('내 목록과 대상 굿즈 상세를 함께 되살린다', async () => {
    await deleteMyProductQuestionAction({}, deleteForm());

    expect(mocks.revalidatePath).toHaveBeenCalledWith('/my/questions');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/shop/g13');
  });

  /* 행이 사라진 뒤에는 어느 굿즈였는지 알 수 없다 — 삭제 전에 읽어 둔다. */
  it('굿즈를 못 읽었으면 목록만 되살린다', async () => {
    mocks.lookupResult = { data: null, error: null };

    await deleteMyProductQuestionAction({}, deleteForm());

    expect(mocks.revalidatePath).toHaveBeenCalledWith('/my/questions');
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
  });

  /* 0행은 남의 글이거나 이미 지워진 글이다. 성공으로 그리면 사용자는 사라지지 않은
     줄을 보며 "삭제했어요"를 읽는다. */
  it('지워진 행이 없으면 실패로 답한다', async () => {
    mocks.deleteResult = { data: [], error: null };

    const state = await deleteMyProductQuestionAction({}, deleteForm());

    expect(state.status).toBe('error');
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('삭제도 보호 액션이라 비로그인은 내 Q&A를 next로 실어 로그인으로 보낸다', async () => {
    mocks.authState = { isConfigured: true, user: null, profile: null, isStaff: false };

    await expect(deleteMyProductQuestionAction({}, deleteForm())).rejects.toThrow(
      `NEXT_REDIRECT:/login?next=${encodeURIComponent('/my/questions')}`,
    );
    expect(mocks.deleted).toHaveLength(0);
  });

  it('정지 계정은 정지 안내로 보낸다', async () => {
    mocks.suspended = true;

    await expect(deleteMyProductQuestionAction({}, deleteForm())).rejects.toThrow(
      'NEXT_REDIRECT:/account-suspended',
    );
    expect(mocks.deleted).toHaveLength(0);
  });

  it('온보딩 전이면 온보딩으로 보낸다', async () => {
    mocks.onboarded = false;

    await expect(deleteMyProductQuestionAction({}, deleteForm())).rejects.toThrow(
      `NEXT_REDIRECT:/onboarding?next=${encodeURIComponent('/my/questions')}`,
    );
    expect(mocks.deleted).toHaveLength(0);
  });

  it('id 꼴이 아니면 삭제를 시도하지 않는다', async () => {
    const state = await deleteMyProductQuestionAction({}, deleteForm('not-a-uuid'));

    expect(state.status).toBe('error');
    expect(mocks.deleted).toHaveLength(0);
  });

  /* 게이트를 지난 뒤 봉인·정지되면 정책이 막는다. "잠시 후 다시"라고 하면 사용자는
     될 때까지 다시 누른다. */
  it('정책 거절은 계정 상태를 확인하라고 말한다', async () => {
    mocks.deleteResult = {
      data: null,
      error: { message: 'new row violates row-level security policy for table "product_questions"' },
    };

    const state = await deleteMyProductQuestionAction({}, deleteForm());

    expect(state.message).toContain('계정 상태를 확인');
  });

  it('모르는 오류는 일반 실패로 접는다', async () => {
    mocks.deleteResult = { data: null, error: { message: 'connection reset' } };

    const state = await deleteMyProductQuestionAction({}, deleteForm());

    expect(state.message).toContain('질문을 삭제하지 못했어요');
  });
});
