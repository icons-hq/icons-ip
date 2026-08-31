import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAdminProductQuestionConsoleData } from './product-questions.server';

const QUESTION_ROW = {
  id: '55555555-5555-4555-8555-555555555555',
  good_id: 'g13',
  user_id: '77777777-7777-4777-8777-777777777777',
  body: '사이즈가 궁금해요',
  status: 'visible',
  answer_body: null as string | null,
  answered_at: null as string | null,
  answered_by: null as string | null,
  created_at: '2026-08-31T02:00:00.000Z',
};

interface RecordedCall {
  table: string;
  select: string;
  head: boolean;
  filters: string[];
  range: [number, number] | null;
}

const mocks = vi.hoisted(() => ({
  calls: [] as RecordedCall[],
  questions: [] as Array<Record<string, unknown>>,
  questionCount: 0,
  questionError: null as { message: string } | null,
  goods: [] as Array<Record<string, unknown>>,
  profiles: [] as Array<Record<string, unknown>>,
  profileError: null as { message: string } | null,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    from: (table: string) => {
      const call: RecordedCall = { table, select: '', head: false, filters: [], range: null };
      mocks.calls.push(call);

      const result = () => {
        if (table === 'goods') return { data: mocks.goods, error: null, count: null };
        if (table === 'public_profiles') {
          return { data: mocks.profiles, error: mocks.profileError, count: null };
        }
        return {
          data: call.head ? null : mocks.questions,
          error: mocks.questionError,
          count: mocks.questionCount,
        };
      };

      /* Supabase 질의 빌더는 어느 단계에서든 await 될 수 있다(head 집계는 range 없이
         끝난다). 그래서 가짜도 thenable 이어야 한다. */
      const query = {
        select(value: string, options?: { head?: boolean }) {
          call.select = value;
          call.head = Boolean(options?.head);
          return query;
        },
        eq(column: string, value: string) {
          call.filters.push(`eq:${column}=${value}`);
          return query;
        },
        is(column: string, value: null) {
          call.filters.push(`is:${column}=${String(value)}`);
          return query;
        },
        not(column: string, operator: string, value: null) {
          call.filters.push(`not:${column} ${operator} ${String(value)}`);
          return query;
        },
        in(column: string, ids: string[]) {
          call.filters.push(`in:${column}=${ids.join(',')}`);
          return query;
        },
        order() {
          return query;
        },
        range(from: number, to: number) {
          call.range = [from, to];
          return query;
        },
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve(result()).then(resolve);
        },
      };
      return query;
    },
  }),
}));

function listCall() {
  return mocks.calls.find((call) => call.table === 'product_questions' && !call.head);
}

function countCalls() {
  return mocks.calls.filter((call) => call.table === 'product_questions' && call.head);
}

beforeEach(() => {
  mocks.calls = [];
  mocks.questions = [QUESTION_ROW];
  mocks.questionCount = 1;
  mocks.questionError = null;
  mocks.goods = [{ id: 'g13', name: '아크릴 블록' }];
  mocks.profiles = [{ id: QUESTION_ROW.user_id, nickname: '팬일호' }];
  mocks.profileError = null;
});

describe('getAdminProductQuestionConsoleData', () => {
  it('굿즈 이름과 작성자 닉네임을 붙여 행을 만든다', async () => {
    const data = await getAdminProductQuestionConsoleData({ status: 'all', page: 1 });

    expect(data.rows).toEqual([expect.objectContaining({
      id: QUESTION_ROW.id,
      goodId: 'g13',
      goodName: '아크릴 블록',
      authorName: '팬일호',
      hidden: false,
      answerBody: null,
      answeredByName: null,
    })]);
    expect(data.total).toBe(1);
    expect(data.pageSize).toBe(20);
  });

  it('페이지 크기만큼만 읽는다', async () => {
    await getAdminProductQuestionConsoleData({ status: 'all', page: 2 });

    expect(listCall()?.range).toEqual([20, 39]);
  });

  /* 미답변 큐는 블라인드된 글을 뺀다 — 내려간 질문에 답을 다는 것은 큐가 시키는
     일이 아니고, DB 부분 인덱스도 같은 조건으로 좁혀져 있다. */
  it('미답변 필터는 공개 상태의 무답변 질문만 본다', async () => {
    await getAdminProductQuestionConsoleData({ status: 'unanswered', page: 1 });

    expect(listCall()?.filters).toEqual(['is:answer_body=null', 'eq:status=visible']);
  });

  it('답변 완료 필터는 답변이 있는 질문만 본다', async () => {
    await getAdminProductQuestionConsoleData({ status: 'answered', page: 1 });

    expect(listCall()?.filters).toEqual(['not:answer_body is null']);
  });

  it('비노출 필터는 블라인드된 질문만 본다', async () => {
    await getAdminProductQuestionConsoleData({ status: 'hidden', page: 1 });

    expect(listCall()?.filters).toEqual(['eq:status=hidden']);
  });

  it('상태별 집계를 head 질의 네 번으로 센다', async () => {
    mocks.questionCount = 7;

    const data = await getAdminProductQuestionConsoleData({ status: 'all', page: 1 });

    expect(countCalls()).toHaveLength(4);
    expect(data.counts).toEqual({ total: 7, unanswered: 7, answered: 7, hidden: 7 });
  });

  it('답변자 닉네임도 같은 조회로 채운다', async () => {
    mocks.questions = [{
      ...QUESTION_ROW,
      answer_body: '235mm 입니다',
      answered_at: '2026-08-31T05:00:00.000Z',
      answered_by: '88888888-8888-4888-8888-888888888888',
    }];
    mocks.profiles = [
      { id: QUESTION_ROW.user_id, nickname: '팬일호' },
      { id: '88888888-8888-4888-8888-888888888888', nickname: '운영자A' },
    ];

    const data = await getAdminProductQuestionConsoleData({ status: 'all', page: 1 });

    expect(data.rows[0].answeredByName).toBe('운영자A');
    const profileCall = mocks.calls.find((call) => call.table === 'public_profiles');
    expect(profileCall?.filters[0]).toContain('88888888-8888-4888-8888-888888888888');
  });

  /* 닉네임을 못 읽어도 목록은 떠야 한다 — 작성자 이름 하나가 큐 전체를 닫으면 안 된다. */
  it('작성자 조회가 실패하면 fan_ 축약으로 접는다', async () => {
    mocks.profileError = { message: 'permission denied' };

    const data = await getAdminProductQuestionConsoleData({ status: 'all', page: 1 });

    expect(data.rows[0].authorName).toBe('fan_777777');
  });

  it('굿즈 이름을 못 읽으면 id 라도 보여 준다', async () => {
    mocks.goods = [];

    const data = await getAdminProductQuestionConsoleData({ status: 'all', page: 1 });

    expect(data.rows[0].goodName).toBe('g13');
  });

  it('목록 조회 실패는 화면이 아니라 로더에서 터뜨린다', async () => {
    mocks.questionError = { message: 'permission denied' };

    await expect(getAdminProductQuestionConsoleData({ status: 'all', page: 1 }))
      .rejects.toThrow('Failed to load product questions');
  });
});
