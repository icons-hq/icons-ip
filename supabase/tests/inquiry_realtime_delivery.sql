\set ON_ERROR_STOP on
begin;
-- A hostile subscriber may omit every client-side filter and column selection.
select 1 / case when exists (
 select 1 from pg_publication where pubname='supabase_realtime' and pubinsert and pubupdate and not pubdelete and not pubtruncate
) then 1 else 0 end as assert_realtime_never_emits_unfiltered_deletions;
select 1 / case when (
 select count(*) from pg_publication_tables where pubname='supabase_realtime' and schemaname='public'
 and tablename in ('inquiries','inquiry_messages')
)=2 and not exists (
 select 1 from pg_publication_tables where pubname='supabase_realtime'
 and tablename in ('inquiry_internal_notes','customer_notes','audit_log')
) then 1 else 0 end as assert_only_conversation_rows_are_published;
select 1 / case when not has_table_privilege('authenticated','public.inquiries','select')
 and has_column_privilege('authenticated','public.inquiries','id','select')
 and has_column_privilege('authenticated','public.inquiries','status','select')
 and not has_column_privilege('authenticated','public.inquiries','assignee_id','select')
 and not has_column_privilege('authenticated','public.inquiries','handled_by','select')
 and not has_column_privilege('authenticated','public.inquiries','waiting_since','select')
 and not has_column_privilege('authenticated','public.inquiry_messages','author_id','select')
 and has_column_privilege('authenticated','public.inquiry_messages','body','select')
 then 1 else 0 end as assert_staff_identity_is_not_in_public_payload;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('00000000-0000-4000-8000-00000000432'||n)::uuid,'authenticated','authenticated','realtime-'||n||'@qa.test',now(),'{}','{}',now(),now()
from generate_series(1,3) n;
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000004323';
insert into public.inquiries(id,user_id,category,title,assignee_id)
values ('10000000-0000-4000-8000-000000004321','00000000-0000-4000-8000-000000004321','etc','내 문의','00000000-0000-4000-8000-000000004323'),
 ('10000000-0000-4000-8000-000000004322','00000000-0000-4000-8000-000000004322','etc','다른 고객 문의',null);
insert into public.inquiry_messages(id,inquiry_id,author,author_id,body)
values ('20000000-0000-4000-8000-000000004321','10000000-0000-4000-8000-000000004321','user','00000000-0000-4000-8000-000000004321','내 질문'),
 ('20000000-0000-4000-8000-000000004322','10000000-0000-4000-8000-000000004322','user','00000000-0000-4000-8000-000000004322','다른 질문');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004321',true);
set local role authenticated;
select 1 / case when (select count(id) from public.inquiries where id in ('10000000-0000-4000-8000-000000004321','10000000-0000-4000-8000-000000004322'))=1
 and (select count(id) from public.inquiry_messages where id in ('20000000-0000-4000-8000-000000004321','20000000-0000-4000-8000-000000004322'))=1
 then 1 else 0 end as assert_owner_row_filter;
do $$ begin
 begin perform assignee_id from public.inquiries; raise exception 'assignee exposed'; exception when insufficient_privilege then null; end;
 begin perform author_id from public.inquiry_messages; raise exception 'author identity exposed'; exception when insufficient_privilege then null; end;
 begin perform public.admin_inquiry_workspace('10000000-0000-4000-8000-000000004321'); raise exception 'staff workspace exposed'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004323',true);
select 1 / case when (select count(id) from public.inquiries where id in ('10000000-0000-4000-8000-000000004321','10000000-0000-4000-8000-000000004322'))=2
 and public.admin_inquiry_workspace('10000000-0000-4000-8000-000000004321')->>'assigneeId'='00000000-0000-4000-8000-000000004323'
 then 1 else 0 end as assert_staff_keeps_assignment_workspace;
reset role;
rollback;
