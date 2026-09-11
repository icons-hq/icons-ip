\set ON_ERROR_STOP on
-- Isolated test database only. Prepend helpers/goods_kc_fixture.sql as in CI.
begin;
select set_config('request.jwt.claim.sub', '', true);
create function pg_temp.operations_assert(condition boolean, label text) returns void language plpgsql as $$
begin
  if condition is not true then raise exception 'Operations contact assertion failed: %', label; end if;
end;
$$;
create function pg_temp.operations_expect_error(statement text, expected_message text, expected_state text)
returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if sqlstate <> expected_state or position(expected_message in sqlerrm) = 0 then raise; end if;
    return;
  end;
  raise exception 'Expected operations contact rejection: %', expected_message;
end;
$$;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000050101','authenticated','authenticated','operations-contact-admin@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000050102','authenticated','authenticated','operations-contact-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000050103','authenticated','authenticated','operations-contact-buyer@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000050104','authenticated','authenticated','operations-contact-suspended-admin@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000050105','authenticated','authenticated','operations-contact-suspended-staff@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='admin',nickname='운영연락검증'||right(id::text,6)
 where id in ('00000000-0000-4000-8000-000000050101','00000000-0000-4000-8000-000000050104');
update public.profiles set role='staff',nickname='운영직원검증'||right(id::text,6)
 where id in ('00000000-0000-4000-8000-000000050102','00000000-0000-4000-8000-000000050105');
update public.profiles set suspended_at=now(),suspension_reason='합성 정지 검증'
 where id in ('00000000-0000-4000-8000-000000050104','00000000-0000-4000-8000-000000050105');
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,is_active) values
 ('00000000-0000-4000-8000-000000050111','operations-contact-active','운영 연락 활성 출고지','hanjin',3000,true),
 ('00000000-0000-4000-8000-000000050112','operations-contact-inactive','운영 연락 비활성 출고지',null,0,false);
insert into public.verticals(key,label,color) values('operations-contact-fixture','운영 연락 검증','#000000');
insert into public.ips(id,title,vertical_key,published_at)
 values('operations-contact-fixture','운영 연락 검증','operations-contact-fixture',now());
insert into public.goods(id,ip_id,name,type,price,stock,image_path,origin_id,
 notice_maker,notice_origin,notice_material,notice_size,notice_made_on,notice_as_manager,notice_as_contact)
 values('operations-contact-good','operations-contact-fixture','운영 연락 공개 검증 상품','문구',1700,'ok',
 'public-media/operations-contact-fixture.webp','00000000-0000-4000-8000-000000050111',
 '합성 제조사','한국','종이','A5','2026-09','공개 CS','02-000');
select pg_temp.publish_goods_kc_fixture('operations-contact-good');
insert into public.orders(id,user_id,status,total,address)
 values('00000000-0000-4000-8000-000000050121','00000000-0000-4000-8000-000000050103','pending',1700,'{}');
select to_jsonb(good) as original_good from public.goods good where good.id='operations-contact-good' \gset
select to_jsonb(order_row) as original_order from public.orders order_row where order_row.id='00000000-0000-4000-8000-000000050121' \gset
select jsonb_agg(to_jsonb(origin) order by origin.id) as original_origins from public.fulfillment_origins origin
 where origin.id in ('00000000-0000-4000-8000-000000050111','00000000-0000-4000-8000-000000050112') \gset
select jsonb_build_object('email',(select to_jsonb(control) from private.email_dispatch_control control where singleton),
 'delay',(select to_jsonb(control) from private.order_delay_notice_delivery_control control where singleton)) as original_gates \gset

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000050102',true);
select pg_temp.operations_assert(
 (select count(*) from public.admin_operations_contacts())=(select count(*)+1 from public.fulfillment_origins),
 'staff sees operations and every existing origin');
select pg_temp.operations_assert(exists(select 1 from public.admin_operations_contacts() contact
 where contact.scope='operations' and contact.origin_id is null and contact.origin_name is null and contact.origin_active is null
 and contact.owner_name='' and contact.contact='' and contact.source_reference='' and contact.handoff_reference=''
 and contact.updated_at is null and contact.updated_by_name is null), 'unsaved operations row is explicit blank information');
select pg_temp.operations_assert(exists(select 1 from public.admin_operations_contacts() contact
 where contact.origin_id='00000000-0000-4000-8000-000000050112' and contact.origin_active=false
 and contact.owner_name='' and contact.updated_at is null), 'inactive origins remain manageable');
select pg_temp.operations_expect_error($sql$select public.admin_save_operations_contact('operations',null,
 '{"ownerName":"staff","contact":"","sourceReference":"","handoffReference":""}',null)$sql$,'admin_required','42501');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000050101',true);
