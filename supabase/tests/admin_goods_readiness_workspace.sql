\set ON_ERROR_STOP on
-- Prepend helpers/goods_kc_fixture.sql. Synthetic, transaction-local, no deliveries.
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000052801','authenticated','authenticated','readiness-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000052802','authenticated','authenticated','readiness-member@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='admin' where id='00000000-0000-4000-8000-000000052801';
insert into public.verticals(key,label,color) values('readiness-test','상품 준비 테스트','#000');
insert into public.ips(id,title,vertical_key,published_at) values('readiness-test','준비 테스트','readiness-test',now()),('readiness-draft-ip','초안 IP','readiness-test',null);
insert into public.catalog_categories(id,code,name,parent_id,depth,sort_order) values
 ('00000000-0000-4000-8000-000000052810','readiness-parent','테스트 상위',null,1,0),
 ('00000000-0000-4000-8000-000000052811','readiness-child','테스트 하위','00000000-0000-4000-8000-000000052810',2,0);
insert into public.goods(id,code,ip_id,name,type,price,stock,category_id)
 select 'readiness-'||lpad(n::text,3,'0'),'READINESS-'||lpad(n::text,3,'0'),'readiness-test','동일 상품명','문구',1000,'ok','00000000-0000-4000-8000-000000052811'::uuid
 from generate_series(1,25) n;
update public.goods set image_path='public-media/readiness-fixture.webp',notice_maker='합성',notice_origin='한국',notice_material='종이',notice_size='A5',notice_made_on='2026',notice_as_manager='합성 CS',notice_as_contact='02-000'
 where id like 'readiness-%';
update public.goods_variants set stock_qty=5 where good_id like 'readiness-%';
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id in ('readiness-001','readiness-002','readiness-003','readiness-004');
-- Emulate the preserved historical row without changing any trigger or policy.
delete from private.goods_kc_review_events where good_id='readiness-002';
delete from private.goods_kc_reviews where good_id='readiness-002';
update public.goods set stock='soldout' where id='readiness-003';
update public.goods_variants set archived_at=now() where good_id='readiness-004';
update public.goods_variants set stock_qty=0 where good_id='readiness-005';
update public.goods set archived_at=now() where id='readiness-005';
update public.goods set notice_maker=null,ip_id='readiness-draft-ip' where id='readiness-006';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000052801',true);
select 1/case when public.admin_read_goods_readiness('readiness-001')->>'state'='ready' then 1 else 0 end as assert_complete_goods_ready;
select 1/case when public.admin_read_goods_readiness('readiness-002')->>'publicReview'='legacy_unrecorded'
 and public.admin_read_goods_readiness('readiness-002')->>'saleSettings'='ready'
 and public.admin_read_goods_readiness('readiness-002')->>'publication'='published' then 1 else 0 end as assert_legacy_review_does_not_stop_existing_sale;
select 1/case when public.admin_read_goods_readiness('readiness-003')->'reasonCodes' ? 'stopped'
 and public.admin_read_goods_readiness('readiness-004')->'reasonCodes' ? 'no_active_options'
 and public.admin_read_goods_readiness('readiness-006')->'reasonCodes' ?& array['draft','notice_missing','ip_unpublished','kc_required'] then 1 else 0 end as assert_independent_axes_and_multiple_reasons;
select public.admin_search_goods_workspace(p_query=>'READINESS-',p_readiness=>'review_required',p_limit=>20) as queue \gset
select 1/case when (:'queue'::jsonb->>'total')::int=23 and jsonb_array_length(:'queue'::jsonb->'rows')=20
 and (select sum(value::int) from jsonb_each_text(:'queue'::jsonb->'reasonCounts'))>23 then 1 else 0 end as assert_total_deduplicates_goods_and_is_not_page_length;
select 1/case when jsonb_array_length(public.admin_search_goods_workspace(p_query=>'READINESS-',p_readiness=>'review_required',p_offset=>20)->'rows')=3
 and (public.admin_search_goods_workspace(p_query=>'READINESS-',p_readiness=>'review_required',p_limit=>0)->>'total')::int=23 then 1 else 0 end as assert_page_boundary_and_summary_match;
select 1/case when (public.admin_search_goods_workspace(p_query=>'READINESS-',p_category_id=>'00000000-0000-4000-8000-000000052810')->>'total')::int=24
 and (select count(*) from public.admin_goods_workspace_export_candidates(p_query=>'READINESS-',p_category_id=>'00000000-0000-4000-8000-000000052810'))=24 then 1 else 0 end as assert_child_category_and_export_ignore_public_activation_gate;
