\set ON_ERROR_STOP on

-- 상담 위젯 '버튼형 자주 묻는 질문'(0901-044) 스모크.
-- FAQ마다 위젯 버튼(delivery·cancel·return) 대표 지정을 본문과 한 트랜잭션으로 저장한다. 버튼마다 대표는 하나라
-- 다른 FAQ가 가진 버튼을 지정하면 그 FAQ의 지정이 풀리고 updated_at이 올라 열린 편집 폼의 덮어쓰기가 막힌다.
-- 지정 변경은 faq.widget_topic으로 감사하고, cs.manage 없는 운영자·구매자는 저장하지 못한다.
-- 공개 읽기는 기존 RLS 그대로라 익명은 공개 FAQ의 지정만 읽는다.

begin;

-- ── 스키마·ACL·운영자 계약 ────────────────────────────────────────────────

select 1 / case when (
  has_function_privilege('authenticated', 'public.admin_save_faq_entry_with_widget_topic(uuid,text,text,text,integer,boolean,timestamptz,text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_save_faq_entry_with_widget_topic(uuid,text,text,text,integer,boolean,timestamptz,text)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_save_faq_entry_with_widget_topic(uuid,text,text,text,integer,boolean,timestamptz,text)', 'execute')
  and (select prosecdef from pg_proc where oid = 'public.admin_save_faq_entry_with_widget_topic(uuid,text,text,text,integer,boolean,timestamptz,text)'::regprocedure)
  and not has_column_privilege('authenticated', 'public.faq_entries', 'widget_topic', 'update')
  and has_column_privilege('anon', 'public.faq_entries', 'widget_topic', 'select')
) then 1 else 0 end as assert_widget_topic_acl;

select 1 / case when exists (
  select 1 from private.operator_rpc_contracts
  where signature = 'public.admin_save_faq_entry_with_widget_topic(uuid,text,text,text,integer,boolean,timestamp with time zone,text)'
    and capability = 'cs.manage' and guard_kind = 'write' and not legacy_admin_only
) and exists (
  select 1 from private.operator_internal_contracts
  where signature = 'public.admin_save_faq_entry_with_widget_topic(uuid,text,text,text,integer,boolean,timestamp with time zone,text)'
) then 1 else 0 end as assert_operator_contract_registered;

select 1 / case when exists (
  select 1 from pg_indexes
  where schemaname = 'public' and tablename = 'faq_entries' and indexname = 'faq_entries_widget_topic_key'
    and indexdef like 'CREATE UNIQUE INDEX%' and indexdef like '%WHERE (widget_topic IS NOT NULL)%'
) then 1 else 0 end as assert_one_designation_per_topic_index;