select public.admin_save_operations_contact('operations',null,
 '{"ownerName":"  OPS-PRIVATE-OWNER  ","contact":"  ops-private-contact@example.test  ","sourceReference":"  ops-private-source-reference  ","handoffReference":"  ops-private-handoff-reference  "}',null) as operations_version \gset
select pg_temp.operations_assert(exists(select 1 from public.admin_operations_contacts() contact
 where contact.scope='operations' and contact.owner_name='OPS-PRIVATE-OWNER' and contact.contact='ops-private-contact@example.test'
 and contact.source_reference='ops-private-source-reference' and contact.handoff_reference='ops-private-handoff-reference'
 and contact.updated_at=:'operations_version' and contact.updated_by_name='운영연락검증050101'), 'admin receipt preserves trimmed strings and actor');
select pg_temp.operations_assert((select count(*) from public.admin_operations_contact_history())=1,
 'new save creates one history entry');
select pg_temp.operations_assert(public.admin_save_operations_contact('operations',null,
 '{"ownerName":"OPS-PRIVATE-OWNER","contact":"ops-private-contact@example.test","sourceReference":"ops-private-source-reference","handoffReference":"ops-private-handoff-reference"}',
 :'operations_version')=:'operations_version', 'same values and version are a no-op');
select pg_temp.operations_assert((select count(*) from public.admin_operations_contact_history())=1,
 'no-op does not add an audit');
select pg_temp.operations_expect_error($sql$select public.admin_save_operations_contact('operations',null,
 '{"ownerName":"collision","contact":"","sourceReference":"","handoffReference":""}',null)$sql$,
 'operations_contact_changed','PT409');

select public.admin_save_operations_contact('operations',null,
 '{"ownerName":"OPS-PRIVATE-OWNER","contact":"ops-private-updated@example.test","sourceReference":"","handoffReference":"ops-private-handoff-reference"}',
 :'operations_version') as operations_updated_version \gset
select pg_temp.operations_assert(:'operations_updated_version'::timestamptz>:'operations_version'::timestamptz,
 'changed version advances monotonically');
select pg_temp.operations_expect_error(format($sql$select public.admin_save_operations_contact('operations',null,
 '{"ownerName":"stale","contact":"","sourceReference":"","handoffReference":""}',%L)$sql$,:'operations_version'),
 'operations_contact_changed','PT409');
select pg_temp.operations_assert(exists(select 1 from public.admin_operations_contact_history(1) history
 where history.scope='operations' and history.origin_name is null and history.actor_name='운영연락검증050101'
 and history.changed_fields=array['contact','sourceReference']), 'history exposes only the changed field names');

select public.admin_save_operations_contact('origin','00000000-0000-4000-8000-000000050111',
 '{"ownerName":"","contact":"","sourceReference":"","handoffReference":""}',null) as origin_version \gset
select pg_temp.operations_assert(exists(select 1 from public.admin_operations_contacts() contact
 where contact.origin_id='00000000-0000-4000-8000-000000050111' and contact.owner_name='' and contact.contact=''
 and contact.source_reference='' and contact.handoff_reference='' and contact.updated_at=:'origin_version'),
 'all blank values can be saved without inventing readiness');
select public.admin_save_operations_contact('origin','00000000-0000-4000-8000-000000050112',
 jsonb_build_object('ownerName',repeat('가',100),'contact',repeat('나',200),
 'sourceReference',repeat('다',500),'handoffReference',repeat('라',500)),null) as inactive_version \gset
select pg_temp.operations_assert(exists(select 1 from public.admin_operations_contacts() contact
 where contact.origin_id='00000000-0000-4000-8000-000000050112' and not contact.origin_active
 and char_length(contact.owner_name)=100 and char_length(contact.contact)=200
 and char_length(contact.source_reference)=500 and char_length(contact.handoff_reference)=500),
 'inclusive length bounds and inactive origin writes are supported');

do $$
declare
  valid jsonb := '{"ownerName":"","contact":"","sourceReference":"","handoffReference":""}';
  invalid jsonb;
  field_name text;
  max_length integer;
  bad_scope text;
