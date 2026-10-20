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
-- Preserve any committed owner from earlier suites in the same leased clone.
insert into private.operator_memberships(profile_id,manager_role)
 select 'a6140000-0000-4000-8000-000000000001'::uuid,
 case when exists(select 1 from private.operator_memberships where manager_role='owner') then 'primary' else 'owner' end;
update private.operator_access_state set configured=true where id;
select 1/case when (select configured from private.operator_access_state where id)
 and (select count(*)=1 from private.operator_memberships where manager_role='owner') then 1 else 0 end as assert_single_configured_owner;
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
reset role;
select (:'receipt'::jsonb#>>'{group,id}')::uuid as group_id \gset
select jsonb_build_object('goods',(private.goods_group_common_identity('group-conversion-source')->'goods')||jsonb_build_object('additional_category_ids','[]'::jsonb,
 'name_en','TEST common English','description','TEST 공통 설명','description_format','plain','description_image_paths','[]'::jsonb,'search_keywords',jsonb_build_array('공통 키워드')),
 'attributes',jsonb_build_object('categoryId',null,'schemaRevision',0,'expectedRevision',0,'values','{}'::jsonb,'removeIds','[]'::jsonb),
 'afterSales',jsonb_build_object('phone','0200000000','guide','TEST 공통 A/S 안내','sellerSpecialNotes','TEST 공통 특이사항'),
 'sizeChart',jsonb_build_object('enabled',true,'chart',jsonb_build_object('unit','cm','sizes',jsonb_build_array('S'),'measurements',jsonb_build_array(jsonb_build_object('name','가로','values',jsonb_build_array('10.5'))),'note','TEST 측정 안내')))
 as common_values \gset
select public.admin_save_goods_group_common(:'group_id',1,:'common_values','a6140000-0000-4000-8000-000000000200',
 'a6140000-0000-4000-8000-000000000001','a6140000-0000-4000-8000-000000000002') as common_receipt \gset
select 1/case when :'common_receipt'::jsonb#>>'{group,revision}'='2' and (select bool_and(name_en='TEST common English' and description='TEST 공통 설명' and published_at is null) from public.goods where id in('group-conversion-source',:'new_good'))
 and private.goods_group_common_identity('group-conversion-source')=private.goods_group_common_identity(:'new_good')
 then 1 else 0 end as assert_atomic_common_edit;
select 1/case when public.admin_save_goods_group_common(:'group_id',1,:'common_values','a6140000-0000-4000-8000-000000000200',
 'a6140000-0000-4000-8000-000000000001','a6140000-0000-4000-8000-000000000002')=:'common_receipt'::jsonb
 then 1 else 0 end as assert_common_idempotent_receipt;
select pg_temp.gg_error('update public.goods set description=''TEST 개인 수정'' where id=''group-conversion-source''','goods_group_common_owned_by_group');
update public.goods set description=description where id='group-conversion-source';
select 1/case when public.admin_get_goods_group_editor_ownership(:'new_good')#>>'{aggregation,ownerGoodId}'='group-conversion-source'
 and public.admin_get_goods_group_common(:'group_id')#>>'{afterSales,guide}'='TEST 공통 A/S 안내'
 then 1 else 0 end as assert_editor_owner_and_common_reader;
-- Category schemas and optional common sections use the same all-member write.
insert into public.catalog_categories(id,code,name,parent_id,sort_order) values
 ('a6140000-0000-4000-8000-000000000301','group-common-main','TEST 공통 대표',null,0),
 ('a6140000-0000-4000-8000-000000000302','group-common-extra','TEST 공통 추가',null,1);
select public.admin_save_goods_attribute_schema('a6140000-0000-4000-8000-000000000301',
 '[{"id":"a6140000-0000-4000-8000-000000000303","name":"TEST 재질","kind":"text","required":true,"unit":"","options":[]}]',0,'a6140000-0000-4000-8000-000000000304');
select coalesce((select revision from public.goods_attribute_values where good_id='group-conversion-source'),0) as current_attribute_revision \gset
select jsonb_set(jsonb_set(:'common_values','{goods}',(:'common_values'::jsonb->'goods')||jsonb_build_object(
 'category_id','a6140000-0000-4000-8000-000000000301','additional_category_ids',jsonb_build_array('a6140000-0000-4000-8000-000000000302'),
 'notice_maker','TEST 제조자','notice_origin','대한민국','notice_material','TEST 종이','notice_size','TEST 10cm',
 'notice_made_on','2026-10','notice_as_manager','TEST 담당자','notice_as_contact','02-0000-0000')),
 '{attributes}',jsonb_build_object('categoryId','a6140000-0000-4000-8000-000000000301','schemaRevision',1,'expectedRevision',:'current_attribute_revision'::integer,
 'values',jsonb_build_object('a6140000-0000-4000-8000-000000000303','TEST 공통 재질'),'removeIds','[]'::jsonb)) as populated_values \gset
select public.admin_save_goods_group_common(:'group_id',2,:'populated_values','a6140000-0000-4000-8000-000000000201',
 'a6140000-0000-4000-8000-000000000001','a6140000-0000-4000-8000-000000000002');
select 1/case when private.goods_group_common_identity('group-conversion-source')=private.goods_group_common_identity(:'new_good')
 and (select count(*)=2 from public.goods_additional_categories where good_id in('group-conversion-source',:'new_good') and category_id='a6140000-0000-4000-8000-000000000302')
 and (select count(*)=2 from public.goods_attribute_values where good_id in('group-conversion-source',:'new_good') and entries#>>'{0,value}'='TEST 공통 재질')
 then 1 else 0 end as assert_all_common_sections_applied;
select pg_temp.gg_error('update private.goods_after_sales_content set guide=''개별 우회'' where good_id=''group-conversion-source''','goods_group_common_owned_by_group');
select pg_temp.gg_error('delete from private.goods_after_sales_content where good_id=''group-conversion-source''','goods_group_common_owned_by_group');
select pg_temp.gg_error('update private.goods_size_charts set enabled=false where good_id=''group-conversion-source''','goods_group_common_owned_by_group');
select pg_temp.gg_error('delete from private.goods_size_charts where good_id=''group-conversion-source''','goods_group_common_owned_by_group');
select pg_temp.gg_error('update public.goods_attribute_values set entries=''[]'' where good_id=''group-conversion-source''','goods_group_common_owned_by_group');
select pg_temp.gg_error('delete from public.goods_additional_categories where good_id=''group-conversion-source''','goods_group_common_owned_by_group');
select pg_temp.gg_error('update public.goods set search_keywords=array[''개별 우회''] where id=''group-conversion-source''','goods_group_common_owned_by_group');
-- A normal save can keep common values and change the individual price.
select public.admin_save_good(to_jsonb(g)||jsonb_build_object('previous_id',g.id,'price',10123,'publish',false,'additional_category_ids',jsonb_build_array('a6140000-0000-4000-8000-000000000302')))
 from public.goods g where g.id='group-conversion-source';
select 1/case when (select price=10123 from public.goods where id='group-conversion-source') and (select price=12000 from public.goods where id=:'new_good') then 1 else 0 end as assert_individual_price_is_editable;

-- Real KC review and publication fixtures ensure common edits invalidate both
-- review evidence status and its public cached disclosures, preserving history.
create function pg_temp.review_and_publish_common(p_good text) returns void language plpgsql as $$
declare config jsonb;models jsonb;
begin
 config:=public.admin_read_goods_kc(p_good);
 models:=jsonb_build_array(jsonb_build_object('family','other','scheme','not_applicable','productCategory','TEST 공통 상품','modelName','TEST 모델',
 'businessRole','manufacturer','businessName','TEST 사업자','identifier','','publicNote','TEST 공개 안내',
 'variantIds',(select jsonb_agg(id::text order by id) from public.goods_variants where good_id=p_good and archived_at is null),
 'basis','TEST 근거','evidence',jsonb_build_object('applicability','TEST 근거 참조','certificate','','testReport','','declaration','')));
 perform public.admin_save_goods_kc(p_good,models,'reviewed',(config->>'revision')::integer,config->>'contextFingerprint',true);
 update public.goods set published_at=clock_timestamp() where id=p_good;
end$$;
select pg_temp.review_and_publish_common('group-conversion-source');
select pg_temp.review_and_publish_common(:'new_good');
select jsonb_object_agg(g.id,to_jsonb(g)-array['ip_id','type','category_id','name_en','notice_maker','notice_origin','notice_material','notice_size','notice_made_on',
 'notice_as_manager','notice_as_contact','description','description_format','description_image_paths','search_keywords','published_at','updated_at','kc_disclosures']) as personal_before,
 bool_and(published_at is not null and first_published_at is not null and jsonb_array_length(kc_disclosures)>0) as was_reviewed_and_published
 from public.goods g where id in('group-conversion-source',:'new_good') \gset
select 1/case when :'was_reviewed_and_published'::boolean then 1 else 0 end as assert_reviewed_fixture;
select md5(jsonb_agg(to_jsonb(v) order by id)::text) as variants_before from public.goods_variants v where good_id in('group-conversion-source',:'new_good') \gset
select md5(jsonb_agg(to_jsonb(v) order by variant_id)::text) as costs_before from private.goods_variant_purchase_costs v where variant_id=:'new_variant' \gset
set local role service_role;
select public.service_prepare_admin_artwork_upload('a6140000-0000-4000-8000-000000000001','catalog/good/a6140000-0000-4000-8000-000000000305.webp','good','image/webp',100,now()+interval '10 minutes');
select * from public.service_begin_admin_artwork_verification('a6140000-0000-4000-8000-000000000001','catalog/good/a6140000-0000-4000-8000-000000000305.webp');
select public.service_verify_admin_artwork_upload('a6140000-0000-4000-8000-000000000001','catalog/good/a6140000-0000-4000-8000-000000000305.webp',100);
reset role;
select jsonb_set(jsonb_set(:'populated_values','{goods}',(:'populated_values'::jsonb->'goods')||jsonb_build_object('description','<h2>TEST 공통 HTML</h2><img src="public-media/catalog/good/a6140000-0000-4000-8000-000000000305.webp" />',
 'description_format','html','description_image_paths',jsonb_build_array('public-media/catalog/good/a6140000-0000-4000-8000-000000000305.webp'))),
 '{attributes,expectedRevision}',to_jsonb((select revision from public.goods_attribute_values where good_id='group-conversion-source'))) as html_values \gset
set local role authenticated;
select public.admin_save_goods_group_common(:'group_id',3,:'html_values','a6140000-0000-4000-8000-000000000202',
 'a6140000-0000-4000-8000-000000000001','a6140000-0000-4000-8000-000000000002') as html_receipt \gset
reset role;
select 1/case when private.goods_group_common_identity('group-conversion-source')=private.goods_group_common_identity(:'new_good')
 and (select bool_and(description_format='html' and cardinality(description_image_paths)=1 and published_at is null and kc_disclosures='[]') from public.goods where id in('group-conversion-source',:'new_good'))
 and (select bool_and(status='unreviewed' and reviewed_by is null and reviewed_at is null) from private.goods_kc_reviews where good_id in('group-conversion-source',:'new_good'))
 and (select status='attached' from public.admin_artwork_upload_claims where path='catalog/good/a6140000-0000-4000-8000-000000000305.webp')
 and not exists(select 1 from private.goods_artwork_copy_authorizations where transaction_id=txid_current())
 and not exists(select 1 from private.goods_group_write_authorizations where transaction_id=txid_current())
 then 1 else 0 end as assert_html_copy_unpublication_and_kc_invalidation;
select 1/case when :'personal_before'::jsonb=(select jsonb_object_agg(g.id,to_jsonb(g)-array['ip_id','type','category_id','name_en','notice_maker','notice_origin','notice_material','notice_size','notice_made_on',
 'notice_as_manager','notice_as_contact','description','description_format','description_image_paths','search_keywords','published_at','updated_at','kc_disclosures']) from public.goods g where id in('group-conversion-source',:'new_good'))
 and :'variants_before'=(select md5(jsonb_agg(to_jsonb(v) order by id)::text) from public.goods_variants v where good_id in('group-conversion-source',:'new_good'))
 and :'costs_before'=(select md5(jsonb_agg(to_jsonb(v) order by variant_id)::text) from private.goods_variant_purchase_costs v where variant_id=:'new_variant')
 and :'original_items_hash'=(select md5(jsonb_agg(to_jsonb(i) order by i.id)::text) from public.order_items i where i.good_id='group-conversion-source')
 then 1 else 0 end as assert_individual_financial_history_preserved;

-- A late child validation failure rolls back earlier goods/A/S writes, logs,
-- authorizations and operation claims; the same operation ID remains reusable.
select jsonb_set(:'html_values','{attributes,expectedRevision}',to_jsonb((select revision from public.goods_attribute_values where good_id='group-conversion-source'))) as latest_values \gset
select jsonb_build_object('goods',(select jsonb_agg(to_jsonb(g) order by id) from public.goods g where id in('group-conversion-source',:'new_good')),
 'as',(select jsonb_agg(to_jsonb(a) order by good_id) from private.goods_after_sales_content a where good_id in('group-conversion-source',:'new_good')),
 'size',(select jsonb_agg(to_jsonb(c) order by good_id) from private.goods_size_charts c where good_id in('group-conversion-source',:'new_good')),
 'attrs',(select jsonb_agg(to_jsonb(a) order by good_id) from public.goods_attribute_values a where good_id in('group-conversion-source',:'new_good')),
 'group',private.goods_group_snapshot(:'group_id'),'audit',(select count(*) from public.audit_log)) as rollback_before \gset
select pg_temp.gg_error(format('select public.admin_save_goods_group_common(%L,4,%L,%L,%L,%L)',:'group_id',
 jsonb_set(jsonb_set(:'latest_values','{goods,name_en}','"MUST ROLLBACK"'),'{sizeChart,chart,unit}','"invalid"'),
 'a6140000-0000-4000-8000-000000000203','a6140000-0000-4000-8000-000000000001','a6140000-0000-4000-8000-000000000002'),'invalid_goods_size_chart');
select 1/case when :'rollback_before'::jsonb=jsonb_build_object('goods',(select jsonb_agg(to_jsonb(g) order by id) from public.goods g where id in('group-conversion-source',:'new_good')),
 'as',(select jsonb_agg(to_jsonb(a) order by good_id) from private.goods_after_sales_content a where good_id in('group-conversion-source',:'new_good')),
 'size',(select jsonb_agg(to_jsonb(c) order by good_id) from private.goods_size_charts c where good_id in('group-conversion-source',:'new_good')),
 'attrs',(select jsonb_agg(to_jsonb(a) order by good_id) from public.goods_attribute_values a where good_id in('group-conversion-source',:'new_good')),
 'group',private.goods_group_snapshot(:'group_id'),'audit',(select count(*) from public.audit_log))
 and not exists(select 1 from private.goods_group_operations where operation_id='a6140000-0000-4000-8000-000000000203')
 and not exists(select 1 from private.goods_group_write_authorizations where transaction_id=txid_current())
 then 1 else 0 end as assert_late_validation_atomic_rollback;
select pg_temp.gg_error(format('select public.admin_save_goods_group_common(%L,1,%L,%L,%L,%L)',:'group_id',:'latest_values',
 'a6140000-0000-4000-8000-000000000204','a6140000-0000-4000-8000-000000000001','a6140000-0000-4000-8000-000000000002'),'goods_group_changed');
select pg_temp.gg_error(format('select public.admin_save_goods_group_common(%L,1,%L,%L,%L,%L)',:'group_id',:'latest_values',
 'a6140000-0000-4000-8000-000000000200','a6140000-0000-4000-8000-000000000001','a6140000-0000-4000-8000-000000000002'),'goods_group_operation_conflict');
select pg_temp.gg_error(format('select public.admin_save_goods_group_common(%L,4,%L,%L,%L,%L)',:'group_id',:'common_values',
 'a6140000-0000-4000-8000-000000000205','a6140000-0000-4000-8000-000000000001','a6140000-0000-4000-8000-000000000002'),'goods_attributes_changed');
select public.admin_read_goods_group_change(:'group_id',4,'common','a6140000-0000-4000-8000-000000000206',
 'a6140000-0000-4000-8000-000000000001','a6140000-0000-4000-8000-000000000002',true) as sealed \gset
select 1/case when :'sealed'::jsonb->>'state'='sealed' and public.admin_save_goods_group_common(:'group_id',4,:'latest_values','a6140000-0000-4000-8000-000000000206',
 'a6140000-0000-4000-8000-000000000001','a6140000-0000-4000-8000-000000000002')=:'sealed'::jsonb then 1 else 0 end as assert_seal_prevents_late_dispatch;
select pg_temp.gg_error(format('select public.admin_save_goods_group_common(%L,4,%L,%L,%L,%L)',:'group_id',:'latest_values',
 'a6140000-0000-4000-8000-000000000207','a6140000-0000-4000-8000-000000000001','a6140000-0000-4000-8000-000000000999'),'goods_group_auth_changed');
update auth.sessions set not_after=now()-interval '1 minute' where id='a6140000-0000-4000-8000-000000000002';
select pg_temp.gg_error(format('select public.admin_save_goods_group_common(%L,3,%L,%L,%L,%L)',:'group_id',:'html_values',
 'a6140000-0000-4000-8000-000000000202','a6140000-0000-4000-8000-000000000001','a6140000-0000-4000-8000-000000000002'),'goods_group_auth_changed');
select 1/case when not has_function_privilege('anon','public.admin_save_goods_group_common(uuid,bigint,jsonb,uuid,uuid,uuid)','execute')
 and not has_function_privilege('service_role','public.admin_save_goods_group_common(uuid,bigint,jsonb,uuid,uuid,uuid)','execute')
 and not has_function_privilege('authenticated','private.assert_goods_group_common_write(text,jsonb,jsonb)','execute')
 then 1 else 0 end as assert_common_acl_sealed;
rollback;
