\set ON_ERROR_STOP on
-- 1014-105 처리 이력: 문의마다의 처리 이력(담당 지정·변경·답변·완료 — 누가·언제)은 그 문의를 여는 운영자(cs.manage) 누구나,
-- 운영자별 집계·처리 목록은 매니저 관리 권한(operators.manage)만 보고 열람이 감사된다. 원본은 실제 RPC가 남긴 감사 기록이다.
-- 합성 계정·문의·감사 기록은 모두 롤백한다. legacy helper 없이 명시적 매니저 역할과 고정 호환 명단(cohort)으로 판정한다.
begin;
create schema operator_history_test;
create function operator_history_test.id(n integer) returns uuid language sql immutable as $$
  select ('a1050000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function operator_history_test.actor(n integer) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub',operator_history_test.id(n)::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',operator_history_test.id(n),'role','authenticated')::text,true);
end $$;
create function operator_history_test.ok(ok boolean,label text) returns void language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'operator inquiry history assertion: %',label;end if;raise notice 'PASS %',label;
end $$;
create function operator_history_test.error(q text,expected text) returns void language plpgsql as $$ begin
  begin execute q;
  exception when others then if sqlstate=expected or position(expected in sqlerrm)>0 then raise notice 'PASS rejected %',expected;return;end if;raise;end;
  raise exception 'Expected rejection: %',expected;
end $$;
create function operator_history_test.today() returns date language sql stable as $$ select (now() at time zone 'Asia/Seoul')::date $$;
revoke all on all functions in schema operator_history_test from public;
grant usage on schema operator_history_test to authenticated;
grant execute on all functions in schema operator_history_test to authenticated;

select operator_history_test.ok(not has_function_privilege('anon','public.admin_inquiry_processing_history(uuid)','execute')
  and not has_function_privilege('service_role','public.admin_inquiry_processing_history(uuid)','execute')
  and not has_function_privilege('anon','public.admin_operator_inquiry_history(date,date,uuid,integer)','execute')
  and not has_function_privilege('service_role','public.admin_operator_inquiry_history(date,date,uuid,integer)','execute')
  and has_function_privilege('authenticated','public.admin_operator_inquiry_history(date,date,uuid,integer)','execute'),'least privilege ACLs');
select operator_history_test.ok((select provolatile='s' from pg_proc where oid='public.admin_inquiry_processing_history(uuid)'::regprocedure)
  and (select provolatile='v' from pg_proc where oid='public.admin_operator_inquiry_history(date,date,uuid,integer)'::regprocedure),
  'per-inquiry read is stable; the audited operator view is volatile');

-- 1 고객, 2 통합 매니저, 3 계정 주매니저, 4 부매니저, 5 대행사, 6 물류출고관리, 7 호환 단계 admin, 8 호환 단계 staff, 9 부매니저(인계 대상).
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select operator_history_test.id(n),'authenticated','authenticated','operator-history-'||n||'@example.test',now(),
  '{"testFixture":"operator-inquiry-history"}','{}',now(),now() from generate_series(1,9)n;
update public.profiles set role=case when id=operator_history_test.id(1) then 'user'::public.user_role
    when id in(operator_history_test.id(2),operator_history_test.id(7)) then 'admin'::public.user_role else 'staff'::public.user_role end,
  nickname=case when id=operator_history_test.id(9) then null else '처리이력 합성 '||right(id::text,1) end,
  birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
where id in(select operator_history_test.id(n) from generate_series(1,9)n);
insert into private.operator_memberships(profile_id,manager_role) values
  (operator_history_test.id(3),'primary'),(operator_history_test.id(4),'deputy'),(operator_history_test.id(5),'agency'),
  (operator_history_test.id(6),'logistics'),(operator_history_test.id(9),'deputy');
-- 통합 매니저는 하나뿐이다. 이미 있으면 그 행을 잠시 이 합성 계정으로 옮긴다(롤백).
delete from private.operator_memberships where manager_role='owner';
insert into private.operator_memberships(profile_id,manager_role) values(operator_history_test.id(2),'owner');
insert into private.operator_legacy_cohort(profile_id,legacy_role) values
  (operator_history_test.id(7),'admin'),(operator_history_test.id(8),'staff');
insert into public.inquiries(id,user_id,category,title) values
  (operator_history_test.id(101),operator_history_test.id(1),'order','처리이력 합성 배송 문의'),
  (operator_history_test.id(102),operator_history_test.id(1),'etc','처리이력 합성 자동 종결 문의'),
  (operator_history_test.id(103),operator_history_test.id(1),'good','처리이력 합성 미처리 문의');
insert into public.inquiry_messages(inquiry_id,author,author_id,body)
select operator_history_test.id(100+n),'user',operator_history_test.id(1),'합성 고객 질문 '||n from generate_series(1,3)n;

-- 실제 처리: 부매니저 답변(첫 답변 담당 지정) → 대행사가 부매니저(9)에게 인계 → 부매니저(9) 완료. 102는 답변 뒤 7일 무응답 자동 종결.
set local role authenticated;
select operator_history_test.actor(4);
select count(*) from public.admin_answer_inquiry(operator_history_test.id(101),'합성 운영자 답변');
select count(*) from public.admin_answer_inquiry(operator_history_test.id(102),'합성 운영자 답변 2');
select operator_history_test.actor(5);
select public.admin_reassign_inquiry(operator_history_test.id(101),operator_history_test.id(9),'합성 인계 사유');
select operator_history_test.actor(9);
select public.admin_close_inquiry(operator_history_test.id(101));
reset role;
-- 한 트랜잭션 안의 기록은 시각이 같아 순서를 고정한다(실제 운영에서는 처리 시각이 다르다).
update public.audit_log set created_at=now()-case action when 'admin.inquiry.assigned' then interval '50 minutes'
  when 'admin.inquiry.answered' then interval '49 minutes' when 'admin.inquiry.reassigned' then interval '40 minutes' else interval '30 minutes' end
where target in('inquiries:'||operator_history_test.id(101),'inquiries:'||operator_history_test.id(102))
  and action in('admin.inquiry.assigned','admin.inquiry.answered','admin.inquiry.reassigned','admin.inquiry.closed');
update public.inquiries set last_message_at=now()-interval '8 days' where id=operator_history_test.id(102);
select public.close_stale_answered_inquiries()>=1 as auto_closed;
select operator_history_test.ok((select status='closed' from public.inquiries where id=operator_history_test.id(102)),'stale answered inquiry auto-closed');

set local role authenticated;
-- 문의마다의 처리 이력: 그 문의를 여는 부매니저·대행사도 본다.
select operator_history_test.actor(4);
create temp table history_101 on commit drop as select public.admin_inquiry_processing_history(operator_history_test.id(101)) as body;
select operator_history_test.ok((select jsonb_path_query_array(body,'$.events[*].kind')='["assigned","answered","reassigned","closed"]'::jsonb
  and (body->>'total')::int=4 from history_101),'assignment, answer, reassignment and completion in time order');
select operator_history_test.ok((select body#>>'{events,0,toName}'='처리이력 합성 4' and body#>>'{events,1,actorName}'='처리이력 합성 4'
  and body#>>'{events,2,actorName}'='처리이력 합성 5' and body#>>'{events,2,fromName}'='처리이력 합성 4'
  and body#>>'{events,2,toName}'='운영자_'||left(operator_history_test.id(9)::text,6) and body#>>'{events,2,reason}'='합성 인계 사유'
  and body#>>'{events,3,actorName}'='운영자_'||left(operator_history_test.id(9)::text,6) from history_101),'who did each step, with the reassignment reason');
select operator_history_test.ok((select jsonb_path_query_array(public.admin_inquiry_processing_history(operator_history_test.id(102)),'$.events[*].kind')
  ='["assigned","answered","auto_closed"]'::jsonb),'an automatic close shows without an operator');
select operator_history_test.ok((select public.admin_inquiry_processing_history(operator_history_test.id(102))#>'{events,2,actorName}')='null'::jsonb,'automatic close has no actor');
select operator_history_test.ok((select public.admin_inquiry_processing_history(operator_history_test.id(103))->'events')='[]'::jsonb,'an untouched inquiry has no processing events');
select operator_history_test.actor(5);
select operator_history_test.ok((select (public.admin_inquiry_processing_history(operator_history_test.id(101))->>'total')::int)=4,'agency reads the inquiry history');
select operator_history_test.error($q$select public.admin_inquiry_processing_history('a1050000-0000-4000-8000-000000000999')$q$,'P0002');
select operator_history_test.error($q$select public.admin_inquiry_processing_history(null)$q$,'22023');
select operator_history_test.actor(6);
select operator_history_test.error($q$select public.admin_inquiry_processing_history(operator_history_test.id(101))$q$,'42501');
select operator_history_test.actor(1);
select operator_history_test.error($q$select public.admin_inquiry_processing_history(operator_history_test.id(101))$q$,'42501');

-- 운영자별 집계는 매니저 관리 권한만.
select operator_history_test.actor(4);
select operator_history_test.error($q$select public.admin_operator_inquiry_history(operator_history_test.today()-1,operator_history_test.today())$q$,'42501');
select operator_history_test.actor(5);
select operator_history_test.error($q$select public.admin_operator_inquiry_history(operator_history_test.today()-1,operator_history_test.today())$q$,'42501');
select operator_history_test.actor(8);
select operator_history_test.error($q$select public.admin_operator_inquiry_history(operator_history_test.today()-1,operator_history_test.today())$q$,'42501');
select operator_history_test.actor(6);
select operator_history_test.error($q$select public.admin_operator_inquiry_history(operator_history_test.today()-1,operator_history_test.today())$q$,'42501');

select operator_history_test.actor(2);
create temp table operator_summary on commit drop as
  select public.admin_operator_inquiry_history(operator_history_test.today()-1,operator_history_test.today()) as body;
create temp table operator_rows on commit drop as
  select item from operator_summary,jsonb_array_elements(body->'operators') item
  where item->>'operatorId' in(operator_history_test.id(4)::text,operator_history_test.id(5)::text,operator_history_test.id(9)::text);
select operator_history_test.ok((select count(*) from operator_rows)=3 and (select body->'detail' from operator_summary)='null'::jsonb,'summary lists each processing operator without detail');
select operator_history_test.ok((select (item->>'answers')::int=2 and (item->>'closes')::int=0 and (item->>'reassignments')::int=0 and (item->>'inquiries')::int=2
  and item->>'managerRole'='deputy' and item->>'name'='처리이력 합성 4' from operator_rows where item->>'operatorId'=operator_history_test.id(4)::text),
  'deputy: two answers on two inquiries; the automatic first-reply assignment is not counted separately');
select operator_history_test.ok((select (item->>'reassignments')::int=1 and (item->>'answers')::int=0 and item->>'managerRole'='agency'
  from operator_rows where item->>'operatorId'=operator_history_test.id(5)::text),'agency: one reassignment');
select operator_history_test.ok((select (item->>'closes')::int=1 and (item->>'answers')::int=0
  from operator_rows where item->>'operatorId'=operator_history_test.id(9)::text),'closing operator: one completion; the automatic close counts for nobody');
select operator_history_test.ok((select (item->>'lastAt')::timestamptz=now()-interval '30 minutes' from operator_rows where item->>'operatorId'=operator_history_test.id(9)::text),'last processing time');
create temp table operator_detail on commit drop as
  select public.admin_operator_inquiry_history(operator_history_test.today()-1,operator_history_test.today(),operator_history_test.id(5),1)->'detail' as body;
select operator_history_test.ok((select (body->>'total')::int=1 and body#>>'{items,0,kind}'='reassigned' and body#>>'{items,0,inquiryId}'=operator_history_test.id(101)::text
  and body#>>'{items,0,title}'='처리이력 합성 배송 문의' and body#>>'{items,0,status}'='closed' and body#>>'{items,0,fromName}'='처리이력 합성 4'
  and (body#>>'{items,0,reference}')::bigint>0 from operator_detail),'operator detail lists the inquiry, kind, reassignment and current status');
select operator_history_test.ok((select (public.admin_operator_inquiry_history(operator_history_test.today()-1,operator_history_test.today(),operator_history_test.id(4),9)#>>'{detail,page}')::int)=1,
  'detail page clamps to the last page');
select operator_history_test.ok((select public.admin_operator_inquiry_history('2020-01-01','2020-01-31')->'operators')='[]'::jsonb,'a period without processing is empty');
select operator_history_test.error($q$select public.admin_operator_inquiry_history(operator_history_test.today(),operator_history_test.today()-1)$q$,'22023');
select operator_history_test.error($q$select public.admin_operator_inquiry_history(operator_history_test.today()-367,operator_history_test.today())$q$,'22023');
select operator_history_test.error($q$select public.admin_operator_inquiry_history(null,operator_history_test.today())$q$,'22023');
select operator_history_test.actor(3);
select operator_history_test.ok((select jsonb_array_length(public.admin_operator_inquiry_history(operator_history_test.today()-1,operator_history_test.today())->'operators'))>=3,'primary manager reads the summary');
select operator_history_test.actor(7);
select operator_history_test.ok((select jsonb_array_length(public.admin_operator_inquiry_history(operator_history_test.today()-1,operator_history_test.today())->'operators'))>=3,'legacy admin reads the summary');
reset role;

-- 집계 열람은 매번 감사한다(조회 조건 포함). 거절된 호출은 남지 않는다.
select operator_history_test.ok((select count(*) from public.audit_log where action='admin.operator.inquiry_history_viewed' and actor_id=operator_history_test.id(2))=4,
  'every operator summary view by the owner is audited');
select operator_history_test.ok((select diff->>'operatorId'=operator_history_test.id(5)::text and (diff->>'page')::int=1 and diff->>'from'=(operator_history_test.today()-1)::text
  from public.audit_log where action='admin.operator.inquiry_history_viewed' and actor_id=operator_history_test.id(2) and diff->>'operatorId'=operator_history_test.id(5)::text),
  'view audit records the period and selected operator');
select operator_history_test.ok(not exists(select 1 from public.audit_log where action='admin.operator.inquiry_history_viewed'
  and actor_id in(operator_history_test.id(4),operator_history_test.id(5),operator_history_test.id(6),operator_history_test.id(8))),'rejected callers leave no view audit');
select operator_history_test.ok((select count(*) from private.operator_rpc_contracts where (signature='public.admin_inquiry_processing_history(uuid)' and capability='cs.manage')
  or (signature='public.admin_operator_inquiry_history(date,date,uuid,integer)' and capability='operators.manage'))=2,'registered operator RPC contracts');
select operator_history_test.ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='audit_log_inquiry_processing_idx'),'processing audit index');
rollback;
