\set ON_ERROR_STOP on

-- 상품 Q&A 스모크: 공개 문의 작성(RLS insert) · 공개 조회 · 운영 답변과 알림.
-- 작성 자격은 "로그인했고 정지되지 않았다" 뿐이라 RPC가 아니라 RLS 정책이 문지기다.
-- 답변·블라인드는 어드민 RPC만 지난다.

begin;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000821',
    'authenticated', 'authenticated', 'question-asker@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000822',
    'authenticated', 'authenticated', 'question-other@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000823',
    'authenticated', 'authenticated', 'question-staff@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000824',
    'authenticated', 'authenticated', 'question-suspended@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  (
    '00000000-0000-4000-8000-000000000821',
    'question-asker@example.test', 'question_asker', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'
  ),
  (
    '00000000-0000-4000-8000-000000000822',
    'question-other@example.test', 'question_other', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'
  ),
  (
    '00000000-0000-4000-8000-000000000823',
    'question-staff@example.test', 'question_staff', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'
  ),
  (
    '00000000-0000-4000-8000-000000000824',
    'question-suspended@example.test', 'question_suspended', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'
  )
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at,
  role = excluded.role;

update public.profiles
set suspended_at = now(), suspension_reason = 'Q&A 스모크용 정지'
where id = '00000000-0000-4000-8000-000000000824';

insert into public.ips (id, title, vertical_key)
values ('pq-ip', 'Q&A 스모크 IP', 'character')
on conflict (id) do nothing;

insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values ('pq-g1', 'pq-ip', 'Q&A 굿즈', '피규어', 20000, 'ok', 10)
on conflict (id) do update set price = excluded.price;

-- ── 스키마·ACL 계약 ─────────────────────────────────────────────────────────

select 1 / case when (
  select rowsecurity from pg_tables
  where schemaname = 'public' and tablename = 'product_questions'
) then 1 else 0 end as assert_product_questions_have_rls;

select 1 / case when has_table_privilege('anon', 'public.product_questions', 'select')
  and has_table_privilege('authenticated', 'public.product_questions', 'select')
  and not has_table_privilege('anon', 'public.product_questions', 'insert')
  and has_column_privilege('authenticated', 'public.product_questions', 'body', 'insert')
  and not has_column_privilege('authenticated', 'public.product_questions', 'answer_body', 'insert')
  and not has_column_privilege('authenticated', 'public.product_questions', 'status', 'insert')
  and not has_table_privilege('authenticated', 'public.product_questions', 'update')
  and not has_table_privilege('authenticated', 'public.product_questions', 'delete')
then 1 else 0 end as assert_product_question_privileges;

select 1 / case when not has_function_privilege('anon', 'public.admin_answer_product_question(uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_answer_product_question(uuid, text)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_answer_product_question(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_set_product_question_visibility(uuid, boolean)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_set_product_question_visibility(uuid, boolean)', 'execute')
then 1 else 0 end as assert_product_question_rpc_acl;

select 1 / case when (
  select pg_get_constraintdef(oid) like '%product_question_answered%'
  from pg_constraint
  where conrelid = 'public.notifications'::regclass
    and conname = 'notifications_type_check'
) then 1 else 0 end as assert_notification_type_registered;

-- 기존 타입이 지워지지 않았다(덧붙이기 do-블록 계약).
select 1 / case when (
  select pg_get_constraintdef(oid) like '%loyalty_grade_upgraded%'
    and pg_get_constraintdef(oid) like '%review_replied%'
    and pg_get_constraintdef(oid) like '%claim_updated%'
  from pg_constraint
  where conrelid = 'public.notifications'::regclass
    and conname = 'notifications_type_check'
) then 1 else 0 end as assert_existing_notification_types_kept;

-- ── 작성 해피패스 ───────────────────────────────────────────────────────────

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000821', true);
set local role authenticated;

insert into public.product_questions (good_id, user_id, body)
values ('pq-g1', '00000000-0000-4000-8000-000000000821', '재입고 예정이 있나요?')
returning id as question_id \gset

