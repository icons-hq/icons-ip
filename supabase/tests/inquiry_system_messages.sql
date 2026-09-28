\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-4000-8000-000000051301','authenticated','authenticated','auto-customer@example.test',now(),'{}','{}',now(),now()),
('00000000-0000-4000-8000-000000051302','authenticated','authenticated','auto-other@example.test',now(),'{}','{}',now(),now()),
('00000000-0000-4000-8000-000000051303','authenticated','authenticated','auto-operator@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff',nickname='실제 답변자' where id='00000000-0000-4000-8000-000000051303';
update public.store_settings set inquiry_auto_replies=jsonb_set(inquiry_auto_replies,'{order}','{"enabled":true,"body":"자주 묻는 질문 https://iconsip.com/help"}');
select count(*) as notifications_before from public.notifications \gset
select count(*) as emails_before from public.email_deliveries \gset
select 1/case when not has_function_privilege('authenticated','private.create_inquiry_before_system_notice(text,text,text,uuid,text,text[])','execute')
  and not has_function_privilege('anon','public.create_inquiry(text,text,text,uuid,text,text[])','execute')
  and not has_function_privilege('service_role','public.create_inquiry(text,text,text,uuid,text,text[])','execute')
  and not has_column_privilege('authenticated','public.inquiry_messages','author_id','select')
  and not has_table_privilege('authenticated','public.inquiry_messages','insert') then 1 else 0 end as preserve_acl;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000051303',true);
select total as open_before from public.admin_inquiry_status_counts() where status='open' \gset
select (public.admin_customer_report(now()-interval '1 second',now()+interval '1 second')->'inquiries'->>'unanswered')::int as unanswered_before \gset
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000051301',true);
select public.create_inquiry('order','자동 안내 문의','본인 질문') as auto_thread \gset
select public.create_inquiry('etc','꺼진 안내 문의','본인 질문') as off_thread \gset
select 1/case when (select array_agg(author order by created_at,id) from public.inquiry_messages where inquiry_id=:'auto_thread')=array['user','system']
  and (select count(*) from public.inquiry_messages where inquiry_id=:'off_thread')=1 then 1 else 0 end as creation_and_order;
select public.append_inquiry_message(:'auto_thread','추가 질문');
select 1/case when (select count(*) from public.inquiry_messages where inquiry_id=:'auto_thread' and author='system')=1 then 1 else 0 end as no_duplicate_notice_on_reply;
select 1/case when not exists(select 1 from public.inquiry_message_author_names(:'auto_thread')) then 1 else 0 end as no_system_responder_name;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000051302',true);
select 1/case when not exists(select 1 from public.inquiry_messages where inquiry_id=:'auto_thread') then 1 else 0 end as no_other_customer_read;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000051303',true);
select 1/case when (select total from public.admin_inquiry_status_counts() where status='open')=:'open_before'::int+2
  and (public.admin_customer_report(now()-interval '1 second',now()+interval '1 second')->'inquiries'->>'unanswered')::int=:'unanswered_before'::int+2
  and public.admin_inquiry_workspace(:'auto_thread')->>'assigneeId' is null then 1 else 0 end as still_unanswered_unassigned;
reset role;
select 1/case when exists(select 1 from public.inquiries where id=:'auto_thread' and status='open' and answered_at is null and handled_by is null and assignee_id is null and waiting_since=created_at)
  and exists(select 1 from public.inquiry_messages where inquiry_id=:'auto_thread' and author='system' and author_id is null)
  and (select count(*) from public.notifications)=:'notifications_before'::int
  and (select count(*) from public.email_deliveries)=:'emails_before'::int then 1 else 0 end as no_staff_state_or_notifications;
select set_config('test.auto_thread',:'auto_thread',true);
do $$ declare thread_id uuid:=current_setting('test.auto_thread')::uuid; begin
  begin
    insert into public.inquiry_messages(inquiry_id,author,author_id,body) values(thread_id,'staff',null,'잘못된 답변');
    raise exception 'staff null identity allowed';
  exception when check_violation then null; end;
  begin
    insert into public.inquiry_messages(inquiry_id,author,author_id,body) values(thread_id,'user',null,'잘못된 질문');
    raise exception 'user null identity allowed';
  exception when check_violation then null; end;
  begin
    insert into public.inquiry_messages(inquiry_id,author,author_id,body) values(thread_id,'system','00000000-0000-4000-8000-000000051303','잘못된 안내');
    raise exception 'system profile allowed';
  exception when check_violation then null; end;
end $$;
-- Any failure recording the notice rolls back the inquiry and initial user message as well.
create function pg_temp.reject_test_notice() returns trigger language plpgsql as $$ begin
  if new.author='system' then raise check_violation using message='synthetic_notice_failure'; end if;
  return new;
end $$;
create trigger test_reject_system_notice before insert on public.inquiry_messages for each row execute function pg_temp.reject_test_notice();
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000051301',true);
do $$ begin
  perform public.create_inquiry('order','롤백 확인','질문');
  raise exception 'failed notice accepted';
exception when check_violation then
  if sqlerrm<>'synthetic_notice_failure' then raise; end if;
end $$;
select 1/case when not exists(select 1 from public.inquiries where title='롤백 확인') then 1 else 0 end as atomic_inquiry_creation;
rollback;
