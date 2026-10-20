\set ON_ERROR_STOP on
begin;
-- Synthetic identities and all read receipts roll back together. No legacy helper.
create schema inquiry_chat_test;
create function inquiry_chat_test.id(n integer) returns uuid language sql immutable as $$
  select ('a20c0000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function inquiry_chat_test.actor(n integer) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub',inquiry_chat_test.id(n)::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',inquiry_chat_test.id(n),'role','authenticated')::text,true);
end $$;
create function inquiry_chat_test.ok(ok boolean,label text) returns void language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'inquiry chat assertion: %',label;end if;raise notice 'PASS %',label;
end $$;
create function inquiry_chat_test.error(q text,expected text) returns void language plpgsql as $$ begin
  begin execute q;
  exception when others then if sqlstate=expected or position(expected in sqlerrm)>0 then raise notice 'PASS rejected %',expected;return;end if;raise;end;
  raise exception 'Expected rejection: %',expected;
end $$;
revoke all on all functions in schema inquiry_chat_test from public;
grant usage on schema inquiry_chat_test to authenticated;
grant execute on all functions in schema inquiry_chat_test to authenticated;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select inquiry_chat_test.id(n),'authenticated','authenticated','inquiry-chat-'||n||'@example.test',now(),
  '{"testFixture":"inquiry-chat"}','{}',now(),now() from generate_series(1,5)n;
update public.profiles set role=case when id=inquiry_chat_test.id(1) then 'user'::public.user_role else 'staff'::public.user_role end,
  nickname='합성 상담계정 '||right(id::text,1),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
where id in(select inquiry_chat_test.id(n) from generate_series(1,5)n);
insert into private.operator_memberships(profile_id,manager_role) values
  (inquiry_chat_test.id(2),'primary'),(inquiry_chat_test.id(3),'deputy'),(inquiry_chat_test.id(4),'logistics'),(inquiry_chat_test.id(5),'deputy');
update public.profiles set suspended_at=now(),suspension_reason='합성 상담 권한 검사' where id=inquiry_chat_test.id(5);
insert into public.inquiries(id,user_id,category,title,status,created_at,last_message_at,answered_at,closed_at,assignee_id)
select inquiry_chat_test.id(200+n),inquiry_chat_test.id(1),'order','chat-fixture 대화 '||n,
  case n when 1 then 'open' when 2 then 'answered' else 'closed' end,
  now()-interval '2 days',now()-n*interval '1 hour',
  case when n>1 then now()-interval '1 day' else null end,case when n=3 then now() else null end,
  case n when 1 then null when 2 then inquiry_chat_test.id(2) else inquiry_chat_test.id(3) end
from generate_series(1,3)n;
insert into public.inquiry_messages(id,inquiry_id,author,author_id,body,created_at)
select inquiry_chat_test.id(300+n),inquiry_chat_test.id(200+n),'user',inquiry_chat_test.id(1),'chat-fixture 고객 본문 '||n,now()-n*interval '1 hour'
from generate_series(1,3)n;
insert into public.inquiry_messages(id,inquiry_id,author,author_id,body,created_at) values
  (inquiry_chat_test.id(311),inquiry_chat_test.id(201),'user',inquiry_chat_test.id(1),'추가 배송 질문',now()-interval '30 minutes'),
  (inquiry_chat_test.id(401),inquiry_chat_test.id(202),'staff',inquiry_chat_test.id(2),'합성 운영자 답변',now()-interval '20 minutes');
-- Stable filter fixture: one conversation is outside the default seven-day range.
update public.inquiries set last_message_at=case when id=inquiry_chat_test.id(203) then now()-interval '9 days'
  when id=inquiry_chat_test.id(202) then now()-interval '20 minutes' else now()-interval '30 minutes' end
where id in(select inquiry_chat_test.id(200+n) from generate_series(1,3)n);

select inquiry_chat_test.actor(2);
set local role authenticated;
select inquiry_chat_test.ok(public.admin_inquiry_chat_console(p_query=>'chat-fixture',p_period=>'all')->>'total'='3','all conversations counted before pagination');
select inquiry_chat_test.ok(public.admin_inquiry_chat_console(p_query=>'chat-fixture')->>'total'='2','recent period uses latest conversation timestamp');
select inquiry_chat_test.ok(public.admin_inquiry_chat_console(p_query=>'chat-fixture',p_period=>'all')->'counts'='{"all":3,"open":1,"answered":1,"closed":1}'::jsonb,'status counts describe current search and period');
select inquiry_chat_test.ok(public.admin_inquiry_chat_console(p_query=>'chat-fixture',p_period=>'all')->>'unreadMessages'='4','only actual customer messages contribute unread count');
select inquiry_chat_test.ok(public.admin_inquiry_chat_console(p_query=>'chat-fixture',p_limit=>1)#>>'{rows,0,id}'=inquiry_chat_test.id(202)::text,'recent order is applied before pagination');
select inquiry_chat_test.ok(public.admin_inquiry_chat_console(p_query=>'chat-fixture',p_period=>'all',p_sort=>'oldest',p_limit=>1)#>>'{rows,0,id}'=inquiry_chat_test.id(203)::text,'oldest order crosses status boundaries before pagination');
select inquiry_chat_test.ok(public.admin_inquiry_chat_console(p_query=>'추가 배송 질문')->>'total'='1','conversation body search works beyond the latest preview');
select inquiry_chat_test.ok(public.admin_inquiry_chat_console(p_query=>'chat-fixture',p_assignee=>'me')->>'total'='1','current operator assignee filter');
select inquiry_chat_test.ok(public.admin_inquiry_chat_console(p_query=>'chat-fixture',p_assignee=>'unassigned')->>'total'='1','unassigned filter');
select inquiry_chat_test.ok(public.admin_inquiry_chat_console(p_query=>'chat-fixture',p_assignee=>inquiry_chat_test.id(3)::text,p_period=>'all')->>'total'='1','exact assignee filter');

select inquiry_chat_test.ok(public.admin_mark_inquiry_chat_read(inquiry_chat_test.id(201),array[inquiry_chat_test.id(301)])=1,'displayed message is marked for this operator');
select inquiry_chat_test.ok(public.admin_mark_inquiry_chat_read(inquiry_chat_test.id(201),array[inquiry_chat_test.id(301),inquiry_chat_test.id(301)])=0,'repeated read is idempotent');
select inquiry_chat_test.ok(public.admin_inquiry_chat_console(p_query=>'chat-fixture',p_period=>'all')->>'unreadMessages'='3','unseen messages in the same conversation stay unread');
select inquiry_chat_test.error($q$select public.admin_mark_inquiry_chat_read(inquiry_chat_test.id(201),array[inquiry_chat_test.id(311),inquiry_chat_test.id(302)])$q$,'invalid_inquiry_chat_message');
select inquiry_chat_test.ok(public.admin_inquiry_chat_console(p_query=>'chat-fixture',p_period=>'all')->>'unreadMessages'='3','invalid mixed-thread receipt writes nothing');
select inquiry_chat_test.error($q$select public.admin_mark_inquiry_chat_read(inquiry_chat_test.id(202),array[inquiry_chat_test.id(401)])$q$,'invalid_inquiry_chat_message');
select inquiry_chat_test.ok(public.admin_mark_inquiry_chat_read(inquiry_chat_test.id(202),array[inquiry_chat_test.id(302)])=1,'second thread read');
select inquiry_chat_test.ok(public.admin_inquiry_chat_console(p_query=>'chat-fixture',p_period=>'all',p_read=>'read')->>'total'='1','read filter is a server global filter');
select inquiry_chat_test.ok(public.admin_inquiry_chat_console(p_query=>'chat-fixture',p_period=>'all',p_read=>'unread',p_limit=>1)->>'total'='2','unread filter totals precede pagination');
select inquiry_chat_test.ok(public.admin_inquiry_chat_console(p_query=>'chat-fixture',p_period=>'all',p_offset=>99)->'rows'='[]'::jsonb,'out of range page remains empty without discarding total');
select inquiry_chat_test.error($q$select public.admin_mark_inquiry_chat_read(inquiry_chat_test.id(201),'{}'::uuid[])$q$,'invalid_inquiry_chat_read');
select inquiry_chat_test.error($q$select public.admin_inquiry_chat_console(p_status=>'unknown')$q$,'invalid_inquiry_chat_filter');
select inquiry_chat_test.error($q$select public.admin_inquiry_chat_console(p_assignee=>'invalid')$q$,'invalid_inquiry_chat_filter');
select inquiry_chat_test.error($q$select public.admin_inquiry_chat_console(p_sort=>null)$q$,'invalid_inquiry_chat_filter');

select inquiry_chat_test.actor(3);
select inquiry_chat_test.ok(public.admin_inquiry_chat_console(p_query=>'chat-fixture',p_period=>'all')->>'unreadMessages'='4','other operators retain independent unread state');
select inquiry_chat_test.error($q$select * from private.inquiry_chat_reads$q$,'42501');
select inquiry_chat_test.actor(1);
select inquiry_chat_test.error($q$select public.admin_inquiry_chat_console()$q$,'42501');
select inquiry_chat_test.error($q$select public.admin_mark_inquiry_chat_read(inquiry_chat_test.id(201),array[inquiry_chat_test.id(301)])$q$,'42501');
select inquiry_chat_test.actor(4);
select inquiry_chat_test.error($q$select public.admin_inquiry_chat_console()$q$,'42501');
select inquiry_chat_test.error($q$select public.admin_mark_inquiry_chat_read(inquiry_chat_test.id(201),array[inquiry_chat_test.id(301)])$q$,'42501');
select inquiry_chat_test.actor(5);
select inquiry_chat_test.error($q$select public.admin_inquiry_chat_console()$q$,'42501');
reset role;
select inquiry_chat_test.ok(not has_function_privilege('anon','public.admin_inquiry_chat_console(text,text,text,text,text,text,integer,integer)','execute')
  and not has_function_privilege('service_role','public.admin_mark_inquiry_chat_read(uuid,uuid[])','execute')
  and not has_table_privilege('authenticated','private.inquiry_chat_reads','select,insert,update,delete')
  and not has_table_privilege('service_role','private.inquiry_chat_reads','select,insert,update,delete'),'least privilege ACLs');
select inquiry_chat_test.ok((select relrowsecurity from pg_class where oid='private.inquiry_chat_reads'::regclass),'private receipts retain RLS');
select inquiry_chat_test.ok((select count(*)=0 from public.email_deliveries where recipient like 'inquiry-chat-%@example.test'),'read receipts send no external email');
-- A newly committed message with the same timestamp and a smaller UUID was not
-- rendered in the earlier view. Exact-ID receipts must leave it unread.
insert into public.inquiry_messages(id,inquiry_id,author,author_id,body,created_at)
select inquiry_chat_test.id(299),inquiry_chat_test.id(201),'user',inquiry_chat_test.id(1),'조회 후 도착한 합성 메시지',created_at
from public.inquiry_messages where id=inquiry_chat_test.id(301);
select inquiry_chat_test.actor(2);
set local role authenticated;
select inquiry_chat_test.ok(public.admin_mark_inquiry_chat_read(inquiry_chat_test.id(201),array[inquiry_chat_test.id(301)])=0,'old view replay cannot consume a concurrent arrival');
select inquiry_chat_test.ok(public.admin_inquiry_chat_console(p_query=>'chat-fixture',p_period=>'all')->>'unreadMessages'='3','same-time lower UUID stays unread');
-- The right-hand context reads only the selected customer's other conversations.
select inquiry_chat_test.ok(public.admin_inquiry_chat_context(inquiry_chat_test.id(201))->>'previousCount'='2'
  and jsonb_array_length(public.admin_inquiry_chat_context(inquiry_chat_test.id(201))->'previous')=2,'previous conversations are available without a platform permission');
select inquiry_chat_test.ok(not exists(select 1 from jsonb_array_elements(public.admin_inquiry_chat_context(inquiry_chat_test.id(201))->'previous') row
  where row->>'id'=inquiry_chat_test.id(201)::text),'previous conversations exclude the selected thread');
select inquiry_chat_test.ok(public.admin_update_inquiry_chat_tag(inquiry_chat_test.id(2),inquiry_chat_test.id(201),' 배송대기 ',true)->'tags'='["배송대기"]'::jsonb,'explicit tag add trims and persists');
select inquiry_chat_test.ok(public.admin_update_inquiry_chat_tag(inquiry_chat_test.id(2),inquiry_chat_test.id(201),'배송대기',true)->'tags'='["배송대기"]'::jsonb,'same tag add is idempotent');
select inquiry_chat_test.ok(public.admin_inquiry_chat_console(p_query=>'배송대기',p_period=>'all')->>'total'='1','tag search happens before pagination');
select inquiry_chat_test.ok(public.admin_inquiry_chat_console(p_query=>'배송대기',p_period=>'all')#>'{rows,0,tags}'='["배송대기"]'::jsonb,'queue displays the actual saved tags');
select inquiry_chat_test.error($q$select public.admin_update_inquiry_chat_tag(inquiry_chat_test.id(3),inquiry_chat_test.id(201),'잘못된 계정',true)$q$,'inquiry_chat_actor_changed');
select inquiry_chat_test.error($q$select public.admin_update_inquiry_chat_tag(inquiry_chat_test.id(2),inquiry_chat_test.id(201),E'줄\n바꿈',true)$q$,'invalid_inquiry_chat_tag');
select inquiry_chat_test.error($q$select public.admin_update_inquiry_chat_tag(inquiry_chat_test.id(2),inquiry_chat_test.id(201),repeat('가',21),true)$q$,'invalid_inquiry_chat_tag');
do $$ begin
  for n in 1..9 loop perform public.admin_update_inquiry_chat_tag(inquiry_chat_test.id(2),inquiry_chat_test.id(201),'태그'||n,true);end loop;
end $$;
select inquiry_chat_test.error($q$select public.admin_update_inquiry_chat_tag(inquiry_chat_test.id(2),inquiry_chat_test.id(201),'열한번째',true)$q$,'inquiry_chat_tag_limit');
select inquiry_chat_test.ok(jsonb_array_length(public.admin_update_inquiry_chat_tag(inquiry_chat_test.id(2),inquiry_chat_test.id(201),'태그1',false)->'tags')=9,'tag removal changes only its own label');
select inquiry_chat_test.ok(jsonb_array_length(public.admin_update_inquiry_chat_tag(inquiry_chat_test.id(2),inquiry_chat_test.id(201),'태그1',false)->'tags')=9,'tag removal replay is idempotent');
select inquiry_chat_test.actor(3);
select inquiry_chat_test.ok(jsonb_array_length(public.admin_inquiry_chat_context(inquiry_chat_test.id(201))->'tags')=9,'tags are shared with authorized consultation operators');
select inquiry_chat_test.error($q$select * from private.inquiry_chat_tags$q$,'42501');
select inquiry_chat_test.actor(1);
select inquiry_chat_test.error($q$select public.admin_inquiry_chat_context(inquiry_chat_test.id(201))$q$,'42501');
select inquiry_chat_test.error($q$select public.admin_update_inquiry_chat_tag(inquiry_chat_test.id(1),inquiry_chat_test.id(201),'고객쓰기',true)$q$,'42501');
reset role;
select inquiry_chat_test.ok((select count(*)=1 from public.audit_log where target='inquiries:'||inquiry_chat_test.id(201)::text
  and action='admin.inquiry.chat_tag_changed' and diff->>'label'='배송대기'),'same tag replay has one audit record');
select inquiry_chat_test.ok(not has_table_privilege('authenticated','private.inquiry_chat_tags','select,insert,update,delete')
  and not has_function_privilege('anon','public.admin_inquiry_chat_context(uuid)','execute')
  and not has_function_privilege('service_role','public.admin_update_inquiry_chat_tag(uuid,uuid,text,boolean)','execute'),'private tag and history ACLs');
select inquiry_chat_test.ok((select status='open' and waiting_since is not null from public.inquiries where id=inquiry_chat_test.id(201)),'tags preserve inquiry status and waiting time');
rollback;