select set_config('test.question_id', :'question_id', true) as question_id_setting \gset

select 1 / case when (
  select status = 'visible' and answer_body is null and answered_at is null and answered_by is null
  from public.product_questions where id = :'question_id'::uuid
) then 1 else 0 end as assert_question_defaults;

-- 남의 명의로는 쓸 수 없다(RLS with check).
do $$
begin
  begin
    insert into public.product_questions (good_id, user_id, body)
    values ('pq-g1', '00000000-0000-4000-8000-000000000822', '명의 도용');
    raise exception 'user_id spoofing should be rejected';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

-- 답변 컬럼은 작성자가 채울 수 없다(컬럼 grant가 1차, RLS with check가 2차).
do $$
begin
  begin
    insert into public.product_questions (good_id, user_id, body, answer_body, answered_at)
    values (
      'pq-g1', '00000000-0000-4000-8000-000000000821', '자문자답',
      '네 곧 입고됩니다', now()
    );
    raise exception 'pre-filled answer should be rejected';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

-- 정지 계정은 쓸 수 없다.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000824', true);
do $$
begin
  begin
    insert into public.product_questions (good_id, user_id, body)
    values ('pq-g1', '00000000-0000-4000-8000-000000000824', '정지 계정 문의');
    raise exception 'suspended author should be rejected';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

-- ── 공개 조회 ───────────────────────────────────────────────────────────────

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;

select 1 / case when (
  select count(*) from public.product_questions where good_id = 'pq-g1'
) = 1 then 1 else 0 end as assert_anon_reads_visible_question;

-- 비로그인은 쓸 수 없다.
do $$
begin
  begin
    insert into public.product_questions (good_id, user_id, body)
    values ('pq-g1', '00000000-0000-4000-8000-000000000821', '비로그인 문의');
    raise exception 'anon insert should be rejected';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

-- ── 블라인드 ────────────────────────────────────────────────────────────────

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000823', true);
set local role authenticated;

select public.admin_set_product_question_visibility(:'question_id'::uuid, true);

select 1 / case when (
  select status = 'hidden' from public.product_questions where id = :'question_id'::uuid
) then 1 else 0 end as assert_question_hidden;

select 1 / case when exists (
  select 1 from public.audit_log
  where action = 'product_question.visibility'
    and actor_id = '00000000-0000-4000-8000-000000000823'
    and target = 'product_questions:' || :'question_id'
    and diff ->> 'to' = 'hidden'
) then 1 else 0 end as assert_visibility_audited;

-- 운영자에게는 계속 보인다.
select 1 / case when (
  select count(*) from public.product_questions where id = :'question_id'::uuid
) = 1 then 1 else 0 end as assert_staff_sees_hidden_question;

-- 작성자 본인에게도 보인다(왜 내려갔는지 물어볼 근거).
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000821', true);
select 1 / case when (
  select count(*) from public.product_questions where id = :'question_id'::uuid
) = 1 then 1 else 0 end as assert_author_sees_own_hidden_question;

-- 다른 사용자와 비로그인에게는 사라진다.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000822', true);
select 1 / case when (
  select count(*) from public.product_questions where id = :'question_id'::uuid
) = 0 then 1 else 0 end as assert_other_user_cannot_see_hidden;

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
select 1 / case when (
  select count(*) from public.product_questions where id = :'question_id'::uuid
) = 0 then 1 else 0 end as assert_anon_cannot_see_hidden;

-- 해제하면 다시 공개된다.
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000823', true);
set local role authenticated;
select public.admin_set_product_question_visibility(:'question_id'::uuid, false);

select 1 / case when (
  select status = 'visible' from public.product_questions where id = :'question_id'::uuid
) then 1 else 0 end as assert_question_unhidden;

-- ── 운영 답변과 알림 ────────────────────────────────────────────────────────

select public.admin_answer_product_question(
  :'question_id'::uuid,
  '다음 주 재입고 예정입니다.'
);

