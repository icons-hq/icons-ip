\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,created_at,updated_at) values('a5e06400-0000-4000-8000-000000001001','authenticated','authenticated','attribute-clone-admin@example.test',now(),now());
update public.profiles set role='staff' where id='a5e06400-0000-4000-8000-000000001001';
insert into private.operator_memberships(profile_id,manager_role) values('a5e06400-0000-4000-8000-000000001001','primary');
update private.operator_access_state set configured=true where id;
insert into public.ips(id,title,vertical_key) values('attribute-clone-tests','속성 복사 합성 IP','character');
insert into public.catalog_categories(id,code,name,parent_id,sort_order) values('a5e06400-0000-4000-8000-000000001010','attribute-clone-tests','속성 복사',null,0);
insert into public.catalog_category_attribute_schemas(category_id,fields) values('a5e06400-0000-4000-8000-000000001010','[
 {"id":"a5e06400-0000-4000-8000-000000001011","name":"소재","kind":"text","required":true,"unit":"","options":[]},
 {"id":"a5e06400-0000-4000-8000-000000001012","name":"중량","kind":"number","required":false,"unit":"g","options":[]}
]');
insert into public.goods(id,ip_id,name,type,price,category_id,sale_starts_at,sale_ends_at) values('attribute-clone-source','attribute-clone-tests','속성 복사 원본','문구',1000,'a5e06400-0000-4000-8000-000000001010',now(),now()+interval '1 hour');
insert into public.goods_attribute_values(good_id,entries) select 'attribute-clone-source',jsonb_build_array(
 jsonb_build_object('field',fields->0,'value','면'),jsonb_build_object('field',fields->1,'value',12.345678),
 jsonb_build_object('field',jsonb_build_object('id','a5e06400-0000-4000-8000-000000001013','name','보관된 구분','kind','text','required',false,'unit','','options','[]'::jsonb),'value','이전 분류 값'))
 from public.catalog_category_attribute_schemas where category_id='a5e06400-0000-4000-8000-000000001010';
set local role authenticated;
select set_config('request.jwt.claim.sub','a5e06400-0000-4000-8000-000000001001',true);
select public.admin_clone_good('a5e06400-0000-4000-8000-000000001020','attribute-clone-source','attribute-clone-target','ATTR-CLONE','속성 복사 결과');
select public.admin_clone_good('a5e06400-0000-4000-8000-000000001020','attribute-clone-source','attribute-clone-target','ATTR-CLONE','속성 복사 결과');
select 1/case when public.admin_get_goods_attributes('a5e06400-0000-4000-8000-000000001010','attribute-clone-target')#>>'{document,revision}'='1'
 and jsonb_array_length(public.admin_get_goods_attributes('a5e06400-0000-4000-8000-000000001010','attribute-clone-target')#>'{document,entries}')=3 then 1 else 0 end as assert_current_and_retained_values_copied;
reset role;
select 1/case when (select jsonb_agg(e order by e#>>'{field,id}') from public.goods_attribute_values d cross join lateral jsonb_array_elements(d.entries)e where good_id='attribute-clone-source')=(select jsonb_agg(e order by e#>>'{field,id}') from public.goods_attribute_values d cross join lateral jsonb_array_elements(d.entries)e where good_id='attribute-clone-target')
 and (select category_id='a5e06400-0000-4000-8000-000000001010' and published_at is null and sale_starts_at is null and sale_ends_at is null and sale_period_revision=0 and stock_qty=0 from public.goods where id='attribute-clone-target')
 and (select count(*) from public.audit_log where action='catalog.goods_attributes_cloned' and target='goods:attribute-clone-target')=1
 and (select revision from public.goods_attribute_values where good_id='attribute-clone-source')=1 then 1 else 0 end as assert_clone_contract_and_replay_are_unchanged;
-- A retained value must not silently change physical units or kinds on clone.
update public.catalog_category_attribute_schemas set fields=jsonb_set(fields,'{1,unit}','"kg"') where category_id='a5e06400-0000-4000-8000-000000001010';
set local role authenticated;
select public.admin_clone_good('a5e06400-0000-4000-8000-000000001023','attribute-clone-source','attribute-clone-unit','ATTR-UNIT','보관 단위 복사');
reset role;
select 1/case when exists(select 1 from public.goods_attribute_values d cross join lateral jsonb_array_elements(d.entries)e where good_id='attribute-clone-unit' and e#>>'{field,id}'='a5e06400-0000-4000-8000-000000001012' and e#>>'{field,unit}'='g' and e->'value'='12.345678'::jsonb)
 and not exists(select 1 from public.goods_attribute_values d cross join lateral jsonb_array_elements(d.entries)e where good_id='attribute-clone-unit' and e#>>'{field,unit}'='kg') then 1 else 0 end as assert_optional_retained_unit_not_reinterpreted;
update public.catalog_category_attribute_schemas set fields=jsonb_set(jsonb_set(fields,'{1,kind}','"text"'),'{1,unit}','""') where category_id='a5e06400-0000-4000-8000-000000001010';
set local role authenticated;
select public.admin_clone_good('a5e06400-0000-4000-8000-000000001024','attribute-clone-source','attribute-clone-kind','ATTR-KIND','보관 유형 복사');
reset role;
select 1/case when exists(select 1 from public.goods_attribute_values d cross join lateral jsonb_array_elements(d.entries)e where good_id='attribute-clone-kind' and e#>>'{field,id}'='a5e06400-0000-4000-8000-000000001012' and e#>>'{field,kind}'='number' and e#>>'{field,unit}'='g') then 1 else 0 end as assert_optional_retained_kind_not_reinterpreted;
update public.catalog_category_attribute_schemas set fields=fields||jsonb_build_array(jsonb_build_object('id','a5e06400-0000-4000-8000-000000001014','name','새 필수값','kind','text','required',true,'unit','','options','[]'::jsonb)) where category_id='a5e06400-0000-4000-8000-000000001010';
set local role authenticated;
do $$begin
 begin perform public.admin_clone_good('a5e06400-0000-4000-8000-000000001021','attribute-clone-source','attribute-clone-rejected','ATTR-REJECT','필수값 누락');
  raise exception 'Missing newly mandatory attribute accepted';
 exception when check_violation then if sqlerrm<>'goods_attribute_required' then raise;end if;end;
end$$;
reset role;
select 1/case when not exists(select 1 from public.goods where id='attribute-clone-rejected') and not exists(select 1 from public.audit_log where id='a5e06400-0000-4000-8000-000000001021') then 1 else 0 end as assert_invalid_current_definition_rolls_back;
update public.catalog_categories set archived_at=now() where id='a5e06400-0000-4000-8000-000000001010';
set local role authenticated;
select public.admin_clone_good('a5e06400-0000-4000-8000-000000001022','attribute-clone-source','attribute-clone-unclassified','ATTR-UNCLASS','미분류 복사');
select 1/case when jsonb_array_length(public.admin_get_goods_attributes(null,'attribute-clone-unclassified')#>'{document,entries}')=3 then 1 else 0 end as assert_unclassified_clone_retains_prior_values_privately;
reset role;
select 1/case when (select category_id is null from public.goods where id='attribute-clone-unclassified') then 1 else 0 end as assert_archived_category_not_reactivated;
rollback;
