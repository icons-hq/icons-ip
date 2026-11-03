import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGoodQuestions, loadMyQuestions } from './product-questions.server';

const USER_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_ID = '44444444-4444-4444-8444-444444444444';
const QUESTION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

interface TableResult {
  data: unknown;
  error: { message: string } | null;
  count?: number | null;
}

const mocks = vi.hoisted(() => ({
  configured: true,
  tables: {} as Record<string, TableResult>,
  rpcResult: { data: null, error: null } as { data: unknown; error: { message: string } | null },
  rpcCalls: [] as [string, Record<string, unknown>][],
  filters: [] as [string, string, unknown][],
  ranges: [] as [string, number, number][],
  selects: [] as [string, string][],
  user: null as { id: string } | null,
}));

vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: () => ({ isConfigured: mocks.configured }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => (mocks.user
        ? { data: { user: mocks.user }, error: null }
        : { data: { user: null }, error: { message: 'no session' } }),
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      mocks.rpcCalls.push([name, args]);
      return mocks.rpcResult;
    },
    from(table: string) {
      const result = () => mocks.tables[table] ?? { data: null, error: null };
      const query = {
        select: (columns: string) => {
          mocks.selects.push([table, columns]);
          return query;
        },
        eq: (column: string, value: unknown) => {
          mocks.filters.push([table, column, value]);
          return query;
        },
        in: (column: string, value: unknown) => {
          mocks.filters.push([table, column, value]);
          return Promise.resolve(result());
        },
        order: () => query,
        range: (from: number, to: number) => {
          mocks.ranges.push([table, from, to]);
          return Promise.resolve(result());
        },
        then: (resolve: (value: TableResult) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return query;
    },
  }),
}));

function questionRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: QUESTION_ID,
    good_id: 'g13',
    user_id: USER_ID,
    body: '재입고 예정이 있나요?',
    status: 'visible',
    is_secret: false,
    answer_body: null,
    answered_at: null,
    created_at: '2026-08-30T01:00:00.000Z',
    ...overrides,
  };
}

/* good_product_questions 가 돌려주는 읽을 수 있는 줄. */
function listRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: QUESTION_ID,
    goodId: 'g13',
    userId: USER_ID,
    body: '재입고 예정이 있나요?',
    status: 'visible',
    isSecret: false,
    masked: false,
    answered: false,
    answerBody: null,
    answeredAt: null,
    createdAt: '2026-08-30T01:00:00+00:00',
    ...overrides,
  };
}

/* DB 가 가린 비밀글 줄 — 본문·답변·작성자가 null 이다. */
function maskedRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    goodId: 'g13',
    userId: null,
    body: null,
    status: 'visible',
    isSecret: true,
    masked: true,
    answered: true,
    answerBody: null,
    answeredAt: null,
    createdAt: '2026-08-29T01:00:00+00:00',
    ...overrides,
  };
}

beforeEach(() => {
  mocks.configured = true;
  mocks.tables = {};
  mocks.rpcResult = { data: null, error: null };
  mocks.rpcCalls = [];
  mocks.filters = [];
  mocks.ranges = [];
  mocks.selects = [];
  mocks.user = { id: USER_ID };
});

