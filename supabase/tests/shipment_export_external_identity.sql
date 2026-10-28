\set ON_ERROR_STOP on
-- 10/27 회의 D10: 출고지시 행에 옵션의 바코드·ERP 코드·ERP 품명을 싣는다.
-- 값은 주문 시점 스냅샷이 우선이고, 스냅샷 값이 비어 있으면(행이 없거나 그 필드가 NULL) 지금 등록된 값으로 필드별로 채운다.
begin;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values('00000000-0000-4000-8000-000000052801','authenticated','authenticated','export-identity@example.test','{}','{}',now(),now());
update public.profiles set role='admin' where id='00000000-0000-4000-8000-000000052801';
insert into public.verticals(key,label,color) values('export-identity','출고 식별값','#000000');
insert into public.ips(id,title,vertical_key) values('export-identity','출고 식별값','export-identity');
insert into public.goods(id,ip_id,name,type,price,code) values('export-identity','export-identity','식별값 상품','문구',1000,'EXPORT-528');
update public.goods_variants set name='빨강',code='528-RED' where good_id='export-identity';
insert into public.goods_variants(good_id,name,code,price,sort_order) values
 ('export-identity','파랑','528-BLUE',1000,1),('export-identity','노랑','528-YELLOW',1000,2),('export-identity','초록','528-GREEN',1000,3);

-- 주문 전: 빨강은 바코드·ERP 품명만 있고 ERP 코드는 비어 있다. 초록은 세 값이 모두 있다. 파랑·노랑은 아직 없다.
insert into private.goods_variant_external_identity(variant_id,erp_code,erp_name,barcode)
select id,null,'ERP 빨강','0880000000011' from public.goods_variants where good_id='export-identity' and name='빨강'
union all
select id,'ERP-GREEN','ERP 초록','0880000000044' from public.goods_variants where good_id='export-identity' and name='초록';

insert into public.orders(id,user_id,status,total,shipping_fee,address,confirmed_at)
 values('50000000-0000-4000-8000-000000052801','00000000-0000-4000-8000-000000052801','confirmed',7000,3000,'{"recipientName":"출고 식별값","phone":"01000000000","postalCode":"00123","address1":"테스트 주소"}',now());
insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,variant_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select '50000000-0000-4000-8000-000000052801',good_id,id,1,price,'식별값 상품',name,'문구','export-identity' from public.goods_variants where good_id='export-identity';
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot)
 values('60000000-0000-4000-8000-000000052801','50000000-0000-4000-8000-000000052801','00000000-0000-4000-8000-000000042201','김포',3000,'{}');
insert into public.order_shipment_items(order_id,shipment_id,order_item_id)
 select order_id,'60000000-0000-4000-8000-000000052801',id from public.order_items where order_id='50000000-0000-4000-8000-000000052801';

-- 주문 시점 스냅샷이 남았는지 확인한다(파랑·노랑은 NULL 값의 스냅샷 행).
select 1/case when (select count(*) from private.order_item_external_identity_snapshots snapshot join public.order_items item on item.id=snapshot.order_item_id
  where item.order_id='50000000-0000-4000-8000-000000052801')=4 then 1 else 0 end as assert_order_snapshots_captured;

-- 주문 뒤: 빨강은 바코드·ERP 품명을 바꾸고 ERP 코드를 새로 넣는다(스냅샷 값이 이기고 빈 ERP 코드만 지금 값으로 채운다).
-- 파랑은 처음 등록한다(스냅샷 행은 있지만 값이 모두 NULL → 지금 값). 노랑은 계속 없다(빈칸).
-- 초록은 스냅샷 행이 없는 옛 주문처럼 지운 뒤 지금 값을 바꾼다(지금 값).
update private.goods_variant_external_identity set barcode='0880000000099',erp_name='ERP 빨강 변경',erp_code='ERP-RED-LATER'
 where variant_id=(select id from public.goods_variants where good_id='export-identity' and name='빨강');
insert into private.goods_variant_external_identity(variant_id,erp_code,erp_name,barcode)
select id,'ERP-BLUE','ERP 파랑','0880000000022' from public.goods_variants where good_id='export-identity' and name='파랑';
delete from private.order_item_external_identity_snapshots where order_item_id=(select id from public.order_items
 where order_id='50000000-0000-4000-8000-000000052801' and variant_name_snapshot='초록');
update private.goods_variant_external_identity set barcode='0880000000055',erp_name='ERP 초록 지금'
 where variant_id=(select id from public.goods_variants where good_id='export-identity' and name='초록');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000052801',true);
