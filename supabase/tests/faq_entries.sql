\set ON_ERROR_STOP on
begin;

-- FAQ #431: public reads never expose drafts; only active staff can mutate via audited RPC.
select 1 / case when (
  has_table_privilege('anon', 'public.faq_entries', 'select')
  and has_table_privilege('authenticated', 'public.faq_entries', 'select')
  and not has_table_privilege('authenticated', 'public.faq_entries', 'insert,update,delete')
  and not has_table_privilege('service_role', 'public.faq_entries', 'insert,update,delete')
  and not has_function_privilege('anon', 'public.admin_save_faq_entry(uuid,text,text,text,integer,boolean,timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_save_faq_entry(uuid,text,text,text,integer,boolean,timestamptz)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_save_faq_entry(uuid,text,text,text,integer,boolean,timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.admin_delete_faq_entry(uuid,timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_delete_faq_entry(uuid,timestamptz)', 'execute')
) then 1 else 0 end as assert_faq_acl;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
('00000000-0000-4000-8000-000000043101','authenticated','authenticated','faq-staff@example.test',now(),'{}','{}',now(),now()),
('00000000-0000-4000-8000-000000043102','authenticated','authenticated','faq-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set role = 'staff' where id = '00000000-0000-4000-8000-000000043101';

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000043101',true);
select public.admin_save_faq_entry(null,'order','FAQ배송 언제 오나요?','주문 상세의 배송 정보를 확인하세요.',1,true,null) as public_id \gset
select public.admin_save_faq_entry(null,'account','FAQ비밀 초안','공개 전 내부 검토 답변',0,false,null) as draft_id \gset
select 1 / case when (select count(*) from public.faq_entries where question like 'FAQ%') = 2 then 1 else 0 end as assert_staff_reads_drafts;

set local role anon;
select set_config('request.jwt.claim.sub','',true);
select 1 / case when (select count(*) from public.faq_entries where question like 'FAQ%') = 1 then 1 else 0 end as assert_anon_published_only;
select 1 / case when (public.search_faq_entries('FAQ비밀','',20,0)->>'total')::int = 0 then 1 else 0 end as assert_search_hides_draft;
select 1 / case when (public.search_faq_entries('FAQ배송 언제 오나요','order',20,0)->>'total')::int = 1 then 1 else 0 end as assert_keyword_search;
select 1 / case when (public.search_faq_entries('FAQ배송','account',20,0)->>'total')::int = 0 then 1 else 0 end as assert_category_filter;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000043102',true);
select 1 / case when (select count(*) from public.faq_entries where question like 'FAQ%') = 1 then 1 else 0 end as assert_buyer_published_only;
do $$ begin
  perform public.admin_save_faq_entry(null,'order','악의적 FAQ','노출 금지',0,true,null);
  raise exception 'buyer write was allowed';
exception when insufficient_privilege then null; end $$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000043101',true);
select updated_at as original_updated_at from public.faq_entries where id = :'public_id' \gset
select public.admin_save_faq_entry(:'public_id','order','FAQ배송 변경 질문','수정 답변',4,false,:'original_updated_at');
do $$ declare target public.faq_entries; begin
  select * into target from public.faq_entries where question = 'FAQ배송 변경 질문';
  begin
    perform public.admin_save_faq_entry(target.id,'order','덮어쓰기','이전 버전',0,true,target.updated_at - interval '1 second');
    raise exception 'stale edit was allowed';
  exception when serialization_failure then null; end;
end $$;

set local role anon;
select set_config('request.jwt.claim.sub','',true);
select 1 / case when (public.search_faq_entries('FAQ배송','',20,0)->>'total')::int = 0 then 1 else 0 end as assert_unpublish_immediate;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000043101',true);
select updated_at as delete_updated_at from public.faq_entries where id = :'public_id' \gset
select public.admin_delete_faq_entry(:'public_id', :'delete_updated_at');
select 1 / case when not exists(select 1 from public.faq_entries where id = :'public_id') then 1 else 0 end as assert_delete;
reset role;
select 1 / case when (
  select count(*) from public.audit_log where actor_id = '00000000-0000-4000-8000-000000043101' and action in ('faq.create','faq.update','faq.delete')
) = 4 then 1 else 0 end as assert_faq_audit;

update public.profiles set suspended_at = now(), suspension_reason = 'FAQ 권한 테스트' where id = '00000000-0000-4000-8000-000000043101';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000043101',true);
do $$ begin
  perform public.admin_save_faq_entry(null,'order','정지 운영자','거절',0,true,null);
  raise exception 'suspended staff write was allowed';
exception when insufficient_privilege then null; end $$;
rollback;
