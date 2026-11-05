\set ON_ERROR_STOP on

-- 상품 Q&A 비밀글(MD-0023) 스모크.
-- 비밀글의 본문·운영 답변은 작성자와 cs.manage 운영자만 읽는다. 익명·다른 회원·cs.manage 없는 운영자는
-- 테이블을 직접 읽어도 행이 없고, 공개 목록 RPC에서는 자리만 남은 가린 줄(작성일·답변 여부)을 받는다.
-- 비밀글이 아닌 행은 지금과 똑같이 읽힌다.

begin;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
 ('00000000-0000-4000-8000-000000231001','authenticated','authenticated','secret-qna-author@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000231002','authenticated','authenticated','secret-qna-other@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000231003','authenticated','authenticated','secret-qna-cs@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000231004','authenticated','authenticated','secret-qna-logistics@example.test',now(),'{}','{}',now(),now());

update public.profiles set nickname = '비밀글작성자' where id = '00000000-0000-4000-8000-000000231001';
update public.profiles set role = 'staff'
 where id in ('00000000-0000-4000-8000-000000231003','00000000-0000-4000-8000-000000231004');
-- 상품 Q&A 운영 권한(cs.manage)은 primary에 있고 logistics에는 없다.
insert into private.operator_memberships(profile_id,manager_role) values
 ('00000000-0000-4000-8000-000000231003','primary'),
 ('00000000-0000-4000-8000-000000231004','logistics');

insert into public.ips(id,title,vertical_key) values('pqs-ip','비밀글 스모크 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty)
values('pqs-g1','pqs-ip','비밀글 스모크 굿즈','문구',1000,'ok',10);

-- 목록 한 줄을 id로 찾는다.
create function pg_temp.list_row(p_list jsonb, p_id uuid) returns jsonb language sql immutable as $$
  select row_value from jsonb_array_elements(p_list->'rows') as row_value where row_value->>'id' = p_id::text
$$;

-- ── 스키마·ACL 계약 ─────────────────────────────────────────────────────────

select 1 / case when exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'product_questions' and column_name = 'is_secret'
    and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false'
) then 1 else 0 end as assert_is_secret_column;

select 1 / case when has_column_privilege('authenticated', 'public.product_questions', 'is_secret', 'insert')
  and not has_column_privilege('anon', 'public.product_questions', 'is_secret', 'insert')
  and not has_column_privilege('authenticated', 'public.product_questions', 'is_secret', 'update')
  and not has_column_privilege('authenticated', 'public.product_questions', 'answer_body', 'insert')
then 1 else 0 end as assert_is_secret_insert_grant;

select 1 / case when exists (
  select 1 from pg_policies
  where schemaname = 'public' and tablename = 'product_questions'
    and policyname = 'product_questions_secret_read'
    and permissive = 'RESTRICTIVE' and cmd = 'SELECT'
    and roles @> array['anon','authenticated']::name[]
) then 1 else 0 end as assert_secret_read_policy_restrictive;

select 1 / case when has_function_privilege('anon', 'public.good_product_questions(text,integer,integer)', 'execute')
  and has_function_privilege('authenticated', 'public.good_product_questions(text,integer,integer)', 'execute')
  and not has_function_privilege('service_role', 'public.good_product_questions(text,integer,integer)', 'execute')
  and (select prosecdef and provolatile = 's' from pg_proc
       where oid = 'public.good_product_questions(text,integer,integer)'::regprocedure)
then 1 else 0 end as assert_public_list_rpc_acl;

select 1 / case when exists (
  select 1 from private.operator_policy_contracts
  where schema_name = 'public' and table_name = 'product_questions'
    and policy_name = 'product_questions_secret_read' and capability = 'cs.manage'
) and exists (
  select 1 from private.operator_rpc_contracts
  where signature = 'public.good_product_questions(text,integer,integer)'
    and capability = 'cs.manage' and guard_kind = 'mixed'
) and exists (
  select 1 from private.operator_internal_contracts
  where signature = 'public.good_product_questions(text,integer,integer)'
) then 1 else 0 end as assert_operator_contracts_registered;

-- ── 작성 ────────────────────────────────────────────────────────────────────

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000231001', true);
set local role authenticated;

insert into public.product_questions (good_id, user_id, body, is_secret)
values ('pqs-g1', '00000000-0000-4000-8000-000000231001', '비밀 본문: 배송지 변경이 가능한가요?', true)
returning id as secret_id \gset

insert into public.product_questions (good_id, user_id, body)
values ('pqs-g1', '00000000-0000-4000-8000-000000231001', '공개 본문: 사이즈가 궁금해요')
returning id as open_id \gset

select set_config('test.secret_id', :'secret_id', true) as secret_setting \gset
select set_config('test.open_id', :'open_id', true) as open_setting \gset

-- 한 트랜잭션의 now()는 같다. 목록 순서(최신순)를 단언하려고 비밀글을 1분 앞으로 옮긴다.
reset role;
update public.product_questions set created_at = created_at - interval '1 minute' where id = :'secret_id'::uuid;
set local role authenticated;

