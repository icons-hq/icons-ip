-- 10/27 회의 D10②: 출고지시 파일에 옵션의 바코드·ERP 코드·ERP 품명을 싣는다.
-- 1) 출고지시 행(private.admin_shipment_export_before_preorder)의 lines에 barcode·erpCode·erpName을 더한다.
--    값은 주문 시점 스냅샷(private.order_item_external_identity_snapshots)이 우선이고, 스냅샷 값이 비어 있으면
--    (스냅샷 행이 없거나 그 필드가 NULL) 지금 등록된 값(private.goods_variant_external_identity)으로 필드별로 채운다.
--    둘 다 없으면 빈 문자열이다. 스냅샷은 읽기만 한다 — 정산 내보내기(collect_settled_export*)의 원천은 바뀌지 않는다.
--    live 정의는 20261020085140 원문 + 20261020085347의 o.address 치환이므로 원문 복사 대신 앵커 치환으로 고친다.
-- 2) 표준 양식 선택 열에 barcode·erpCode·erpName을 더한다(12~16열). 검증 함수만 넓히고 CHECK 제약은 그대로 쓴다.
-- 3) 내보내기 전 경고용 조회 public.admin_shipment_barcode_gaps: 선택한 배송 건에서 바코드가 비는 옵션 수(바코드 칸이 있는 출고지 양식만).
--    읽기 전용 트랜잭션에서 도는 잠금 없는 STABLE 조회다.
--    출고를 막지 않는다. 기존 주문·스냅샷·출고지 설정은 바꾸지 않는다.
begin;

do $patch$
declare definition text; anchor text;
begin
 definition:=pg_get_functiondef('private.admin_shipment_export_before_preorder(uuid[])'::regprocedure);
 anchor:=$old$'carrier',coalesce(carrier.label,'')) order by i.id)$old$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'shipment_export_identity_projection_anchor_changed'; end if;
 definition:=replace(definition,anchor,$new$'carrier',coalesce(carrier.label,''),
   'barcode',coalesce(identity_snapshot.barcode,identity_live.barcode,''),
   'erpCode',coalesce(identity_snapshot.erp_code,identity_live.erp_code,''),
   'erpName',coalesce(identity_snapshot.erp_name,identity_live.erp_name,'')) order by i.id)$new$);
 anchor:=$old$left join public.goods g on g.id=i.good_id where link.shipment_id=s.id$old$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'shipment_export_identity_join_anchor_changed'; end if;
 execute replace(definition,anchor,$new$left join public.goods g on g.id=i.good_id
   left join private.order_item_external_identity_snapshots identity_snapshot on identity_snapshot.order_item_id=i.id
   left join private.goods_variant_external_identity identity_live on identity_live.variant_id=i.variant_id
   where link.shipment_id=s.id$new$);
end $patch$;

-- 표준 12열 + 선택 열(옵션코드·바코드·ERP 코드·ERP 품명) 최대 16열. 같은 키·같은 헤더는 한 번만 쓴다.
create or replace function private.valid_shipment_export_columns(columns_value jsonb) returns boolean
language sql immutable set search_path='' as $$
 select case when jsonb_typeof(columns_value) is distinct from 'array' then false
 else jsonb_array_length(columns_value) between 12 and 16
   and (select count(distinct value->>'key')=jsonb_array_length(columns_value)
     and count(distinct btrim(value->>'header'))=jsonb_array_length(columns_value)
     and count(*) filter(where value->>'key'=any(array['shipmentId','orderId','recipient','phone','postalCode','address','goodCode','goodName','optionName','qty','deliveryNote','carrier']))=12
     and bool_and(coalesce(jsonb_typeof(value)='object'
       and value->>'key'=any(array['shipmentId','orderId','recipient','phone','postalCode','address','goodCode','goodName','optionName','qty','deliveryNote','carrier','variantCode','barcode','erpCode','erpName'])
       and jsonb_typeof(value->'header')='string' and length(btrim(value->>'header')) between 1 and 80
       and (value->>'header')!~ '[[:cntrl:]]',false))
     from jsonb_array_elements(columns_value)) end;