begin
  foreach bad_scope in array array['warehouse','',null] loop
    perform pg_temp.operations_expect_error(format('select public.admin_save_operations_contact(%L,null,%L::jsonb,null)',bad_scope,valid::text),
      'invalid_operations_contact','22023');
  end loop;
  perform pg_temp.operations_expect_error(format('select public.admin_save_operations_contact(''operations'',%L,%L::jsonb,null)',
    '00000000-0000-4000-8000-000000050111',valid::text),'invalid_operations_contact','22023');
  perform pg_temp.operations_expect_error(format('select public.admin_save_operations_contact(''origin'',null,%L::jsonb,null)',valid::text),
    'invalid_operations_contact','22023');
  perform pg_temp.operations_expect_error(format('select public.admin_save_operations_contact(''origin'',%L,%L::jsonb,null)',
    '00000000-0000-4000-8000-000000050199',valid::text),'operations_contact_origin_not_found','P0002');
  foreach invalid in array array['null'::jsonb,'[]'::jsonb,'"text"'::jsonb,'{}'::jsonb,
    valid-'contact',valid||'{"extra":"silently ignored"}'::jsonb,
    jsonb_set(valid,'{ownerName}','null'),jsonb_set(valid,'{contact}','123'),
    jsonb_set(valid,'{sourceReference}','false'),jsonb_set(valid,'{handoffReference}','[]')] loop
    perform pg_temp.operations_expect_error(format('select public.admin_save_operations_contact(''operations'',null,%L::jsonb,null)',invalid::text),
      'invalid_operations_contact','22023');
  end loop;
  foreach field_name in array array['ownerName','contact','sourceReference','handoffReference'] loop
    max_length := case field_name when 'ownerName' then 100 when 'contact' then 200 else 500 end;
    invalid := jsonb_set(valid,array[field_name],to_jsonb(repeat('가',max_length+1)));
    perform pg_temp.operations_expect_error(format('select public.admin_save_operations_contact(''operations'',null,%L::jsonb,null)',invalid::text),
      'invalid_operations_contact','22023');
    invalid := jsonb_set(valid,array[field_name],to_jsonb(E'앞\n뒤'::text));
    perform pg_temp.operations_expect_error(format('select public.admin_save_operations_contact(''operations'',null,%L::jsonb,null)',invalid::text),
      'invalid_operations_contact','22023');
  end loop;
  foreach invalid in array array[jsonb_set(valid,'{contact}',to_jsonb(E'\t앞'::text)),
    jsonb_set(valid,'{contact}',to_jsonb('앞'||chr(127)))] loop
    perform pg_temp.operations_expect_error(format('select public.admin_save_operations_contact(''operations'',null,%L::jsonb,null)',invalid::text),
      'invalid_operations_contact','22023');
  end loop;
end;
$$;
select pg_temp.operations_expect_error('select public.admin_operations_contact_history(0)','invalid_operations_contact_history_limit','22023');
select pg_temp.operations_expect_error('select public.admin_operations_contact_history(51)','invalid_operations_contact_history_limit','22023');
select pg_temp.operations_expect_error('select public.admin_operations_contact_history(null)','invalid_operations_contact_history_limit','22023');
select pg_temp.operations_assert((select count(*) from public.admin_operations_contact_history(1))=1
 and (select count(*) from public.admin_operations_contact_history(50))=4,'history limit is enforced');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000050102',true);
select pg_temp.operations_assert(exists(select 1 from public.admin_operations_contacts() contact
 where contact.scope='operations' and contact.contact='ops-private-updated@example.test'), 'staff reads saved contacts');
select pg_temp.operations_assert((select count(*) from public.admin_operations_contact_history())=4,'staff reads bounded history');
select pg_temp.operations_assert(not exists(select 1 from public.admin_operations_contact_history() history
 where to_jsonb(history)::text like '%ops-private-%' or to_jsonb(history)::text like '%OPS-PRIVATE-OWNER%'),
 'history never copies raw contact or references');
select pg_temp.operations_expect_error('select * from private.operations_contacts','permission denied','42501');
select pg_temp.operations_expect_error('update private.operations_contacts set contact=''forbidden''','permission denied','42501');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000050103',true);
select pg_temp.operations_expect_error('select public.admin_operations_contacts()','staff_required','42501');
select pg_temp.operations_expect_error('select public.admin_operations_contact_history()','staff_required','42501');
select pg_temp.operations_expect_error($sql$select public.admin_save_operations_contact('operations',null,
 '{"ownerName":"","contact":"","sourceReference":"","handoffReference":""}',null)$sql$,'admin_required','42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000050104',true);
select pg_temp.operations_expect_error('select public.admin_operations_contacts()','staff_required','42501');
select pg_temp.operations_expect_error('select public.admin_operations_contact_history()','staff_required','42501');
select pg_temp.operations_expect_error($sql$select public.admin_save_operations_contact('operations',null,
 '{"ownerName":"","contact":"","sourceReference":"","handoffReference":""}',null)$sql$,'admin_required','42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000050105',true);
select pg_temp.operations_expect_error('select public.admin_operations_contacts()','staff_required','42501');
select pg_temp.operations_expect_error('select public.admin_operations_contact_history()','staff_required','42501');
select set_config('request.jwt.claim.sub','',true);
select pg_temp.operations_expect_error('select public.admin_operations_contacts()','staff_required','42501');

