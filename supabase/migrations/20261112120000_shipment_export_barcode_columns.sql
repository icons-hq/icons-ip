-- 10/27 회의 1027T-046: 출고지시 ICONS 표준 양식과 김포 WMS 양식에도 옵션의 바코드·ERP 품명 열이 생겼다(앱 변경).
-- 출고 행(private.admin_shipment_export_before_preorder)은 20261028140000부터 barcode·erpName을 싣고 있어 행 RPC는 바꾸지 않는다.
-- 여기서는 내보내기 전 "바코드가 없는 옵션 N개" 경고를 새 바코드 칸에 맞춘다. 경고는 출고를 막지 않는다.
-- 1) public.admin_shipment_barcode_gaps(기존 창고 양식 기준): 김포 21열(wms_csv)도 바코드 칸이 있는 양식으로 센다.
--    서원 송장양식·바코드 선택 열을 고른 일반 표준 양식은 그대로 세고, 바코드 열이 없는 일반 표준 12열만 세지 않는다.
--    다른 트랙이 같은 함수를 고칠 수 있어 원문 복사 대신 앵커 치환으로 판정 한 줄만 바꾼다.
-- 2) public.admin_smartstore_shipment_barcode_gaps(ICONS 표준 양식 기준, 새 함수): 표준 양식은 출고지와 관계없이 모든 행에
--    바코드 칸이 있으므로 출고지 양식으로 거르지 않고 센다. 대상·권한·잠금 없는 STABLE 조회 규칙은 기존 함수와 같다
--    (PostgREST가 STABLE RPC를 READ ONLY 트랜잭션에서 실행하므로 잠금을 잡는 권한 판정을 쓰지 않는다, 리뷰 SEC-DB-1).
--    화면(발주·발송 관리)이 ICONS 표준 양식을 고른 경우 이 함수를 부르게 하는 연결은 화면 작업에서 한다.
begin;

do $patch$
declare definition text; anchor text;
begin
 definition:=pg_get_functiondef('public.admin_shipment_barcode_gaps(uuid[],uuid)'::regprocedure);
 anchor:=$old$where (origin.export_template='seowon_xlsx'$old$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'shipment_barcode_gaps_template_anchor_changed'; end if;
 execute replace(definition,anchor,$new$where (origin.export_template in('seowon_xlsx','wms_csv')$new$);
end $patch$;

create function public.admin_smartstore_shipment_barcode_gaps(p_ids uuid[] default null,p_origin_id uuid default null) returns integer
language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(private.has_operator_capability(auth.uid(),'sales.manage',false),false) then
  raise insufficient_privilege using message='operator_capability_required';
 end if;
 if (p_ids is null)=(p_origin_id is null) or cardinality(p_ids)>1000 or array_position(p_ids,null) is not null then
  raise invalid_parameter_value using message='invalid_export_selection';
 end if;
 -- 대상은 기존 경고와 같다: 고른 배송 건, 또는 출고지의 미전달 발송 대기 택배 건(주문 확정·배송 중).
 -- 같은 옵션은 한 번만 세고, 옵션이 지워진 품목은 상품·옵션 이름으로 센다. 값은 출고 파일과 같은 규칙(스냅샷 우선, 비면 지금 값)이다.
 return (select count(distinct coalesce(i.variant_id::text,i.good_id||'/'||coalesce(i.variant_name_snapshot,'')))
  from (select unnest(p_ids) id where p_origin_id is null
   union all
   select pending.id from public.order_shipments pending join public.orders o on o.id=pending.order_id
   where p_origin_id is not null and pending.origin_id=p_origin_id and pending.status='ready' and pending.exported_at is null
    and pending.delivery_method='parcel' and o.status in('confirmed','shipping')) target
  join public.order_shipment_items link on link.shipment_id=target.id
  join public.order_items i on i.id=link.order_item_id
  left join private.order_item_external_identity_snapshots identity_snapshot on identity_snapshot.order_item_id=i.id
  left join private.goods_variant_external_identity identity_live on identity_live.variant_id=i.variant_id
  where coalesce(identity_snapshot.barcode,identity_live.barcode) is null)::integer;
end $$;
revoke all on function public.admin_smartstore_shipment_barcode_gaps(uuid[],uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_smartstore_shipment_barcode_gaps(uuid[],uuid) to authenticated;
select private.register_operator_rpc_contract('public.admin_smartstore_shipment_barcode_gaps(uuid[],uuid)'::regprocedure,'sales.manage','read',false);

-- 본문을 바꾼 함수의 기존 계약을 다시 등록한다.
do $$declare signature text;fn regprocedure;contract record;registered boolean;begin
 foreach signature in array ARRAY['public.admin_shipment_barcode_gaps(uuid[],uuid)'] loop
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
