\set ON_ERROR_STOP on
-- A single full-editor save must keep every independently referenced option.
-- No KC helper is needed: this is an unpublished, synthetic catalog fixture.
begin;
select set_config('request.jwt.claim.sub','',true);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000049269','authenticated','authenticated','option-reference-admin@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='admin',nickname='옵션이력9269' where id='00000000-0000-4000-8000-000000049269';
insert into public.verticals(key,label,color) values('option-lifecycle-tests','옵션 보존 검증','#000000');
insert into public.ips(id,title,vertical_key) values('option-lifecycle-tests','옵션 보존 검증','option-lifecycle-tests');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000049269',true);
select public.admin_save_good('{"id":"option-reference-lifecycle","ip_id":"option-lifecycle-tests","name":"옵션 참조 보존","price":10000,
 "variant_baseline":[],"variants":[
  {"name":"기본 옵션","code":"LIFECYCLE-DEFAULT","attributes":{},"extraPrice":0,"stockQty":2},
  {"name":"할인 이력 옵션","code":"LIFECYCLE-PRICE","attributes":{"구성":"할인"},"extraPrice":1000,"stockQty":2},
  {"name":"매입 이력 옵션","code":"LIFECYCLE-COST","attributes":{"구성":"매입"},"extraPrice":1000,"stockQty":2},
  {"name":"예약 이력 옵션","code":"LIFECYCLE-PREORDER","attributes":{"구성":"예약"},"extraPrice":1000,"stockQty":2},
  {"name":"미참조 옵션","code":"LIFECYCLE-UNUSED","attributes":{"구성":"미참조"},"extraPrice":1000,"stockQty":2}
 ]}');
select id as default_variant from public.goods_variants where good_id='option-reference-lifecycle' and code='LIFECYCLE-DEFAULT' \gset
select id as price_variant from public.goods_variants where good_id='option-reference-lifecycle' and code='LIFECYCLE-PRICE' \gset
select id as cost_variant from public.goods_variants where good_id='option-reference-lifecycle' and code='LIFECYCLE-COST' \gset
select id as preorder_variant from public.goods_variants where good_id='option-reference-lifecycle' and code='LIFECYCLE-PREORDER' \gset
select id as unused_variant from public.goods_variants where good_id='option-reference-lifecycle' and code='LIFECYCLE-UNUSED' \gset
select public.admin_save_goods_price_period('option-reference-lifecycle',:'price_variant',null,
 '{"state":"draft","discountPrice":null,"startsAt":null,"endsAt":null}')->>'id' as price_period \gset
select public.admin_save_goods_variant_purchase_cost('option-reference-lifecycle',:'cost_variant',0,'included',null);
select public.admin_save_goods_preorder('option-reference-lifecycle',:'preorder_variant',null,
 '{"state":"draft","capacityQty":null,"startsAt":null,"endsAt":null,"expectedShipDate":null,"approvalReference":null}')->>'id' as preorder_policy \gset
select jsonb_build_object('previous_id',good.id,'id',good.id,'ip_id',good.ip_id,'name','제거 후 보존 검증','price',good.price,
 'variant_baseline',(select jsonb_agg(id::text order by id) from public.goods_variants where good_id=good.id and archived_at is null),
 'variants',(select jsonb_agg(jsonb_build_object('id',variant.id,'name',variant.name,'code',variant.code,'attributes',variant.attributes,
   'extraPrice',variant.price-good.price,'stockQty',variant.stock_qty,'expectedStockQty',variant.stock_qty))
   from public.goods_variants variant where variant.good_id=good.id and variant.is_default)) as editor_payload
 from public.goods good where good.id='option-reference-lifecycle' \gset
-- RED on the unpatched editor: price/preorder/history references trigger 23503.
select public.admin_save_good(:'editor_payload'::jsonb);
select 1/case when (select count(*) from public.goods_variants where good_id='option-reference-lifecycle')=4
 and (select count(*) from public.goods_variants where id in (:'price_variant',:'cost_variant',:'preorder_variant') and archived_at is not null)=3
 and not exists(select 1 from public.goods_variants where id=:'unused_variant')
 and (select is_default and archived_at is null and code='LIFECYCLE-DEFAULT' and stock_qty=2 from public.goods_variants where id=:'default_variant')
 and (select name='제거 후 보존 검증' and stock_qty=8 from public.goods where id='option-reference-lifecycle')
 then 1 else 0 end as assert_referenced_options_archive_and_unused_option_deletes;
reset role;
select 1/case when exists(select 1 from private.goods_variant_price_periods where id=:'price_period' and variant_id=:'price_variant')
 and exists(select 1 from private.goods_variant_purchase_costs where variant_id=:'cost_variant' and unit_cost_krw=0 and tax_basis='included' and revision=1)
 and (select count(*) from private.goods_variant_purchase_cost_changes where variant_id=:'cost_variant')=1
 and exists(select 1 from private.goods_preorder_policies where id=:'preorder_policy' and variant_id=:'preorder_variant' and state='draft')
 then 1 else 0 end as assert_all_reference_records_survive_failed_delete_subtransactions;
rollback;
