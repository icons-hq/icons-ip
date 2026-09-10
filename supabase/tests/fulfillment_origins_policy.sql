\set ON_ERROR_STOP on
begin;
select 1 / case when to_regclass('public.fulfillment_origins') is not null
 and not has_table_privilege('anon','public.fulfillment_origins','select')
 and not has_table_privilege('authenticated','public.fulfillment_origins','update')
 and not has_function_privilege('authenticated','private.goods_shipping_fee_for(uuid)','execute')
 then 1 else 0 end as assert_origin_settings_and_order_helpers_sealed;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-4000-8000-000000042211','authenticated','authenticated','origins-admin@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000042212','authenticated','authenticated','origins-staff@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='admin' where id='00000000-0000-4000-8000-000000042211';
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000042212';
create temp table old_origin_stamp as select updated_at from public.fulfillment_origins where code='namyangju';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000042212',true);
do $$ begin
  begin
    perform public.admin_save_fulfillment_origin(null,'{}',null);
    raise exception 'staff settings write allowed';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000042211',true);
select public.admin_save_fulfillment_origin(id,(jsonb_build_object('code',origin.code,'name',origin.name,'default_carrier',origin.default_carrier,
      'base_fee',origin.base_fee,'free_threshold',origin.free_threshold,'return_address',origin.return_address,
      'cutoff',origin.cutoff,'export_template',origin.export_template,'is_active',origin.is_active)||jsonb_build_object('default_carrier','hanjin','base_fee',4500,'free_threshold',80000,'is_active',true)),updated_at)
 from public.fulfillment_origins origin where code='namyangju';
reset role;
do $$ begin
  begin
    perform public.admin_save_fulfillment_origin(origin.id,jsonb_build_object('code',origin.code,'name',origin.name,'default_carrier',origin.default_carrier,
      'base_fee',origin.base_fee,'free_threshold',origin.free_threshold,'return_address',origin.return_address,
      'cutoff',origin.cutoff,'export_template',origin.export_template,'is_active',origin.is_active),old_stamp.updated_at)
    from public.fulfillment_origins origin cross join old_origin_stamp old_stamp where origin.code='namyangju';
    raise exception 'stale settings accepted';
  exception when serialization_failure then null; end;
end $$;
select set_config('request.jwt.claim.sub','',true);
insert into public.verticals(key,label,color) values ('shipping-origins','출고지 검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values ('shipping-origins','출고지 검증','shipping-origins',now());
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,published_at,origin_id,shipping_fee_type,individual_fee)
values
 ('shipping-origin-a','shipping-origins','김포 정책 상품','키링',25000,'ok',20,null,'00000000-0000-4000-8000-000000042201','policy',0),
 ('shipping-origin-b','shipping-origins','남양주 정책 상품','키링',60000,'ok',20,null,'00000000-0000-4000-8000-000000042202','policy',0),
 ('shipping-origin-c','shipping-origins','김포 무료 상품','키링',100000,'ok',20,null,'00000000-0000-4000-8000-000000042201','free',0),
 ('shipping-origin-d','shipping-origins','남양주 개별 상품','키링',9000,'ok',20,null,'00000000-0000-4000-8000-000000042202','individual',2500);
-- Build reviewed synthetic KC evidence before publishing each fixture.
select pg_temp.publish_goods_kc_fixture('shipping-origin-a');
select pg_temp.publish_goods_kc_fixture('shipping-origin-b');
select pg_temp.publish_goods_kc_fixture('shipping-origin-c');
select pg_temp.publish_goods_kc_fixture('shipping-origin-d');
create temp table shipping_items(value jsonb);
insert into shipping_items values (jsonb_build_array(jsonb_build_object('goodId','shipping-origin-a','qty',1,'variantId',(select id from public.goods_variants where good_id='shipping-origin-a' and is_default)),jsonb_build_object('goodId','shipping-origin-b','qty',1,'variantId',(select id from public.goods_variants where good_id='shipping-origin-b' and is_default)),jsonb_build_object('goodId','shipping-origin-c','qty',1,'variantId',(select id from public.goods_variants where good_id='shipping-origin-c' and is_default)),jsonb_build_object('goodId','shipping-origin-d','qty',3,'variantId',(select id from public.goods_variants where good_id='shipping-origin-d' and is_default)),jsonb_build_object('goodId','shipping-origin-d','qty',2,'variantId',(select id from public.goods_variants where good_id='shipping-origin-d' and is_default))));
select 1 / case when public.quote_goods_shipping(value)->>'totalFee'='10000'
 and jsonb_array_length(public.quote_goods_shipping(value)->'groups')=2
 and public.quote_goods_shipping(jsonb_set(value,'{0,qty}','2'))->>'totalFee'='7000'
 then 1 else 0 end as assert_groups_policy_subtotal_and_individual_once_per_good from shipping_items;
