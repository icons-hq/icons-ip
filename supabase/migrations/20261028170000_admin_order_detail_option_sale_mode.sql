-- 10/27 회의 후속(m27) D5② 랜덤 판매: 어드민 주문 상세 품목에 판매 방식을 싣는다.
-- 운영자는 배정된 옵션을 그대로 보되, 그 옵션이 고객이 고른 것이 아니라 주문 생성 때 DB가 무작위로 배정한 것인지
-- 구분해야 한다(고객 문의·교환 응대). 품목 jsonb에 optionSaleMode = coalesce(order_items.option_sale_mode_snapshot,'select')를
-- 더한다. 고객 은닉(restrictive RLS·my_order_items 마스킹)과 기존 주문 행은 바꾸지 않는다.
--
-- 대상은 order_items를 이미 join하는 품목 확장 래퍼(20260910091900에서 만든 private.admin_order_detail_before_custom_inputs)다.
-- public.admin_order_detail(085215 가드)은 jsonb_set으로 품목 키를 보존하므로 바꾸지 않는다.
begin;

do $patch$
declare definition text; anchor text;
begin
 definition:=pg_get_functiondef('private.admin_order_detail_before_custom_inputs(uuid)'::regprocedure);
 anchor:=$old$'preorderSnapshot',item.preorder_snapshot)$old$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'admin_order_detail_items_anchor_changed'; end if;
 execute replace(definition,anchor,$new$'preorderSnapshot',item.preorder_snapshot,'optionSaleMode',coalesce(item.option_sale_mode_snapshot,'select'))$new$);
end $patch$;

-- 본문만 바꿨다. 기존 계약이 있으면 그대로 다시 등록해 지문을 맞춘다(20261027140000·20261028140000과 같은 방식).
-- 지금 이 래퍼는 등록돼 있지 않아 새로 등록하지 않는다. 진입점 public.admin_order_detail의 계약(sales.read, read)은 그대로다.
do $$declare signature text;fn regprocedure;contract record;registered boolean;begin
 foreach signature in array ARRAY[
  'private.admin_order_detail_before_custom_inputs(uuid)'
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
