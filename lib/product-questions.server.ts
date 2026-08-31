import 'server-only';

import {
  GOOD_QUESTION_PAGE_SIZE,
  goodQuestionsHref,
  isProductQuestionStatus,
  productQuestionAuthorName,
  type MyProductQuestion,
  type ProductQuestion,
} from '@/lib/product-questions';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';

/* 상품 Q&A 읽기 로더(#330).
 *
 * 읽기는 RLS select 로 한다 — 공개 정책이 visible 행을 anon 에게도 내주고, 작성자는
 * 블라인드된 자기 글까지 본다. 별도 RPC 를 두지 않는 이유가 그것이다.
 *
 * 절대 던지지 않는다. Q&A 는 굿즈 상세의 한 탭이라, 못 읽었다고 상품 페이지 전체가
 * 500 이 되면 구매 경로가 깨진다 — 빈 목록으로 접는다(리뷰 로더와 같은 규율). */

interface ProductQuestionRow {
  id: string;
  good_id: string;
  user_id: string;
  body: string;
  status: string | null;
  answer_body: string | null;
  answered_at: string | null;
  created_at: string;
}

interface MyProductQuestionRow extends ProductQuestionRow {
  goods: { id: string; name: string } | null;
}

interface PublicProfileRow {
  id: string;
  nickname: string | null;
}

export interface GoodQuestionSection {
  questions: ProductQuestion[];
  /** 공개 목록 전체 건수. 탭 카운트와 페이저가 같은 숫자를 쓴다. */
  count: number;
  page: number;
  pageCount: number;
}

function emptySection(page: number): GoodQuestionSection {
  return { questions: [], count: 0, page, pageCount: 1 };
}

type QuestionSupabaseClient = Awaited<ReturnType<typeof createClient>>;

async function currentUserId(supabase: QuestionSupabaseClient): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user.id;
}

function toStatus(value: string | null) {
  return isProductQuestionStatus(value) ? value : 'visible';
}

/**
 * 굿즈 상세의 공개 Q&A 목록.
 *
 * `status = 'visible'` 을 명시로 건다. RLS 는 작성자 본인의 블라인드 글과 staff 의
 * 전체 열람까지 허용하므로, 정책에만 맡기면 같은 굿즈의 "질문 N건"이 보는 사람마다
 * 달라진다 — 탭에 적힌 숫자를 아무도 못 믿게 된다. 본인 블라인드 글은 /my/questions
 * 가 이유와 함께 보여 준다.
 */
export async function loadGoodQuestions(
  goodId: string,
  options: { page?: number } = {},
): Promise<GoodQuestionSection> {
  const page = Math.max(1, Math.trunc(options.page ?? 1) || 1);
  if (!getSupabaseConfig().isConfigured) return emptySection(page);

  const supabase = await createClient();
  const offset = (page - 1) * GOOD_QUESTION_PAGE_SIZE;

  const { count, data, error } = await supabase
    .from('product_questions')
    .select('id,good_id,user_id,body,status,answer_body,answered_at,created_at', { count: 'exact' })
    .eq('good_id', goodId)
    .eq('status', 'visible')
    .order('created_at', { ascending: false })
    .range(offset, offset + GOOD_QUESTION_PAGE_SIZE - 1);

  if (error) return emptySection(page);

  const rows = (data ?? []) as ProductQuestionRow[];
  const total = typeof count === 'number' ? count : rows.length;

  /* 닉네임은 별도 질의다. profiles 는 본인 행만 읽히고(profiles_read), 공개 표시명은
     public_profiles 미러가 갖는다 — 커뮤니티·카탈로그가 쓰는 것과 같은 경로다. */
  const userIds = [...new Set(rows.map((row) => row.user_id))];
  const nicknameById = new Map<string, string | null>();

  if (userIds.length) {
    const profilesResult = await supabase
      .from('public_profiles')
      .select('id,nickname')
      .in('id', userIds);

    /* 표시명을 못 읽었다고 질문을 감추지 않는다 — 이름은 fan_ 폴백으로 접힌다. */
    if (!profilesResult.error) {
      for (const profile of (profilesResult.data ?? []) as PublicProfileRow[]) {
        nicknameById.set(profile.id, profile.nickname);
      }
    }
  }

  return {
    count: total,
    page,
    pageCount: Math.max(1, Math.ceil(total / GOOD_QUESTION_PAGE_SIZE)),
    questions: rows.map((row) => ({
      id: row.id,
      goodId: row.good_id,
      userId: row.user_id,
      body: row.body,
      status: toStatus(row.status),
      answerBody: row.answer_body,
      answeredAt: row.answered_at,
      createdAt: row.created_at,
      authorName: productQuestionAuthorName({
        nickname: nicknameById.get(row.user_id) ?? null,
        userId: row.user_id,
      }),
    })),
  };
}

/**
 * 내가 남긴 질문 전체.
 *
 * 블라인드된 글도 함께 내린다 — 감추면 왜 내려갔는지 물어볼 근거가 사라진다
 * (마이그레이션의 read 정책이 같은 이유로 본인 행을 열어 둔다).
 */
export async function loadMyQuestions(): Promise<MyProductQuestion[]> {
  if (!getSupabaseConfig().isConfigured) return [];

  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return [];

  const { data, error } = await supabase
    .from('product_questions')
    .select('id,good_id,user_id,body,status,answer_body,answered_at,created_at,goods(id,name)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) return [];

  return ((data ?? []) as unknown as MyProductQuestionRow[]).map((row) => ({
    id: row.id,
    goodId: row.good_id,
    userId: row.user_id,
    body: row.body,
    status: toStatus(row.status),
    answerBody: row.answer_body,
    answeredAt: row.answered_at,
    createdAt: row.created_at,
    /* 굿즈가 내려가 이름을 못 읽어도 줄은 남긴다 — 내가 쓴 글이 사라져 보이면 안 된다. */
    goodName: row.goods?.name?.trim() || '삭제된 굿즈',
    /* 굿즈 상세의 Q&A 탭으로 바로 보낸다 — 내 질문이 놓인 자리를 찾아 탭을 다시
       누르게 하지 않는다. */
    goodPath: goodQuestionsHref(row.good_id),
  }));
}
