\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000042970','authenticated','authenticated','shipment-export@example.test','{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000042970';
insert into public.verticals(key,label,color) values('shipment-export-test','출고지시 테스트','#111111');
insert into public.ips(id,title,vertical_key) values('shipment-export-test','출고지시 테스트','shipment-export-test');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values('shipment-export-test','shipment-export-test','출고할 상품','문구',10000,'ok',20);
insert into public.orders(id,user_id,status,total,address) values('00000000-0000-4000-8000-000000042971','00000000-0000-4000-8000-000000042970','confirmed',20000,'{"recipientName":"이름","phone":"01000112233","postalCode":"00123","address1":"주소1","address2":"주소2","deliveryNote":"문 앞"}');
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot) select '00000000-0000-4000-8000-000000042972','00000000-0000-4000-8000-000000042971','shipment-export-test',id,2,10000,'출고할 상품','문구','shipment-export-test' from public.goods_variants where good_id='shipment-export-test' and is_default;
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot) values('00000000-0000-4000-8000-000000042973','00000000-0000-4000-8000-000000042971','00000000-0000-4000-8000-000000042201','김포',3000,'{}');
insert into public.order_shipment_items(order_id,shipment_id,order_item_id) values('00000000-0000-4000-8000-000000042971','00000000-0000-4000-8000-000000042973','00000000-0000-4000-8000-000000042972');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000042970',true);
select public.admin_shipment_export(array['00000000-0000-4000-8000-000000042973'::uuid]) as file_data \gset
select 1 / case when :'file_data'::jsonb#>>'{shipments,0,lines,0,phone}'='01000112233'
 and :'file_data'::jsonb#>>'{shipments,0,lines,0,postalCode}'='00123'
 and :'file_data'::jsonb#>>'{shipments,0,lines,0,qty}'='2'
 and :'file_data'::jsonb#>>'{shipments,0,lines,0,goodName}'='출고할 상품'
 and :'file_data'::jsonb#>>'{shipments,0,lines,0,address}'='주소1 주소2'
 and (select exported_at from public.order_shipments where id='00000000-0000-4000-8000-000000042973') is null then 1 else 0 end as assert_read_only_export_full_standard_fields;
select jsonb_build_array(jsonb_build_object('id',id,'updatedAt',updated_at)) as versions from public.order_shipments where id='00000000-0000-4000-8000-000000042973' \gset
select public.admin_mark_shipments_exported(:'versions');
select 1 / case when (select exported_at is not null and exported_by='00000000-0000-4000-8000-000000042970' from public.order_shipments where id='00000000-0000-4000-8000-000000042973') then 1 else 0 end as assert_export_marked_after_generation;
select set_config('test.shipment_export_versions',:'versions',true);
do $$begin perform public.admin_mark_shipments_exported(current_setting('test.shipment_export_versions')::jsonb);raise exception 'stale export marked';exception when serialization_failure then null;end$$;
do $$begin perform public.admin_save_origin_export_columns('00000000-0000-4000-8000-000000042201','[]',now());raise exception 'staff settings write accepted';exception when insufficient_privilege then null;end$$;
select public.admin_update_shipment_status('00000000-0000-4000-8000-000000042973','shipping','hanjin','1234567890');
do $$begin perform public.admin_shipment_export(array['00000000-0000-4000-8000-000000042973'::uuid]);raise exception 'shipped exported as ready';exception when check_violation then if sqlerrm<>'shipment_not_ready' then raise;end if;end$$;
reset role;
select 1 / case when exists(select 1 from public.audit_log where actor_id='00000000-0000-4000-8000-000000042970' and action='admin.shipment.exported') then 1 else 0 end as assert_export_audit;
rollback;
