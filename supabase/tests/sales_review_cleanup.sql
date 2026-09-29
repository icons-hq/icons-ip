\set ON_ERROR_STOP on
-- #505: exercise the public save/search seams, including the real audit history.
begin;
select set_config('request.jwt.claim.sub','',true);

create function pg_temp.good_payload(good_id text) returns jsonb language sql as $$
  select record->'good'||jsonb_build_object('previous_id',good_id,
    'variant_baseline',(select coalesce(jsonb_agg(value->'id'),'[]') from jsonb_array_elements(record->'variants') where value->>'archived_at' is null),
    'variants',(select jsonb_agg(jsonb_build_object('id',value->'id','name',value->'name','code',value->'code','attributes',value->'attributes',
      'extraPrice',(value->>'price')::integer-(record#>>'{good,price}')::integer,'stockQty',value->'stock_qty',
      'expectedStockQty',value->'stock_qty','isActive',value->>'archived_at' is null,'lowStockThreshold',value->'low_stock_threshold'))
      from jsonb_array_elements(record->'variants')))
  from public.admin_goods_import_records('{}',array[good_id]) record;
$$;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000050501','authenticated','authenticated','review-cleanup-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000050502','authenticated','authenticated','review-cleanup-member@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000050501';
insert into public.verticals(key,label,color) values('review-cleanup','리뷰 회귀 검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values('review-cleanup','리뷰 회귀 검증','review-cleanup',now());
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000050501',true);
select public.admin_save_good('{"id":"review-cleanup-policy","ip_id":"review-cleanup","name":"정책 검증","price":1000,
 "variant_baseline":[],"variants":[{"name":"기본 옵션","code":"REVIEW-CLEANUP-1","attributes":{},"extraPrice":0,"stockQty":10}],
 "allow_card_payment":true,"allow_bank_transfer":true,"order_quantity_limit_enabled":false,"min_order_qty":1,"max_order_qty":5}');
reset role;
delete from public.audit_log where action='admin.good.sales_policy_saved' and target='goods:review-cleanup-policy';
set local role authenticated;

select public.admin_save_good(pg_temp.good_payload('review-cleanup-policy')||
 '{"allow_card_payment":false,"order_quantity_limit_enabled":true,"max_order_qty":3}');
reset role;
select 1/case when (select count(*) from public.audit_log where action='admin.good.sales_policy_saved' and target='goods:review-cleanup-policy')=1
 and exists(select 1 from public.audit_log where action='admin.good.sales_policy_saved' and target='goods:review-cleanup-policy'
   and diff#>>'{before,allow_card_payment}'='true' and diff#>>'{after,allow_card_payment}'='false'
   and diff#>>'{before,order_quantity_limit_enabled}'='false' and diff#>>'{after,order_quantity_limit_enabled}'='true'
   and diff#>>'{before,max_order_qty}'='5' and diff#>>'{after,max_order_qty}'='3')
 then 1 else 0 end as assert_one_complete_audit_for_controls_and_limits;

delete from public.audit_log where action='admin.good.sales_policy_saved' and target='goods:review-cleanup-policy';
set local role authenticated;
select public.admin_save_good(pg_temp.good_payload('review-cleanup-policy')||'{"allow_card_payment":true}');
reset role;
select 1/case when (select count(*) from public.audit_log where action='admin.good.sales_policy_saved' and target='goods:review-cleanup-policy')=1
 and exists(select 1 from public.audit_log where action='admin.good.sales_policy_saved' and target='goods:review-cleanup-policy'
   and diff#>>'{before,allow_card_payment}'='false' and diff#>>'{after,allow_card_payment}'='true'
   and diff#>>'{before,max_order_qty}'='3' and diff#>>'{after,max_order_qty}'='3')
 then 1 else 0 end as assert_controls_only_keep_the_original_before;

delete from public.audit_log where action='admin.good.sales_policy_saved' and target='goods:review-cleanup-policy';
set local role authenticated;
select public.admin_save_good(pg_temp.good_payload('review-cleanup-policy')||'{"max_order_qty":4}');
reset role;
select 1/case when (select count(*) from public.audit_log where action='admin.good.sales_policy_saved' and target='goods:review-cleanup-policy')=1
 and exists(select 1 from public.audit_log where action='admin.good.sales_policy_saved' and target='goods:review-cleanup-policy'
   and diff#>>'{before,max_order_qty}'='3' and diff#>>'{after,max_order_qty}'='4')
 then 1 else 0 end as assert_limits_only_keep_one_audit;
set local role authenticated;
select public.admin_save_good(pg_temp.good_payload('review-cleanup-policy'));
reset role;
select 1/case when (select count(*) from public.audit_log where action='admin.good.sales_policy_saved' and target='goods:review-cleanup-policy')=1
 then 1 else 0 end as assert_noop_does_not_append_an_audit;

insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values
 ('review-cleanup-percent','review-cleanup','검증 50% 할인','문구',1000,'ok',10),
 ('review-cleanup-underscore','review-cleanup','검증 A_B','문구',1000,'ok',10),
 ('review-cleanup-backslash','review-cleanup',E'검증 A\\B','문구',1000,'ok',10),
 ('review-cleanup-long','review-cleanup',repeat('가',101),'문구',1000,'ok',10),
 ('review-cleanup-hidden','review-cleanup','검증 50% 숨김','문구',1000,'ok',10);
select pg_temp.publish_goods_kc_fixture(id) from public.goods
 where id in ('review-cleanup-percent','review-cleanup-underscore','review-cleanup-backslash','review-cleanup-long');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000050501',true);
select 1/case when (select array_agg(id order by id) from public.admin_find_goods_for_shipping_notice_template(null,'%'))
 =array['review-cleanup-hidden','review-cleanup-percent']
 and (select array_agg(id) from public.admin_find_goods_for_shipping_notice_template(null,'_'))=array['review-cleanup-underscore']
 and (select array_agg(id) from public.admin_find_goods_for_shipping_notice_template(null,E'\\'))=array['review-cleanup-backslash']
 then 1 else 0 end as assert_template_lookup_treats_patterns_as_literals;
select 1/case when public.admin_search_goods_additional('review-cleanup-policy','%')->0->>'goodId'='review-cleanup-percent'
 and jsonb_array_length(public.admin_search_goods_additional('review-cleanup-policy','%'))=1
 and public.admin_search_goods_additional('review-cleanup-policy','_')->0->>'goodId'='review-cleanup-underscore'
 and jsonb_array_length(public.admin_search_goods_additional('review-cleanup-policy','_'))=1
 and public.admin_search_goods_additional('review-cleanup-policy',E'\\')->0->>'goodId'='review-cleanup-backslash'
 and jsonb_array_length(public.admin_search_goods_additional('review-cleanup-policy',E'\\'))=1
 then 1 else 0 end as assert_additional_lookup_escapes_patterns_and_keeps_visibility;
select 1/case when (select count(*) from public.admin_find_goods_for_shipping_notice_template(null,repeat('가',100)))=1
 and (select count(*) from public.admin_find_goods_for_shipping_notice_template(null,repeat('가',101)))=0
 and jsonb_array_length(public.admin_search_goods_additional('review-cleanup-policy',repeat('가',100)))=1
 and public.admin_search_goods_additional('review-cleanup-policy',repeat('가',101))='[]'::jsonb
 and (select count(*) from public.admin_find_goods_for_shipping_notice_template(null,repeat(' ',101)))=0
 and public.admin_search_goods_additional('review-cleanup-policy',repeat(' ',101))='[]'::jsonb
 and public.admin_search_goods_additional('review-cleanup-percent','%')='[]'::jsonb
 then 1 else 0 end as assert_search_length_cap_and_base_exclusion;
select 1/case when exists(select 1 from public.admin_find_goods_for_shipping_notice_template(null,'') where id='review-cleanup-hidden')
 and exists(select 1 from public.admin_find_goods_for_shipping_notice_template(null,null) where id='review-cleanup-hidden')
 and public.admin_search_goods_additional('review-cleanup-policy','')='[]'::jsonb
 and public.admin_search_goods_additional('review-cleanup-policy',null)='[]'::jsonb
 then 1 else 0 end as assert_empty_search_behavior_is_preserved;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000050502',true);
select 1/case when not exists(select 1 from public.admin_find_goods_for_shipping_notice_template(null,'')) then 1 else 0 end as assert_member_cannot_search_drafts;
do $$ begin
  begin
    perform public.admin_search_goods_additional('review-cleanup-policy','검증');
  exception when insufficient_privilege then return;
  end;
  raise exception 'member additional lookup must require staff';
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select 1/case when not has_function_privilege('anon','public.admin_find_goods_for_shipping_notice_template(uuid,text)','execute')
 and not has_function_privilege('service_role','public.admin_find_goods_for_shipping_notice_template(uuid,text)','execute')
 and not has_function_privilege('anon','public.admin_search_goods_additional(text,text)','execute')
 and not has_function_privilege('service_role','public.admin_search_goods_additional(text,text)','execute')
 and not has_function_privilege('anon','private.admin_save_good_before_category(jsonb)','execute')
 and not has_function_privilege('authenticated','private.admin_save_good_before_category(jsonb)','execute')
 and not has_function_privilege('service_role','private.admin_save_good_before_category(jsonb)','execute')
 then 1 else 0 end as assert_redefined_functions_are_sealed;

select 1/case when count(*)=4 then 1 else 0 end as assert_all_four_foreign_keys_have_covering_indexes
from (values ('public.order_items'::regclass,'price_period_id'),('public.order_items'::regclass,'preorder_policy_id'),
 ('public.order_shipments'::regclass,'delivery_policy_id'),('public.goods_variants'::regclass,'preorder_policy_id')) expected(table_id,column_name)
where exists(select 1 from pg_constraint foreign_key join pg_attribute column_info
 on column_info.attrelid=foreign_key.conrelid and column_info.attnum=any(foreign_key.conkey)
 where foreign_key.contype='f' and foreign_key.conrelid=expected.table_id and column_info.attname=expected.column_name
   and exists(select 1 from pg_index index where index.indrelid=expected.table_id and index.indisvalid
     and array(select unnest(index.indkey) limit cardinality(foreign_key.conkey))=foreign_key.conkey));
rollback;
