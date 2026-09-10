\set ON_ERROR_STOP on

begin;

-- #480/#481: operator-managed keywords are shared by public integrated search and
-- staff goods search; display order is an optional product-level catalog key.
insert into auth.users(
  id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values (
  '00000000-0000-4000-8000-000000048001',
  'authenticated','authenticated','goods-discovery-staff@example.test',now(),'{}','{}',now(),now()
);
update public.profiles set role='staff', nickname='goods_discovery_staff', birth_date='1990-01-01',
  consents='{"terms":true,"privacy":true}', onboarded_at=now()
where id='00000000-0000-4000-8000-000000048001';
insert into public.verticals(key,label,color)
values ('goods-discovery','상품 검색 검증','#000000');
insert into public.ips(id,title,vertical_key,published_at)
values ('goods-discovery','상품 검색 검증','goods-discovery',now());

-- The wrapper trims and de-duplicates case-insensitively while preserving first
-- occurrence order, and stores the nullable display order in the same transaction.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048001',true);
select public.admin_save_good(jsonb_build_object(
  'id','goods-discovery-good',
  'ip_id','goods-discovery',
  'name','아크릴 키링',
  'name_en','Acrylic Keyring',
  'type','키링',
  'price',1000,
  'search_keywords',jsonb_build_array('  여름 굿즈  ','KUMA','kuma',''),
  'display_order',7
));
select 1 / case when (
  (select search_keywords from public.goods where id='goods-discovery-good') = array['여름 굿즈','KUMA']
  and (select display_order from public.goods where id='goods-discovery-good') = 7
  and (select name_en from public.goods where id='goods-discovery-good') = 'Acrylic Keyring'
) then 1 else 0 end as assert_discovery_metadata_is_normalized_and_saved;

-- Existing callers that omit the new keys keep the stored metadata.
select public.admin_save_good('{"previous_id":"goods-discovery-good","id":"goods-discovery-good","ip_id":"goods-discovery","name":"이름 수정","type":"키링","price":1000}');
select 1 / case when (
  (select search_keywords from public.goods where id='goods-discovery-good') = array['여름 굿즈','KUMA']
  and (select display_order from public.goods where id='goods-discovery-good') = 7
) then 1 else 0 end as assert_legacy_save_preserves_discovery_metadata;

-- Explicit clearing is supported, while malformed values are rejected before
-- the wrapped catalog save can change the product.
select public.admin_save_good('{"previous_id":"goods-discovery-good","id":"goods-discovery-good","ip_id":"goods-discovery","name":"이름 수정","type":"키링","price":1000,"search_keywords":[],"display_order":null}');
select 1 / case when (
  (select cardinality(search_keywords) from public.goods where id='goods-discovery-good') = 0
  and (select display_order from public.goods where id='goods-discovery-good') is null
) then 1 else 0 end as assert_discovery_metadata_can_be_cleared;
do $$
begin
  begin
    perform public.admin_save_good(jsonb_build_object(
      'previous_id','goods-discovery-good','id','goods-discovery-good','ip_id','goods-discovery',
      'name','거절될 수정','type','키링','price',1000,
      'search_keywords',jsonb_build_array(repeat('x',81)), 'display_order',-1
    ));
    raise exception 'invalid discovery metadata accepted';
  exception when check_violation then
    if sqlerrm <> 'invalid_good_search_keywords' then raise; end if;
  end;
end;
$$;
select 1 / case when (
  (select name from public.goods where id='goods-discovery-good') = '이름 수정'
  and (select cardinality(search_keywords) from public.goods where id='goods-discovery-good') = 0
  and (select display_order from public.goods where id='goods-discovery-good') is null
) then 1 else 0 end as assert_invalid_discovery_metadata_is_atomic;

-- Search is staff-only at the admin seam and matches both the English name and
-- the operator keyword. Literal wildcard characters remain escaped by the RPC.
select 1 / case when (
  not has_function_privilege('anon','public.admin_search_goods(text)','execute')
  and has_function_privilege('authenticated','public.admin_search_goods(text)','execute')
  and not has_function_privilege('service_role','public.admin_search_goods(text)','execute')
  and (select count(*) from public.admin_search_goods('Acrylic Keyring') where id='goods-discovery-good') = 1
) then 1 else 0 end as assert_admin_discovery_search_and_acl;
select public.admin_save_good('{"previous_id":"goods-discovery-good","id":"goods-discovery-good","ip_id":"goods-discovery","name":"이름 수정","type":"키링","price":1000,"search_keywords":["100% 키링"]}');
select 1 / case when (select count(*) from public.admin_search_goods('%') where id='goods-discovery-good') = 1
  then 1 else 0 end as assert_admin_search_escapes_wildcards;

-- Public search includes a published unrestricted good and keeps drafts and adult
-- goods outside the customer result set.
reset role;
update public.goods set search_keywords=array['여름 굿즈'], display_order=7,
  sale_restriction='none'
where id='goods-discovery-good';
select pg_temp.publish_goods_kc_fixture('goods-discovery-good');
insert into public.goods(
  id,ip_id,name,type,price,stock,search_keywords,published_at,sale_restriction
) values (
  'goods-discovery-adult','goods-discovery','성인 키링','키링',1000,'ok',array['여름 굿즈'],null,'adult'
), (
  'goods-discovery-draft','goods-discovery','초안 키링','키링',1000,'ok',array['여름 굿즈'],null,'none'
);
-- Build reviewed synthetic KC evidence before publishing each fixture.
select pg_temp.publish_goods_kc_fixture('goods-discovery-adult');
set local role anon;
select set_config('request.jwt.claim.role','anon',true);
select 1 / case when (
  (select count(*) from public.search_public_content('여름 굿즈')
   where kind='good' and id='goods-discovery-good') = 1
  and (select count(*) from public.search_public_content('여름 굿즈')
   where kind='good' and id in ('goods-discovery-adult','goods-discovery-draft')) = 0
) then 1 else 0 end as assert_public_discovery_visibility;

rollback;
