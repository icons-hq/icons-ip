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
  filters: [] as [string, string, unknown][],
  ranges: [] as [string, number, number][],
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
    from(table: string) {
      const result = () => mocks.tables[table] ?? { data: null, error: null };
      const query = {
        select: () => query,
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
    answer_body: null,
    answered_at: null,
    created_at: '2026-08-30T01:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  mocks.configured = true;
  mocks.tables = {};
  mocks.filters = [];
  mocks.ranges = [];
  mocks.user = { id: USER_ID };
});

describe('loadGoodQuestions', () => {
  it('공개 목록을 굿즈·공개 상태로 좁히고 페이지를 잘라 읽는다', async () => {
    mocks.tables.product_questions = {
      data: [questionRow({ answer_body: '다음 주 재입고됩니다.', answered_at: '2026-08-31T02:00:00.000Z' })],
      error: null,
      count: 23,
    };
    mocks.tables.public_profiles = { data: [{ id: USER_ID, nickname: '아이콘즈팬' }], error: null };

    const section = await loadGoodQuestions('g13', { page: 2 });

    expect(mocks.filters).toContainEqual(['product_questions', 'good_id', 'g13']);
    /* RLS 는 작성자 본인의 블라인드 글과 staff 열람까지 허용한다. 상태 필터를 정책에만
       맡기면 같은 굿즈의 "질문 N건"이 보는 사람마다 달라진다. */
    expect(mocks.filters).toContainEqual(['product_questions', 'status', 'visible']);
    expect(mocks.ranges).toContainEqual(['product_questions', 10, 19]);
    expect(section.count).toBe(23);
    expect(section.page).toBe(2);
    expect(section.pageCount).toBe(3);
    expect(section.questions[0]).toMatchObject({
      id: QUESTION_ID,
      authorName: '아이콘즈팬',
      answerBody: '다음 주 재입고됩니다.',
      status: 'visible',
    });
  });

  /* 표시명을 못 읽었다고 질문을 감추면, 프로필 미러 한 번의 오류가 상품 문답을 통째로 지운다. */
  it('닉네임을 못 읽어도 질문은 남고 이름만 폴백으로 접힌다', async () => {
    mocks.tables.product_questions = { data: [questionRow({ user_id: OTHER_ID })], error: null, count: 1 };
    mocks.tables.public_profiles = { data: null, error: { message: 'boom' } };

    const section = await loadGoodQuestions('g13');

    expect(section.questions).toHaveLength(1);
    expect(section.questions[0].authorName).toBe('fan_444444');
  });

  /* Q&A 는 굿즈 상세의 한 탭이다 — 못 읽었다고 상품 페이지 전체가 500이 되면 구매 경로가 깨진다. */
  it('읽기가 실패하면 던지지 않고 빈 섹션으로 접는다', async () => {
    mocks.tables.product_questions = { data: null, error: { message: 'boom' }, count: null };

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
    expect(mocks.filters).toHaveLength(0);
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
    });
    expect(questions[1]).toMatchObject({ status: 'hidden', goodName: '삭제된 굿즈' });
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