-- 체크하지 않은 질문은 공개다(기본값 false).
select 1 / case when (
  select is_secret = false from public.product_questions where id = :'open_id'::uuid
) and (
  select is_secret from public.product_questions where id = :'secret_id'::uuid
) then 1 else 0 end as assert_secret_flag_saved;

-- 운영 답변. 알림은 작성자에게만 가고 비밀글 본문·답변을 싣지 않는다.
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000231003', true);
set local role authenticated;

select public.admin_save_cs_reply(gen_random_uuid(), auth.uid(), 'product_question', :'secret_id'::uuid,
  '비밀 답변: 출고 전이면 바꿀 수 있습니다.',
  (select reply_source_revision from public.product_questions where id = :'secret_id'::uuid));

reset role;
update public.product_questions
set answer_body = '공개 답변: 가로 10cm입니다.', answered_at = now()
where id = :'open_id'::uuid;

select 1 / case when (
  select count(*) = 1
    and bool_and(user_id = '00000000-0000-4000-8000-000000231001')
    and bool_and(position('비밀 본문' in title || ' ' || body) = 0)
    and bool_and(position('비밀 답변' in title || ' ' || body) = 0)
  from public.notifications
  where dedupe_key = 'product_question_answered:' || :'secret_id'
) then 1 else 0 end as assert_answer_notification_carries_no_secret_text;

-- ── 익명 ────────────────────────────────────────────────────────────────────

select set_config('request.jwt.claim.sub', '', true);
set local role anon;

-- 테이블 직접 읽기: 남의 비밀글은 행째 없다. 본문·답변을 꺼낼 컬럼 경로가 없다.
select 1 / case when (
  select count(*) from public.product_questions where good_id = 'pqs-g1'
) = 1 and not exists (
  select 1 from public.product_questions where id = :'secret_id'::uuid
) and not exists (
  select 1 from public.product_questions where good_id = 'pqs-g1' and is_secret
) and (
  select body = '공개 본문: 사이즈가 궁금해요' and answer_body = '공개 답변: 가로 10cm입니다.'
  from public.product_questions where id = :'open_id'::uuid
) then 1 else 0 end as assert_anon_table_hides_secret_row;

-- 공개 목록: 비밀글도 자리를 지키고 본문·답변·작성자만 비어 있다.
do $$
declare
  list jsonb := public.good_product_questions('pqs-g1', 10, 0);
  masked jsonb := pg_temp.list_row(list, current_setting('test.secret_id')::uuid);
  open_row jsonb := pg_temp.list_row(list, current_setting('test.open_id')::uuid);
begin
  if (list->>'count')::integer is distinct from 2 or jsonb_array_length(list->'rows') <> 2 then
    raise exception 'anon list should keep the secret row: %', list;
  end if;
  if masked is null or masked->>'masked' is distinct from 'true' or masked->>'isSecret' is distinct from 'true'
    or masked->'body' is distinct from 'null'::jsonb or masked->'answerBody' is distinct from 'null'::jsonb
    or masked->'userId' is distinct from 'null'::jsonb or masked->'answeredAt' is distinct from 'null'::jsonb
    or masked->>'answered' is distinct from 'true' or masked->>'createdAt' is null then
    raise exception 'anon secret row not masked: %', masked;
  end if;
  if position('비밀 본문' in list::text) > 0 or position('비밀 답변' in list::text) > 0
    or position('00000000-0000-4000-8000-000000231001' in masked::text) > 0 then
    raise exception 'anon list leaks secret text: %', list;
  end if;
  if open_row->>'masked' is distinct from 'false' or open_row->>'isSecret' is distinct from 'false'
    or open_row->>'body' is distinct from '공개 본문: 사이즈가 궁금해요'
    or open_row->>'answerBody' is distinct from '공개 답변: 가로 10cm입니다.'
    or open_row->>'userId' is distinct from '00000000-0000-4000-8000-000000231001' then
    raise exception 'anon open row changed: %', open_row;
  end if;
end;
$$;

-- ── 다른 회원 ───────────────────────────────────────────────────────────────

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000231002', true);
set local role authenticated;

select 1 / case when not exists (
  select 1 from public.product_questions where id = :'secret_id'::uuid
) and (
  select count(*) from public.product_questions where good_id = 'pqs-g1'
) = 1 then 1 else 0 end as assert_other_user_table_hides_secret_row;

do $$
declare
  list jsonb := public.good_product_questions('pqs-g1', 10, 0);
  masked jsonb := pg_temp.list_row(list, current_setting('test.secret_id')::uuid);
begin
  if (list->>'count')::integer is distinct from 2 or masked->>'masked' is distinct from 'true' or masked->'body' is distinct from 'null'::jsonb
    or position('비밀 본문' in list::text) > 0 or position('비밀 답변' in list::text) > 0 then
    raise exception 'other user should get a masked row: %', list;
  end if;
end;
$$;

-- 남의 비밀글은 지울 수도 없다(보이지 않는 행이라 0행).
delete from public.product_questions where id = :'secret_id'::uuid;

-- ── cs.manage 없는 운영자 ──────────────────────────────────────────────────

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000231004', true);