select 1 / case when (
  select answer_body = '다음 주 재입고 예정입니다.'
    and answered_at is not null
    and answered_by = '00000000-0000-4000-8000-000000000823'
  from public.product_questions where id = :'question_id'::uuid
) then 1 else 0 end as assert_answer_recorded;

select 1 / case when exists (
  select 1 from public.audit_log
  where action = 'product_question.answer'
    and actor_id = '00000000-0000-4000-8000-000000000823'
    and target = 'product_questions:' || :'question_id'
    and (diff ->> 'isEdit')::boolean = false
) then 1 else 0 end as assert_answer_audited;

reset role;

select 1 / case when (
  select count(*) = 1
    and bool_and(type = 'product_question_answered')
    and bool_and(link_path = '/my/questions')
    and bool_and(source_type = 'product_question')
    and bool_and(read_at is null)
  from public.notifications
  where user_id = '00000000-0000-4000-8000-000000000821'
    and dedupe_key = 'product_question_answered:' || :'question_id'
) then 1 else 0 end as assert_answer_notification;

-- 재답변은 갱신하고 알림을 다시 띄운다.
update public.notifications
set read_at = now()
where user_id = '00000000-0000-4000-8000-000000000821'
  and dedupe_key = 'product_question_answered:' || :'question_id';

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000823', true);
set local role authenticated;
select public.admin_answer_product_question(
  :'question_id'::uuid,
  '재고가 확보돼 이번 주에 입고됩니다.'
);

reset role;

select 1 / case when (
  select answer_body = '재고가 확보돼 이번 주에 입고됩니다.'
  from public.product_questions where id = :'question_id'::uuid
) then 1 else 0 end as assert_reanswer_updates_body;

select 1 / case when (
  select count(*) = 1 and bool_and(read_at is null)
  from public.notifications
  where user_id = '00000000-0000-4000-8000-000000000821'
    and dedupe_key = 'product_question_answered:' || :'question_id'
) then 1 else 0 end as assert_reanswer_resurfaces_notification;

select 1 / case when (
  select count(*) from public.audit_log
  where action = 'product_question.answer'
    and target = 'product_questions:' || :'question_id'
    and (diff ->> 'isEdit')::boolean
) = 1 then 1 else 0 end as assert_reanswer_marked_as_edit;

-- ── 비스태프 차단 ───────────────────────────────────────────────────────────

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000821', true);
set local role authenticated;
do $$
begin
  begin
    perform public.admin_answer_product_question(
      current_setting('test.question_id')::uuid,
      '탈취 답변'
    );
    raise exception 'non-staff answer should be rejected';
  exception
    when insufficient_privilege then
      if sqlerrm <> 'forbidden' then raise; end if;
  end;

  begin
    perform public.admin_set_product_question_visibility(
      current_setting('test.question_id')::uuid,
      true
    );
    raise exception 'non-staff visibility change should be rejected';
  exception
    when insufficient_privilege then
      if sqlerrm <> 'forbidden' then raise; end if;
  end;
end;
$$;

-- 작성자도 자기 글을 직접 고치거나 지울 수 없다(update/delete 정책 없음).
do $$
begin
  begin
    update public.product_questions
    set body = '수정 시도'
    where id = current_setting('test.question_id')::uuid;
    raise exception 'direct question update should be rejected';
  exception
    when insufficient_privilege then null;
  end;

  begin
    delete from public.product_questions
    where id = current_setting('test.question_id')::uuid;
    raise exception 'direct question delete should be rejected';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

-- 없는 문의에 답변할 수 없다.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000823', true);
do $$
begin
  begin
    perform public.admin_answer_product_question(
      '00000000-0000-4000-8000-0000000008ff'::uuid,
      '유령 답변'
    );
    raise exception 'answering a missing question should be rejected';
  exception
    when no_data_found then
      if sqlerrm <> 'question_not_found' then raise; end if;
  end;
end;
$$;

reset role;

rollback;