select public.admin_shipment_export(array['60000000-0000-4000-8000-000000052801'::uuid]) as exported \gset
create temp table exported_lines on commit drop as
 select value->>'optionName' option_name,value->>'barcode' barcode,value->>'erpCode' erp_code,value->>'erpName' erp_name
 from jsonb_array_elements(:'exported'::jsonb#>'{shipments,0,lines}');
select 1/case when (select count(*) from exported_lines)=4
 and (select count(*) from exported_lines where barcode is null or erp_code is null or erp_name is null)=0
 then 1 else 0 end as assert_every_line_has_identity_keys;
select 1/case when exists(select 1 from exported_lines where option_name='빨강' and barcode='0880000000011' and erp_name='ERP 빨강' and erp_code='ERP-RED-LATER')
 then 1 else 0 end as assert_snapshot_wins_and_blank_snapshot_field_uses_live;
select 1/case when exists(select 1 from exported_lines where option_name='파랑' and barcode='0880000000022' and erp_code='ERP-BLUE' and erp_name='ERP 파랑')
 then 1 else 0 end as assert_null_snapshot_uses_live_identity;
select 1/case when exists(select 1 from exported_lines where option_name='초록' and barcode='0880000000055' and erp_code='ERP-GREEN' and erp_name='ERP 초록 지금')
 then 1 else 0 end as assert_missing_snapshot_row_uses_live_identity;
select 1/case when exists(select 1 from exported_lines where option_name='노랑' and barcode='' and erp_code='' and erp_name='')
 then 1 else 0 end as assert_unidentified_option_exports_blank_cells;
-- 출고 파일은 스냅샷을 읽기만 한다. 지금 값으로 채운 결과를 스냅샷에 되쓰지 않는다(정산 내보내기 원천 보존).
reset role;
select 1/case when (select count(*) from private.order_item_external_identity_snapshots snapshot join public.order_items item on item.id=snapshot.order_item_id
  where item.order_id='50000000-0000-4000-8000-000000052801' and snapshot.barcode is null)=2
 and not exists(select 1 from private.order_item_external_identity_snapshots where order_item_id=(select id from public.order_items
  where order_id='50000000-0000-4000-8000-000000052801' and variant_name_snapshot='초록'))
 then 1 else 0 end as assert_snapshots_unchanged_by_export;

-- 내보내기 전 경고: 바코드가 비는 옵션 수(노랑 1개). 같은 옵션이 여러 배송 건에 있어도 한 번만 센다.
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot)
 values('60000000-0000-4000-8000-000000052802','50000000-0000-4000-8000-000000052801','00000000-0000-4000-8000-000000042202','남양주',0,'{}');
set local role authenticated;
select 1/case when public.admin_shipment_barcode_gaps(array['60000000-0000-4000-8000-000000052801'::uuid])=1
 and public.admin_shipment_barcode_gaps(array['60000000-0000-4000-8000-000000052801'::uuid,'60000000-0000-4000-8000-000000052802'::uuid])=1
 and public.admin_shipment_barcode_gaps(array['60000000-0000-4000-8000-000000052802'::uuid])=0
 and public.admin_shipment_barcode_gaps(array[]::uuid[])=0
 then 1 else 0 end as assert_barcode_gap_counts_distinct_options;
do $$ begin
 begin perform public.admin_shipment_barcode_gaps(null); raise exception 'null selection accepted';
 exception when invalid_parameter_value then null; end;
 begin perform public.admin_shipment_barcode_gaps(array[null]::uuid[]); raise exception 'null id accepted';
 exception when invalid_parameter_value then null; end;
 begin perform public.admin_shipment_barcode_gaps(array(select gen_random_uuid() from generate_series(1,1001))); raise exception 'oversized selection accepted';
 exception when invalid_parameter_value then null; end;
end $$;

-- 표준 양식: 바코드·ERP 코드·ERP 품명 선택 열(최대 16열)을 저장하고 내보낸다. 중복·알 수 없는 키는 거절한다.
select export_columns as original_columns,updated_at as origin_stamp from public.fulfillment_origins where id='00000000-0000-4000-8000-000000042201' \gset
select public.admin_save_origin_export_columns('00000000-0000-4000-8000-000000042201',
 :'original_columns'::jsonb||'[{"key":"variantCode","header":"옵션코드"},{"key":"barcode","header":"바코드"},{"key":"erpCode","header":"ERP 코드"},{"key":"erpName","header":"ERP 품명"}]',
 :'origin_stamp') as optional_stamp \gset
select 1/case when jsonb_array_length(public.admin_shipment_export(array['60000000-0000-4000-8000-000000052801'::uuid])#>'{shipments,0,columns}')=16
 then 1 else 0 end as assert_sixteen_standard_columns_saved;
do $$ declare columns_value jsonb; invalid jsonb; stamp timestamptz; begin
 select export_columns,updated_at into columns_value,stamp from public.fulfillment_origins where id='00000000-0000-4000-8000-000000042201';
 foreach invalid in array array[
  columns_value||'[{"key":"barcode","header":"두 번째 바코드"}]',
  (columns_value-12)||'[{"key":"barcode","header":"두 번째 바코드"}]',
  (columns_value-12)||'[{"key":"erpQty","header":"ERP 수량"}]',
  (columns_value-0)||'[{"key":"barcode","header":"배송건번호 대신"}]'
 ] loop
  begin
   perform public.admin_save_origin_export_columns('00000000-0000-4000-8000-000000042201',invalid,stamp);
   raise exception 'invalid columns accepted: %',invalid;
  exception when check_violation then if sqlerrm<>'invalid_export_columns' then raise; end if;
  end;
 end loop;
end $$;
select public.admin_save_origin_export_columns('00000000-0000-4000-8000-000000042201',:'original_columns',:'optional_stamp');

-- 판매 권한이 없는 계정은 경고 조회도 못 한다.
reset role;
update public.profiles set role='user' where id='00000000-0000-4000-8000-000000052801';
set local role authenticated;
do $$ begin
 perform public.admin_shipment_barcode_gaps(array['60000000-0000-4000-8000-000000052801'::uuid]);
 raise exception 'customer read barcode gaps';
exception when insufficient_privilege then null; end $$;
rollback;
