\set ON_ERROR_STOP on
begin;

select 1 / case when not exists (
  select 1 from public.goods good left join public.goods_variants variant
    on variant.good_id = good.id and variant.is_default
  where variant.id is null or variant.price <> good.price or variant.stock_qty <> good.stock_qty
) then 1 else 0 end as assert_default_backfill_preserves_price_and_inventory;

insert into public.verticals(key,label,color) values ('variant-expand','옵션 확장','#000000');
insert into public.ips(id,title,vertical_key,published_at) values ('variant-expand','옵션 확장','variant-expand',now());
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,published_at)
values ('variant-expand','variant-expand','기본 옵션 상품','문구',10000,'ok',7,now());
select 1 / case when exists (
  select 1 from public.goods_variants where good_id = 'variant-expand'
    and is_default and name = '기본 옵션' and price = 10000 and stock_qty = 7
) then 1 else 0 end as assert_new_good_creates_default_variant;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-4000-8000-000000041901','authenticated','authenticated','variant-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000041902','authenticated','authenticated','variant-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000041901';
update public.profiles set nickname='variant_buyer',birth_date='2000-01-01',
 consents='{"terms":true,"privacy":true}',onboarded_at=now() where id='00000000-0000-4000-8000-000000041902';

insert into public.ips(id,title,vertical_key) values ('variant-expand-draft','비공개 옵션','variant-expand');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,sale_restriction) values
 ('variant-expand-draft','variant-expand-draft','비공개 상품','문구',1000,'ok',2,'none'),
 ('variant-expand-restricted','variant-expand','판매 제한 상품','문구',1000,'ok',2,'adult');
set local role anon;
select 1 / case when (select count(*) from public.goods_variants where good_id like 'variant-expand%') = 1
 then 1 else 0 end as assert_public_options_follow_catalog_visibility;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000041901',true);
select 1 / case when (select count(*) from public.goods_variants where good_id like 'variant-expand%') = 3
 then 1 else 0 end as assert_staff_reads_unpublished_and_restricted_options;
select 1 / case when public.admin_adjust_stock('00000000-0000-4000-8000-000000041910','variant-expand', (select id from public.goods_variants where good_id='variant-expand' and is_default),7,3,'옵션 입고') = 10 then 1 else 0 end as assert_explicit_option_adjustment;
select 1 / case when (
  select stock_qty from public.goods_variants where good_id='variant-expand' and is_default
) = 10 then 1 else 0 end as assert_adjustment_targets_default_variant;
select public.admin_adjust_stock('00000000-0000-4000-8000-000000041910','variant-expand', (select id from public.goods_variants where good_id='variant-expand' and is_default),7,3,'옵션 입고');
select 1 / case when (select stock_qty from public.goods_variants where good_id='variant-expand') = 10
  then 1 else 0 end as assert_replay_does_not_double_adjust_variant;
reset role;

update public.goods set price=12000 where id='variant-expand';
select 1 / case when (select price from public.goods_variants where good_id='variant-expand') = 12000
  then 1 else 0 end as assert_legacy_price_edit_updates_default_variant;
do $$ begin
  begin
    update public.goods set stock_qty=stock_qty+1 where id='variant-expand';
    raise exception 'direct cache overwrite was allowed';
  exception when check_violation then null; end;
  begin
    delete from public.goods_variants where good_id='variant-expand';
    set constraints goods_variants_require_default immediate;
    raise exception 'good without default variant was allowed';
  exception when check_violation then null; end;
end $$;

insert into public.cart_items(user_id,good_id,qty, variant_id) values ('00000000-0000-4000-8000-000000041902','variant-expand',2, (select id from public.goods_variants where good_id='variant-expand' and is_default));
select public.place_order('00000000-0000-4000-8000-000000041902',
 '{"recipientName":"구매자","phone":"01012345678","postalCode":"12345","address1":"서울시"}'::jsonb,
 '00000000-0000-4000-8000-000000041920','card') as order_id \gset
select 1 / case when (select stock_qty from public.goods_variants where good_id='variant-expand') = 8
  and (select stock_qty from public.goods where id='variant-expand') = 8 then 1 else 0 end as assert_order_decrements_variant_and_cache;
select public.finalize_order_cancellation_with_provider_evidence(:'order_id','옵션 복원',array[]::text[]);
select public.finalize_order_cancellation_with_provider_evidence(:'order_id','옵션 복원',array[]::text[]);
select 1 / case when (select stock_qty from public.goods_variants where good_id='variant-expand') = 10
  and (select stock_qty from public.goods where id='variant-expand') = 10 then 1 else 0 end as assert_cancellation_restores_once;

select 1 / case when
  not has_table_privilege('anon','public.goods_variants','insert,update,delete')
  and not has_table_privilege('authenticated','public.goods_variants','insert,update,delete')
  and not has_table_privilege('service_role','public.goods_variants','insert,update,delete')
  and not has_function_privilege('authenticated','private.change_goods_variant_stock(text,uuid,bigint)','execute')
  and not has_function_privilege('service_role','private.change_goods_variant_stock(text,uuid,bigint)','execute')
  and not has_function_privilege('anon','private.change_goods_variant_stock(text,uuid,bigint)','execute')
  then 1 else 0 end as assert_variant_writes_are_sealed;
rollback;