-- ── 픽스처: cs.manage 운영자(primary), cs.manage 없는 운영자(logistics), 구매자 ──────────

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
 ('00000000-0000-4000-8000-000000904401','authenticated','authenticated','faq-widget-cs@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000904402','authenticated','authenticated','faq-widget-logistics@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000904403','authenticated','authenticated','faq-widget-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set role = 'staff'
 where id in ('00000000-0000-4000-8000-000000904401','00000000-0000-4000-8000-000000904402');
insert into private.operator_memberships(profile_id,manager_role) values
 ('00000000-0000-4000-8000-000000904401','primary'),
 ('00000000-0000-4000-8000-000000904402','logistics');

-- ── 지정·이동·해제 ─────────────────────────────────────────────────────────

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000904401',true);

select public.admin_save_faq_entry_with_widget_topic(null,'order','WT배송 언제 오나요?','결제 후 영업일 기준으로 출고합니다.',0,true,null,'delivery') as first_id \gset
select 1 / case when (select widget_topic from public.faq_entries where id = :'first_id') = 'delivery'
then 1 else 0 end as assert_new_faq_designated;

select updated_at as first_updated_at from public.faq_entries where id = :'first_id' \gset
select set_config('faq_widget_test.first_id', :'first_id', true);
select set_config('faq_widget_test.first_updated_at', :'first_updated_at', true);

-- 같은 버튼을 다른 FAQ에 지정하면 이전 FAQ의 지정이 풀리고 updated_at이 오른다.
select public.admin_save_faq_entry_with_widget_topic(null,'order','WT배송 안내(개정)','개정한 배송 안내입니다.',1,true,null,'delivery') as second_id \gset
select set_config('faq_widget_test.second_id', :'second_id', true);
select 1 / case when (select widget_topic from public.faq_entries where id = :'first_id') is null
  and (select updated_at from public.faq_entries where id = :'first_id') > :'first_updated_at'::timestamptz
  and (select widget_topic from public.faq_entries where id = :'second_id') = 'delivery'
  and (select count(*) from public.faq_entries where widget_topic = 'delivery') = 1
then 1 else 0 end as assert_designation_moved;

-- 밀려난 FAQ의 열린 편집 폼(옛 updated_at)은 지정을 되찾지 못한다.
do $$ begin
  perform public.admin_save_faq_entry_with_widget_topic(current_setting('faq_widget_test.first_id')::uuid,'order','WT배송 언제 오나요?',
    '결제 후 영업일 기준으로 출고합니다.',0,true,current_setting('faq_widget_test.first_updated_at')::timestamptz,'delivery');
  raise exception 'stale form re-took the widget topic';
exception when sqlstate 'PT409' then null; end $$;
select 1 / case when (select widget_topic from public.faq_entries where id = :'second_id') = 'delivery'
then 1 else 0 end as assert_stale_form_rejected;

-- 지정을 바꾸지 않는 저장은 지정 감사를 남기지 않는다.
select updated_at as second_updated_at from public.faq_entries where id = :'second_id' \gset
select public.admin_save_faq_entry_with_widget_topic(:'second_id','order','WT배송 안내(개정)','문구만 고쳤습니다.',1,true,:'second_updated_at','delivery');

-- 다른 버튼으로 옮기면 원래 버튼은 비고, 해제하면 지정이 사라진다.
select updated_at as second_updated_at from public.faq_entries where id = :'second_id' \gset
select public.admin_save_faq_entry_with_widget_topic(:'second_id','claim','WT반품 안내','주문 상세에서 요청합니다.',1,true,:'second_updated_at','return');
select 1 / case when (select widget_topic from public.faq_entries where id = :'second_id') = 'return'
  and not exists (select 1 from public.faq_entries where widget_topic = 'delivery')
then 1 else 0 end as assert_designation_switched;
select updated_at as second_updated_at from public.faq_entries where id = :'second_id' \gset
select public.admin_save_faq_entry_with_widget_topic(:'second_id','claim','WT반품 안내','주문 상세에서 요청합니다.',1,true,:'second_updated_at',null);
select 1 / case when (select widget_topic from public.faq_entries where id = :'second_id') is null
then 1 else 0 end as assert_designation_cleared;

-- 기존 본문 저장 RPC(admin_save_faq_entry)는 지정을 건드리지 않는다.
select public.admin_save_faq_entry_with_widget_topic(null,'claim','WT취소 안내','발주확인 전에는 주문 상세에서 취소할 수 있습니다.',2,true,null,'cancel') as cancel_id \gset
select updated_at as cancel_updated_at from public.faq_entries where id = :'cancel_id' \gset
select public.admin_save_faq_entry(:'cancel_id','claim','WT취소 안내','본문만 고친 취소 안내입니다.',2,true,:'cancel_updated_at');
select 1 / case when (select widget_topic from public.faq_entries where id = :'cancel_id') = 'cancel'
then 1 else 0 end as assert_legacy_save_keeps_designation;

-- 정해진 버튼 밖의 값은 거절한다.
do $$ begin
  perform public.admin_save_faq_entry_with_widget_topic(null,'order','WT잘못된 버튼','거절',0,true,null,'refund');
  raise exception 'unknown widget topic was saved';
exception when invalid_parameter_value then null; end $$;

-- ── 권한 ───────────────────────────────────────────────────────────────────

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000904402',true);
do $$ begin
  perform public.admin_save_faq_entry_with_widget_topic(null,'order','WT물류 계정','거절',0,true,null,'delivery');
  raise exception 'operator without cs.manage saved a widget topic';
exception when insufficient_privilege then null; end $$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000904403',true);
do $$ begin
  perform public.admin_save_faq_entry_with_widget_topic(null,'order','WT구매자','거절',0,true,null,'delivery');
  raise exception 'buyer saved a widget topic';
exception when insufficient_privilege then null; end $$;
do $$ begin
  update public.faq_entries set widget_topic = 'delivery' where question like 'WT%';
  raise exception 'buyer updated faq_entries directly';
exception when insufficient_privilege then null; end $$;

-- ── 공개 읽기: 익명은 공개 FAQ의 지정만 읽는다 ─────────────────────────────

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000904401',true);
select updated_at as cancel_updated_at from public.faq_entries where id = :'cancel_id' \gset
select public.admin_save_faq_entry_with_widget_topic(:'cancel_id','claim','WT취소 안내','본문만 고친 취소 안내입니다.',2,false,:'cancel_updated_at','cancel');

set local role anon;
select set_config('request.jwt.claim.sub','',true);
select 1 / case when not exists (select 1 from public.faq_entries where widget_topic = 'cancel')
then 1 else 0 end as assert_anon_cannot_read_draft_designation;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000904401',true);
select updated_at as cancel_updated_at from public.faq_entries where id = :'cancel_id' \gset
select public.admin_save_faq_entry_with_widget_topic(:'cancel_id','claim','WT취소 안내','본문만 고친 취소 안내입니다.',2,true,:'cancel_updated_at','cancel');

set local role anon;
select set_config('request.jwt.claim.sub','',true);
select 1 / case when (select question from public.faq_entries where widget_topic = 'cancel' and is_published) = 'WT취소 안내'
then 1 else 0 end as assert_anon_reads_published_designation;

-- ── 감사 ───────────────────────────────────────────────────────────────────

reset role;
-- first(delivery 지정) · first 밀려남 · second(delivery 지정) · second delivery→return · second 해제 · cancel 지정 = 6건.
-- 지정을 바꾸지 않은 저장(문구 수정, 비공개·공개 전환)은 남기지 않는다.
select 1 / case when (
  select count(*) from public.audit_log
  where actor_id = '00000000-0000-4000-8000-000000904401' and action = 'faq.widget_topic'
) = 6 then 1 else 0 end as assert_widget_topic_audit;
select 1 / case when exists (
  select 1 from public.audit_log
  where actor_id = '00000000-0000-4000-8000-000000904401' and action = 'faq.widget_topic'
    and target = 'faq:' || :'first_id' and diff ->> 'before' = 'delivery' and diff -> 'after' = 'null'::jsonb
    and diff ->> 'replacedBy' = :'second_id'
) then 1 else 0 end as assert_displacement_audited;

-- 버튼마다 대표는 하나다(직접 쓰기에서도 유일 인덱스가 막는다).
do $$ begin
  insert into public.faq_entries(category,question,answer,widget_topic) values ('claim','WT중복','중복','cancel');
  raise exception 'second designation for one widget topic was stored';
exception when unique_violation then null; end $$;

rollback;
