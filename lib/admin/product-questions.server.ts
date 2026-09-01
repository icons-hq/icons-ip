import 'server-only';

import { createClient } from '@/lib/supabase/server';
import {
  ADMIN_PRODUCT_QUESTION_PAGE_SIZE,
  adminProductQuestionAuthorLabel,
  type AdminProductQuestionConsoleData,
  type AdminProductQuestionCounts,
  type AdminProductQuestionFilters,
  type AdminProductQuestionRow,
  type AdminProductQuestionStatusFilter,
} from './product-questions';

/* 어드민 상품 Q&A 콘솔 로더 (S8 #330).
 *
 * product_questions 는 staff RLS select 가 열려 있고(블라인드된 글도 staff 에게는
 * 보인다) 목록·집계 전용 RPC 가 없어 테이블을 직접 읽는다 — service role 은 화면
 * 로드에 끌어들이지 않는다.
 *
 * 작성자 이름은 profiles 가 아니라 public_profiles 에서 읽는다. profiles 는 컬럼
 * 화이트리스트 grant 위에 self-only select 정책이 걸려 있어 staff 세션도 남의 행을
 * 읽지 못한다 — 콘솔에 작성자 이메일이 없는 이유다(리뷰·문의 콘솔은 전용 staff RPC
 * 가 그 값을 실어 준다). */

const LIST_SELECT = 'id,good_id,user_id,body,status,answer_body,answered_at,answered_by,created_at';

interface QuestionRow {
  id: string;
  good_id: string;
  user_id: string;
  body: string;
  status: string;
  answer_body: string | null;
  answered_at: string | null;
  answered_by: string | null;
  created_at: string;
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

function toNumber(value: number | null | undefined) {
  return Number.isSafeInteger(value) ? (value as number) : 0;
}

/**
 * 상태 필터가 붙은 목록 질의.
 *
 * `unanswered`는 블라인드된 글을 뺀다 — 내려간 질문에 답을 다는 것은 미답변 큐가
 * 시키는 일이 아니고, DB의 부분 인덱스(product_questions_awaiting_answer_idx)도
 * 같은 조건으로 좁혀져 있다.
 */
function questionListQuery(
  supabase: SupabaseServerClient,
  status: AdminProductQuestionStatusFilter,
) {
  const base = supabase.from('product_questions').select(LIST_SELECT, { count: 'exact' });
  if (status === 'unanswered') return base.is('answer_body', null).eq('status', 'visible');
  if (status === 'answered') return base.not('answer_body', 'is', null);
  if (status === 'hidden') return base.eq('status', 'hidden');
  return base;
}

function questionCountQuery(
  supabase: SupabaseServerClient,
  status: AdminProductQuestionStatusFilter,
) {
  const base = supabase
    .from('product_questions')
    .select('id', { count: 'exact', head: true });
  if (status === 'unanswered') return base.is('answer_body', null).eq('status', 'visible');
  if (status === 'answered') return base.not('answer_body', 'is', null);
  if (status === 'hidden') return base.eq('status', 'hidden');
  return base;
}

/* 집계 하나가 실패해도 목록은 떠야 한다. 칩만 0으로 접고 그리드는 그대로 그린다. */
async function countQuestions(
  supabase: SupabaseServerClient,
  status: AdminProductQuestionStatusFilter,
) {
  const { count, error } = await questionCountQuery(supabase, status);
  return error ? 0 : toNumber(count);
}

async function nicknamesById(supabase: SupabaseServerClient, ids: string[]) {
  if (!ids.length) return new Map<string, string | null>();

  const { data, error } = await supabase
    .from('public_profiles')
    .select('id,nickname')
    .in('id', ids);

  if (error) return new Map<string, string | null>();
  return new Map(
    ((data ?? []) as { id: string; nickname: string | null }[])
      .map((row) => [row.id, row.nickname] as const),
  );
}

async function goodNamesById(supabase: SupabaseServerClient, ids: string[]) {
  if (!ids.length) return new Map<string, string>();

  const { data, error } = await supabase
    .from('goods')
    .select('id,name')
    .in('id', ids);

  if (error) return new Map<string, string>();
  return new Map(
    ((data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name] as const),
  );
}

export async function getAdminProductQuestionConsoleData(
  filters: AdminProductQuestionFilters,
): Promise<AdminProductQuestionConsoleData> {
  const supabase = await createClient();
  const offset = (filters.page - 1) * ADMIN_PRODUCT_QUESTION_PAGE_SIZE;

  const listResult = await questionListQuery(supabase, filters.status)
    .order('created_at', { ascending: false })
    .range(offset, offset + ADMIN_PRODUCT_QUESTION_PAGE_SIZE - 1);

  if (listResult.error) {
    throw new Error(`Failed to load product questions: ${listResult.error.message}`);
  }

  const rows = (listResult.data ?? []) as unknown as QuestionRow[];

  const [total, unanswered, answered, hidden, goodNames, profileNames] = await Promise.all([
    countQuestions(supabase, 'all'),
    countQuestions(supabase, 'unanswered'),
    countQuestions(supabase, 'answered'),
    countQuestions(supabase, 'hidden'),
    goodNamesById(supabase, [...new Set(rows.map((row) => row.good_id))]),
    nicknamesById(supabase, [...new Set([
      ...rows.map((row) => row.user_id),
      ...rows
        .map((row) => row.answered_by)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ])]),
  ]);

  const counts: AdminProductQuestionCounts = { total, unanswered, answered, hidden };

  return {
    counts,
    filters,
    pageSize: ADMIN_PRODUCT_QUESTION_PAGE_SIZE,
    total: toNumber(listResult.count),
    rows: rows.map((row): AdminProductQuestionRow => ({
      id: row.id,
      goodId: row.good_id,
      /* 이름 질의만 실패한 경우에도 행은 남는다. 빈 이름 대신 id 를 보여 준다 —
         무엇에 대한 질문인지 모르면 답할 수 없다. */
      goodName: goodNames.get(row.good_id) ?? row.good_id,
      userId: row.user_id,
      authorName: adminProductQuestionAuthorLabel(
        profileNames.get(row.user_id) ?? null,
        row.user_id,
      ),
      body: row.body,
      hidden: row.status === 'hidden',
      answerBody: row.answer_body,
      answeredAt: row.answered_at,
      answeredByName: row.answered_by
        ? profileNames.get(row.answered_by)?.trim() || null
        : null,
      createdAt: row.created_at,
    })),
  };
}
