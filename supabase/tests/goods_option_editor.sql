\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-4000-8000-000000044101','authenticated','authenticated','goods-options@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000044101';
insert into public.verticals(key,label,color) values ('goods-options','옵션 검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values ('goods-options','옵션 검증','goods-options',now());
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000044101',true);
select public.admin_save_good('{"id":"option-editor","ip_id":"goods-options","name":"옵션 상품","price":1000,"variant_baseline":[],"variants":[{"name":"빨강","attributes":{"색상":"빨강","사이즈":"M"},"code":"RED-441","extraPrice":500,"stockQty":4},{"name":"파랑","attributes":{"색상":"파랑","사이즈":"L"},"code":"","extraPrice":0,"stockQty":3}]}');
select 1 / case when (select count(*) from public.goods_variants where good_id='option-editor' and archived_at is null)=2
 and exists(select 1 from public.goods_variants where good_id='option-editor' and code='RED-441' and price=1500 and stock_qty=4 and is_default and attributes='{"색상":"빨강","사이즈":"M"}'::jsonb)
 and (select stock_qty from public.goods where id='option-editor')=7 then 1 else 0 end as assert_initial_options_saved;
reset role;
create function pg_temp.option_payload() returns jsonb language sql as $$
 select jsonb_build_object('previous_id',g.id,'variants',(select jsonb_agg(jsonb_build_object('id',v.id,'name',v.name,'code',v.code,'attributes',v.attributes,'extraPrice',v.price-g.price,'stockQty',v.stock_qty,'expectedStockQty',v.stock_qty) order by v.sort_order,v.id) from public.goods_variants v where good_id=g.id and archived_at is null),
 'variant_baseline',(select jsonb_agg(v.id::text order by v.id) from public.goods_variants v where good_id=g.id and archived_at is null))||to_jsonb(g)
 from public.goods g where g.id='option-editor'
$$;
select pg_temp.option_payload() as snapshot \gset
-- A purchase changing stock while the editor is open must survive an unchanged quantity submission.
update public.goods_variants set stock_qty=3 where code='RED-441';
set local role authenticated;
select public.admin_save_good(:'snapshot'::jsonb||'{"name":"메타데이터 수정"}');
select 1 / case when (select stock_qty from public.goods_variants where code='RED-441')=3 then 1 else 0 end as assert_untouched_stock_preserves_purchase;
reset role;
create temporary table option_request(payload jsonb);
insert into option_request values(jsonb_set(:'snapshot'::jsonb,'{variants,0,stockQty}','9'));
grant select on option_request to authenticated;
set local role authenticated;
do $$ begin
 perform public.admin_save_good((select payload from option_request));
 raise exception 'stale stock edit succeeded';
exception when serialization_failure then if sqlerrm<>'stock_changed' then raise; end if;
end $$;
select 1 / case when (select name from public.goods where id='option-editor')='메타데이터 수정' then 1 else 0 end as assert_stock_conflict_rolls_back_metadata;
reset role;
-- Cart references preserve removed options. The current row is archived and its code remains reserved.
insert into public.cart_items(user_id,good_id,variant_id,qty) select '00000000-0000-4000-8000-000000044101','option-editor',id,1 from public.goods_variants where code='RED-441';
select pg_temp.option_payload() as current_snapshot \gset
set local role authenticated;
select public.admin_save_good(:'current_snapshot'::jsonb||jsonb_build_object('variants',jsonb_build_array(:'current_snapshot'::jsonb->'variants'->1)));
select 1 / case when exists(select 1 from public.goods_variants where code='RED-441' and archived_at is not null and not is_default)
 and (select count(*) from public.goods_variants where good_id='option-editor' and is_default)=1 then 1 else 0 end as assert_referenced_option_archived_and_default_promoted;
reset role;
select pg_temp.option_payload() as single_snapshot \gset
select set_config('request.jwt.claim.sub','',true);
update public.goods set type='문구',image_path='public-media/options-fixture.webp',notice_maker='제조사',notice_origin='한국',notice_material='종이',notice_size='A5',notice_made_on='2026-09',notice_as_manager='CS',notice_as_contact='02-000'
where id='option-editor';
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000044101',true);
select pg_temp.option_payload() as complete_snapshot \gset
set local role authenticated;
select public.admin_save_good(jsonb_set(:'complete_snapshot'::jsonb,'{variants,0,stockQty}','7')||'{"publish":true}');
select 1 / case when exists(select 1 from public.goods where id='option-editor' and published_at is not null)
 and exists(select 1 from public.goods_variants where good_id='option-editor' and is_default and stock_qty=7) then 1 else 0 end as assert_stock_and_publication_saved_together;
do $$ declare invalid jsonb; begin
 foreach invalid in array array['[]'::jsonb,'[{"name":"","attributes":{},"code":"","extraPrice":0,"stockQty":0}]'::jsonb,
   (select jsonb_agg(jsonb_build_object('name','옵션'||i,'attributes',jsonb_build_object('번호',i::text),'code','','extraPrice',0,'stockQty',0)) from generate_series(1,101) i)] loop
  begin
   perform public.admin_save_good(pg_temp.option_payload()||jsonb_build_object('variants',invalid));
   raise exception 'invalid option batch accepted';
  exception when check_violation then if sqlerrm<>'invalid_goods_options' then raise; end if; end;
 end loop;
end $$;
select 1 / case when public.admin_last_good_notice()->'notice' = '{"maker":"제조사","origin":"한국","material":"종이","size":"A5","madeOn":"2026-09","asManager":"CS","asContact":"02-000"}'::jsonb then 1 else 0 end as assert_last_save_copies_seven_values;
select public.admin_save_good(jsonb_build_object('id','option-boundary','ip_id','goods-options','name','100개 옵션','variant_baseline','[]'::jsonb,
 'variants',(select jsonb_agg(jsonb_build_object('name','옵션'||i,'attributes',jsonb_build_object('번호',i::text),'code','','extraPrice',0,'stockQty',0)) from generate_series(1,100) i)));
select 1 / case when (select count(*) from public.goods_variants where good_id='option-boundary')=100 then 1 else 0 end as assert_100_options_allowed;
reset role;
update public.profiles set nickname='option_buyer',birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}' where id='00000000-0000-4000-8000-000000044101';
delete from public.cart_items where user_id='00000000-0000-4000-8000-000000044101';
insert into public.cart_items(user_id,good_id,variant_id,qty) select '00000000-0000-4000-8000-000000044101',good_id,id,1 from public.goods_variants where good_id='option-editor' and is_default;
set local role service_role;
select public.place_order('00000000-0000-4000-8000-000000044101','{"recipientName":"구매자","phone":"01012345678","postalCode":"12345","address1":"서울시"}','10000000-0000-4000-8000-000000044101','card') as order_id \gset
reset role;
select pg_temp.option_payload() as ordered_snapshot \gset
set local role authenticated;
select public.admin_save_good(:'ordered_snapshot'::jsonb||'{"variants":[{"name":"초록","attributes":{"색상":"초록"},"code":"GREEN-441","extraPrice":100,"stockQty":2}]}');
select 1 / case when exists(select 1 from public.order_items item join public.goods_variants variant on variant.id=item.variant_id
 where item.order_id=:'order_id' and variant.archived_at is not null and item.variant_name_snapshot='파랑')
 and exists(select 1 from public.goods_variants where code='GREEN-441' and is_default and stock_qty=2)
 then 1 else 0 end as assert_order_history_option_archived_and_snapshot_preserved;