select 1 / case when public.quote_goods_shipping('[]')->>'totalFee'='0'
 and public.quote_goods_shipping(jsonb_build_array(jsonb_build_object('goodId','shipping-origin-c','qty',99,'variantId',(select id from public.goods_variants where good_id='shipping-origin-c' and is_default))))->>'totalFee'='0'
 and public.quote_goods_shipping(jsonb_build_array(jsonb_build_object('goodId','shipping-origin-d','qty',2147483647,'variantId',(select id from public.goods_variants where good_id='shipping-origin-d' and is_default))))->>'totalFee'='2500'
 and public.quote_goods_shipping((select jsonb_agg(jsonb_build_object('goodId','shipping-origin-c','variantId',(select id from public.goods_variants where good_id='shipping-origin-c' and is_default),'qty',1)) from generate_series(1,1000)))->>'totalFee'='0'
 then 1 else 0 end as assert_empty_free_and_individual_quantity_boundaries;
do $$ begin
  begin
    perform public.quote_goods_shipping(jsonb_build_array(jsonb_build_object('goodId','shipping-origin-a','qty',1,'unitPrice',999999,'variantId',(select id from public.goods_variants where good_id='shipping-origin-a' and is_default))));
    raise exception 'client shipping price trusted';
  exception when invalid_parameter_value then null; end;
end $$;
update public.goods set published_at=null where id='shipping-origin-c';
do $$ begin
  begin
    perform public.quote_goods_shipping(jsonb_build_array(jsonb_build_object('goodId','shipping-origin-c','qty',1,'variantId',(select id from public.goods_variants where good_id='shipping-origin-c' and is_default))));
    raise exception 'draft good quoted';
  exception when check_violation then if sqlerrm<>'shipping_quote_good_unavailable' then raise; end if; end;
end $$;
update public.goods set published_at=now() where id='shipping-origin-c';
-- Both payment methods use the same final order helper, including two options
-- of one individually charged good. Client/cart prices are never consulted.
update public.goods set published_at=null where id='shipping-origin-d';
insert into public.goods_variants(id,good_id,name,price,stock_qty,sort_order)
 values('00000000-0000-4000-8000-000000042231','shipping-origin-d','두 번째 옵션',11000,5,1);
select pg_temp.publish_goods_kc_fixture('shipping-origin-d');
select 1 / case when public.quote_goods_shipping(jsonb_build_array(jsonb_build_object('goodId','shipping-origin-d','qty',3,'variantId',(select id from public.goods_variants where good_id='shipping-origin-d' and is_default)),jsonb_build_object('goodId','shipping-origin-d','variantId','00000000-0000-4000-8000-000000042231','qty',2)))->>'totalFee'='2500'
 then 1 else 0 end as assert_individual_fee_once_across_distinct_options;
update public.profiles set nickname='배송 구매자',birth_date='2000-01-01',consents='{"terms":true,"privacy":true}',onboarded_at=now()
 where id='00000000-0000-4000-8000-000000042211';
do $$ declare payment_kind public.order_payment_method; placed uuid;
begin
 foreach payment_kind in array array['card','bank_transfer']::public.order_payment_method[] loop
  insert into public.cart_items(user_id,good_id,variant_id,qty)
   select '00000000-0000-4000-8000-000000042211',variant.good_id,variant.id,
    case when variant.good_id='shipping-origin-d' then case when variant.is_default then 3 else 2 end else 1 end
   from public.goods_variants variant where variant.good_id in ('shipping-origin-a','shipping-origin-b','shipping-origin-c','shipping-origin-d');
  placed:=public.place_order('00000000-0000-4000-8000-000000042211',
   '{"recipientName":"배송 검증","phone":"01012345678","postalCode":"00000","address1":"배송 금지 테스트 주소"}',gen_random_uuid(),payment_kind);
  if not exists(select 1 from public.orders where id=placed and shipping_fee=10000 and total=244000 and jsonb_array_length(shipping_fee_breakdown)=2) then
   raise exception 'mixed origin order fee differs for %',payment_kind;
  end if;
 end loop;
end $$;
insert into public.orders(id,user_id,status,total,shipping_fee,address,expires_at)
 values ('00000000-0000-4000-8000-000000042221','00000000-0000-4000-8000-000000042211','pending',0,0,
 '{"recipientName":"배송 검증","phone":"01012345678","postalCode":"00000","address1":"배송 금지 테스트 주소"}',now()+interval '1 hour');
insert into public.order_items(order_id,good_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot, variant_id)
 select '00000000-0000-4000-8000-000000042221',id,case when id='shipping-origin-d' then 5 else 1 end,price,name,type,ip_id, (select id from public.goods_variants where good_id=public.goods.id and is_default) from public.goods where ip_id='shipping-origins';