set local role anon;
select pg_temp.operations_expect_error('select public.admin_operations_contacts()','permission denied','42501');
select pg_temp.operations_expect_error('select public.admin_operations_contact_history()','permission denied','42501');
select pg_temp.operations_expect_error($sql$select public.admin_save_operations_contact('operations',null,
 '{"ownerName":"","contact":"","sourceReference":"","handoffReference":""}',null)$sql$,'permission denied','42501');
select pg_temp.operations_expect_error('select * from private.operations_contacts','permission denied','42501');
select pg_temp.operations_assert(public.get_storefront_settings()::text not like '%ops-private-%',
 'public storefront settings do not expose operations contacts');
select pg_temp.operations_assert(exists(select 1 from public.search_public_content('운영 연락 공개 검증',20) item where item.id='operations-contact-good')
 and not exists(select 1 from public.search_public_content('운영 연락 공개 검증',20) item
   where to_jsonb(item)::text like '%ops-private-%' or to_jsonb(item)::text like '%OPS-PRIVATE-OWNER%'),
 'real public catalog projection does not contain internal contacts');
set local role service_role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000050101',true);
select pg_temp.operations_expect_error('select public.admin_operations_contacts()','permission denied','42501');
select pg_temp.operations_expect_error('select public.admin_operations_contact_history()','permission denied','42501');
select pg_temp.operations_expect_error($sql$select public.admin_save_operations_contact('operations',null,
 '{"ownerName":"","contact":"","sourceReference":"","handoffReference":""}',null)$sql$,'permission denied','42501');
select pg_temp.operations_expect_error('select * from private.operations_contacts','permission denied','42501');
select pg_temp.operations_expect_error('update private.operations_contacts set contact=''forbidden''','permission denied','42501');

reset role;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.operations_assert((select relrowsecurity from pg_class where oid='private.operations_contacts'::regclass),
 'private contacts table has RLS');
select pg_temp.operations_assert(not has_table_privilege('anon','private.operations_contacts','select,insert,update,delete')
 and not has_table_privilege('authenticated','private.operations_contacts','select,insert,update,delete')
 and not has_table_privilege('service_role','private.operations_contacts','select,insert,update,delete'),
 'application roles have no direct table privileges');
select pg_temp.operations_expect_error($sql$insert into private.operations_contacts(scope,origin_id,updated_by)
 values('operations',null,'00000000-0000-4000-8000-000000050101')$sql$,
 'operations_contacts_scope_origin_key','23505');
select pg_temp.operations_assert((select count(*) from public.audit_log where action='admin.operations_contact.updated')=4,
 'only four actual changes are audited');
select pg_temp.operations_assert(not exists(select 1 from public.audit_log audit
 where audit.action='admin.operations_contact.updated' and (
   audit.diff::text like '%ops-private-%' or audit.diff::text like '%OPS-PRIVATE-OWNER%'
   or not (audit.diff ?& array['scope','originId','changedFields','previousVersion','updatedAt'])
   or exists(select 1 from jsonb_object_keys(audit.diff) key
     where key not in ('scope','originId','changedFields','previousVersion','updatedAt')))),
 'audit contains exactly the allowed metadata without original text');
select pg_temp.operations_assert(exists(select 1 from public.audit_log audit where audit.action='admin.operations_contact.updated'
 and audit.target='operations_contact:operations' and audit.diff->>'previousVersion' is not null
 and audit.diff->'changedFields'='["contact","sourceReference"]'::jsonb)
 and exists(select 1 from public.audit_log audit where audit.action='admin.operations_contact.updated'
 and audit.target='operations_contact:origin:00000000-0000-4000-8000-000000050112'),
 'audit targets and changed fields identify the edited row');
select pg_temp.operations_assert((select to_jsonb(good) from public.goods good where good.id='operations-contact-good')=:'original_good'::jsonb
 and (select to_jsonb(order_row) from public.orders order_row where order_row.id='00000000-0000-4000-8000-000000050121')=:'original_order'::jsonb
 and (select jsonb_agg(to_jsonb(origin) order by origin.id) from public.fulfillment_origins origin
   where origin.id in ('00000000-0000-4000-8000-000000050111','00000000-0000-4000-8000-000000050112'))=:'original_origins'::jsonb,
 'goods, orders and origin operating data are unchanged');
select pg_temp.operations_assert(jsonb_build_object(
 'email',(select to_jsonb(control) from private.email_dispatch_control control where singleton),
 'delay',(select to_jsonb(control) from private.order_delay_notice_delivery_control control where singleton))=:'original_gates'::jsonb,
 'contact references do not activate any email gate');
rollback;
