\set ON_ERROR_STOP on
-- Prepend helpers/goods_kc_fixture.sql in the same psql connection.
-- Every fixture and mutation rolls back; never run against an operational DB.
begin;
select set_config('request.jwt.claim.sub','',true);
create function pg_temp.attr_expect(statement text, message text, code text default null)
returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if sqlstate='42501' and sqlerrm='operator_capability_required' and message in ('forbidden','staff_required','staff required','staff access required','admin_required','admin required','purchase_cost_admin_required') then return;end if;
    if position(message in sqlerrm)=0 or (code is not null and sqlstate<>code) then raise; end if;
    return;
  end;
  raise exception 'Expected rejection: %',message;
end $$;
create function pg_temp.attr_fields() returns jsonb language sql as $$
  select '[
    {"id":"00000000-0000-4000-8000-000000713511","name":"소재","kind":"text","required":true,"unit":"","options":[]},
    {"id":"00000000-0000-4000-8000-000000713512","name":"색상","kind":"single","required":false,"unit":"","options":[{"id":"00000000-0000-4000-8000-000000713521","label":"빨강"},{"id":"00000000-0000-4000-8000-000000713522","label":"파랑"}]},
    {"id":"00000000-0000-4000-8000-000000713513","name":"사용 장소","kind":"multi","required":false,"unit":"","options":[{"id":"00000000-0000-4000-8000-000000713521","label":"실내"},{"id":"00000000-0000-4000-8000-000000713522","label":"실외"}]},
    {"id":"00000000-0000-4000-8000-000000713514","name":"중량","kind":"number","required":false,"unit":"g","options":[]}
  ]'::jsonb;
$$;
create function pg_temp.attr_submission(category uuid, schema_revision integer, value_revision integer, values_json jsonb, removals jsonb default '[]')
returns jsonb language sql as $$
  select jsonb_build_object('categoryId',category,'schemaRevision',schema_revision,'expectedRevision',value_revision,'values',values_json,'removeIds',removals);
$$;
create function pg_temp.attr_good(good_id text) returns jsonb language sql as $$
  select jsonb_build_object('id',good_id,'previous_id',(select id from public.goods where id=good_id),'ip_id','attributes-7135','name','합성 속성 상품','type','문구','price',1000,'stock','ok',
    'notice_maker','합성 제조자','notice_origin','합성 국가','notice_material','합성 소재','notice_size','합성 규격',
    'notice_made_on','2026-10','notice_as_manager','합성 CS','notice_as_contact','02-000');
