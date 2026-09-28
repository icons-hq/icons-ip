\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000051101','authenticated','authenticated','category-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000051102','authenticated','authenticated','category-member@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000051101';
insert into public.verticals(key,label,color) values('category-memberships','추가 분류 검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values('category-memberships','추가 분류 검증','category-memberships',now());
insert into public.catalog_categories(id,code,name,parent_id,depth) values
 ('00000000-0000-4000-8000-000000051110','category-a','대표 가지',null,1),
 ('00000000-0000-4000-8000-000000051111','category-a-leaf','대표 말단','00000000-0000-4000-8000-000000051110',2),
 ('00000000-0000-4000-8000-000000051120','category-b','추가 가지',null,1),
 ('00000000-0000-4000-8000-000000051121','category-b-leaf','추가 말단','00000000-0000-4000-8000-000000051120',2),
 ('00000000-0000-4000-8000-000000051122','category-b-leaf-2','추가 말단 2','00000000-0000-4000-8000-000000051120',2);
create function pg_temp.category_good_payload(good_id text) returns jsonb language sql as $$
  select record->'good'||jsonb_build_object('previous_id',good_id,
    'variant_baseline',(select coalesce(jsonb_agg(value->'id'),'[]') from jsonb_array_elements(record->'variants') where value->>'archived_at' is null),
    'variants',(select jsonb_agg(jsonb_build_object('id',value->'id','name',value->'name','code',value->'code','attributes',value->'attributes',
      'extraPrice',(value->>'price')::integer-(record#>>'{good,price}')::integer,'stockQty',value->'stock_qty',
      'expectedStockQty',value->'stock_qty','isActive',value->>'archived_at' is null,'lowStockThreshold',value->'low_stock_threshold'))
      from jsonb_array_elements(record->'variants')))
  from public.admin_goods_import_records('{}',array[good_id]) record;
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000051101',true);
select public.admin_save_good('{"id":"category-member-1","code":"CATEGORY-MEMBER-1","ip_id":"category-memberships","name":"분류 검색 검증","price":9000,
 "category_id":"00000000-0000-4000-8000-000000051111",
 "additional_category_ids":["00000000-0000-4000-8000-000000051121","00000000-0000-4000-8000-000000051122","00000000-0000-4000-8000-000000051121"],
 "variant_baseline":[],"variants":[{"name":"기본 옵션","code":"CATEGORY-MEMBER-1-1","attributes":{},"extraPrice":0,"stockQty":5}]}');
select 1/case when (select count(*) from public.goods_additional_categories where good_id='category-member-1')=2
 and (select category_id from public.goods where id='category-member-1')='00000000-0000-4000-8000-000000051111'
 then 1 else 0 end as assert_primary_preserved_and_additional_deduplicated;
select public.admin_save_good('{"id":"category-member-2","code":"CATEGORY-MEMBER-2","ip_id":"category-memberships","name":"분류 검색 검증","price":9000,
 "category_id":"00000000-0000-4000-8000-000000051121",
 "additional_category_ids":["00000000-0000-4000-8000-000000051122"],
 "variant_baseline":[],"variants":[{"name":"기본 옵션","code":"CATEGORY-MEMBER-2-1","attributes":{},"extraPrice":0,"stockQty":5}]}');
select 1/case when (public.admin_search_goods_workspace(p_query=>'CATEGORY-MEMBER-',p_ip_id=>'category-memberships',p_status=>'draft',p_stock=>'ok',
 p_category_id=>'00000000-0000-4000-8000-000000051120',p_limit=>1)->>'total')::int=2
 and jsonb_array_length(public.admin_search_goods_workspace(p_query=>'CATEGORY-MEMBER-',p_category_id=>'00000000-0000-4000-8000-000000051120',p_limit=>1,p_offset=>1)->'rows')=1
 and (select count(*) from public.admin_goods_workspace_export_candidates(p_query=>'CATEGORY-MEMBER-',p_category_id=>'00000000-0000-4000-8000-000000051120'))=2
 then 1 else 0 end as assert_primary_and_additional_descendants_share_filters_paging_and_export;
select public.admin_save_good(pg_temp.category_good_payload('category-member-1')-'additional_category_ids');
select 1/case when (select count(*) from public.goods_additional_categories where good_id='category-member-1')=2
 then 1 else 0 end as assert_omission_preserves_memberships;
select fingerprint as previous_fingerprint from public.admin_goods_import_records('{}',array['category-member-2']) record,
 lateral (select record->>'fingerprint' fingerprint) value \gset
select public.admin_save_good(pg_temp.category_good_payload('category-member-2')||'{"additional_category_ids":[]}');
select 1/case when (select record->>'fingerprint' from public.admin_goods_import_records('{}',array['category-member-2']) record)<>:'previous_fingerprint'
 then 1 else 0 end as assert_membership_edit_invalidates_import_snapshot;
do $$ begin
  begin perform public.admin_save_good(pg_temp.category_good_payload('category-member-1')||'{"additional_category_ids":["00000000-0000-4000-8000-000000051120"]}');
    raise exception 'non-leaf accepted'; exception when check_violation then if sqlerrm<>'category_not_leaf' then raise; end if; end;
  begin perform public.admin_save_good(pg_temp.category_good_payload('category-member-1')||'{"additional_category_ids":"invalid"}');
    raise exception 'invalid array accepted'; exception when invalid_parameter_value then null; end;
  begin insert into public.goods_additional_categories(good_id,category_id) values('category-member-1','00000000-0000-4000-8000-000000051110');
    raise exception 'direct mutation accepted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 1/case when (select count(*) from public.audit_log where target='goods:category-member-1' and action='admin.good.additional_categories_saved')=1
 then 1 else 0 end as assert_noop_does_not_duplicate_audit;
do $$ begin
  begin insert into public.catalog_categories(code,name,parent_id,depth) values('category-forbidden-child','말단 변경 불가','00000000-0000-4000-8000-000000051122',3);
    raise exception 'additional member leaf became parent'; exception when check_violation then if sqlerrm<>'category_has_goods' then raise; end if; end;
end $$;
update public.catalog_categories set archived_at=now() where id='00000000-0000-4000-8000-000000051122';
set local role authenticated;
select public.admin_save_good(pg_temp.category_good_payload('category-member-1'));
select public.admin_clone_good('00000000-0000-4000-8000-000000051130','category-member-1','category-member-copy','CATEGORY-MEMBER-COPY','분류 복사');
select 1/case when (select count(*) from public.goods_additional_categories where good_id='category-member-copy')=1
 then 1 else 0 end as assert_clone_copies_active_additional_categories_only;
select public.admin_save_good(pg_temp.category_good_payload('category-member-copy')||'{"additional_category_ids":[]}');
select public.admin_clone_good('00000000-0000-4000-8000-000000051130','category-member-1','category-member-copy','CATEGORY-MEMBER-COPY','분류 복사');
select 1/case when not exists(select 1 from public.goods_additional_categories where good_id='category-member-copy')
 then 1 else 0 end as assert_clone_replay_preserves_later_edits;
select public.admin_save_good(pg_temp.category_good_payload('category-member-2')||'{"additional_category_ids":["00000000-0000-4000-8000-000000051111"]}');
select public.admin_save_good(pg_temp.category_good_payload('category-member-2')||'{"id":"category-member-renamed"}');
select 1/case when exists(select 1 from public.goods_additional_categories where good_id='category-member-renamed' and category_id='00000000-0000-4000-8000-000000051111')
 and not exists(select 1 from public.goods_additional_categories where good_id='category-member-2')
 then 1 else 0 end as assert_draft_url_rename_preserves_memberships;
select public.admin_assign_good_category('00000000-0000-4000-8000-000000051131','category-member-1','00000000-0000-4000-8000-000000051121',null);
select 1/case when not exists(select 1 from public.goods_additional_categories where good_id='category-member-1' and category_id='00000000-0000-4000-8000-000000051121')
 then 1 else 0 end as assert_primary_promotion_removes_redundant_membership;
select public.admin_save_good(pg_temp.category_good_payload('category-member-1')||'{"additional_category_ids":[]}');
do $$ begin
  begin perform public.admin_save_good(pg_temp.category_good_payload('category-member-1')||'{"additional_category_ids":["00000000-0000-4000-8000-000000051122"]}');
    raise exception 'archived new membership accepted'; exception when check_violation then if sqlerrm<>'category_archived' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000051102',true);
select 1/case when not exists(select 1 from public.goods_additional_categories) then 1 else 0 end as assert_member_cannot_read_admin_memberships;
reset role;
select 1/case when not has_table_privilege('anon','public.goods_additional_categories','select')
 and not has_table_privilege('authenticated','public.goods_additional_categories','insert')
 and not has_function_privilege('authenticated','private.apply_goods_additional_categories(text,uuid[])','execute')
 and not has_function_privilege('service_role','private.apply_goods_additional_categories(text,uuid[])','execute')
 and not (select customer_enabled from public.category_activation_control where id='catalog')
 then 1 else 0 end as assert_acl_and_public_gate_unchanged;
rollback;