$$;
revoke all on function private.valid_shipment_export_columns(jsonb) from public,anon,authenticated,service_role;

-- 내보내기 전 경고: 선택한 배송 건의 품목 가운데 출고 파일의 바코드 칸이 비는 옵션 수(옵션 단위로 한 번씩).
-- 출고 파일과 같은 규칙(스냅샷 우선, 비면 지금 값)으로 센다. 옵션이 지워진 품목은 상품·옵션 이름으로 센다.
-- 바코드 칸은 기존 창고 양식으로 받을 때 배송 건 출고지의 양식이 정한다(출고 행 함수와 같은 order_shipments.origin_id 기준):
-- 서원 송장양식은 늘 있고, 표준 양식은 바코드 선택 열을 고른 경우만 있다. 김포 21열에는 없다. 그 밖의 배송 건은 세지 않는다.
-- PostgREST는 STABLE RPC를 POST여도 READ ONLY 트랜잭션에서 실행한다. 잠금(SELECT … FOR SHARE)을 잡는
-- require_operator_capability는 거기서 25006으로 실패하므로, 같은 화면의 다른 조회(admin_search_shipments_console·
-- admin_origin_pending_export_ids)처럼 잠금 없는 판정을 쓴다(리뷰 SEC-DB-1). 경고는 어떤 쓰기도 허락하지 않아
-- 권한 회수와의 잠금 순서 보장(fence)이 필요 없다.
create function public.admin_shipment_barcode_gaps(p_ids uuid[]) returns integer
language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(private.has_operator_capability(auth.uid(),'sales.manage',false),false) then
  raise insufficient_privilege using message='operator_capability_required';
 end if;
 if p_ids is null or cardinality(p_ids)>1000 or array_position(p_ids,null) is not null then
  raise invalid_parameter_value using message='invalid_export_selection';
 end if;
 return (select count(distinct coalesce(i.variant_id::text,i.good_id||'/'||coalesce(i.variant_name_snapshot,'')))
  from public.order_shipment_items link
  join public.order_shipments s on s.id=link.shipment_id
  join public.fulfillment_origins origin on origin.id=s.origin_id
  join public.order_items i on i.id=link.order_item_id
  left join private.order_item_external_identity_snapshots identity_snapshot on identity_snapshot.order_item_id=i.id
  left join private.goods_variant_external_identity identity_live on identity_live.variant_id=i.variant_id
  where link.shipment_id=any(p_ids)
   and (origin.export_template='seowon_xlsx'
    or (origin.export_template='standard' and origin.export_columns @> '[{"key":"barcode"}]'::jsonb))
   and coalesce(identity_snapshot.barcode,identity_live.barcode) is null)::integer;
end $$;
revoke all on function public.admin_shipment_barcode_gaps(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_shipment_barcode_gaps(uuid[]) to authenticated;
select private.register_operator_rpc_contract('public.admin_shipment_barcode_gaps(uuid[])'::regprocedure,'sales.manage','read',false);

-- 본문을 바꾼 함수의 기존 계약만 다시 등록한다(등록되지 않은 private 헬퍼는 그대로 둔다).
do $$declare signature text;fn regprocedure;contract record;begin
 foreach signature in array ARRAY[
  'private.admin_shipment_export_before_preorder(uuid[])',
  'private.valid_shipment_export_columns(jsonb)'
 ] loop
  fn:=signature::regprocedure;
  select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure=fn;
  if found then perform private.register_operator_rpc_contract(fn,contract.capability,contract.guard_kind,contract.legacy_admin_only);
  elsif exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=fn) then
   perform private.register_operator_internal_contract(fn);
  end if;
 end loop;
end $$;

commit;
notify pgrst,'reload schema';