select public.admin_save_good(pg_temp.option_payload()||'{"publish":false,"origin_id":null}');
select 1 / case when exists(select 1 from public.goods where id='option-editor' and published_at is null and origin_id is null and first_published_at is not null) then 1 else 0 end as assert_explicit_unpublish_keeps_slug_lock_and_allows_empty_origin;
reset role;
select 1 / case when exists(select 1 from public.audit_log where action='admin.good.options_saved' and actor_id='00000000-0000-4000-8000-000000044101')
 and not has_function_privilege('anon','public.admin_save_good(jsonb)','execute')
 and not has_function_privilege('service_role','public.admin_save_good(jsonb)','execute')
 and not has_function_privilege('anon','public.admin_last_good_notice()','execute')
 and not has_function_privilege('service_role','public.admin_last_good_notice()','execute')
 and not has_function_privilege('authenticated','private.save_goods_options(text,jsonb,jsonb,boolean)','execute')
 then 1 else 0 end as assert_audited_sealed_options;
update public.profiles set role='user' where id='00000000-0000-4000-8000-000000044101';
set local role authenticated;
do $$ begin
 perform public.admin_save_good('{"ip_id":"goods-options","name":"forbidden","variant_baseline":[],"variants":[{"name":"x","attributes":{},"code":"","extraPrice":0,"stockQty":100}]}');
 raise exception 'fan wrote option stock';
exception when insufficient_privilege then null;
end $$;
rollback;
