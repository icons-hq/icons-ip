-- 10/14 회의 A6·A2: 출고지시와 서원 회신 대조가 16자리 배송건번호를 쓴다.
-- 출고지시 응답의 배송 건마다 주문번호·배송건번호를 싣고(서원 원형 양식의 덧붙인 열·이름 접미사 순서),
-- 서원 회신 후보에도 배송건번호를 실어 회신에 남은 번호로 정확히 대조한다. 기존 선택·검증·잠금은 그대로다.
begin;

do $patch$
declare definition text; anchor text;
begin
 definition:=pg_get_functiondef('public.admin_shipment_export(uuid[])'::regprocedure);
 anchor:=$old$ return result;
end$old$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'shipment_export_numbers_anchor_changed'; end if;
 execute replace(definition,anchor,$new$ return jsonb_set(result,'{shipments}',coalesce((select jsonb_agg(entry.value||jsonb_build_object(
  'shipmentNumber',s.shipment_number,'orderNumber',o.order_number) order by entry.ordinality)
  from jsonb_array_elements(result->'shipments') with ordinality entry(value,ordinality)
  join public.order_shipments s on s.id=(entry.value->>'id')::uuid join public.orders o on o.id=s.order_id),'[]'::jsonb));
end$new$);

 definition:=pg_get_functiondef('public.admin_origin_tracking_candidates(uuid,text[],text[])'::regprocedure);
 anchor:=$old$select s.id,s.order_id,s.status,s.carrier,s.tracking_number,s.shipped_at,a.address$old$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'tracking_candidates_select_anchor_changed'; end if;
 definition:=replace(definition,anchor,$new$select s.id,s.shipment_number,s.order_id,s.status,s.carrier,s.tracking_number,s.shipped_at,a.address$new$);
 anchor:=$old$jsonb_build_object('id',c.id,'orderId',c.order_id,'status',c.status,$old$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'tracking_candidates_projection_anchor_changed'; end if;
 execute replace(definition,anchor,$new$jsonb_build_object('id',c.id,'shipmentNumber',c.shipment_number,'orderId',c.order_id,'status',c.status,$new$);
end $patch$;

do $$declare signature text;fn regprocedure;contract record;registered boolean;begin
 foreach signature in array ARRAY[
  'public.admin_shipment_export(uuid[])',
  'public.admin_origin_tracking_candidates(uuid,text[],text[])'
 ] loop
  fn:=signature::regprocedure;registered:=false;
  select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure=fn;
  if found then perform private.register_operator_rpc_contract(fn,contract.capability,contract.guard_kind,contract.legacy_admin_only);registered:=true; end if;
  if exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=fn) then
   perform private.register_operator_internal_contract(fn);registered:=true;
  end if;
  if not registered then raise exception 'operational_rpc_contract_missing: %',signature; end if;
 end loop;
end $$;

commit;
notify pgrst,'reload schema';
