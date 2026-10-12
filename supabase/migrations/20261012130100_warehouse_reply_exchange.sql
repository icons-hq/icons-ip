-- 창고 회신 등록 (2026-10-12): 남양주(서원) 송장양식 회신과 재업로드 안전장치.

-- 1) 일괄 등록은 이미 발송된 배송 건의 운송장을 바꾸지 않는다. 같은 회신을 다시 올리면 아무것도
--    바꾸지 않고(unchanged), 다른 번호면 거절한다. 정정은 감사 기록을 남기는 운송장 수정 폼
--    (`admin_update_shipment_tracking`)만 한다 — 관리자 가이드의 계약과 같다. 퀵·방문수령 배송 건은
--    기존처럼 택배 경로에서 거절한다.
create or replace function public.admin_import_shipment_tracking(p_reference text,p_carrier text,p_tracking_number text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare reference_key uuid;shipment_key uuid;shipment public.order_shipments;purchase_status public.order_status;
begin
 if (select auth.uid()) is null or not public.is_staff() then raise insufficient_privilege using message='staff required';end if;
 reference_key:=btrim(p_reference)::uuid;
 select id into shipment_key from public.order_shipments where id=reference_key;
 if shipment_key is null then shipment_key:=private.single_order_shipment(reference_key);end if;
 select o.status into purchase_status from public.orders o join public.order_shipments s on s.order_id=o.id where s.id=shipment_key for update of o;
 select * into shipment from public.order_shipments where id=shipment_key for update;
 if shipment.status='ready' then
   perform public.admin_update_shipment_status(shipment.id,'shipping',p_carrier,p_tracking_number);
   return jsonb_build_object('shipmentId',shipment.id,'orderId',shipment.order_id,'dispatched',true);
 end if;
 perform private.lock_parcel_shipment(shipment.id);
 if shipment.status not in ('shipping','delivered') or purchase_status='canceled' then raise check_violation using message='order_not_shipped';end if;
 if shipment.carrier is distinct from nullif(btrim(p_carrier),'') or shipment.tracking_number is distinct from nullif(btrim(p_tracking_number),'') then
   raise check_violation using message='shipment_tracking_conflict';
 end if;
 return jsonb_build_object('shipmentId',shipment.id,'orderId',shipment.order_id,'dispatched',false,'unchanged',true);
end $$;
revoke all on function public.admin_import_shipment_tracking(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_import_shipment_tracking(text,text,text) to authenticated;

-- 2) 서원은 주문번호를 돌려주지 않는다(질문지 D4). 회신 줄은 내려받은 송장양식의 줄 내용으로
--    배송 건을 찾으므로, 출고지의 대조 후보를 내보내기와 같은 스냅샷 값으로 읽는다: 출고지시를
--    전달한(exported_at) 발송 대기 택배 배송 건과, 재업로드를 알아보기 위한 최근 45일 발송 건.
--    아직 전달하지 않은 발송 대기 건은 회신에 있을 수 없으므로 후보가 아니다. 회신의 송장번호가
--    기간과 관계없이 이미 다른 배송 건에 쓰였는지도 함께 돌려준다(예전 회신 재업로드 방지).
--    줄 규칙(전화 표기·품목명)은 앱의 서원 내보내기 한 곳에서만 만든다.
create function public.admin_origin_tracking_candidates(target_origin_id uuid,target_tracking_numbers text[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare origin public.fulfillment_origins;result jsonb;
begin
 if (select auth.uid()) is null or not public.is_staff() then raise insufficient_privilege using message='staff required';end if;
 if target_tracking_numbers is null or cardinality(target_tracking_numbers)>1000 then
   raise invalid_parameter_value using message='invalid_tracking_batch';
 end if;
 select * into origin from public.fulfillment_origins where id=target_origin_id;
 if not found then raise no_data_found using message='warehouse_origin_not_found';end if;
 with candidates as (
  select s.id,s.order_id,s.status,s.carrier,s.tracking_number,o.address
  from public.order_shipments s join public.orders o on o.id=s.order_id
  where s.origin_id=origin.id and s.delivery_method='parcel'
   and ((s.status='ready' and s.exported_at is not null and o.status in ('confirmed','shipping'))
     or (s.status in ('shipping','delivered') and o.status<>'canceled' and s.shipped_at>=now()-interval '45 days'))
  order by s.status<>'ready',s.shipped_at desc nulls first,s.id
  limit 5001
 ), bounded as (select * from candidates limit 5000)
 select jsonb_build_object('originId',origin.id,'template',origin.export_template,'active',origin.is_active,
   'defaultCarrier',origin.default_carrier,'truncated',(select count(*)>5000 from candidates),
   'shipments',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'orderId',c.order_id,'status',c.status,
     'carrier',c.carrier,'trackingNumber',c.tracking_number,
     'lines',coalesce((select jsonb_agg(jsonb_build_object('recipient',coalesce(c.address->>'recipientName',''),
       'phone',coalesce(c.address->>'phone',''),'postalCode',coalesce(c.address->>'postalCode',''),
       'address',concat_ws(' ',c.address->>'address1',nullif(c.address->>'address2','')),
       'goodName',i.good_name_snapshot,'optionName',coalesce(i.variant_name_snapshot,''),'qty',i.qty,
       'deliveryNote',coalesce(c.address->>'deliveryNote','')) order by i.id)
      from public.order_shipment_items link join public.order_items i on i.id=link.order_item_id
      where link.shipment_id=c.id),'[]'))) from bounded c),'[]'),
   'usedTracking',coalesce((select jsonb_agg(jsonb_build_object('trackingNumber',s.tracking_number,'shipmentId',s.id) order by s.tracking_number,s.id)
     from public.order_shipments s where s.carrier=origin.default_carrier and s.tracking_number=any(target_tracking_numbers)),'[]'))
 into result;
 return result;
