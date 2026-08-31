import { beforeEach, describe, expect, it, vi } from 'vitest';
import { askProductQuestionAction } from './question-actions';

const USER_ID = '33333333-3333-4333-8333-333333333333';
const PDP_NEXT = '/shop/g13?qnaPage=2#qna';

const mocks = vi.hoisted(() => ({
  authState: {} as Record<string, unknown>,
  onboarded: true,
  suspended: false,
  inserts: [] as [string, unknown][],
  insertResult: { error: null } as { error: { message: string } | null },
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: async () => mocks.authState }));
/* safeNextPath·onboardingPath 는 실물을 쓴다 — next 검증이 이 액션의 안전 계약이라
   대역으로 갈아 끼우면 검증이 아니라 대역을 시험하게 된다. */
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
    from: (table: string) => ({
      insert: (payload: unknown) => {
        mocks.inserts.push([table, payload]);
        return Promise.resolve(mocks.insertResult);
      },
    }),
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

function questionForm(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  formData.set('goodId', 'g13');
  formData.set('next', PDP_NEXT);
  formData.set('body', '재입고 예정이 있나요?');
  for (const [key, value] of Object.entries(overrides)) formData.set(key, value);
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
  mocks.inserts = [];
  mocks.insertResult = { error: null };
  mocks.revalidatePath.mockReset();
});

describe('askProductQuestionAction', () => {
  /* 작성 자격 판정은 RLS insert 정책이 갖는다. 액션은 세션의 user_id 만 실어 보낸다 —
     insert grant 가 열린 컬럼도 good_id·user_id·body 뿐이다. */
  it('세션 명의로 세 컬럼만 insert 한다', async () => {
    const state = await askProductQuestionAction({}, questionForm());

    expect(mocks.inserts).toEqual([[
      'product_questions',
      { body: '재입고 예정이 있나요?', good_id: 'g13', user_id: USER_ID },
    ]]);
    expect(state.message).toBe('질문을 등록했어요. 답변이 달리면 알림으로 알려드려요.');
    expect(state.resultKey).toBeTruthy();
  });

  /* 질문은 굿즈 상세와 내 Q&A 두 곳에 동시에 나타난다. */
  it('굿즈 상세와 내 Q&A를 함께 되살린다', async () => {
    await askProductQuestionAction({}, questionForm());

    expect(mocks.revalidatePath).toHaveBeenCalledWith('/shop/g13');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/my/questions');
  });

  /* 게이트는 (b)형이다 — 폼은 비로그인에게도 보이고, 제출이 로그인으로 보낸다.
     돌아올 자리는 방금 보던 Q&A 페이지여야 한다. */
  it('비로그인 제출은 보던 Q&A 페이지를 next로 실어 로그인으로 보낸다', async () => {
    mocks.authState = { isConfigured: true, user: null, profile: null, isStaff: false };

    await expect(askProductQuestionAction({}, questionForm())).rejects.toThrow(
      `NEXT_REDIRECT:/login?next=${encodeURIComponent(PDP_NEXT)}`,
    );
    expect(mocks.inserts).toHaveLength(0);
  });

  /* next 는 로그인 리다이렉트의 목적지다 — 다른 굿즈나 외부로 태우면 열린 리다이렉트가 된다. */
  it('그 굿즈의 상세가 아닌 next는 해당 굿즈의 Q&A 탭으로 접는다', async () => {
    mocks.authState = { isConfigured: true, user: null, profile: null, isStaff: false };

    await expect(
      askProductQuestionAction({}, questionForm({ next: 'https://evil.example/steal' })),
    ).rejects.toThrow(`NEXT_REDIRECT:/login?next=${encodeURIComponent('/shop/g13?qnaPage=1#qna')}`);

    await expect(
      askProductQuestionAction({}, questionForm({ next: '/shop/g99?qnaPage=1#qna' })),
    ).rejects.toThrow(`NEXT_REDIRECT:/login?next=${encodeURIComponent('/shop/g13?qnaPage=1#qna')}`);
  });

  it('정지 계정은 정지 안내로 보낸다', async () => {
    mocks.suspended = true;

    await expect(askProductQuestionAction({}, questionForm())).rejects.toThrow(
      'NEXT_REDIRECT:/account-suspended',
    );
    expect(mocks.inserts).toHaveLength(0);
  });

  it('온보딩 전이면 온보딩으로 보낸다', async () => {
    mocks.onboarded = false;

    await expect(askProductQuestionAction({}, questionForm())).rejects.toThrow(
      `NEXT_REDIRECT:/onboarding?next=${encodeURIComponent(PDP_NEXT)}`,
    );
    expect(mocks.inserts).toHaveLength(0);
  });

  it('빈 본문은 저장을 시도하지 않는다', async () => {
    const state = await askProductQuestionAction({}, questionForm({ body: '   ' }));

    expect(state.errors?.body).toBe('질문 내용을 입력해주세요.');
    expect(mocks.inserts).toHaveLength(0);
  });

  /* 게이트를 지난 뒤 정지되면 RLS 가 막는다. 그때 "잠시 후 다시"라고 하면 사용자는
     될 때까지 다시 누른다. */
  it('RLS 거절은 계정 상태를 확인하라고 말한다', async () => {
    mocks.insertResult = {
      error: { message: 'new row violates row-level security policy for table "product_questions"' },
    };

    const state = await askProductQuestionAction({}, questionForm());

    expect(state.errors?.form).toContain('계정 상태를 확인');
    expect(state.message).toBeUndefined();
  });

  it('모르는 저장 오류는 일반 실패로 접는다', async () => {
    mocks.insertResult = { error: { message: 'connection reset' } };

    const state = await askProductQuestionAction({}, questionForm());

    expect(state.errors?.form).toContain('질문을 등록하지 못했습니다');
  });
});
