\set ON_ERROR_STOP on
-- The optional field must remain optional. Do not make the old draft fixtures
-- pass by adding customInputsExpectedRevision to every request.
begin;
create function pg_temp.expect_draft_optional_error(statement text, expected text)
returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then if position(expected in sqlerrm)>0 then return; end if; raise; end;
  raise exception 'Expected draft error: %',expected;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('a5d01700-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
  'draft-optional-'||n||'@example.test',now(),'{"testFixture":"draft-optional"}','{}',now(),now()
from generate_series(1,3)n;
update public.profiles set role='staff' where id in ('a5d01700-0000-4000-8000-000000000001','a5d01700-0000-4000-8000-000000000002');
insert into private.operator_memberships(profile_id,manager_role) values
 ('a5d01700-0000-4000-8000-000000000001','primary'),('a5d01700-0000-4000-8000-000000000002','deputy');

create temp table draft_period_input(value jsonb);
insert into draft_period_input values(jsonb_build_object(
 'name','판매기간과 직접입력 보존',
 'salePeriodEnabled','true','saleStartsAt','2026-12-01T09:00','saleEndsAt','2026-12-31T18:00','salePeriodRevision','0',
 'customInputs','{"enabled":true,"fields":[{"id":"a5d01700-0000-4000-8000-000000000080","name":"각인 문구","active":true}]}',
 'productAttributes','{"draft":"미완성 속성 보존"}'));
grant select on draft_period_input to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','a5d01700-0000-4000-8000-000000000001',true);

select public.admin_save_goods_draft('a5d01700-0000-4000-8000-000000000010','{"name":"최소 JSON"}',0);
select public.admin_save_goods_draft('a5d01700-0000-4000-8000-000000000010','{"name":"최소 JSON"}',0);
select 1/case when public.admin_get_goods_draft('a5d01700-0000-4000-8000-000000000010')->>'revision'='1'
 and public.admin_get_goods_draft('a5d01700-0000-4000-8000-000000000010')->'values'='{"name":"최소 JSON"}'::jsonb
 then 1 else 0 end as omitted_revision_and_exact_retry_work;

select public.admin_save_goods_draft('a5d01700-0000-4000-8000-000000000011','{"name":"명시한 영","customInputsExpectedRevision":"0"}',0);
select 1/case when public.admin_get_goods_draft('a5d01700-0000-4000-8000-000000000011')#>>'{values,customInputsExpectedRevision}'='0'
 then 1 else 0 end as explicit_zero_remains_valid;

select public.admin_save_goods_draft('a5d01700-0000-4000-8000-000000000012',(select value from draft_period_input),0);
select 1/case when public.admin_get_goods_draft('a5d01700-0000-4000-8000-000000000012')->'values'=(select value from draft_period_input)
 then 1 else 0 end as omitted_revision_preserves_period_and_custom_inputs;
select public.admin_save_goods_draft('a5d01700-0000-4000-8000-000000000012',
 (select value||'{"customInputsExpectedRevision":"0","saleEndsAt":"2027-01-01T18:00"}'::jsonb from draft_period_input),1);
select 1/case when public.admin_get_goods_draft('a5d01700-0000-4000-8000-000000000012')->>'revision'='2'
 and public.admin_get_goods_draft('a5d01700-0000-4000-8000-000000000012')->'values'=
  (select value||'{"customInputsExpectedRevision":"0","saleEndsAt":"2027-01-01T18:00"}'::jsonb from draft_period_input)
 then 1 else 0 end as explicit_zero_preserves_updated_period_and_custom_inputs;

select pg_temp.expect_draft_optional_error($q$select public.admin_save_goods_draft('a5d01700-0000-4000-8000-000000000012','{"name":"오래된 버전"}',0)$q$,'goods_draft_changed');
select pg_temp.expect_draft_optional_error($q$select public.admin_save_goods_draft('a5d01700-0000-4000-8000-000000000013','{"name":"기존 상품 revision 차단","customInputsExpectedRevision":"1"}',0)$q$,'invalid_goods_draft');
select pg_temp.expect_draft_optional_error($q$select public.admin_save_goods_draft('a5d01700-0000-4000-8000-000000000013','{"name":"숫자 타입 차단","customInputsExpectedRevision":0}',0)$q$,'invalid_goods_draft');
select pg_temp.expect_draft_optional_error($q$select public.admin_save_goods_draft('a5d01700-0000-4000-8000-000000000013','{"name":"미지원 키 차단","email":"private@example.test"}',0)$q$,'invalid_goods_draft');
select set_config('request.jwt.claim.sub','a5d01700-0000-4000-8000-000000000002',true);
select pg_temp.expect_draft_optional_error($q$select public.admin_get_goods_draft('a5d01700-0000-4000-8000-000000000010')$q$,'goods_draft_not_found');
select pg_temp.expect_draft_optional_error($q$select public.admin_save_goods_draft('a5d01700-0000-4000-8000-000000000010','{"name":"다른 운영자의 덮어쓰기"}',1)$q$,'forbidden');
select set_config('request.jwt.claim.sub','a5d01700-0000-4000-8000-000000000003',true);
select pg_temp.expect_draft_optional_error($q$select public.admin_save_goods_draft('a5d01700-0000-4000-8000-000000000013','{"name":"권한 없는 신규 저장"}',0)$q$,'operator_capability_required');
reset role;
select 1/case when (select count(*) from public.admin_goods_drafts where id::text like 'a5d01700-%')=3
 and (select count(*) from public.audit_log where action='admin.goods.draft.saved' and target like 'goods_draft:a5d01700-%')=4
 and not exists(select 1 from public.admin_goods_drafts where id='a5d01700-0000-4000-8000-000000000013')
 and not has_function_privilege('anon','public.admin_save_goods_draft(uuid,jsonb,integer)','execute')
 and not has_function_privilege('service_role','public.admin_save_goods_draft(uuid,jsonb,integer)','execute')
 and has_function_privilege('authenticated','public.admin_save_goods_draft(uuid,jsonb,integer)','execute')
 then 1 else 0 end as draft_cas_owner_audit_and_acl_remain_intact;
delete from private.operator_memberships where profile_id='a5d01700-0000-4000-8000-000000000001';
update public.profiles set role='user' where id='a5d01700-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','a5d01700-0000-4000-8000-000000000001',true);
select pg_temp.expect_draft_optional_error($q$select public.admin_save_goods_draft('a5d01700-0000-4000-8000-000000000010','{"name":"최소 JSON"}',0)$q$,'operator_capability_required');
reset role;
rollback;