end $$;
revoke all on function public.admin_origin_tracking_candidates(uuid,text[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_origin_tracking_candidates(uuid,text[]) to authenticated;

-- 3) 출고지별 "새 출고지시 한 번에 내려받기". 목록은 100건씩 보이지만 출고지시는 출고지 단위로
--    한 파일이어야 한다. 내보내기 RPC가 거절할 배송 건(취소 진행·예약 미할당·퀵/방문수령·이미
--    전달)은 미리 뺀다. 김포·서원 파일은 품목 한 줄이 한 행이고 회신 업로드는 1,000줄까지라,
--    한 번에 품목 1,000줄(배송 건 1,000건)까지만 고르고 나머지 수는 함께 알린다.
create function public.admin_origin_pending_export_ids(target_origin_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if (select auth.uid()) is null or not public.is_staff() then raise insufficient_privilege using message='staff required';end if;
 with pending as (
  select s.id,s.created_at,(select count(*) from public.order_shipment_items link where link.shipment_id=s.id) line_count
  from public.order_shipments s join public.orders o on o.id=s.order_id
  where s.origin_id=target_origin_id and s.status='ready' and s.exported_at is null and s.delivery_method='parcel'
   and o.status in ('confirmed','shipping') and private.shipment_preorder_allocation_ready(s.id)
   and not exists(select 1 from public.order_cancellation_requests r where r.order_id=o.id and r.status in ('requested','processing','needs_review'))
   and not exists(select 1 from public.order_cancellation_claims c where c.order_id=o.id)
 ), ordered as (
  select id,created_at,sum(line_count) over(order by created_at,id) running_lines,row_number() over(order by created_at,id) position
  from pending
 )
 select jsonb_build_object(
   'ids',coalesce((select jsonb_agg(id order by created_at,id) from ordered where running_lines<=1000 and position<=1000),'[]'),
   'total',(select count(*) from pending))
 into result;
 return result;
end $$;
revoke all on function public.admin_origin_pending_export_ids(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_origin_pending_export_ids(uuid) to authenticated;
