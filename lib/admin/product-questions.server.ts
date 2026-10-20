import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { imageUrlFromBg, publicMediaUrl } from '@/lib/media';
import { customerServicePageSize } from './customer-service-list';
import {
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

const LIST_SELECT = 'id,good_id,user_id,body,status,answer_body,answered_at,answered_by,created_at,updated_at';

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
  updated_at?: string | null;
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
  filters: AdminProductQuestionFilters,
) {
  const byGoodName = Boolean(filters.query && filters.field === 'good');
  let base = supabase.from('product_questions').select(
    byGoodName ? `${LIST_SELECT},goods!inner(name)` : LIST_SELECT,
    { count: 'exact' },
  );
  if (filters.status === 'unanswered') base = base.is('answer_body', null).eq('status', 'visible');
  if (filters.status === 'answered') base = base.not('answer_body', 'is', null);
  if (filters.status === 'hidden') base = base.eq('status', 'hidden');
  if (filters.from) base = base.gte('created_at', `${filters.from}T00:00:00+09:00`);
  if (filters.to) {
    const nextDay = new Date(`${filters.to}T00:00:00+09:00`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    base = base.lt('created_at', nextDay.toISOString());
  }
  if (filters.query) {
    if (filters.field === 'goodId') base = base.eq('good_id', filters.query);
    else if (filters.field === 'id') {
      const id = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(filters.query)
        ? filters.query : '00000000-0000-0000-0000-000000000000';
      base = base.eq('id', id);
    } else {
      const escaped = filters.query.replace(/[\\%_*]/g, (character) => `\\${character}`);
      base = base.ilike(byGoodName ? 'goods.name' : 'body', `%${escaped}%`);
    }
  }
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

async function goodsById(supabase: SupabaseServerClient, ids: string[]) {
  type GoodSummary = { name: string; imageUrl: string | null };
  if (!ids.length) return new Map<string, GoodSummary>();

  const { data, error } = await supabase
    .from('goods')
    .select('id,name,image_path,bg')
    .in('id', ids);

  if (error) return new Map<string, GoodSummary>();
  return new Map(
    ((data ?? []) as { id: string; name: string; image_path?: string | null; bg?: string | null }[])
      .map((row) => [row.id, {
        name: row.name,
        imageUrl: row.image_path ? publicMediaUrl(row.image_path) : imageUrlFromBg(row.bg),
      }] as const),
  );
}

export async function getAdminProductQuestionConsoleData(
  filters: AdminProductQuestionFilters,
): Promise<AdminProductQuestionConsoleData> {
  const supabase = await createClient();
  const pageSize = customerServicePageSize(filters.pageSize);
  const offset = (filters.page - 1) * pageSize;

  const listResult = await questionListQuery(supabase, filters)
    .order('created_at', { ascending: filters.sort === 'oldest' })
    .order('id', { ascending: filters.sort === 'oldest' })
    .range(offset, offset + pageSize - 1);

  if (listResult.error) {
    throw new Error(`Failed to load product questions: ${listResult.error.message}`);
  }

  const rows = (listResult.data ?? []) as unknown as QuestionRow[];

  const [total, unanswered, answered, hidden, goods, profileNames] = await Promise.all([
    countQuestions(supabase, 'all'),
    countQuestions(supabase, 'unanswered'),
    countQuestions(supabase, 'answered'),
    countQuestions(supabase, 'hidden'),
    goodsById(supabase, [...new Set(rows.map((row) => row.good_id))]),
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
    pageSize,
    total: toNumber(listResult.count),
    rows: rows.map((row): AdminProductQuestionRow => ({
      id: row.id,
      goodId: row.good_id,
      /* 이름 질의만 실패한 경우에도 행은 남는다. 빈 이름 대신 id 를 보여 준다 —
         무엇에 대한 질문인지 모르면 답할 수 없다. */
      goodName: goods.get(row.good_id)?.name ?? row.good_id,
      goodImageUrl: goods.get(row.good_id)?.imageUrl ?? null,
      userId: row.user_id,
      authorName: adminProductQuestionAuthorLabel(
        profileNames.get(row.user_id) ?? null,
        row.user_id,
      ),
      body: row.body,
      hidden: row.status === 'hidden',
      answerBody: row.answer_body,
      answeredAt: row.answered_at,
      updatedAt: row.updated_at ?? null,
      answeredByName: row.answered_by
        ? profileNames.get(row.answered_by)?.trim() || null
        : null,
      createdAt: row.created_at,
    })),
  };
}
