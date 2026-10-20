\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000063301','authenticated','authenticated','custom-inputs-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000063302','authenticated','authenticated','custom-inputs-buyer@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000063303','authenticated','authenticated','custom-inputs-other@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff',nickname='custom_staff' where id='00000000-0000-4000-8000-000000063301';
update public.profiles set nickname='custom_buyer',email='custom-inputs-buyer@example.test',birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}' where id='00000000-0000-4000-8000-000000063302';
insert into public.fulfillment_origins(id,code,name,base_fee,return_address,is_active) values
 ('00000000-0000-4000-8000-000000063301','custom-inputs','합성 입력 출고지',0,'합성 반송지',true);
insert into public.ips(id,title,vertical_key,published_at) values('custom-inputs','합성 입력 IP','character',now());
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000063301',true);
select public.admin_save_good('{"id":"custom-inputs-good","code":"CUSTOM-IN","ip_id":"custom-inputs","name":"합성 각인 상품","type":"문구","price":10000,"origin_id":"00000000-0000-4000-8000-000000063301","variant_baseline":[],"variants":[{"name":"기본 옵션","attributes":{},"code":"CUSTOM-IN-01","extraPrice":0,"stockQty":10}],"custom_inputs":{"enabled":true,"fields":[{"id":"00000000-0000-4000-8000-000000063311","name":"각인 문구","active":true},{"id":"00000000-0000-4000-8000-000000063312","name":"이니셜","active":true}]},"custom_inputs_expected_revision":0}');
select 1/case when (select custom_inputs_enabled and custom_inputs_revision=1 and jsonb_array_length(custom_input_fields)=2 from public.goods where id='custom-inputs-good') then 1 else 0 end as assert_definition_saved;
select public.admin_clone_good('00000000-0000-4000-8000-000000063304','custom-inputs-good','custom-inputs-clone','CUSTOM-COPY','합성 각인 복사');
select 1/case when (select custom_inputs_enabled and custom_inputs_revision=1 from public.goods where id='custom-inputs-clone')
 and (select custom_input_fields from public.goods where id='custom-inputs-clone')=(select custom_input_fields from public.goods where id='custom-inputs-good') then 1 else 0 end as assert_clone_copies_input_definition;
