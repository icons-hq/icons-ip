\set ON_ERROR_STOP on
begin;
\ir ../seed.sql
create temp table variant_seed_before on commit drop as
  select id,good_id from public.goods_variants where is_default;
update public.goods set published_at=null where id='g1';
update public.goods_variants set stock_qty=3 where good_id='g1' and is_default;
\ir ../seed.sql
\ir ../seed.sql
select 1 / case when
 (select stock_qty=7 and published_at is null from public.goods where id='g1')
 and (select stock_qty=7 from public.goods_variants where good_id='g1' and is_default)
 and not exists (
   select 1 from variant_seed_before before_seed left join public.goods_variants variant on variant.id=before_seed.id
   where variant.id is null or variant.good_id<>before_seed.good_id or not variant.is_default
 )
 and not exists (
   select good.id from public.goods good left join public.goods_variants variant on variant.good_id=good.id
   group by good.id,good.stock_qty having good.stock_qty<>coalesce(sum(variant.stock_qty),0)
 )
 then 1 else 0 end as assert_seed_replay_resets_default_stock_without_replacing_options;
rollback;