$$;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000713501','authenticated','authenticated','attributes-admin@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000713502','authenticated','authenticated','attributes-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000713503','authenticated','authenticated','attributes-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='admin' where id='00000000-0000-4000-8000-000000713501';
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000713502';
insert into public.verticals(key,label,color) values('attributes-7135','속성 합성 검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values('attributes-7135','속성 합성 검증','attributes-7135',now());
insert into public.catalog_categories(id,code,name,parent_id,sort_order) values
 ('00000000-0000-4000-8000-000000713531','attributes-root','속성 상위',null,0),
 ('00000000-0000-4000-8000-000000713532','attributes-a','속성 A','00000000-0000-4000-8000-000000713531',0),
 ('00000000-0000-4000-8000-000000713533','attributes-b','속성 B','00000000-0000-4000-8000-000000713531',1);
insert into public.goods(id,ip_id,name,type,price,stock,category_id,notice_maker,notice_origin,notice_material,notice_size,notice_made_on,notice_as_manager,notice_as_contact) values
 ('attributes-legacy','attributes-7135','합성 속성 상품','문구',1000,'ok','00000000-0000-4000-8000-000000713532',
 '합성 제조자','합성 국가','합성 소재','합성 규격','2026-10','합성 CS','02-000');
select pg_temp.publish_goods_kc_fixture('attributes-legacy');

select 1/case when not has_table_privilege('anon','public.goods_attribute_values','select')
 and not has_table_privilege('authenticated','public.goods_attribute_values','insert')
 and not has_table_privilege('authenticated','public.catalog_category_attribute_schemas','update')
 and not has_function_privilege('anon','public.admin_get_goods_attributes(uuid,text)','execute')
 and not has_function_privilege('service_role','public.admin_save_goods_attribute_schema(uuid,jsonb,integer,uuid)','execute')
 and not has_function_privilege('authenticated','private.merge_goods_attributes(jsonb,jsonb,jsonb,jsonb)','execute')
 and not has_function_privilege('authenticated','private.admin_save_good_before_attributes(jsonb)','execute')
 and has_function_privilege('anon','public.get_good_attribute_rows(text)','execute')
 then 1 else 0 end as attribute_acl_sealed;

-- Same Unicode trimming and numeric precision as the editor, including the
-- former 1e-10 tolerance hole. Invalid schema must never save but fail to parse.
do $$ declare whitespace text; candidate jsonb; begin
 foreach whitespace in array array[E'\t',E'\n',chr(11),chr(160),chr(5760),chr(8192),chr(8232),chr(8239),chr(12288),chr(65279)] loop
  if private.goods_attribute_fields_valid(jsonb_set(pg_temp.attr_fields(),'{0,name}',to_jsonb(whitespace||'소재')))
    or private.goods_attribute_fields_valid(jsonb_set(pg_temp.attr_fields(),'{3,unit}',to_jsonb('g'||whitespace)))
    or private.goods_attribute_fields_valid(jsonb_set(pg_temp.attr_fields(),'{1,options,0,label}',to_jsonb(whitespace)))
    or private.goods_attribute_value_valid(pg_temp.attr_fields()->0,to_jsonb(whitespace||'면'))
  then raise exception 'Untrimmed Unicode whitespace accepted'; end if;
 end loop;
 foreach candidate in array array['0.0000000001'::jsonb,'1.2345678','1000000001','"1"','null'] loop
  if private.goods_attribute_value_valid(pg_temp.attr_fields()->3,candidate) then raise exception 'Invalid numeric accepted: %',candidate; end if;
 end loop;
 if not private.goods_attribute_value_valid(pg_temp.attr_fields()->3,'-1000000000')
   or not private.goods_attribute_value_valid(pg_temp.attr_fields()->3,'0.000001')
 then raise exception 'Valid numeric boundary rejected'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000713503',true);
select pg_temp.attr_expect($q$select public.admin_get_goods_attributes(null,null)$q$,'staff_required','42501');
select pg_temp.attr_expect($q$select public.admin_save_goods_attribute_schema('00000000-0000-4000-8000-000000713532','[]',0,gen_random_uuid())$q$,'admin_required','42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000713502',true);
select 1/case when public.admin_get_goods_attributes('00000000-0000-4000-8000-000000713532','attributes-legacy')#>>'{schema,revision}'='0'
 and public.admin_get_goods_attributes(null,'attributes-legacy')#>>'{document,revision}'='0' then 1 else 0 end as empty_schema_and_document_readable;
select pg_temp.attr_expect($q$select public.admin_save_goods_attribute_schema('00000000-0000-4000-8000-000000713532',pg_temp.attr_fields(),0,gen_random_uuid())$q$,'admin_required','42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000713501',true);
select pg_temp.attr_expect($q$select public.admin_save_goods_attribute_schema('00000000-0000-4000-8000-000000713531',pg_temp.attr_fields(),0,gen_random_uuid())$q$,'category_not_leaf','23514');
select pg_temp.attr_expect($q$select public.admin_save_goods_attribute_schema('00000000-0000-4000-8000-000000713532',jsonb_set(pg_temp.attr_fields(),'{0,name}','""'),0,gen_random_uuid())$q$,'invalid_attribute_schema','22023');
select public.admin_save_goods_attribute_schema('00000000-0000-4000-8000-000000713532',pg_temp.attr_fields(),0,'00000000-0000-4000-8000-000000713541');
select public.admin_save_goods_attribute_schema('00000000-0000-4000-8000-000000713532',pg_temp.attr_fields(),0,'00000000-0000-4000-8000-000000713541');
select pg_temp.attr_expect($q$select public.admin_save_goods_attribute_schema('00000000-0000-4000-8000-000000713532','[]',0,'00000000-0000-4000-8000-000000713541')$q$,'operation_conflict','23505');
select pg_temp.attr_expect($q$select public.admin_save_goods_attribute_schema('00000000-0000-4000-8000-000000713532',pg_temp.attr_fields(),0,gen_random_uuid())$q$,'goods_attribute_schema_changed','PT409');
select public.admin_save_goods_attribute_schema('00000000-0000-4000-8000-000000713533',jsonb_build_array(jsonb_set(pg_temp.attr_fields()->0,'{id}','"00000000-0000-4000-8000-000000713515"')),0,'00000000-0000-4000-8000-000000713542');
reset role;
select 1/case when (select revision from public.catalog_category_attribute_schemas where category_id='00000000-0000-4000-8000-000000713532')=1
 and (select count(*) from public.audit_log where id='00000000-0000-4000-8000-000000713541')=1
 and (select published_at is not null from public.goods where id='attributes-legacy') then 1 else 0 end as schema_replay_once_and_legacy_publication_preserved;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000713502',true);
select public.admin_save_good(pg_temp.attr_good('attributes-legacy')||'{"price":2000,"category_code":"attributes-a"}');
select pg_temp.attr_expect($q$select public.admin_save_good(pg_temp.attr_good('attributes-required')||'{"category_code":"attributes-a"}')$q$,'goods_attribute_required','23514');
select pg_temp.attr_expect($q$select public.admin_save_good(pg_temp.attr_good('attributes-legacy')||'{"category_code":"attributes-b"}')$q$,'goods_attribute_required','23514');
select pg_temp.attr_expect($q$select public.admin_save_good(pg_temp.attr_good('attributes-mismatch')||'{"category_id":"00000000-0000-4000-8000-000000713532","category_code":"attributes-b"}')$q$,'good_category_identity_mismatch','22023');
select pg_temp.attr_expect($q$select public.admin_save_good(pg_temp.attr_good('attributes-missing')||'{"category_code":"attributes-missing"}')$q$,'category_not_found','P0002');
select public.admin_save_good(pg_temp.attr_good('attributes-empty')||'{"category_id":" "}');
select public.admin_save_good(pg_temp.attr_good('attributes-empty-code')||'{"category_code":""}');
select public.admin_save_good(pg_temp.attr_good('attributes-good')||jsonb_build_object('category_code','attributes-a','product_attributes',
 pg_temp.attr_submission('00000000-0000-4000-8000-000000713532',1,0,'{"00000000-0000-4000-8000-000000713511":"면","00000000-0000-4000-8000-000000713512":"00000000-0000-4000-8000-000000713521","00000000-0000-4000-8000-000000713513":["00000000-0000-4000-8000-000000713522","00000000-0000-4000-8000-000000713521"],"00000000-0000-4000-8000-000000713514":12.345678}')));
select 1/case when public.admin_get_goods_attributes('00000000-0000-4000-8000-000000713532','attributes-good')#>>'{document,revision}'='1'
 and jsonb_array_length(public.admin_get_goods_attributes('00000000-0000-4000-8000-000000713532','attributes-good')#>'{document,entries}')=4 then 1 else 0 end as four_value_kinds_roundtrip;
do $$ declare values_json jsonb; begin
 foreach values_json in array array[
  '{"00000000-0000-4000-8000-000000713511":" 面"}'::jsonb,
  '{"00000000-0000-4000-8000-000000713512":"00000000-0000-4000-8000-000000713599"}',
  '{"00000000-0000-4000-8000-000000713513":["00000000-0000-4000-8000-000000713521","00000000-0000-4000-8000-000000713521"]}',
  '{"00000000-0000-4000-8000-000000713514":0.0000000001}'
 ] loop
  perform pg_temp.attr_expect(format('select public.admin_save_good(%L::jsonb)',pg_temp.attr_good('attributes-good')||jsonb_build_object('product_attributes',
    pg_temp.attr_submission('00000000-0000-4000-8000-000000713532',1,1,values_json))),'invalid_goods_attribute_value','23514');
 end loop;
 perform pg_temp.attr_expect(format('select public.admin_save_good(%L::jsonb)',pg_temp.attr_good('attributes-good')||jsonb_build_object('product_attributes',
   pg_temp.attr_submission('00000000-0000-4000-8000-000000713532',0,1,'{}'))),'goods_attribute_schema_changed','PT409');
 perform pg_temp.attr_expect(format('select public.admin_save_good(%L::jsonb)',pg_temp.attr_good('attributes-good')||jsonb_build_object('product_attributes',
   pg_temp.attr_submission('00000000-0000-4000-8000-000000713532',1,0,'{}'))),'goods_attributes_changed','PT409');
 perform pg_temp.attr_expect(format('select public.admin_save_good(%L::jsonb)',pg_temp.attr_good('attributes-good')||jsonb_build_object('product_attributes',
   pg_temp.attr_submission('00000000-0000-4000-8000-000000713532',1,1,'{"00000000-0000-4000-8000-000000713599":"unknown"}'))),'invalid_goods_attributes','23514');
 perform pg_temp.attr_expect(format('select public.admin_save_good(%L::jsonb)',pg_temp.attr_good('attributes-good')||jsonb_build_object('product_attributes',
   pg_temp.attr_submission('00000000-0000-4000-8000-000000713532',1,1,'{"00000000-0000-4000-8000-000000713511":null}'))),'goods_attribute_required','23514');
end $$;
reset role;
select 1/case when (select revision=1 and jsonb_array_length(entries)=4 from public.goods_attribute_values where good_id='attributes-good')
 and (select category_id='00000000-0000-4000-8000-000000713532' and price=2000 and published_at is not null from public.goods where id='attributes-legacy')
 and not exists(select 1 from public.goods where id in('attributes-required','attributes-mismatch','attributes-missing'))
 then 1 else 0 end as rejection_rolls_back_and_legacy_edit_works;
select pg_temp.publish_goods_kc_fixture('attributes-good');
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select 1/case when jsonb_array_length(public.get_good_attribute_rows('attributes-good'))=4
 and public.get_good_attribute_rows('attributes-good')#>>'{1,value}'='빨강'
 and public.get_good_attribute_rows('attributes-good')#>>'{2,value}'='실외, 실내'
 and public.get_good_attribute_rows('attributes-good')#>>'{3,value}'='12.345678 g'
 and public.get_good_attribute_rows('attributes-empty')='[]'::jsonb
 and not exists(select 1 from jsonb_array_elements(public.get_good_attribute_rows('attributes-good')) r, lateral jsonb_object_keys(r) k where k not in('id','name','value'))
 then 1 else 0 end as public_rows_only_current_readable_labels;
reset role;
savepoint unpublished_ip;
update public.ips set published_at=null where id='attributes-7135';
set local role anon;
select 1/case when public.get_good_attribute_rows('attributes-good')='[]'::jsonb then 1 else 0 end as unpublished_ip_hides_attributes;
rollback to savepoint unpublished_ip;

-- Definition changes keep previous snapshots, hide incompatible values, and
-- resolve current labels. They do not invalidate KC or revoke publication.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000713501',true);
select public.admin_save_goods_attribute_schema('00000000-0000-4000-8000-000000713532',
 jsonb_set(jsonb_set(jsonb_set(pg_temp.attr_fields(),'{0,name}','"소재 이름"'),'{1,options,0,label}','"진홍"'),'{3,unit}','"kg"')-2,1,'00000000-0000-4000-8000-000000713543');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000713502',true);
select public.admin_read_goods_kc('attributes-good') as attr_kc_before \gset
select public.admin_save_good(pg_temp.attr_good('attributes-good')||jsonb_build_object('product_attributes',
 pg_temp.attr_submission('00000000-0000-4000-8000-000000713532',2,1,'{"00000000-0000-4000-8000-000000713511":"면혼방"}')));
select 1/case when public.admin_read_goods_kc('attributes-good')->>'revision'=:'attr_kc_before'::jsonb->>'revision'
 and public.admin_read_goods_kc('attributes-good')->>'status'='reviewed' then 1 else 0 end as attributes_do_not_change_kc_context;
reset role;
select 1/case when (select jsonb_array_length(entries)=4 and revision=2 from public.goods_attribute_values where good_id='attributes-good')
 and (select published_at is not null from public.goods where id='attributes-good') then 1 else 0 end as removed_definitions_do_not_erase_snapshots_or_unpublish;
set local role anon;
select 1/case when jsonb_array_length(public.get_good_attribute_rows('attributes-good'))=2
 and public.get_good_attribute_rows('attributes-good')#>>'{0,name}'='소재 이름'
 and public.get_good_attribute_rows('attributes-good')#>>'{0,value}'='면혼방'
 and public.get_good_attribute_rows('attributes-good')#>>'{1,value}'='진홍' then 1 else 0 end as incompatible_unit_and_removed_field_hidden;
reset role;
-- Category change is an existing KC boundary; make this fixture a draft first.
update public.goods set published_at=null where id='attributes-good';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000713502',true);
select public.admin_save_good(pg_temp.attr_good('attributes-good')||jsonb_build_object('product_attributes',
 pg_temp.attr_submission('00000000-0000-4000-8000-000000713532',2,2,'{}','["00000000-0000-4000-8000-000000713513"]')));
select pg_temp.attr_expect($q$select public.admin_save_good(pg_temp.attr_good('attributes-good')||'{"category_code":"attributes-b"}')$q$,'goods_attribute_required','23514');
select public.admin_save_good(pg_temp.attr_good('attributes-good')||jsonb_build_object('category_code','attributes-b','product_attributes',
 pg_temp.attr_submission('00000000-0000-4000-8000-000000713533',1,3,'{"00000000-0000-4000-8000-000000713515":"B값"}')));
select pg_temp.attr_expect($q$select public.admin_save_good(pg_temp.attr_good('attributes-blocked-rename')||jsonb_build_object('previous_id','attributes-good','category_code','attributes-b'))$q$,'goods_slug_locked','23514');
reset role;
select 1/case when (select jsonb_array_length(entries)=4 and revision=4 from public.goods_attribute_values where good_id='attributes-good')
 and not exists(select 1 from public.goods_attribute_values where good_id='attributes-blocked-rename')
 and not exists(select 1 from public.goods_attribute_values v, lateral jsonb_array_elements(v.entries) e where v.good_id='attributes-good' and e#>>'{field,id}'='00000000-0000-4000-8000-000000713513')
 then 1 else 0 end as explicit_remove_category_retention_and_published_slug_gate;
set local role authenticated;
select public.admin_save_good(pg_temp.attr_good('attributes-before-rename')||jsonb_build_object('category_code','attributes-b','product_attributes',
 pg_temp.attr_submission('00000000-0000-4000-8000-000000713533',1,0,'{"00000000-0000-4000-8000-000000713515":"이름 변경 보존"}')));
select public.admin_save_good(pg_temp.attr_good('attributes-renamed')||jsonb_build_object('previous_id','attributes-before-rename','category_code','attributes-b'));
reset role;
select 1/case when (select jsonb_array_length(entries)=1 and revision=1 from public.goods_attribute_values where good_id='attributes-renamed')
 and not exists(select 1 from public.goods_attribute_values where good_id='attributes-before-rename') then 1 else 0 end as unpublished_id_cascade_preserves_values;

-- Incomplete inputs stay in the operator's private draft. Rejected completion
-- must not consume the draft; a successful retry is the original saved result.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000713502',true);
select public.admin_save_goods_draft('00000000-0000-4000-8000-000000713551',jsonb_build_object('name','속성 미완성','productAttributes','{"incomplete":true}'),0);
select 1/case when public.admin_get_goods_draft('00000000-0000-4000-8000-000000713551')#>>'{values,productAttributes}'='{"incomplete":true}' then 1 else 0 end as incomplete_attributes_survive_draft;
select pg_temp.attr_expect($q$select public.admin_save_good_from_draft(pg_temp.attr_good('attributes-from-draft')||'{"category_code":"attributes-b"}','00000000-0000-4000-8000-000000713551',1)$q$,'goods_attribute_required','23514');
select 1/case when public.admin_get_goods_draft('00000000-0000-4000-8000-000000713551')->>'revision'='1'
 and public.admin_get_goods_draft('00000000-0000-4000-8000-000000713551')->>'archived'='false' then 1 else 0 end as rejected_completion_keeps_draft;
select public.admin_save_good_from_draft(pg_temp.attr_good('attributes-from-draft')||jsonb_build_object('category_code','attributes-b','product_attributes',
 pg_temp.attr_submission('00000000-0000-4000-8000-000000713533',1,0,'{"00000000-0000-4000-8000-000000713515":"완료값"}')),'00000000-0000-4000-8000-000000713551',1);
select 1/case when public.admin_save_good_from_draft('{"id":"attributes-never-created"}','00000000-0000-4000-8000-000000713551',1)->>'id'='attributes-from-draft'
 and public.admin_get_goods_draft('00000000-0000-4000-8000-000000713551')->>'archived'='true' then 1 else 0 end as completed_draft_replay_keeps_first_result;
reset role;
select 1/case when (select revision=1 and jsonb_array_length(entries)=1 from public.goods_attribute_values where good_id='attributes-from-draft')
 and not exists(select 1 from public.goods where id='attributes-never-created')
 and (select count(*) from public.audit_log where action='catalog.goods_attributes_saved' and target='goods:attributes-from-draft')=1
 then 1 else 0 end as draft_completion_attributes_atomic_once;
update public.profiles set suspended_at=now(),suspension_reason='속성 QA' where id in('00000000-0000-4000-8000-000000713501','00000000-0000-4000-8000-000000713502');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000713501',true);
select pg_temp.attr_expect($q$select public.admin_save_goods_attribute_schema('00000000-0000-4000-8000-000000713532','[]',2,gen_random_uuid())$q$,'admin_required','42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000713502',true);
select pg_temp.attr_expect($q$select public.admin_get_goods_attributes(null,'attributes-renamed')$q$,'staff_required','42501');
select pg_temp.attr_expect($q$select public.admin_save_good(pg_temp.attr_good('attributes-suspended'))$q$,'staff_required','42501');
rollback;