describe('loadGoodQuestions', () => {
  /* 공개 목록은 테이블이 아니라 RPC 로 읽는다 — 테이블 RLS 는 남의 비밀글 행을 아예 빼는데,
     목록은 그 행도 자리를 지켜야 한다. 공개 상태 조건과 가림 판정은 RPC 본문이 갖는다. */
  it('공개 목록 RPC 로 굿즈와 페이지 범위를 넘기고 건수를 그대로 쓴다', async () => {
    mocks.rpcResult = {
      data: {
        count: 23,
        rows: [listRow({ answered: true, answerBody: '다음 주 재입고됩니다.', answeredAt: '2026-08-31T02:00:00+00:00' })],
      },
      error: null,
    };
    mocks.tables.public_profiles = { data: [{ id: USER_ID, nickname: '아이콘즈팬' }], error: null };

    const section = await loadGoodQuestions('g13', { page: 2 });

    expect(mocks.rpcCalls).toEqual([[
      'good_product_questions',
      { target_good_id: 'g13', target_limit: 10, target_offset: 10 },
    ]]);
    expect(mocks.selects.some(([table]) => table === 'product_questions')).toBe(false);
    expect(section.count).toBe(23);
    expect(section.page).toBe(2);
    expect(section.pageCount).toBe(3);
    expect(section.questions[0]).toMatchObject({
      id: QUESTION_ID,
      masked: false,
      isSecret: false,
      authorName: '아이콘즈팬',
      answerBody: '다음 주 재입고됩니다.',
      status: 'visible',
    });
  });

  /* 비밀글(MD-0023): 가린 줄은 본문·답변·작성자 없이 자리만 지킨다. 이름 조회에도 끼지 않는다. */
  it('가린 비밀글 줄은 본문·작성자 없이 답변 여부만 남기고 이름을 찾지 않는다', async () => {
    mocks.rpcResult = { data: { count: 2, rows: [listRow(), maskedRow()] }, error: null };
    mocks.tables.public_profiles = { data: [{ id: USER_ID, nickname: '아이콘즈팬' }], error: null };

    const section = await loadGoodQuestions('g13');

    expect(section.count).toBe(2);
    expect(section.questions[1]).toEqual({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      goodId: 'g13',
      masked: true,
      isSecret: true,
      answered: true,
      createdAt: '2026-08-29T01:00:00+00:00',
    });
    expect(mocks.filters).toContainEqual(['public_profiles', 'id', [USER_ID]]);
  });

  /* 작성자 본인(또는 운영자)에게는 DB 가 비밀글 원문을 그대로 준다. 화면은 표시만 붙인다. */
  it('읽을 수 있는 비밀글은 원문과 답변을 비밀글 표시와 함께 넘긴다', async () => {
    mocks.rpcResult = {
      data: {
        count: 1,
        rows: [listRow({ isSecret: true, answered: true, answerBody: '출고 전이면 바꿀 수 있습니다.', answeredAt: '2026-08-31T02:00:00+00:00' })],
      },
      error: null,
    };

    const section = await loadGoodQuestions('g13');

    expect(section.questions[0]).toMatchObject({
      masked: false,
      isSecret: true,
      body: '재입고 예정이 있나요?',
      answerBody: '출고 전이면 바꿀 수 있습니다.',
    });
  });

  /* 모양이 어긋난 줄을 읽을 수 있는 줄로 그리면 빈 본문이나 엉뚱한 이름이 나온다 — 가린 줄로 접는다. */
  it('가림 표시가 없거나 본문·작성자가 빠진 줄은 가린 줄로 접는다', async () => {
    mocks.rpcResult = {
      data: {
        count: 3,
        rows: [
          listRow({ masked: undefined }),
          listRow({ id: 'dddd', userId: null }),
          listRow({ id: 'eeee', body: null }),
          { id: 'broken' },
        ],
      },
      error: null,
    };

    const section = await loadGoodQuestions('g13');

    expect(section.questions).toHaveLength(3);
    expect(section.questions.every((question) => question.masked)).toBe(true);
    expect(JSON.stringify(section.questions)).not.toContain('재입고 예정이 있나요?');
  });

  /* 범위를 벗어난 페이지에서도 전체 건수를 지켜야 "질문 없음"으로 잘못 접히지 않는다. */
  it('빈 페이지에서도 RPC 의 전체 건수를 쓴다', async () => {
    mocks.rpcResult = { data: { count: 12, rows: [] }, error: null };

    const section = await loadGoodQuestions('g13', { page: 9 });

    expect(section).toMatchObject({ count: 12, page: 9, pageCount: 2, questions: [] });
  });

  /* 표시명을 못 읽었다고 질문을 감추면, 프로필 미러 한 번의 오류가 상품 문답을 통째로 지운다. */
  it('닉네임을 못 읽어도 질문은 남고 이름만 폴백으로 접힌다', async () => {
    mocks.rpcResult = { data: { count: 1, rows: [listRow({ userId: OTHER_ID })] }, error: null };
    mocks.tables.public_profiles = { data: null, error: { message: 'boom' } };

    const section = await loadGoodQuestions('g13');

    expect(section.questions).toHaveLength(1);
    expect(section.questions[0]).toMatchObject({ masked: false, authorName: 'fan_444444' });
  });

  /* Q&A 는 굿즈 상세의 한 탭이다 — 못 읽었다고 상품 페이지 전체가 500이 되면 구매 경로가 깨진다. */
  it('읽기가 실패하면 던지지 않고 빈 섹션으로 접는다', async () => {
    mocks.rpcResult = { data: null, error: { message: 'boom' } };

    await expect(loadGoodQuestions('g13')).resolves.toEqual({
      questions: [],
      count: 0,
      page: 1,
      pageCount: 1,
    });
  });

  it('mock 모드에서는 질의 없이 빈 섹션을 돌려준다', async () => {
    mocks.configured = false;

    const section = await loadGoodQuestions('g13', { page: 3 });

    expect(section).toEqual({ questions: [], count: 0, page: 3, pageCount: 1 });
    expect(mocks.rpcCalls).toHaveLength(0);
  });
});

