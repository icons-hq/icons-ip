import 'server-only';

import {
  GOOD_QUESTION_PAGE_SIZE,
  goodQuestionsHref,
  isProductQuestionStatus,
  productQuestionAuthorName,
  type GoodQuestionItem,
  type MyProductQuestion,
} from '@/lib/product-questions';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';

/* 상품 Q&A 읽기 로더(#330).
 *
 * 굿즈 상세 목록은 공개 RPC(good_product_questions)로 읽는다. 비밀글(MD-0023)이 생긴 뒤로
 * 테이블 RLS 는 남의 비밀글 행을 아예 빼는데, 공개 목록은 그 행도 "비밀글입니다." 한 줄로
 * 자리를 지켜야 해서다 — 가리는 판정(작성자·운영자만 본문을 읽는다)은 DB 함수가 갖고, 이
 * 로더는 받은 줄을 그대로 옮길 뿐이다. 내 Q&A 는 지금처럼 RLS select 로 본인 행을 읽는다.
 *
 * 절대 던지지 않는다. Q&A 는 굿즈 상세의 한 탭이라, 못 읽었다고 상품 페이지 전체가
 * 500 이 되면 구매 경로가 깨진다 — 빈 목록으로 접는다(리뷰 로더와 같은 규율). */

interface ProductQuestionRow {
  id: string;
  good_id: string;
  user_id: string;
  body: string;
  status: string | null;
  is_secret: boolean | null;
  answer_body: string | null;
  answered_at: string | null;
  created_at: string;
}

/** good_product_questions 가 돌려주는 한 줄. 가린 줄은 본문·답변·작성자가 null 이다. */
interface PublicQuestionListRow {
  id?: unknown;
  goodId?: unknown;
  userId?: unknown;
  body?: unknown;
  status?: unknown;
  isSecret?: unknown;
  masked?: unknown;
  answered?: unknown;
  answerBody?: unknown;
  answeredAt?: unknown;
  createdAt?: unknown;
}

interface PublicQuestionList {
  count?: unknown;
  rows?: unknown;
}

interface MyProductQuestionRow extends ProductQuestionRow {
  goods: { id: string; name: string } | null;
}

interface PublicProfileRow {
  id: string;
  nickname: string | null;
}

export interface GoodQuestionSection {
  questions: GoodQuestionItem[];
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

function toStatus(value: unknown) {
  return isProductQuestionStatus(value) ? value : 'visible';
}

function stringOrNull(value: unknown) {
  return typeof value === 'string' ? value : null;
}

/**
 * RPC 한 줄을 화면 모양으로.
 *
 * 읽을 수 있는 줄의 조건을 좁게 잡는다 — `masked === false` 이고 본문·작성자가 실제로 있어야 한다.
 * 그 밖의 모양은 전부 가린 줄로 접는다. 모양이 어긋났을 때 본문 자리에 빈 글이나 엉뚱한 이름을
 * 그리는 것보다 "비밀글입니다." 가 덜 위험하다.
 */
function toPublicListItem(row: PublicQuestionListRow, nicknameById: Map<string, string | null>): GoodQuestionItem | null {
  const id = stringOrNull(row.id);
  const goodId = stringOrNull(row.goodId);
  const createdAt = stringOrNull(row.createdAt);
  if (!id || !goodId || !createdAt) return null;

  const userId = stringOrNull(row.userId);
  const body = stringOrNull(row.body);
  if (row.masked !== false || !userId || body === null) {
    return { id, goodId, masked: true, isSecret: true, answered: row.answered === true, createdAt };
  }

  return {
    id,
    goodId,
    masked: false,
    userId,
    body,
    status: toStatus(row.status),
    isSecret: row.isSecret === true,
    answerBody: stringOrNull(row.answerBody),
    answeredAt: stringOrNull(row.answeredAt),
    createdAt,
    authorName: productQuestionAuthorName({ nickname: nicknameById.get(userId) ?? null, userId }),
  };
}

/**
 * 굿즈 상세의 공개 Q&A 목록.
 *
 * 블라인드되지 않은(`status = 'visible'`) 질문만 실린다 — RPC 본문이 그 조건을 못 박는다. 건수는
 * 가려진 비밀글까지 포함한 공개 행 전체라 보는 사람마다 달라지지 않는다. 범위를 벗어난 페이지도
 * 전체 건수를 함께 받아 "질문 없음"과 "이 페이지가 빔"을 가른다.
 */
export async function loadGoodQuestions(
  goodId: string,
  options: { page?: number } = {},
): Promise<GoodQuestionSection> {
  const page = Math.max(1, Math.trunc(options.page ?? 1) || 1);
  if (!getSupabaseConfig().isConfigured) return emptySection(page);

  const supabase = await createClient();
  const offset = (page - 1) * GOOD_QUESTION_PAGE_SIZE;

  const { data, error } = await supabase.rpc('good_product_questions', {
    target_good_id: goodId,
    target_limit: GOOD_QUESTION_PAGE_SIZE,
    target_offset: offset,
  });

  if (error || !data || typeof data !== 'object') return emptySection(page);

  const list = data as PublicQuestionList;
  const rows = (Array.isArray(list.rows) ? list.rows : []) as PublicQuestionListRow[];
  const total = typeof list.count === 'number' && Number.isSafeInteger(list.count) && list.count >= 0
    ? list.count
    : rows.length;

  /* 닉네임은 별도 질의다. profiles 는 본인 행만 읽히고(profiles_read), 공개 표시명은
     public_profiles 미러가 갖는다 — 커뮤니티·카탈로그가 쓰는 것과 같은 경로다. 가린 줄은
     작성자 id 가 없어 이름을 찾지 않는다. */
  const userIds = [...new Set(rows
    .filter((row) => row.masked === false)
    .map((row) => stringOrNull(row.userId))
    .filter((id): id is string => Boolean(id)))];
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
    questions: rows
      .map((row) => toPublicListItem(row, nicknameById))
      .filter((item): item is GoodQuestionItem => item !== null),
  };
}

/**
 * 내가 남긴 질문 전체.
 *
 * 블라인드된 글도 함께 내린다 — 감추면 왜 내려갔는지 물어볼 근거가 사라진다
 * (마이그레이션의 read 정책이 같은 이유로 본인 행을 열어 둔다). 본인 비밀글도 본문·답변까지
 * 그대로 읽힌다 — 비밀글 정책(product_questions_secret_read)이 작성자에게는 열려 있다.
 */
export async function loadMyQuestions(): Promise<MyProductQuestion[]> {
  if (!getSupabaseConfig().isConfigured) return [];

  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return [];

  const { data, error } = await supabase
    .from('product_questions')
    .select('id,good_id,user_id,body,status,is_secret,answer_body,answered_at,created_at,goods(id,name)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) return [];

  return ((data ?? []) as unknown as MyProductQuestionRow[]).map((row) => ({
    id: row.id,
    goodId: row.good_id,
    userId: row.user_id,
    body: row.body,
    status: toStatus(row.status),
    isSecret: row.is_secret === true,
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
