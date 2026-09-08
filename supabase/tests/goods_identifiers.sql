\set ON_ERROR_STOP on
begin;

select 1 / case when not exists (
 select 1 from public.goods good join public.goods_variants variant on variant.good_id=good.id and variant.is_default
 where good.code is null or btrim(good.code)='' or variant.code is null or btrim(variant.code)=''
) then 1 else 0 end as assert_existing_goods_and_options_have_codes;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-4000-8000-000000042001','authenticated','authenticated','good-code-staff@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000042001';
insert into public.verticals(key,label,color) values ('goods-code','상품코드','#000000');
insert into public.ips(id,title,vertical_key) values ('goods-code','상품코드','goods-code');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000042001',true);
select 1 / case when (select code='GC-0001' and slug='hangeul-kiring' and default_variant_code='GC-0001-01'
 from public.admin_suggest_goods_identifiers('goods-code','한글 키링'))
 then 1 else 0 end as assert_code_and_name_slug_suggestion;
select public.admin_save_good(jsonb_build_object(
 'ip_id','goods-code','name','한글 키링','type','키링','price',12000,'stock','ok',
 'notice_maker','제조사','notice_origin','한국','notice_material','아크릴','notice_size','5cm',
 'notice_made_on','2026-09','notice_as_manager','고객센터','notice_as_contact','02-000-0000'
)) as saved \gset
select 1 / case when (:'saved'::jsonb->>'id')='hangeul-kiring' and (:'saved'::jsonb->>'code')='GC-0001'
 then 1 else 0 end as assert_new_good_gets_name_slug_and_automatic_code;
reset role;

create temp table initial_variant as select id from public.goods_variants where good_id='hangeul-kiring' and is_default;
insert into public.cart_items(user_id,good_id,qty, variant_id) values ('00000000-0000-4000-8000-000000042001','hangeul-kiring',1, (select id from public.goods_variants where good_id='hangeul-kiring' and is_default));
insert into public.wishlists(user_id,good_id) values ('00000000-0000-4000-8000-000000042001','hangeul-kiring');
insert into public.restock_alerts(user_id,good_id) values ('00000000-0000-4000-8000-000000042001','hangeul-kiring');
insert into public.campaigns(id,kind,title,starts_at,ends_at,sections) values
 ('goods-code-campaign','drop','코드 테스트',now(),now()+interval '1 day','[{"type":"goods_grid","good_ids":["hangeul-kiring"]}]');
set local role authenticated;
select public.admin_save_good(to_jsonb(good)||jsonb_build_object(
 'previous_id',good.id,'id','hangeul-keyring','code','logistics-100','default_variant_code','warehouse-100'
)) from public.goods good where id='hangeul-kiring';
select 1 / case when exists(select 1 from public.goods where id='hangeul-keyring' and code='LOGISTICS-100' and first_published_at is null)
 and exists(select 1 from public.goods_variants where good_id='hangeul-keyring' and code='WAREHOUSE-100')
 then 1 else 0 end as assert_draft_slug_and_manual_logistics_codes_saved;
do $$ declare payload jsonb; begin
 select to_jsonb(good)||jsonb_build_object('id','duplicate-code') into payload from public.goods good where id='hangeul-keyring';
 begin
  perform public.admin_save_good(payload);
  raise exception 'duplicate code accepted';
 exception when unique_violation then null; end;
 begin
  perform public.admin_save_good(payload||jsonb_build_object('code','SECOND-CODE','default_variant_code','WAREHOUSE-100'));
  raise exception 'duplicate option code accepted';
 exception when unique_violation then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.goods set image_path='public-media/goods-code-fixture.webp' where id='hangeul-keyring';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000042001',true);
select public.admin_set_good_published('hangeul-keyring',true);
select public.admin_set_ip_published('goods-code',true);
select public.admin_set_ip_published('goods-code',false);
do $$ declare payload jsonb; begin
 select to_jsonb(good)||jsonb_build_object('previous_id',id,'id','forbidden-rename') into payload from public.goods good where id='hangeul-keyring';
 begin
  perform public.admin_save_good(payload);
  raise exception 'published slug was renamed';
 exception when check_violation then if sqlerrm<>'goods_slug_locked' then raise; end if; end;
end $$;
reset role;
select 1 / case when
 (select id from public.goods_variants where good_id='hangeul-keyring' and is_default)=(select id from initial_variant)
 and exists(select 1 from public.cart_items where good_id='hangeul-keyring')
 and exists(select 1 from public.wishlists where good_id='hangeul-keyring')
 and exists(select 1 from public.restock_alerts where good_id='hangeul-keyring')
 and exists(select 1 from public.campaigns where id='goods-code-campaign' and sections->0->'good_ids' ? 'hangeul-keyring')
 and exists(select 1 from public.audit_log where target='goods:hangeul-kiring' and action='catalog.good.upsert')
 and exists(select 1 from public.audit_log where target='goods:hangeul-keyring' and diff->>'previous_id'='hangeul-kiring')
 and not exists(select 1 from public.goods where id='duplicate-code')
 then 1 else 0 end as assert_draft_rename_preserves_references_and_audit;

select 1 / case when
 not has_function_privilege('anon','public.admin_save_good(jsonb)','execute')
 and has_function_privilege('authenticated','public.admin_save_good(jsonb)','execute')
 and not has_function_privilege('service_role','public.admin_save_good(jsonb)','execute')
 and not has_function_privilege('anon','public.admin_suggest_goods_identifiers(text,text)','execute')
 and not has_table_privilege('authenticated','public.goods_variants','update')
 and not has_function_privilege('authenticated','private.allocate_goods_code(text)','execute')
 then 1 else 0 end as assert_code_write_permissions;

rollback;
