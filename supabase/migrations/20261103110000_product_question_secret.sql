-- MD-0023 상품 Q&A 비밀글(스마트스토어형).
--
-- 작성자가 '비밀글'로 남긴 질문은 공개 목록에서 자리만 지키고 "비밀글입니다."로 보인다.
-- 본문과 운영 답변은 작성자 본인과 cs.manage 운영자만 읽는다. 가림은 화면이 아니라 DB가
-- 강제한다 — 익명·다른 회원이 PostgREST로 테이블을 직접 읽어도 남의 비밀글은 행째 보이지 않는다.
--
-- 경로별 처리:
--   1. 테이블 직접 읽기(REST product_questions): restrictive select 정책이 남의 비밀글 행을 뺀다.
--      기존 permissive 정책(product_questions_read)은 그대로 둔다 — 작성자·운영자 읽기(/my/questions,
--      어드민 문의 관리)는 지금처럼 테이블을 직접 읽고, 공개 행(비밀글 아님)의 동작도 바뀌지 않는다.
--   2. 굿즈 상세 공개 목록: 비밀글도 자리를 차지해야 해서(건수·페이지가 보는 사람마다 달라지면 안 된다)
--      테이블 직접 읽기 대신 security definer RPC public.good_product_questions가 목록을 준다.
--      읽을 수 없는 비밀글은 본문·답변·작성자·답변 시각을 비우고 작성일·답변 여부만 남긴다.
--   3. 작성: insert 컬럼 grant에 is_secret을 더한다. 작성 정책(product_questions_insert_own)은 그대로다.
-- 운영 답변 알림(admin_answer_product_question)은 작성자에게만 가고 굿즈 이름만 싣는다 — 본문이 없다.
-- 어드민 경보(capture_admin_operation_alert)·미답변 집계도 본문을 싣지 않는다.

alter table public.product_questions
  add column is_secret boolean not null default false;

comment on column public.product_questions.is_secret is
  '비밀글(MD-0023). 본문·답변은 작성자와 cs.manage 운영자만 읽는다. 공개 목록은 good_product_questions가 가린 줄로 준다.';

-- 작성 경로는 RLS insert 그대로다. 컬럼 grant만 넓힌다 — status·answer_*는 여전히 닫혀 있다.
grant insert (is_secret) on table public.product_questions to authenticated;

-- 1. 남의 비밀글 행 은닉. permissive 정책과 AND로 묶인다: 공개 행은 그대로, 비밀글은 작성자·운영자만.
create policy product_questions_secret_read on public.product_questions
  as restrictive
  for select
  to anon, authenticated
  using (
    not is_secret
    or user_id = (select auth.uid())
    or (select public.has_operator_capability('cs.manage'))
  );

select private.register_operator_policy_contract(
  'public.product_questions'::regclass,
  'product_questions_secret_read',
  'cs.manage'
);

-- 2. 굿즈 상세 공개 목록.
--
-- 상태 조건(status = 'visible')을 본문에 못 박는다 — 블라인드된 글은 작성자 본인에게도 이 목록에는
-- 실리지 않는다(본인 블라인드 글은 /my/questions가 이유와 함께 보여 준다). 건수는 비밀글을 포함한
-- 공개 행 전체라 보는 사람과 무관하게 같다.
--
-- 가린 줄에는 user_id를 싣지 않는다 — 작성자 표시명이 남으면 "누가 무엇을 숨겨 물었는지"가 드러난다.
-- 행 id는 남긴다. 목록의 key일 뿐이고, 남의 비밀글 행은 테이블에서 읽히지 않는다(1).
--
-- STABLE이다. PostgREST가 READ ONLY 트랜잭션으로 부르므로 행 잠금·쓰기를 하지 않는다.
create function public.good_product_questions(
  target_good_id text,
  target_limit integer default 10,
  target_offset integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with viewer as (
    select
      (select auth.uid()) as id,
      coalesce(public.has_operator_capability('cs.manage'), false) as can_manage
  ),
  listed as (
    select
      question.id,
      question.good_id,
      question.user_id,
      question.body,
      question.status,
      question.is_secret,
      question.answer_body,
      question.answered_at,
      question.created_at,
      (
        not question.is_secret
        or (viewer.id is not null and question.user_id = viewer.id)
        or viewer.can_manage
      ) as readable
    from public.product_questions as question
    cross join viewer
    where question.good_id = target_good_id
      and question.status = 'visible'
  ),
  paged as (
    select listed.*
    from listed
    order by listed.created_at desc, listed.id desc
    limit least(greatest(coalesce(target_limit, 10), 1), 50)
    offset greatest(coalesce(target_offset, 0), 0)
  )
  select jsonb_build_object(
    'count', (select count(*) from listed),
    'rows', coalesce(
      (
        select jsonb_agg(
          case when paged.readable then jsonb_build_object(
            'id', paged.id,
            'goodId', paged.good_id,
            'userId', paged.user_id,
            'body', paged.body,
            'status', paged.status,
            'isSecret', paged.is_secret,
            'masked', false,
            'answered', paged.answer_body is not null,
            'answerBody', paged.answer_body,
            'answeredAt', paged.answered_at,
            'createdAt', paged.created_at
          ) else jsonb_build_object(
            'id', paged.id,
            'goodId', paged.good_id,
            'userId', null,
            'body', null,
            'status', paged.status,
            'isSecret', true,
            'masked', true,
            'answered', paged.answer_body is not null,
            'answerBody', null,
            'answeredAt', null,
            'createdAt', paged.created_at
          ) end
          order by paged.created_at desc, paged.id desc
        )
        from paged
      ),
      '[]'::jsonb
    )
  );
$$;

-- ⚠️ Supabase default privileges가 public 스키마 신규 함수에 anon/authenticated/service_role
--    execute를 자동 부여한다. `from public`만으로는 봉인되지 않는다.
revoke all on function public.good_product_questions(text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.good_product_questions(text, integer, integer)
  to anon, authenticated;

comment on function public.good_product_questions(text, integer, integer) is
  '굿즈 상세 공개 Q&A 목록(MD-0023). 읽을 수 없는 비밀글은 본문·답변·작성자 없이 작성일·답변 여부만 싣는다.';

-- 공개 RPC지만 운영자 분기(cs.manage)가 있어 mixed로 분류한다. 실행 메타데이터(ACL 포함)는 grant 뒤에 찍는다.
select private.register_operator_rpc_contract(
  'public.good_product_questions(text,integer,integer)'::regprocedure,
  'cs.manage',
  'mixed',
  false
);
select private.register_operator_internal_contract(
  'public.good_product_questions(text,integer,integer)'::regprocedure
);

notify pgrst, 'reload schema';
