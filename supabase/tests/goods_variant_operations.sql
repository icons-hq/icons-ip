\set ON_ERROR_STOP on
begin;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000046801','authenticated','authenticated','variant-operations-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000046802','authenticated','authenticated','variant-operations-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000046801';
update public.profiles set nickname='안전재고 구매자',birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
 where id='00000000-0000-4000-8000-000000046802';
insert into public.verticals(key,label,color) values('variant-operations','옵션 운영 검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values('variant-operations','옵션 운영 검증','variant-operations',now());

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000046801',true);
select public.admin_save_good('{"id":"variant-operations","ip_id":"variant-operations","name":"안전재고 옵션","price":10000,"variant_baseline":[],"variants":[{"name":"기본 옵션","attributes":{},"code":"SAFE-468-01","extraPrice":0,"stockQty":10,"lowStockThreshold":3}]}');
select 1 / case when exists(
 select 1 from public.admin_goods_import_records('{}','{variant-operations}') record
 where record->'variants' @> '[{"code":"SAFE-468-01","stock_qty":10,"low_stock_threshold":3}]'::jsonb
   and record->'good'->>'stock_qty'='10'
) then 1 else 0 end as assert_threshold_is_saved_without_reserving_stock;

select record->'good'||jsonb_build_object(
 'previous_id','variant-operations',
 'variant_baseline',jsonb_build_array(record#>>'{variants,0,id}'),
 'variants',jsonb_build_array(jsonb_build_object(
   'id',record#>>'{variants,0,id}','name','기본 옵션','attributes','{}'::jsonb,'code','SAFE-468-01',
   'extraPrice',0,'stockQty',10,'expectedStockQty',10,'isActive',false
 ))) as stopped_payload
from public.admin_goods_import_records('{}','{variant-operations}') record \gset
select public.admin_save_good(:'stopped_payload'::jsonb);
select 1 / case when exists(
 select 1 from public.admin_goods_import_records('{}','{variant-operations}') record
 where record#>>'{variants,0,archived_at}' is not null
   and record#>>'{variants,0,is_default}'='true'
   and record#>>'{variants,0,stock_qty}'='10'
   and record#>>'{variants,0,low_stock_threshold}'='3'
) then 1 else 0 end as assert_stopped_default_keeps_identity_and_stock;

select record#>>'{variants,0,id}' as variant_id,record#>>'{variants,0,updated_at}' as variant_updated_at
from public.admin_goods_import_records('{}','{variant-operations}') record \gset
select public.admin_set_goods_variant_active('variant-operations',:'variant_id',true,:'variant_updated_at',10000);
select 1 / case when exists(
 select 1 from public.admin_goods_import_records('{}','{variant-operations}') record
 where record#>>'{variants,0,id}'=:'variant_id'
   and record#>>'{variants,0,archived_at}' is null
   and record#>>'{variants,0,stock_qty}'='10'
   and record#>>'{variants,0,low_stock_threshold}'='3'
) then 1 else 0 end as assert_restore_preserves_option_and_stock;

select 1 / case when (
 select count(*) from public.admin_search_goods('SAFE-468') good
 where public.admin_goods_active_stock_qty(good)=10
   and public.admin_goods_low_stock_option_count(good)=0
)=1 then 1 else 0 end as assert_inventory_summary_uses_active_options;

select public.admin_save_good('{"id":"variant-export-operations","ip_id":"variant-operations","name":"중지된 기본 옵션 엑셀","price":10000,"variant_baseline":[],"variants":[{"name":"기본 옵션","attributes":{},"code":"SAFE-EXPORT-01","extraPrice":0,"stockQty":10,"isActive":false},{"name":"빨강","attributes":{"색상":"빨강"},"code":"SAFE-EXPORT-02","extraPrice":0,"stockQty":4}]}');
select 1 / case when exists(
 select 1 from public.admin_goods_export_candidates('SAFE-EXPORT','','active','ok')
 where good_id='variant-export-operations' and option_rows=2
) then 1 else 0 end as assert_export_counts_stopped_default_and_active_options;

-- Complete the synthetic catalog fixture without making an external upload or
-- payment. The public cart/order and cancellation boundaries do the actual work.
reset role;
select set_config('request.jwt.claim.sub','',true);
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values('00000000-0000-4000-8000-000000046830','variant-operations','옵션 검증 출고지','hanjin',3000,'합성 반송 주소',true);
update public.goods set type='문구',image_path='public-media/variant-operations-fixture.webp',
 notice_maker='제조사',notice_origin='한국',notice_material='종이',notice_size='A5',notice_made_on='2026-09',
 notice_as_manager='CS',notice_as_contact='02-000',origin_id='00000000-0000-4000-8000-000000046830'
 where id='variant-operations';
select pg_temp.publish_goods_kc_fixture('variant-operations');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000046802',true);
select public.set_cart_item_quantity('variant-operations',:'variant_id',10);
select 1 / case when exists(select 1 from public.cart_items where good_id='variant-operations' and qty=10)
 then 1 else 0 end as assert_threshold_does_not_reduce_ten_saleable_units;
select public.set_cart_item_quantity('variant-operations',:'variant_id',7);
reset role;
set local role service_role;
select public.place_order('00000000-0000-4000-8000-000000046802',
 '{"recipientName":"검증 구매자","phone":"01012345678","postalCode":"00000","address1":"배송 금지 합성 주소"}',
 '00000000-0000-4000-8000-000000046820','card') as order_id \gset
reset role;
set local role authenticated;
select public.set_cart_item_quantity('variant-operations',:'variant_id',1);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000046801',true);
select 1 / case when exists(select 1 from public.admin_search_goods('SAFE-468') good
 where public.admin_goods_active_stock_qty(good)=3 and public.admin_goods_low_stock_option_count(good)=1)
 then 1 else 0 end as assert_order_debit_reaches_warning_threshold;
select record#>>'{variants,0,updated_at}' as ordered_variant_updated_at
from public.admin_goods_import_records('{}','{variant-operations}') record \gset
select public.admin_set_goods_variant_active('variant-operations',:'variant_id',false,:'ordered_variant_updated_at');
select public.admin_set_goods_variant_active('variant-operations',:'variant_id',false,:'ordered_variant_updated_at');
select 1 / case when exists(select 1 from public.admin_goods_export_candidates('SAFE-468','','published','soldout') where good_id='variant-operations' and option_rows=1)
 and not exists(select 1 from public.admin_goods_export_candidates('SAFE-468','','published','ok'))
 then 1 else 0 end as assert_stopped_inventory_is_filtered_before_export;

set local role anon;
select set_config('request.jwt.claim.sub','',true);
select 1 / case when not exists(select 1 from public.goods_variants where good_id='variant-operations')
 then 1 else 0 end as assert_stopped_option_is_not_publicly_selectable;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000046802',true);
select 1 / case when exists(select 1 from public.order_items where order_id=:'order_id'
 and variant_id=:'variant_id' and variant_code_snapshot='SAFE-468-01' and qty=7 and unit_price=10000)
 then 1 else 0 end as assert_owner_keeps_original_order_identity_and_price;
do $$ begin
 perform public.set_cart_item_quantity('variant-operations',(select variant_id from public.cart_items where good_id='variant-operations'),1);
 raise exception 'stopped option was added to cart';
exception when check_violation then if sqlerrm<>'catalog_item_unavailable' then raise; end if;
end $$;
reset role;
set local role service_role;
do $$ begin
 perform public.place_order('00000000-0000-4000-8000-000000046802',
  '{"recipientName":"검증 구매자","phone":"01012345678","postalCode":"00000","address1":"배송 금지 합성 주소"}',
  '00000000-0000-4000-8000-000000046821','card');
 raise exception 'stopped option was ordered from stale cart';
exception when check_violation then if sqlerrm<>'catalog_item_unavailable' then raise; end if;
end $$;
reset role;
-- This existing finalizer is sealed even from service_role; only its owning
-- trusted payment/cancellation paths invoke it. Exercise it as the test owner.
select public.finalize_order_cancellation_with_provider_evidence(:'order_id','합성 미결제 취소','{}');
select public.finalize_order_cancellation_with_provider_evidence(:'order_id','합성 미결제 취소','{}');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000046801',true);
select 1 / case when exists(select 1 from public.admin_goods_import_records('{}','{variant-operations}') record
 where record#>>'{variants,0,id}'=:'variant_id' and record#>>'{variants,0,stock_qty}'='10'
 and record#>>'{variants,0,archived_at}' is not null and record#>>'{variants,0,low_stock_threshold}'='3')
 and exists(select 1 from public.admin_search_goods('SAFE-468') good
   where public.admin_goods_active_stock_qty(good)=0 and public.admin_goods_low_stock_option_count(good)=0)
 then 1 else 0 end as assert_cancel_restores_stock_once_without_reactivating_option;

reset role;
select 1 / case when (select count(*) from public.audit_log where action='admin.good.option_stopped' and target='goods:variant-operations')=1
 and (select count(*) from public.audit_log where action='order.option_stock_restored' and target='order:'||:'order_id')=1
 and (select count(*) from public.orders where user_id='00000000-0000-4000-8000-000000046802')=1
 then 1 else 0 end as assert_replays_do_not_duplicate_state_stock_or_orders;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000046801',true);
do $$ declare record jsonb; payload jsonb; invalid jsonb; begin
 select value into record from public.admin_goods_import_records('{}','{variant-operations}') value;
 payload:=record->'good'||jsonb_build_object('previous_id','variant-operations','variant_baseline','[]'::jsonb,
   'variants',jsonb_build_array(jsonb_build_object('id',record#>>'{variants,0,id}',
   'name','기본 옵션','attributes','{}'::jsonb,'code','SAFE-468-01','extraPrice',0,'stockQty',10,
   'expectedStockQty',10,'isActive',false)));
 foreach invalid in array array['-1'::jsonb,'1.5'::jsonb,'"3"'::jsonb,'true'::jsonb,'{}'::jsonb,'2147483648'::jsonb] loop
   begin
     perform public.admin_save_good(jsonb_set(payload,'{variants,0,lowStockThreshold}',invalid));
     raise exception 'invalid warning threshold accepted';
   exception when check_violation then if sqlerrm<>'invalid_goods_options' then raise; end if; end;
 end loop;
 foreach invalid in array array['null'::jsonb,'"false"'::jsonb,'1'::jsonb] loop
   begin
     perform public.admin_save_good(jsonb_set(payload,'{variants,0,isActive}',invalid));
     raise exception 'invalid availability accepted';
   exception when check_violation then if sqlerrm<>'invalid_goods_options' then raise; end if; end;
 end loop;
 perform public.admin_save_good(jsonb_set(payload,'{variants,0,lowStockThreshold}','0'));
 if not exists(select 1 from public.goods_variants where good_id='variant-operations' and low_stock_threshold=0 and stock_qty=10) then
   raise exception 'zero threshold was treated as missing'; end if;
 perform public.admin_save_good(jsonb_set(payload,'{variants,0,lowStockThreshold}','null'));
 if not exists(select 1 from public.goods_variants where good_id='variant-operations' and low_stock_threshold is null and stock_qty=10) then
   raise exception 'clearing threshold changed inventory'; end if;
 begin
   perform public.admin_set_goods_variant_active('variant-operations',(record#>>'{variants,0,id}')::uuid,true,'2000-01-01',10000);
   raise exception 'stale restore accepted';
 exception when sqlstate 'PT409' then if sqlerrm<>'goods_variant_changed' then raise; end if; end;
end $$;

reset role;
update public.goods_variants set attributes='{}' where code='SAFE-EXPORT-02';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000046801',true);
do $$ declare variant public.goods_variants; begin
 select * into variant from public.goods_variants where code='SAFE-EXPORT-01';
 begin
   perform public.admin_set_goods_variant_active(variant.good_id,variant.id,true,variant.updated_at,9000);
   raise exception 'below-base restore price accepted';
 exception when check_violation then if sqlerrm<>'variant_price_below_base' then raise; end if; end;
 begin
   perform public.admin_set_goods_variant_active(variant.good_id,variant.id,true,variant.updated_at,10000);
   raise exception 'duplicate option combination restored';
 exception when check_violation then if sqlerrm<>'goods_variant_combination_exists' then raise; end if; end;
end $$;
reset role;
select 1 / case when has_function_privilege('authenticated','public.admin_set_goods_variant_active(text,uuid,boolean,timestamptz,integer)','execute')
 and not has_function_privilege('anon','public.admin_set_goods_variant_active(text,uuid,boolean,timestamptz,integer)','execute')
 and not has_function_privilege('service_role','public.admin_set_goods_variant_active(text,uuid,boolean,timestamptz,integer)','execute')
 and not has_function_privilege('authenticated','private.save_goods_options(text,jsonb,jsonb,boolean)','execute')
 and not has_function_privilege('anon','public.admin_goods_active_stock_qty(public.goods)','execute')
 and not has_function_privilege('service_role','public.admin_goods_low_stock_option_count(public.goods)','execute')
 and not has_table_privilege('authenticated','public.goods_variants','UPDATE')
 then 1 else 0 end as assert_option_operations_are_sealed;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000046802',true);
do $$ begin
 perform public.admin_set_goods_variant_active('variant-operations','00000000-0000-4000-8000-000000046899',true,now(),10000);
 raise exception 'buyer changed an option';
exception when insufficient_privilege then if sqlerrm<>'forbidden' then raise; end if;
end $$;
reset role;
set constraints public.goods_variants_require_default immediate;

rollback;
