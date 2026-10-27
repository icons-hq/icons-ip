-- 10/14 회의 A3a·S7: 발송 지연 안내의 배송 건을 16자리 배송건번호로 적고, 고객 메일에는
-- 출고지 이름을 싣지 않는다. 이미 준비된 안내의 본문(message_body)은 고객에게 고지된 기록이라
-- 다시 쓰지 않는다. 새로 준비하는 안내부터 번호로 적고, 메일 작업은 주문번호와 번호만 있는
-- 배송 건 표기를 함께 낸다. 어드민이 보는 배송 건 표기(shipment_labels)는 출고지 이름을 유지한다.
begin;

do $patch$
declare definition text; anchor text; replacement text;
begin
 definition:=pg_get_functiondef('public.admin_prepare_order_delay_notice(uuid,uuid[],text,text,date)'::regprocedure);
 anchor:=$old$select array_agg(origin_name_snapshot||' · '||upper(right(id::text,8)) order by id) into labels from public.order_shipments where id=any(g.shipment_ids);$old$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'delay_notice_label_anchor_changed'; end if;
 replacement:=$new$select array_agg(origin_name_snapshot||' · '||coalesce(shipment_number,upper(right(id::text,8))) order by id) into labels from public.order_shipments where id=any(g.shipment_ids);$new$;
 definition:=replace(definition,anchor,replacement);
 anchor:=$old$(select string_agg(upper(right(x::text,8)),', ' order by x) from unnest(g.shipment_ids[1:3])x)$old$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'delay_notice_body_anchor_changed'; end if;
 replacement:=$new$(select string_agg(coalesce(s.shipment_number,upper(right(s.id::text,8))),', ' order by s.id) from public.order_shipments s where s.id=any(g.shipment_ids[1:3]))$new$;
 execute replace(definition,anchor,replacement);

 definition:=pg_get_functiondef('public.claim_order_delay_email_jobs(integer)'::regprocedure);
 anchor:=$old$'orderId',c.order_id,$old$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'delay_email_order_anchor_changed'; end if;
 definition:=replace(definition,anchor,anchor||$new$'orderNumber',(select o.order_number from public.orders o where o.id=c.order_id),$new$);
 anchor:=$old$'shipmentLabels',c.shipment_labels$old$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'delay_email_label_anchor_changed'; end if;
 execute replace(definition,anchor,$new$'shipmentLabels',(select coalesce(array_agg(coalesce(s.shipment_number,upper(right(s.id::text,8))) order by s.id),'{}'::text[])
   from public.order_shipments s where s.id=any(c.shipment_ids))$new$);

 -- 주문 상세 타임라인: 감사 기록의 trigger(예: T3 자동 발주확인 'auto_order_confirmation')를 판독기가 함께 낸다.
 definition:=pg_get_functiondef('private.admin_order_detail_before_preorder(uuid)'::regprocedure);
 anchor:=$old$'body',case when a.action='admin.order.note' then a.diff->>'body' end)$old$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'order_timeline_trigger_anchor_changed'; end if;
 execute replace(definition,anchor,$new$'body',case when a.action='admin.order.note' then a.diff->>'body' end,'trigger',a.diff->>'trigger')$new$);
end $patch$;

-- 본문만 바꿨다. 기존 권한 계약은 그대로 다시 등록해 지문을 맞춘다.
do $$declare signature text;fn regprocedure;contract record;registered boolean;begin
 foreach signature in array ARRAY[
  'public.admin_prepare_order_delay_notice(uuid,uuid[],text,text,date)',
  'public.claim_order_delay_email_jobs(integer)',
  'private.admin_order_detail_before_preorder(uuid)'
 ] loop
  fn:=signature::regprocedure;registered:=false;
  select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure=fn;
  if found then perform private.register_operator_rpc_contract(fn,contract.capability,contract.guard_kind,contract.legacy_admin_only);registered:=true; end if;
  if exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=fn) then
   perform private.register_operator_internal_contract(fn);registered:=true;
  end if;
  if not registered and signature like 'public.admin_%' then raise exception 'operational_rpc_contract_missing: %',signature; end if;
 end loop;
end $$;

commit;
notify pgrst,'reload schema';
