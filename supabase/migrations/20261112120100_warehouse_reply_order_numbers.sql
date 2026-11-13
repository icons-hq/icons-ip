-- 10/14 회의 1014-096: 김포 WMS 21열의 `주문번호(쇼핑몰)` 칸을 UUID 대신 16자리 주문번호(orders.order_number)로 내보낸다(앱 변경).
-- 김포 회신 반입이 두 형식을 모두 받게 한다. 11/12 이전에 내려받은 파일의 전체 주문 UUID 회신도 그대로 받는다.
-- 1) private.warehouse_reply_order_id: 회신 주문 식별값 → 주문 id. UUID는 그대로, 숫자 문자열은 orders.order_number와 정확히
--    같은 주문(고유 색인)을 찾는다. 번호의 자리 형식은 orders의 CHECK가 정하므로 여기서는 숫자 10~32자리만 거른다 —
--    주문번호 체계가 바뀌어도(1014-116) 대조는 그대로 동작한다. 접두·끝자리로 넘겨짚지 않는다.
-- 2) public.admin_import_warehouse_tracking_batch: 형식 검사가 주문번호도 받고, 찾지 못한 번호는 그 줄만 shipment_not_found로 남긴다.
--    주문 단위 묶음·행 잠금 순서·합포장 검사·결과 형식은 그대로다.
-- 3) private.prepare_pack_tracking_batch(출고지 경로): 합포장 사전 검사도 같은 해석을 써서 주문번호 회신의 합포장 송장 충돌을
--    잠금 전에 막는다(전에는 UUID가 아니면 조용히 건너뛰었다).
-- 다른 트랙이 같은 함수를 고칠 수 있어 원문 복사 대신 앵커 치환으로 필요한 줄만 바꾼다(앵커는 정확히 한 번 나와야 한다).
begin;

create function private.warehouse_reply_order_id(p_reference text) returns uuid
language sql stable set search_path='' as $$
 select case
  when p_reference ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_reference::uuid
  when p_reference ~ '^[0-9]{10,32}$' then (select purchase.id from public.orders purchase where purchase.order_number=p_reference)
 end
$$;
revoke all on function private.warehouse_reply_order_id(text) from public,anon,authenticated,service_role;

do $patch$
declare definition text; anchor text;
begin
 definition:=pg_get_functiondef('public.admin_import_warehouse_tracking_batch(uuid,jsonb)'::regprocedure);
 anchor:=$old$        or reference_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise invalid_parameter_value using message='invalid_warehouse_order_reference';$old$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'warehouse_reply_reference_check_anchor_changed'; end if;
 definition:=replace(definition,anchor,$new$        or (reference_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and reference_value !~ '^[0-9]{10,32}$') then
        raise invalid_parameter_value using message='invalid_warehouse_order_reference';$new$);
 anchor:=$old$      order_key := reference_value::uuid;$old$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'warehouse_reply_order_key_anchor_changed'; end if;
 execute replace(definition,anchor,$new$      order_key := private.warehouse_reply_order_id(reference_value);
      if order_key is null then raise no_data_found using message='shipment_not_found'; end if;$new$);

 definition:=pg_get_functiondef('private.prepare_pack_tracking_batch(jsonb,uuid)'::regprocedure);
 -- 같은 해석 줄이 두 반복문(잠금 대상 수집·송장 충돌 검사)에 있다. 각각 다음 줄까지 묶어 한 번씩만 나오는 앵커로 바꾼다.
 anchor:=$old$   else select id into strict sid from public.order_shipments where order_id=(row_value->>'reference')::uuid and origin_id=p_origin;end if;
  exception when others then sid:=null;end;
  if sid is not null then ids:=array_append(ids,sid);end if;$old$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'pack_tracking_lock_anchor_changed'; end if;
 definition:=replace(definition,anchor,$new$   else select id into strict sid from public.order_shipments where order_id=private.warehouse_reply_order_id(btrim(row_value->>'reference')) and origin_id=p_origin;end if;
  exception when others then sid:=null;end;
  if sid is not null then ids:=array_append(ids,sid);end if;$new$);
 anchor:=$old$   else select id into strict sid from public.order_shipments where order_id=(row_value->>'reference')::uuid and origin_id=p_origin;end if;
  exception when others then sid:=null;end;
  pack_key:=private.shipment_pack_id(sid);$old$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'pack_tracking_conflict_anchor_changed'; end if;
 execute replace(definition,anchor,$new$   else select id into strict sid from public.order_shipments where order_id=private.warehouse_reply_order_id(btrim(row_value->>'reference')) and origin_id=p_origin;end if;
  exception when others then sid:=null;end;
  pack_key:=private.shipment_pack_id(sid);$new$);
end $patch$;

-- 본문을 바꾼 함수의 기존 계약을 다시 등록한다.
do $$declare signature text;fn regprocedure;contract record;registered boolean;begin
 foreach signature in array ARRAY[
  'public.admin_import_warehouse_tracking_batch(uuid,jsonb)',
  'private.prepare_pack_tracking_batch(jsonb,uuid)'
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