-- Admin save carries shipping atomically and omission preserves existing policy.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000042212',true);
set local role authenticated;
select public.admin_save_good('{"ip_id":"shipping-origins","name":"Shipping wrapper draft","origin_id":"00000000-0000-4000-8000-000000042202","shipping_fee_type":"individual","individual_fee":3700}');
select public.admin_save_good('{"previous_id":"shipping-wrapper-draft","id":"shipping-wrapper-draft","ip_id":"shipping-origins","name":"Shipping wrapper edited"}');
select 1 / case when exists(select 1 from public.goods where id='shipping-wrapper-draft' and published_at is null
 and origin_id='00000000-0000-4000-8000-000000042202' and shipping_fee_type='individual' and individual_fee=3700)
 then 1 else 0 end as assert_save_omitted_shipping_preserves_policy;
select public.admin_save_good('{"ip_id":"shipping-origins","name":"No shipping draft","origin_id":null}');
select 1 / case when exists(select 1 from public.goods where id='no-shipping-draft' and origin_id is null and published_at is null)
 then 1 else 0 end as assert_empty_shipping_draft_saved;
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.goods set type='문구',price=1000,image_path='public-media/origins.webp',
 notice_maker='제조사',notice_origin='한국',notice_material='종이',notice_size='A5',notice_made_on='2026-09',notice_as_manager='CS',notice_as_contact='02-000-0000'
 where id='no-shipping-draft';
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000042212',true);
set local role authenticated;
select pg_temp.review_goods_kc_fixture('no-shipping-draft');
do $$ begin
 begin
  perform public.admin_set_good_published('no-shipping-draft',true);
  raise exception 'missing shipping published';
 exception when check_violation then if sqlerrm<>'fulfillment_origin_required' then raise; end if; end;
end $$;
select public.admin_save_good(to_jsonb(good)||jsonb_build_object('previous_id',good.id,'origin_id','00000000-0000-4000-8000-000000042202','publish',true))
 from public.goods good where id='no-shipping-draft';
select 1 / case when exists(select 1 from public.goods where id='no-shipping-draft' and published_at is not null and origin_id='00000000-0000-4000-8000-000000042202')
 then 1 else 0 end as assert_shipping_and_publish_atomic;
reset role;
update public.fulfillment_origins set is_active=false where code='gimpo';
set local role authenticated;
do $$ begin
 begin
  -- A reviewed product name is part of the KC context. Change only price here
  -- so this test isolates the invalid-origin boundary and full-save rollback.
  perform public.admin_save_good(to_jsonb(good)||jsonb_build_object('previous_id',good.id,'price',1200,'origin_id','00000000-0000-4000-8000-000000042201')) from public.goods good where id='no-shipping-draft';
  raise exception 'inactive origin save accepted';
 exception when check_violation then if sqlerrm<>'fulfillment_origin_inactive' then raise; end if; end;
end $$;
select 1 / case when exists(select 1 from public.goods where id='no-shipping-draft' and name='No shipping draft'
 and price=1000 and origin_id='00000000-0000-4000-8000-000000042202') then 1 else 0 end as assert_failed_shipping_rolls_back_complete_save;
reset role;
update public.fulfillment_origins set is_active=true where code='gimpo';
select set_config('request.jwt.claim.sub','',true);
update public.goods set individual_fee=9000 where id='shipping-origin-d';
select private.goods_shipping_fee_for('00000000-0000-4000-8000-000000042221'::uuid) as quoted_fee \gset
update public.orders set shipping_fee=:'quoted_fee'::bigint where id='00000000-0000-4000-8000-000000042221';
select 1 / case when shipping_fee=10000 and jsonb_array_length(shipping_fee_breakdown)=2
 and (select individual_fee_snapshot from public.order_items where order_id=orders.id and good_id='shipping-origin-d')=2500
 then 1 else 0 end as assert_order_uses_line_shipping_snapshots from public.orders where id='00000000-0000-4000-8000-000000042221';
create temp table order_quote_before as select shipping_fee,shipping_fee_breakdown from public.orders where id='00000000-0000-4000-8000-000000042221';
update public.fulfillment_origins set base_fee=12345,free_threshold=null where code='gimpo';
select 1 / case when private.goods_shipping_fee_for(50000)=12345
 and not exists(select 1 from public.orders current cross join order_quote_before previous
 where current.id='00000000-0000-4000-8000-000000042221'
 and (current.shipping_fee<>previous.shipping_fee or current.shipping_fee_breakdown<>previous.shipping_fee_breakdown))
 then 1 else 0 end as assert_dynamic_policy_keeps_existing_order_fixed;
select 1 / case when exists(select 1 from public.audit_log where actor_id='00000000-0000-4000-8000-000000042211' and action='admin.fulfillment_origin.saved')
 then 1 else 0 end as assert_origin_edit_audited;
rollback;