select 1/case when (public.admin_search_goods_workspace(p_query=>'READINESS-',p_status=>'archived')->>'total')::int=1 then 1 else 0 end as assert_archived_scope_explicit;
select 1/case when public.admin_read_goods_readiness('readiness-001')->>'priceMin'='1000' then 1 else 0 end as assert_option_price_uses_current_resolver;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000052802',true);
do $$ begin
 begin perform public.admin_search_goods_workspace(); raise exception 'member can read workspace'; exception when insufficient_privilege then null; end;
 begin perform public.admin_read_goods_readiness('readiness-001'); raise exception 'member can read readiness'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 1/case when not has_function_privilege('anon','public.admin_search_goods_workspace(text,text,text,text,uuid,text,integer,integer)','execute')
 and not has_function_privilege('service_role','public.admin_read_goods_readiness(text)','execute') then 1 else 0 end as assert_public_read_boundary_unchanged;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000052801',true);
select public.admin_save_goods_preorder('readiness-007',(select id from public.goods_variants where good_id='readiness-007'),null,
 jsonb_build_object('state','active','capacityQty',11,'startsAt',now()-interval '1 hour','endsAt',now()+interval '1 hour',
 'expectedShipDate',(now() at time zone 'Asia/Seoul')::date+7,'approvalReference','TEST-ONLY readiness supply'));
select 1/case when public.admin_read_goods_readiness('readiness-007')->>'availableQty'='11' then 1 else 0 end as assert_preorder_available_uses_supply_authority;
-- Saving and reviewing the draft removes exactly one item from the same queue.
select pg_temp.publish_goods_kc_fixture('readiness-008');
select 1/case when (public.admin_search_goods_workspace(p_query=>'READINESS-',p_readiness=>'review_required',p_limit=>0)->>'total')::int=22
 and public.admin_read_goods_readiness('readiness-008')->>'state'='ready' then 1 else 0 end as assert_review_publish_readback_updates_shared_queue;
select public.admin_save_good('{"id":"workspace-price-case","ip_id":"readiness-test","name":"옵션 가격 정밀 검증","price":10000,
 "variant_baseline":[],"variants":[{"name":"기본 옵션","code":"WORKSPACE-PRICE-1","attributes":{},"extraPrice":2345,"stockQty":10},
 {"name":"추가 옵션","code":"WORKSPACE-PRICE-2","attributes":{"구성":"추가"},"extraPrice":7890,"stockQty":10}]}');
select 1/case when public.admin_read_goods_readiness('workspace-price-case')->>'priceMin'='12345'
 and public.admin_read_goods_readiness('workspace-price-case')->>'priceMax'='17890' then 1 else 0 end as assert_option_range_is_not_good_base_price;
select public.admin_save_goods_price_period('workspace-price-case',(select id from public.goods_variants where good_id='workspace-price-case' and is_default),null,
 jsonb_build_object('state','active','discountPrice',10001,'startsAt',now()-interval '1 hour','endsAt',now()+interval '1 hour'));
select 1/case when public.admin_read_goods_readiness('workspace-price-case')->>'priceMin'='10001'
 and public.admin_read_goods_readiness('workspace-price-case')->>'priceMax'='17890' then 1 else 0 end as assert_current_period_price_is_exact;
update public.goods_variants set archived_at=now() where good_id='workspace-price-case' and not is_default;
select 1/case when public.admin_read_goods_readiness('workspace-price-case')->>'priceMax'='10001' then 1 else 0 end as assert_stopped_option_is_not_price_range;
explain (analyze,costs off,timing off) select public.admin_search_goods_workspace(p_query=>'READINESS-',p_readiness=>'review_required',p_limit=>20);
insert into public.goods(id,code,ip_id,name,type,price,stock)
 select 'workspace-scale-'||lpad(n::text,4,'0'),'WS-SCALE-'||lpad(n::text,4,'0'),'readiness-test','대량 목록 검증','문구',1000,'ok'
 from generate_series(1,1001) n;
select 1/case when (public.admin_search_goods_workspace(p_query=>'WS-SCALE-',p_readiness=>'review_required',p_limit=>0)->>'total')::int=1001
 and jsonb_array_length(public.admin_search_goods_workspace(p_query=>'WS-SCALE-',p_readiness=>'review_required',p_limit=>20,p_offset=>1000)->'rows')=1
 then 1 else 0 end as assert_more_than_postgrest_row_cap_is_counted_and_paged;
explain (analyze,costs off,timing off) select public.admin_search_goods_workspace(p_query=>'WS-SCALE-',p_readiness=>'review_required',p_limit=>20);
rollback;
