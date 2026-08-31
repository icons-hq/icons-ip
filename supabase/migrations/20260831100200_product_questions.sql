-- S8 상품 Q&A (#330): 굿즈 상세의 공개 문의와 운영 답변.
--
-- 리뷰(20260818130001)와 같은 모양의 표면이지만 자격이 정반대다. 리뷰는 "그
-- 굿즈를 실제로 받은 주문"에 매여 있고, Q&A는 사기 전에 묻는 글이라 주문 자격이
-- 없다. 그래서 작성 경로가 RPC가 아니라 RLS insert 정책이다 — 판정할 자격이
-- "로그인했고 정지되지 않았다" 뿐이면 RPC는 껍데기만 늘린다.
--
-- 1:1 문의(inquiries)와도 다르다. 저쪽은 비공개 스레드고 이쪽은 굿즈 상세에
-- 공개로 붙는 한 문답이다. 그래서 답변이 별도 테이블이 아니라 같은 행의
-- answer_* 컬럼이다 — 문답이 1:1이라 스레드 구조를 만들 이유가 없다.

-- ── 알림 type 확장 ──────────────────────────────────────────────────────────
--
-- 목록을 통째로 다시 쓰지 않고 기존 정의에서 값을 읽어 덧붙인다. 손으로 적은
-- 목록은 브랜치가 갈라진 사이에 다른 마이그레이션이 추가한 타입을 조용히 지운다.
do $$
declare
  v_def text;
  v_values text;
begin
  select pg_get_constraintdef(constraint_row.oid)
  into strict v_def
  from pg_catalog.pg_constraint as constraint_row
  where constraint_row.conrelid = 'public.notifications'::regclass
    and constraint_row.conname = 'notifications_type_check';

  select string_agg(distinct quote_literal(matched[1]), ', ')
  into v_values
  from regexp_matches(v_def, '''([a-z_]+)''::text', 'g') as matched;

  if v_values is null then
    raise exception 'notifications_type_check has no readable type list';
  end if;

  if position('''product_question_answered''' in v_values) = 0 then
    v_values := v_values || ', ' || quote_literal('product_question_answered');
  end if;

  execute 'alter table public.notifications drop constraint notifications_type_check';
  execute format(
    'alter table public.notifications add constraint notifications_type_check check (type in (%s))',
    v_values
  );
end;
$$;

-- ── 테이블 ──────────────────────────────────────────────────────────────────

create table public.product_questions (
  id uuid primary key default gen_random_uuid(),
  good_id text not null references public.goods (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null
    check (char_length(body) between 1 and 1000),
  -- 운영자 블라인드 전용. 작성자 삭제는 행을 지운다(리뷰와 같은 분리).
  status text not null default 'visible'
    check (status in ('visible', 'hidden')),
  answer_body text
    check (answer_body is null or char_length(answer_body) between 1 and 2000),
  answered_at timestamptz,
  answered_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 답변 본문과 답변 시각은 함께 존재하거나 함께 비어 있다.
  check ((answer_body is null) = (answered_at is null))
);

create trigger product_questions_set_updated_at
before update on public.product_questions
for each row execute function public.set_updated_at();

-- 굿즈 상세의 공개 목록(최신순).
create index product_questions_good_recent_idx
  on public.product_questions (good_id, status, created_at desc);

-- 내 문의 목록(/my/questions).
create index product_questions_user_recent_idx
  on public.product_questions (user_id, created_at desc);

create index product_questions_answered_by_idx
  on public.product_questions (answered_by)
  where answered_by is not null;

-- 답변 미등록 큐. 운영자가 가장 자주 여는 조건이라 부분 인덱스로 좁힌다.
create index product_questions_awaiting_answer_idx
  on public.product_questions (created_at desc)
  where answer_body is null and status = 'visible';

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.product_questions enable row level security;

-- 공개 브라우징: 살지 말지 정하는 사람은 아직 로그인하지 않은 사람이다.
-- 작성자는 블라인드된 자기 글도 본다 — 감추면 왜 내려갔는지 물어볼 근거가 사라진다.
create policy product_questions_read on public.product_questions
  for select
  to anon, authenticated
  using (
    status = 'visible'
    or user_id = (select auth.uid())
    or (select public.is_staff())
  );

-- 작성 경로. posts_insert(20260624093001)와 같은 구조다: 본인 명의 + 정지 계정 차단.
-- 답변 컬럼은 여기서 절대 채워질 수 없다 — 운영 답변을 사용자가 스스로 심는 것을
-- 스키마가 아니라 정책이 막는다.
create policy product_questions_insert_own on public.product_questions
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'visible'
    and answer_body is null
    and answered_at is null
    and answered_by is null
    and exists (
      select 1
      from public.profiles as profile
      where profile.id = (select auth.uid())
        and profile.suspended_at is null
    )
  );

-- update/delete 정책은 없다. 답변·블라인드는 어드민 RPC만 지난다.
revoke all on table public.product_questions
  from public, anon, authenticated, service_role;
grant select on table public.product_questions to anon, authenticated;
grant insert (good_id, user_id, body) on table public.product_questions to authenticated;

-- ── 어드민 RPC ──────────────────────────────────────────────────────────────

-- 답변 등록·수정. 재답변은 허용하고, 그때마다 알림을 다시 띄운다 — 답변 내용이
-- 바뀌었는데 조용하면 구매자는 이전 답변을 그대로 믿는다.
create function public.admin_answer_product_question(
  target_question_id uuid,
  target_answer_body text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_answer text := btrim(coalesce(target_answer_body, ''), E' \t\n\r\f\v');
  v_user_id uuid;
  v_good_id text;
  v_good_name text;
  v_previous text;
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if char_length(normalized_answer) not between 1 and 2000 then
    raise exception 'invalid_question_answer' using errcode = '22023';
  end if;

  select question.user_id, question.good_id, question.answer_body
    into v_user_id, v_good_id, v_previous
  from public.product_questions as question
  where question.id = target_question_id
  for update;

  if not found then
    raise exception 'question_not_found' using errcode = 'P0002';
  end if;

  update public.product_questions
  set answer_body = normalized_answer,
      answered_at = now(),
      answered_by = actor_id
  where id = target_question_id;

  select good.name into v_good_name
  from public.goods as good
  where good.id = v_good_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'product_question.answer',
    'product_questions:' || target_question_id::text,
    jsonb_build_object(
      'goodId', v_good_id,
      'isEdit', v_previous is not null,
      'answerLength', char_length(normalized_answer)
    )
  );

  -- body CHECK 상한은 500자다. 굿즈 이름이 길어 알림 insert가 실패하면 답변
  -- 저장까지 함께 되돌아간다 — 이름을 잘라서라도 답변은 남긴다.
  insert into public.notifications (
    user_id, type, title, body, link_path, source_type, source_id, dedupe_key
  )
  values (
    v_user_id,
    'product_question_answered',
    '상품 문의에 답변이 등록됐어요',
    left(coalesce(v_good_name, '굿즈'), 100) || ' 문의에 ICONS 운영자가 답변을 남겼습니다.',
    '/my/questions',
    'product_question',
    target_question_id::text,
    'product_question_answered:' || target_question_id::text
  )
  on conflict (user_id, dedupe_key) do update set
    title = excluded.title,
    body = excluded.body,
    read_at = null,
    created_at = now();
end;
$$;

-- 블라인드/해제. 행을 지우지 않고 상태만 바꾼다 — 원문이 남아야 왜 내렸는지
-- 검증할 수 있다.
create function public.admin_set_product_question_visibility(
  target_question_id uuid,
  target_hidden boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := (select auth.uid());
  next_status text := case when coalesce(target_hidden, false) then 'hidden' else 'visible' end;
  v_previous text;
  v_good_id text;
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select question.status, question.good_id
    into v_previous, v_good_id
  from public.product_questions as question
  where question.id = target_question_id
  for update;

  if not found then
    raise exception 'question_not_found' using errcode = 'P0002';
  end if;

  update public.product_questions
  set status = next_status
  where id = target_question_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'product_question.visibility',
    'product_questions:' || target_question_id::text,
    jsonb_build_object('from', v_previous, 'to', next_status, 'goodId', v_good_id)
  );
end;
$$;

-- ⚠️ Supabase default privileges가 public 스키마 신규 함수에 anon/authenticated/
--    service_role execute를 자동 부여한다. `from public`만으로는 봉인되지 않는다.
revoke all on function public.admin_answer_product_question(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_answer_product_question(uuid, text) to authenticated;

revoke all on function public.admin_set_product_question_visibility(uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_set_product_question_visibility(uuid, boolean)
  to authenticated;