describe('loadMyQuestions', () => {
  /* 블라인드된 글도 함께 내린다 — 감추면 왜 내려갔는지 물어볼 근거가 사라진다. */
  it('본인 글 전체를 굿즈 이름·경로와 함께 내리고 블라인드도 남긴다', async () => {
    mocks.tables.product_questions = {
      data: [
        { ...questionRow(), goods: { id: 'g13', name: '아크릴 블록' } },
        { ...questionRow({ id: 'bbbb', status: 'hidden' }), goods: null },
      ],
      error: null,
    };

    const questions = await loadMyQuestions();

    expect(mocks.filters).toContainEqual(['product_questions', 'user_id', USER_ID]);
    expect(questions[0]).toMatchObject({
      goodName: '아크릴 블록',
      goodPath: '/shop/g13?qnaPage=1#qna',
      status: 'visible',
      isSecret: false,
    });
    expect(questions[1]).toMatchObject({ status: 'hidden', goodName: '삭제된 굿즈' });
  });

  /* 본인 비밀글은 원문 그대로다 — 비밀글 정책이 작성자에게는 열려 있다. 표시만 붙인다. */
  it('내 비밀글은 본문·답변을 그대로 읽고 비밀글 표시를 넘긴다', async () => {
    mocks.tables.product_questions = {
      data: [{
        ...questionRow({ is_secret: true, answer_body: '출고 전이면 바꿀 수 있습니다.', answered_at: '2026-08-31T02:00:00.000Z' }),
        goods: { id: 'g13', name: '아크릴 블록' },
      }],
      error: null,
    };

    const [question] = await loadMyQuestions();

    expect(mocks.selects).toContainEqual(['product_questions', expect.stringContaining('is_secret')]);
    expect(question).toMatchObject({
      isSecret: true,
      body: '재입고 예정이 있나요?',
      answerBody: '출고 전이면 바꿀 수 있습니다.',
    });
  });

  it('세션이 없으면 질의 없이 빈 목록이다', async () => {
    mocks.user = null;

    await expect(loadMyQuestions()).resolves.toEqual([]);
    expect(mocks.filters).toHaveLength(0);
  });

  it('mock 모드에서는 빈 목록이다', async () => {
    mocks.configured = false;

    await expect(loadMyQuestions()).resolves.toEqual([]);
  });
});