select 1 / case when not exists (
  select 1 from public.product_questions where id = :'secret_id'::uuid
) then 1 else 0 end as assert_logistics_staff_table_hides_secret_row;

do $$
declare
  masked jsonb := pg_temp.list_row(public.good_product_questions('pqs-g1', 10, 0), current_setting('test.secret_id')::uuid);
begin
  if masked->>'masked' is distinct from 'true' or masked->'body' is distinct from 'null'::jsonb then
    raise exception 'staff without cs.manage should get a masked row: %', masked;
  end if;
end;
$$;

-- ── 작성자 ──────────────────────────────────────────────────────────────────

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000231001', true);

-- /my/questions 경로: 본인 비밀글은 본문·답변까지 테이블에서 그대로 읽힌다.
select 1 / case when (
  select body = '비밀 본문: 배송지 변경이 가능한가요?'
    and answer_body = '비밀 답변: 출고 전이면 바꿀 수 있습니다.'
    and is_secret
  from public.product_questions where id = :'secret_id'::uuid
) and (
  select count(*) from public.product_questions where user_id = '00000000-0000-4000-8000-000000231001'
) = 2 then 1 else 0 end as assert_author_reads_own_secret_row;

do $$
declare
  list jsonb := public.good_product_questions('pqs-g1', 10, 0);
  own jsonb := pg_temp.list_row(list, current_setting('test.secret_id')::uuid);
begin
  if (list->>'count')::integer is distinct from 2 or own->>'masked' is distinct from 'false' or own->>'isSecret' is distinct from 'true'
    or own->>'body' is distinct from '비밀 본문: 배송지 변경이 가능한가요?'
    or own->>'answerBody' is distinct from '비밀 답변: 출고 전이면 바꿀 수 있습니다.'
    or own->>'userId' is distinct from '00000000-0000-4000-8000-000000231001' or own->>'answeredAt' is null then
    raise exception 'author should read own secret row: %', own;
  end if;
end;
$$;

-- ── cs.manage 운영자 ────────────────────────────────────────────────────────

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000231003', true);

-- 어드민 문의 관리 경로: 테이블 직접 읽기로 비밀글 원문·답변을 본다.
select 1 / case when (
  select body = '비밀 본문: 배송지 변경이 가능한가요?' and is_secret
  from public.product_questions where id = :'secret_id'::uuid
) and (
  select count(*) from public.product_questions where good_id = 'pqs-g1'
) = 2 then 1 else 0 end as assert_cs_staff_reads_secret_row;

do $$
declare
  own jsonb := pg_temp.list_row(public.good_product_questions('pqs-g1', 10, 0), current_setting('test.secret_id')::uuid);
begin
  if own->>'masked' is distinct from 'false' or own->>'body' is distinct from '비밀 본문: 배송지 변경이 가능한가요?' then
    raise exception 'cs staff should read secret row: %', own;
  end if;
end;
$$;

-- ── 블라인드·페이지 ─────────────────────────────────────────────────────────

-- 블라인드된 비밀글은 공개 목록에서 빠진다(자리도 남지 않는다). 작성자에게는 테이블에서 계속 보인다.
select public.admin_set_product_question_visibility(:'secret_id'::uuid, true);

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;

do $$
declare list jsonb := public.good_product_questions('pqs-g1', 10, 0);
begin
  if (list->>'count')::integer is distinct from 1 or pg_temp.list_row(list, current_setting('test.secret_id')::uuid) is not null then
    raise exception 'hidden secret row must leave the public list: %', list;
  end if;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000231001', true);
set local role authenticated;

select 1 / case when (
  select status = 'hidden' and is_secret from public.product_questions where id = :'secret_id'::uuid
) and (
  select (public.good_product_questions('pqs-g1', 10, 0)->>'count')::integer
) = 1 then 1 else 0 end as assert_author_keeps_hidden_secret_row_off_public_list;

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000231003', true);
set local role authenticated;
select public.admin_set_product_question_visibility(:'secret_id'::uuid, false);

-- 범위를 벗어난 페이지도 전체 건수를 알려 준다(빈 페이지 ≠ 질문 없음). 한도는 1~50으로 접힌다.
reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;

select 1 / case when (
  select (list->>'count')::integer = 2 and jsonb_array_length(list->'rows') = 0
  from (select public.good_product_questions('pqs-g1', 10, 40) as list) as page
) and (
  select (list->>'count')::integer = 2 and jsonb_array_length(list->'rows') = 1
    and list->'rows'->0->>'id' = current_setting('test.open_id')
  from (select public.good_product_questions('pqs-g1', 0, 0) as list) as page
) and (
  select (list->>'count')::integer = 0 and list->'rows' = '[]'::jsonb
  from (select public.good_product_questions('pqs-missing', 10, 0) as list) as page
) then 1 else 0 end as assert_public_list_paging;

-- ── 작성자 삭제 ─────────────────────────────────────────────────────────────

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000231001', true);
set local role authenticated;
delete from public.product_questions where id = :'secret_id'::uuid;

reset role;
select 1 / case when not exists (
  select 1 from public.product_questions where id = :'secret_id'::uuid
) then 1 else 0 end as assert_author_deletes_own_secret_row;

rollback;
