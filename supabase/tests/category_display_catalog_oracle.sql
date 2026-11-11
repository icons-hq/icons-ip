\set ON_ERROR_STOP on
-- Prepend helpers/goods_kc_fixture.sql. This rollback-only fixture emits one
-- JSON record for the independent toGood/selectShopGoods integration oracle.
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
values('93931000-0000-4000-8000-000000000001','authenticated','authenticated','category-oracle@example.test',now(),'{"testFixture":"category-oracle"}','{}');
update public.profiles set role='staff' where id='93931000-0000-4000-8000-000000000001';
insert into private.operator_memberships(profile_id,manager_role) values('93931000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
insert into public.catalog_categories(id,code,name,parent_id,sort_order) values
 ('93931000-0000-4000-8000-000000000011','cd-oracle-root','비교 전시',null,0),
 ('93931000-0000-4000-8000-000000000012','cd-oracle-source','연결 분류',null,1);
insert into private.category_display_nodes(id,parent_id,name,sort_order,archived_at,legacy_category_id)
 select id,parent_id,name,sort_order,archived_at,id from public.catalog_categories where code like 'cd-oracle-%';
update public.category_activation_control set customer_enabled=true where id='catalog';
insert into public.ips(id,title,vertical_key,published_at) values('cd-oracle-ip','가격 공급 비교','character',now());
-- 등록 시각을 일부만 달리 둔다 — 오래된순·최신순의 시각 비교와 동률(추천 순서) 처리를 함께 본다.
insert into public.goods(id,ip_id,name,type,price,category_id,display_order,created_at)
select 'cd-oracle-g-'||suffix,'cd-oracle-ip','비교 상품 '||suffix,'문구',1000,'93931000-0000-4000-8000-000000000012',case when suffix='20' then 0 else null end,
 case suffix when '10' then now()-interval '2 days' when '2' then now()-interval '1 day' else now() end
from unnest(array['1','01','001','2','10','20']) suffix;

update public.goods_variants set stock_qty=7 where good_id like 'cd-oracle-g-%';
insert into public.goods_variants(good_id,name,code,price,stock_qty,is_default,attributes,sort_order)
values('cd-oracle-g-1','추가 옵션','CD-ORACLE-EXTRA',2500,2,false,'{}',1);
insert into private.goods_variant_price_periods(good_id,variant_id,state,regular_price,discount_price,starts_at,ends_at,created_by,updated_by)
select good_id,id,'active',1000,500,now()-interval '1 day',now()+interval '1 day','93931000-0000-4000-8000-000000000001','93931000-0000-4000-8000-000000000001'
from public.goods_variants where good_id='cd-oracle-g-1' and is_default;
insert into private.goods_preorder_policies(id,variant_id,state,capacity_qty,starts_at,ends_at,expected_ship_date,approval_reference,created_by,activated_by,activated_at)
select '93931000-0000-4000-8000-000000000101',id,'active',3,now()-interval '1 day',now()+interval '1 day',current_date+30,'synthetic QA','93931000-0000-4000-8000-000000000001','93931000-0000-4000-8000-000000000001',now()
from public.goods_variants where good_id='cd-oracle-g-2' and is_default;
update public.goods_variants set preorder_policy_id='93931000-0000-4000-8000-000000000101',stock_qty=0 where good_id='cd-oracle-g-2' and is_default;
update public.goods_variants set stock_qty=0 where good_id='cd-oracle-g-10';
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','kc-oracle-'||md5(id)||'@example.test',now(),'{"testFixture":"goods-kc"}','{}' from public.goods where id like 'cd-oracle-g-%';
insert into private.operator_memberships(profile_id,manager_role)
select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where id like 'cd-oracle-g-%';
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id like 'cd-oracle-g-%';
-- The oracle input mirrors the existing catalog projection, independently of
-- category_display_public_good and its pre-filtered aggregate price.
create temp table cd_oracle_rows(rows jsonb);
grant insert,select on cd_oracle_rows to authenticated;
create temp table cd_oracle_cases(mode text,query jsonb,page jsonb);
grant insert,select on cd_oracle_cases to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','93931000-0000-4000-8000-000000000001',true);
do $$declare config jsonb;query jsonb;mode_value text;sort_value text;filter jsonb;begin
 insert into cd_oracle_rows
select jsonb_agg(to_jsonb(g)||jsonb_build_object('additional_good_ids',public.goods_additional_ids(g),'sale_period',public.goods_sale_period(g),
 'goods_variants',(select jsonb_agg(to_jsonb(v)||jsonb_build_object('pricing',public.goods_variant_pricing(v),'supply',public.goods_variant_supply(v)) order by v.sort_order,v.id)
 from public.goods_variants v where v.good_id=g.id)) order by g.id) rows
from public.goods g where g.id like 'cd-oracle-g-%';
 config:=public.admin_get_category_display('93931000-0000-4000-8000-000000000011')->'values';
 config:=config||'{"enabled":true,"categoryIds":["93931000-0000-4000-8000-000000000012"],"goodIds":["cd-oracle-g-10","cd-oracle-g-2","cd-oracle-g-1","cd-oracle-g-01","cd-oracle-g-001","cd-oracle-g-20"]}';
 foreach mode_value in array array['categories','manual'] loop
  foreach sort_value in array array['recommended','name_asc','name_desc','price_asc','price_desc','oldest','newest'] loop
   for filter in select value from jsonb_array_elements('[{}, {"min":600}, {"max":700}, {"min":900,"max":1000}, {"types":["키링"]}, {"types":["예약판매"]}, {"types":["키링","예약판매"]}, {"ips":["missing-ip"]}]') loop
    query:='{"ips":[],"types":[],"min":null,"max":null}'::jsonb||jsonb_build_object('sort',sort_value)||filter;
    insert into cd_oracle_cases values(mode_value,query,public.admin_preview_category_display('93931000-0000-4000-8000-000000000011',config||jsonb_build_object('mode',mode_value),query));
   end loop;
  end loop;
 end loop;
end $$;
reset role;
select jsonb_build_object('categoryDisplayOracle',true,'rows',(select rows from cd_oracle_rows),'cases',(select jsonb_agg(to_jsonb(c)) from cd_oracle_cases c));
-- Source archive and the global category switch are evaluated at read time.
update public.catalog_categories set archived_at=clock_timestamp() where id='93931000-0000-4000-8000-000000000012';
set local role authenticated;
do $$declare config jsonb;p jsonb;begin
 config:=public.admin_get_category_display('93931000-0000-4000-8000-000000000011')->'values';
 config:=config||'{"enabled":true,"categoryIds":["93931000-0000-4000-8000-000000000012"]}';
 p:=public.admin_preview_category_display('93931000-0000-4000-8000-000000000011',config,'{"ips":[],"types":[],"min":null,"max":null,"sort":"recommended"}');
 if p->>'total'<>'0' then raise exception 'archived source leaked goods';end if;
end $$;
reset role;
update public.category_activation_control set customer_enabled=false where id='catalog';
set local role authenticated;
do $$declare config jsonb;begin
 config:=public.admin_get_category_display('93931000-0000-4000-8000-000000000011')->'values';
 if public.admin_preview_category_display('93931000-0000-4000-8000-000000000011',config,'{"ips":[],"types":[],"min":null,"max":null,"sort":"recommended"}') is not null then raise exception 'disabled category surface leaked';end if;
end $$;
reset role;
rollback;
