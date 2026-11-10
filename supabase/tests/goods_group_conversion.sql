\set ON_ERROR_STOP on
begin;
create function pg_temp.gg_error(q text,wanted text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if position(wanted in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected error: %',wanted;
end$$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('a6140000-0000-4000-8000-000000000001','authenticated','authenticated','group-conversion-admin@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='admin',nickname='TEST 그룹 관리자',birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
 where id='a6140000-0000-4000-8000-000000000001';
insert into private.operator_memberships(profile_id,manager_role) values('a6140000-0000-4000-8000-000000000001','primary');
insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values('a6140000-0000-4000-8000-000000000002','a6140000-0000-4000-8000-000000000001',now(),now(),now()+interval '1 hour');
insert into public.ips(id,title,vertical_key,published_at) values('group-conversion-ip','TEST 그룹 IP','character',now());
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values('group-conversion-source','group-conversion-ip','TEST 원상품','문구',10000,'ok',7);
select id as first_variant from public.goods_variants where good_id='group-conversion-source' and is_default \gset
insert into public.goods_variants(id,good_id,name,attributes,price,stock_qty,sort_order,is_default) values
 ('a6140000-0000-4000-8000-000000000003','group-conversion-source','파랑','{"색상":"파랑"}',12000,11,1,false),
 ('a6140000-0000-4000-8000-000000000004','group-conversion-source','미선택','{"색상":"미선택"}',13000,13,2,false);
insert into private.goods_variant_external_identity(variant_id,erp_code,erp_name,barcode)
 values('a6140000-0000-4000-8000-000000000003','GROUP-ERP-001','TEST 파랑','000123');
insert into public.orders(id,user_id,status,total,address,created_at,delivered_at)
 select ('a6140000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'a6140000-0000-4000-8000-000000000001','delivered',12000,'{}',now()-interval '2 days',now()-interval '1 day'
 from generate_series(100,101) n;
insert into public.order_items(order_id,good_id,variant_id,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,variant_name_snapshot,qty,unit_price)
 select ('a6140000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'group-conversion-source','a6140000-0000-4000-8000-000000000003',
 'TEST 전환 전 구매명','문구','group-conversion-ip','TEST 파랑 구매옵션',1,12000 from generate_series(100,101) n;
insert into public.reviews(id,user_id,good_id,order_id,rating,body,status,hidden_reason,hidden_at) values
 ('a6140000-0000-4000-8000-000000000102','a6140000-0000-4000-8000-000000000001','group-conversion-source','a6140000-0000-4000-8000-000000000100',4,'TEST 이전 구매 리뷰','visible',null,null),
 ('a6140000-0000-4000-8000-000000000103','a6140000-0000-4000-8000-000000000001','group-conversion-source','a6140000-0000-4000-8000-000000000101',1,'TEST 숨김 리뷰','hidden','TEST 검증',clock_timestamp());
select md5(jsonb_agg(to_jsonb(i) order by i.id)::text) as original_items_hash from public.order_items i where i.good_id='group-conversion-source' \gset
select good_name_snapshot as original_good_name,variant_name_snapshot as original_option_name from public.order_items where order_id='a6140000-0000-4000-8000-000000000100' \gset
set local role authenticated;
select set_config('request.jwt.claim.sub','a6140000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a6140000-0000-4000-8000-000000000001","role":"authenticated","session_id":"a6140000-0000-4000-8000-000000000002"}',true);
select public.admin_save_goods_variant_purchase_cost('group-conversion-source','a6140000-0000-4000-8000-000000000003',4567,'included',null);
select jsonb_build_object('sourceGoodId','group-conversion-source','name','TEST 그룹','optionNames',jsonb_build_array('색상'),
 'selections',jsonb_build_array(jsonb_build_object('variantId',:'first_variant','values',jsonb_build_array('빨강')),
 jsonb_build_object('variantId','a6140000-0000-4000-8000-000000000003','values',jsonb_build_array('파랑')))) as request \gset
select public.admin_preview_goods_group_conversion(:'request','a6140000-0000-4000-8000-000000000001','a6140000-0000-4000-8000-000000000002') as preview \gset
select 1/case when :'preview'::jsonb->>'state'='ready' and jsonb_array_length(:'preview'::jsonb#>'{plan,unselectedOptions}')=1
 and not :'preview'::jsonb::text like '%4567%' then 1 else 0 end as assert_plan_private_cost_absent;
select public.admin_confirm_goods_group_conversion((:'preview'::jsonb->>'previewId')::uuid,'a6140000-0000-4000-8000-000000000005',
 'a6140000-0000-4000-8000-000000000001','a6140000-0000-4000-8000-000000000002') as receipt \gset
select 1/case when public.admin_confirm_goods_group_conversion((:'preview'::jsonb->>'previewId')::uuid,'a6140000-0000-4000-8000-000000000005',
 'a6140000-0000-4000-8000-000000000001','a6140000-0000-4000-8000-000000000002')=:'receipt'::jsonb then 1 else 0 end as assert_exact_replay;
reset role;
set constraints all immediate;
select :'receipt'::jsonb#>>'{group,members,1,goodId}' as new_good \gset
select :'receipt'::jsonb#>>'{group,members,1,variantId}' as new_variant \gset
select 1/case when (select count(*)=2 from private.goods_group_members where group_id=(:'receipt'::jsonb#>>'{group,id}')::uuid)
 and (select count(*)=1 from public.goods_variants where good_id='group-conversion-source' and archived_at is null)
 and (select id=:'first_variant' and stock_qty=7 from public.goods_variants where good_id='group-conversion-source' and is_default)
 and (select stock_qty=11 and price=12000 from public.goods_variants where id=:'new_variant')
 and (select stock_qty=0 and archived_at is not null from public.goods_variants where id='a6140000-0000-4000-8000-000000000003')
 and (select stock_qty=13 and archived_at is not null from public.goods_variants where id='a6140000-0000-4000-8000-000000000004')
 and (select sum(stock_qty)=31 from public.goods where id in('group-conversion-source',:'new_good'))
 and (select bool_and(published_at is null) from public.goods where id in('group-conversion-source',:'new_good'))
 then 1 else 0 end as assert_stock_identity_and_unpublication;
select 1/case when (select variant_id=:'new_variant' from private.goods_variant_external_identity where erp_code='GROUP-ERP-001')
 and (select target_variant_id=:'new_variant' from private.goods_group_external_identity_moves where source_variant_id='a6140000-0000-4000-8000-000000000003')
 and (select unit_cost_krw=4567 from private.goods_variant_purchase_costs where variant_id=:'new_variant')
 and (select count(*)=2 from private.goods_aggregation_members where root_good_id='group-conversion-source')
 and not exists(select 1 from private.goods_group_write_authorizations where transaction_id=txid_current())
 then 1 else 0 end as assert_current_identifiers_cost_and_aggregation;
select pg_temp.gg_error('update public.goods_variants set archived_at=null where id=''a6140000-0000-4000-8000-000000000003''','goods_group_old_variant_retired');
select pg_temp.gg_error(format('insert into public.goods_variants(good_id,name,price,is_default) values(%L,''extra'',12000,false)',:'new_good'),'goods_group_single_variant_required');
select pg_temp.gg_error('update public.goods set name=''임의 이름'' where id=''group-conversion-source''','goods_group_name_owned_by_group');
set local role authenticated;
select 1/case when public.admin_search_goods_groups('TEST 그룹',1,30)->>'total'='1'
 and public.admin_get_goods_group_source('group-conversion-source')->>'groupId'=:'receipt'::jsonb#>>'{group,id}'
 then 1 else 0 end as assert_admin_readers;
select jsonb_build_object('name','변경 그룹','optionNames',jsonb_build_array('색상'),'members',jsonb_build_array(
 jsonb_build_object('goodId',:'new_good','values',jsonb_build_array('파랑')),
 jsonb_build_object('goodId','group-conversion-source','values',jsonb_build_array('빨강')))) as structure \gset
select public.admin_save_goods_group((:'receipt'::jsonb#>>'{group,id}')::uuid,1,:'structure',
 'a6140000-0000-4000-8000-000000000006','a6140000-0000-4000-8000-000000000001','a6140000-0000-4000-8000-000000000002') as changed \gset
select 1/case when :'changed'::jsonb#>>'{group,revision}'='2' and :'changed'::jsonb#>>'{group,members,0,goodId}'=:'new_good'
 and public.admin_read_goods_group_change((:'receipt'::jsonb#>>'{group,id}')::uuid,1,'update',
  'a6140000-0000-4000-8000-000000000006','a6140000-0000-4000-8000-000000000001','a6140000-0000-4000-8000-000000000002',false)=:'changed'::jsonb
 then 1 else 0 end as assert_structure_save_and_metadata_receipt;
select pg_temp.gg_error(format('select public.admin_save_goods_group(%L,1,%L,%L,%L,%L)',:'receipt'::jsonb#>>'{group,id}',:'structure',
 'a6140000-0000-4000-8000-000000000007','a6140000-0000-4000-8000-000000000001','a6140000-0000-4000-8000-000000000002'),'goods_group_changed');
select public.admin_save_goods_group((:'receipt'::jsonb#>>'{group,id}')::uuid,2,
 jsonb_set(:'structure','{members}',jsonb_build_array(:'structure'::jsonb#>'{members,0}')),
 'a6140000-0000-4000-8000-000000000008','a6140000-0000-4000-8000-000000000001','a6140000-0000-4000-8000-000000000002') as detached \gset
select 1/case when :'detached'::jsonb#>>'{group,commonGoodId}'=:'new_good'
 and public.admin_get_goods_aggregation(:'new_good')->>'ownerGoodId'='group-conversion-source'
 then 1 else 0 end as assert_display_detach_keeps_financial_family;
select public.admin_archive_goods_group((:'receipt'::jsonb#>>'{group,id}')::uuid,3,
 'a6140000-0000-4000-8000-000000000009','a6140000-0000-4000-8000-000000000001','a6140000-0000-4000-8000-000000000002') as archived \gset
select 1/case when :'archived'::jsonb#>>'{group,archivedAt}' is not null and :'archived'::jsonb#>'{group,members}'='[]'::jsonb
 and public.admin_get_goods_aggregation(:'new_good')->>'ownerGoodId'='group-conversion-source'
 then 1 else 0 end as assert_group_archive_never_reverses_conversion;
select public.admin_save_goods_group('a6140000-0000-4000-8000-000000000010',0,:'structure',
 'a6140000-0000-4000-8000-000000000011','a6140000-0000-4000-8000-000000000001','a6140000-0000-4000-8000-000000000002') as assembled \gset
select 1/case when :'assembled'::jsonb#>>'{group,revision}'='1' then 1 else 0 end as assert_new_group_from_existing_single_option_goods;
select public.admin_read_goods_group_change('a6140000-0000-4000-8000-000000000012',0,'create',
 'a6140000-0000-4000-8000-000000000013','a6140000-0000-4000-8000-000000000001','a6140000-0000-4000-8000-000000000002',true) as sealed \gset
select 1/case when public.admin_save_goods_group('a6140000-0000-4000-8000-000000000012',0,:'structure',
 'a6140000-0000-4000-8000-000000000013','a6140000-0000-4000-8000-000000000001','a6140000-0000-4000-8000-000000000002')=:'sealed'::jsonb
 then 1 else 0 end as assert_seal_blocks_delayed_structure_write;
reset role;
select 1/case when not exists(select 1 from private.goods_groups where id='a6140000-0000-4000-8000-000000000012')
 and (select count(*)=2 from private.goods_aggregation_members where root_good_id='group-conversion-source')
 then 1 else 0 end as assert_sealed_absent_and_family_unchanged;
select 1/case when (select md5(jsonb_agg(to_jsonb(i) order by i.id)::text) from public.order_items i where i.good_id='group-conversion-source')=:'original_items_hash'
 then 1 else 0 end as assert_purchased_identity_and_amount_snapshots_unchanged;
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values('a6140000-0000-4000-8000-000000000104','group-conversion-origin','TEST 그룹 출고지','hanjin',3000,'TEST 합성 주소',true);
update public.goods set origin_id='a6140000-0000-4000-8000-000000000104' where id='group-conversion-source';
update public.goods set origin_id='a6140000-0000-4000-8000-000000000104' where id=:'new_good';
set local role authenticated;
do $$declare good_key text;variants jsonb;config jsonb;begin
 for good_key in select id from public.goods where ip_id='group-conversion-ip' loop
  config:=public.admin_read_goods_kc(good_key);
  select jsonb_agg(id) into variants from public.goods_variants where good_id=good_key and archived_at is null;
  perform public.admin_save_goods_kc(good_key,jsonb_build_array(jsonb_build_object('family','other','scheme','not_applicable',
   'productCategory','','modelName','','businessRole','','businessName','','identifier','','publicNote','',
   'variantIds',variants,'basis','','evidence',jsonb_build_object('applicability','','certificate','','testReport','','declaration',''))),
   'reviewed',(config->>'revision')::integer,config->>'contextFingerprint',true);
 end loop;
end$$;
reset role;
update public.goods set published_at=clock_timestamp() where ip_id='group-conversion-ip';
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"anon"}',true);
select 1/case when jsonb_array_length(public.get_good_group(:'new_good')->'members')=2
 and public.get_good_group_reviews(:'new_good')#>>'{summary,count}'='1'
 and (public.get_good_group_reviews(:'new_good')#>>'{summary,average}')::numeric=4
 and public.get_good_group_reviews(:'new_good')#>>'{reviews,0,goodId}'='group-conversion-source'
 and public.get_good_group_reviews(:'new_good')#>>'{reviews,0,goodName}'=:'original_good_name'
 and public.get_good_group_reviews(:'new_good')#>>'{reviews,0,variantNames,0}'=:'original_option_name'
 and public.get_good_group_reviews(:'new_good','recent',false,10,100)->>'total'='1'
 then 1 else 0 end as assert_public_group_reviews_preserve_purchase_and_full_page_total;
reset role;
update public.goods set published_at=null where id='group-conversion-source';
set local role anon;
select 1/case when jsonb_array_length(public.get_good_group(:'new_good')->'members')=1
 and public.get_good_group_reviews(:'new_good')#>>'{summary,count}'='0'
 and public.get_good_group('group-conversion-source') is null
 then 1 else 0 end as assert_group_does_not_reveal_unpublished_goods_or_reviews;
reset role;
select 1/case when not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'
 and (p.proname like '%goods_group%' or p.proname='record_goods_stock_successor')
 and (has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute')))
 then 1 else 0 end as assert_private_functions_sealed;
rollback;