reset role;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.publish_goods_kc_fixture('custom-inputs-good');
select id as variant_id from public.goods_variants where good_id='custom-inputs-good' and is_default \gset
select set_config('test.custom_variant',:'variant_id',true);
select '{"00000000-0000-4000-8000-000000063311":"첫 번째 문구","00000000-0000-4000-8000-000000063312":"AB"}'::jsonb as inputs_a \gset
select '{"00000000-0000-4000-8000-000000063311":"두 번째 문구","00000000-0000-4000-8000-000000063312":"CD"}'::jsonb as inputs_b \gset
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000063302',true);
select public.set_cart_item_quantity_with_inputs('custom-inputs-good',:'variant_id',1,1,:'inputs_a');
select public.set_cart_item_quantity_with_inputs('custom-inputs-good',:'variant_id',2,1,:'inputs_b');
select public.set_cart_item_quantity('custom-inputs-good',:'variant_id',0);
select 1/case when (select count(*) from public.cart_items)=2 and (select sum(qty) from public.cart_items)=3
 and (select count(distinct id) from public.cart_items)=2 and (select count(distinct input_key) from public.cart_items)=2
 and exists(select 1 from public.cart_items where input_snapshot#>>'{fields,0,name}'='각인 문구' and input_snapshot#>>'{fields,0,value}'='첫 번째 문구')
 then 1 else 0 end as assert_distinct_texts_stay_separate_and_legacy_delete_is_scoped;
select public.merge_cart_items(jsonb_build_array(jsonb_build_object('good_id','custom-inputs-good','variant_id',:'variant_id','qty',1,'input_revision',1,'input_values',:'inputs_a'::jsonb)));
select public.add_cart_selection('custom-inputs-good',jsonb_build_array(jsonb_build_object('good_id','custom-inputs-good','variant_id',:'variant_id','qty',1,'expected_qty',1,'input_revision',1,'input_values',:'inputs_a'::jsonb)));
select 1/case when (select count(*) from public.cart_items)=2 and (select sum(qty) from public.cart_items)=4
 and public.quote_goods_sales((select jsonb_agg(jsonb_build_object('goodId',good_id,'variantId',variant_id,'qty',qty)) from public.cart_items))->>'subtotal'='40000'
 then 1 else 0 end as assert_same_text_merges_and_price_quote_sums_variant_lines;
do $$declare variant uuid:=current_setting('test.custom_variant')::uuid; values_a jsonb:='{"00000000-0000-4000-8000-000000063311":"첫 번째 문구","00000000-0000-4000-8000-000000063312":"AB"}';begin
 begin perform public.set_cart_item_quantity('custom-inputs-good',variant,1);raise exception 'legacy call bypassed required inputs';exception when check_violation then if sqlerrm<>'goods_custom_inputs_changed' then raise;end if;end;
 begin perform public.set_cart_item_quantity_with_inputs('custom-inputs-good',variant,1,1,'{}');raise exception 'missing inputs accepted';exception when check_violation then if sqlerrm<>'invalid_goods_custom_inputs' then raise;end if;end;
 begin perform public.set_cart_item_quantity_with_inputs('custom-inputs-good',variant,9,1,values_a);raise exception 'aggregate stock exceeded';exception when check_violation then if sqlerrm<>'out of stock' then raise;end if;end;
 begin perform public.add_cart_selection('custom-inputs-good',jsonb_build_array(jsonb_build_object('good_id','custom-inputs-good','variant_id',variant,'qty',1,'expected_qty',1,'input_revision',1,'input_values',values_a)));raise exception 'uncertain add retry doubled quantity';exception when sqlstate 'PT409' then if sqlerrm<>'cart_selection_changed' then raise;end if;end;
 begin perform public.set_cart_item_quantity_with_inputs('custom-inputs-good',variant,1,1,jsonb_set(values_a,'{00000000-0000-4000-8000-000000063311}',to_jsonb(repeat('x',101))));raise exception 'long input accepted';exception when check_violation then if sqlerrm<>'invalid_goods_custom_inputs' then raise;end if;end;
end$$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000063303',true);
select 1/case when (select count(*) from public.cart_items)=0 then 1 else 0 end as assert_inputs_are_account_isolated;
reset role;
set local role service_role;
select public.place_order('00000000-0000-4000-8000-000000063302','{"recipientName":"합성 수취인","phone":"01000000000","postalCode":"12345","address1":"합성 주소"}','00000000-0000-4000-8000-000000063321','card') as order_id \gset
reset role;
select 1/case when (select count(*) from public.order_items where order_id=:'order_id')=2
 and (select count(distinct variant_id) from public.order_items where order_id=:'order_id')=1
 and (select sum(qty) from public.order_items where order_id=:'order_id')=4
 and (select count(*) from public.order_shipment_items where order_id=:'order_id')=2
 and (select total from public.orders where id=:'order_id')=40000
 and (select stock_qty from public.goods_variants where id=:'variant_id')=6
 and not exists(select 1 from public.cart_items where user_id='00000000-0000-4000-8000-000000063302')
 and (select count(distinct custom_inputs_snapshot#>>'{fields,0,value}') from public.order_items where order_id=:'order_id')=2
 then 1 else 0 end as assert_order_consumes_distinct_rows_and_preserves_inputs_and_supply;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000063301',true);
select 1/case when jsonb_array_length(public.admin_order_detail(:'order_id')->'items')=2
 and public.admin_order_detail(:'order_id')#>>'{items,0,customInputs,fields,0,name}'='각인 문구'
 then 1 else 0 end as assert_staff_order_readback_has_input_snapshot;
reset role;
-- Export reads the same immutable line snapshots after payment; roll the
-- synthetic status transition back before testing the unpaid full cancel.
savepoint export_projection;
update public.orders set status='confirmed' where id=:'order_id';
update public.order_shipments set status='ready' where order_id=:'order_id';
set local role authenticated;
select public.admin_shipment_export((select array_agg(id) from public.order_shipments where order_id=:'order_id')) as input_export \gset
select 1/case when jsonb_array_length(:'input_export'::jsonb#>'{shipments,0,lines}')=2
 and exists(select 1 from jsonb_array_elements(:'input_export'::jsonb#>'{shipments,0,lines}') line where line->>'optionName' like '%각인 문구: 첫 번째 문구%' and line->>'optionName' like '%이니셜: AB%')
 and exists(select 1 from jsonb_array_elements(:'input_export'::jsonb#>'{shipments,0,lines}') line where line->>'optionName' like '%각인 문구: 두 번째 문구%' and line->>'optionName' like '%이니셜: CD%')
 then 1 else 0 end as assert_warehouse_export_keeps_distinct_input_values;
reset role;
update public.order_shipments set exported_at=clock_timestamp() where order_id=:'order_id';
set local role authenticated;
select public.admin_origin_tracking_candidates('00000000-0000-4000-8000-000000063301','{}',
 array[(select address->>'phone' from public.orders where id=:'order_id')]) as input_candidates \gset
select 1/case when
 (select jsonb_agg(line->>'optionName' order by line->>'optionName') from jsonb_array_elements(:'input_candidates'::jsonb#>'{shipments,0,lines}') line)
 =(select jsonb_agg(line->>'optionName' order by line->>'optionName') from jsonb_array_elements(:'input_export'::jsonb#>'{shipments,0,lines}') line)
 then 1 else 0 end as reply_candidate_preserves_the_exported_custom_input_option_text;

rollback to savepoint export_projection;
set local role service_role;
select public.cancel_order(:'order_id','합성 주문 전체 취소');
reset role;
select 1/case when (select stock_qty from public.goods_variants where id=:'variant_id')=10
 and (select status from public.orders where id=:'order_id')='canceled'
 and (select count(*) from public.order_items where order_id=:'order_id' and custom_inputs_snapshot is not null)=2
 then 1 else 0 end as assert_full_order_cancel_restores_every_custom_line_once;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000063302',true);
select public.set_cart_item_quantity_with_inputs('custom-inputs-good',:'variant_id',1,1,:'inputs_a');
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.goods set custom_input_fields=jsonb_set(custom_input_fields,'{0,name}','"새 각인 문구"') where id='custom-inputs-good';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000063302',true);
set local role service_role;
do $$begin
 begin perform public.place_order('00000000-0000-4000-8000-000000063302'::uuid,'{"recipientName":"합성 수취인","phone":"01000000000","postalCode":"12345","address1":"합성 주소"}'::jsonb,'00000000-0000-4000-8000-000000063322'::uuid,'card'::public.order_payment_method);raise exception 'stale definition ordered';exception when check_violation then if sqlerrm<>'goods_custom_inputs_changed' then raise;end if;end;
end$$;
set local role authenticated;
select 1/case when (select count(*) from public.cart_items)=1 then 1 else 0 end as assert_stale_checkout_failure_keeps_cart;
select public.set_cart_item_quantity_with_inputs('custom-inputs-good',:'variant_id',0,1,:'inputs_a');
select 1/case when (select count(*) from public.cart_items)=0 then 1 else 0 end as assert_obsolete_input_line_can_be_removed;
reset role;
do $$begin
 begin update public.order_items set custom_inputs_snapshot=null where good_id='custom-inputs-good';raise exception 'history input mutated';exception when check_violation then if sqlerrm<>'order_custom_inputs_snapshot_immutable' then raise;end if;end;
end$$;
select 1/case when exists(select 1 from public.audit_log where action='admin.good.custom_inputs_saved' and target='goods:custom-inputs-good')
 and not has_function_privilege('anon','public.set_cart_item_quantity_with_inputs(text,uuid,integer,integer,jsonb)','execute')
 and not has_function_privilege('service_role','public.set_cart_item_quantity_with_inputs(text,uuid,integer,integer,jsonb)','execute')
 and not has_function_privilege('authenticated','private.resolve_goods_custom_inputs(text,integer,jsonb)','execute')
 then 1 else 0 end as assert_input_definition_audit_and_sealed_helpers;
rollback;
