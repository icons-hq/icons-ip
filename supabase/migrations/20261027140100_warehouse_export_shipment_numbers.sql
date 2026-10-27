-- 10/14 회의 A6·A2: 출고지시와 서원 회신 대조가 16자리 배송건번호와 내보낼 때 정한 받는분성명 접미사를 쓴다.
-- 1) 출고지시 응답의 배송 건마다 주문번호·배송건번호를 싣는다(서원 원형 양식의 덧붙인 열·이름 접미사 순서).
-- 2) 서원 원형 양식을 내보낼 때 정한 이름 접미사(김영생01·02 등)를 배송 건별로 그 내보내기 묶음과 함께 기록한다.
--    접미사는 그 파일 안에서만 정해지므로(같은 받는 분의 배송 건 수·합포장) 회신 대조는 순위가 아니라 이 기록과 정확히 맞춘다.
--    같은 배송 건을 다시 내보내면 마지막 내보내기의 접미사로 바뀐다. 기록은 출고지시 전달 표시와 같은 트랜잭션에서 남는다.
-- 3) 서원 회신 후보에 배송건번호·기록된 접미사·합포장 구성을 실어, 회신에 남은 번호로 정확히 대조하고 접미사를 기록과
--    맞추며 합포장 구성원이 빠지거나 송장이 갈린 묶음은 그 묶음만 사람에게 넘긴다. 기존 선택·검증·잠금은 그대로다.
begin;

create table private.seowon_export_labels (
  shipment_id uuid primary key references public.order_shipments(id) on delete cascade,
  export_batch uuid not null,
  recipient_suffix text not null check (recipient_suffix ~ '^([0-9]{2,3})?$'),
  recorded_by uuid not null,
  recorded_at timestamptz not null default clock_timestamp()
);
create index seowon_export_labels_batch on private.seowon_export_labels(export_batch);
alter table private.seowon_export_labels enable row level security;
revoke all on private.seowon_export_labels from public,anon,authenticated,service_role;

-- 출고지시 전달 표시(admin_mark_shipments_exported)와 서원 접미사 기록을 한 트랜잭션으로 묶는다.
-- 표시가 실패하면 기록도 남지 않는다. 라벨은 이번에 표시하는 서원 출고지 배송 건만 받는다.
create function public.admin_mark_seowon_shipments_exported(target_versions jsonb,target_batch uuid,target_labels jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare actor uuid; total integer;
begin
  actor:=private.require_operator_capability('sales.manage',false);
  if target_batch is null or jsonb_typeof(target_labels) is distinct from 'array' or jsonb_array_length(target_labels) not between 1 and 1000
    or jsonb_typeof(target_versions) is distinct from 'array'
    or exists(select 1 from jsonb_array_elements(target_labels) label where jsonb_typeof(label)<>'object'
      or label->>'shipmentId' is null or label->>'shipmentId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(label->'suffix')<>'string' or label->>'suffix' !~ '^([0-9]{2,3})?$')
    or (select count(distinct lower(label->>'shipmentId')) from jsonb_array_elements(target_labels) label)<>jsonb_array_length(target_labels)
    or exists(select 1 from jsonb_array_elements(target_labels) label where not exists(
      select 1 from jsonb_array_elements(target_versions) version where lower(version->>'id')=lower(label->>'shipmentId'))) then
    raise invalid_parameter_value using message='invalid_seowon_export_labels';
  end if;
  if exists(select 1 from jsonb_array_elements(target_labels) label
    left join public.order_shipments s on s.id=(label->>'shipmentId')::uuid
    left join public.fulfillment_origins origin on origin.id=s.origin_id
    where s.id is null or origin.export_template is distinct from 'seowon_xlsx') then
    raise check_violation using message='invalid_seowon_export_labels';
  end if;
  total:=public.admin_mark_shipments_exported(target_versions);
  insert into private.seowon_export_labels(shipment_id,export_batch,recipient_suffix,recorded_by)
  select (label->>'shipmentId')::uuid,target_batch,label->>'suffix',actor from jsonb_array_elements(target_labels) label
  on conflict(shipment_id) do update set export_batch=excluded.export_batch,recipient_suffix=excluded.recipient_suffix,
    recorded_by=excluded.recorded_by,recorded_at=clock_timestamp();
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.shipment.seowon_labels_recorded','seowon_export:'||target_batch,
    jsonb_build_object('shipments',jsonb_array_length(target_labels),'suffixed',(select count(*) from jsonb_array_elements(target_labels) label where label->>'suffix'<>'')));
  return total;
end $$;
revoke all on function public.admin_mark_seowon_shipments_exported(jsonb,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_mark_seowon_shipments_exported(jsonb,uuid,jsonb) to authenticated;
select private.register_operator_rpc_contract('public.admin_mark_seowon_shipments_exported(jsonb,uuid,jsonb)'::regprocedure,'sales.manage','write',false);

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
 execute replace(definition,anchor,$new$jsonb_build_object('id',c.id,'shipmentNumber',c.shipment_number,
   'seowonLabel',(select jsonb_build_object('batch',l.export_batch,'suffix',l.recipient_suffix) from private.seowon_export_labels l where l.shipment_id=c.id),
   'pack',(select jsonb_build_object('id',pack.summary->>'id','shipmentIds',pack.summary->'shipmentIds')
     from (select private.shipment_pack_summary(c.id) summary) pack where pack.summary is not null),
   'orderId',c.order_id,'status',c.status,$new$);
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
