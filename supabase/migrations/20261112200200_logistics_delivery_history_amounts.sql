-- 1014-084 "수령인 정보만"(2026-11-11)·물류 착불(2026-11-12 "선결제 배송비·결제 금액·구매자 정보는 계속 비움") 통합 보완.
-- 택배 외 인계 정보 읽기(admin_read_shipment_delivery)의 이력은 주문 관리 권한(sales.manage)이 없으면 방식 변경 근거
-- (customerRequestReference·feeConsentReference)를 빼고 보낸다(20261112140000 4-2절). 그런데 방식 변경 이력의 증거에는
-- 선결제 배송비(shippingFee)와 주문 총액(orderTotal)도 들어 있어(주문 상세의 방식 변경 20260910103635, 발송처리 화면의 방식 적용
-- 20261112130000) 출고 전용 운영자에게 그대로 전달됐다. 같은 기준으로 두 금액도 뺀다. 주문 관리 권한자의 응답은 그대로다.
-- 같은 웨이브 통합으로 물류가 발송처리 화면에서 방식을 적용하게 되어(20261112200000) 이런 이력이 물류 계정에도 생긴다.
begin;

do $patch$
declare
  target constant regprocedure := 'public.admin_read_shipment_delivery(uuid)'::regprocedure;
  body text;
  anchor constant text := $a$operation.evidence-'customerRequestReference'-'feeConsentReference' end$a$;
begin
  body := pg_get_functiondef(target);
  if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'logistics_delivery_history_anchor_changed';
  end if;
  execute replace(body, anchor, $a$operation.evidence-'customerRequestReference'-'feeConsentReference'-'shippingFee'-'orderTotal' end$a$);
end $patch$;

do $contracts$
declare
  fn constant regprocedure := 'public.admin_read_shipment_delivery(uuid)'::regprocedure;
  contract record;
begin
  select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure=fn;
  if not found or contract.capability<>'sales.dispatch' then raise exception 'logistics_delivery_history_contract_baseline_changed'; end if;
  perform private.register_operator_rpc_contract(fn, contract.capability, contract.guard_kind, contract.legacy_admin_only);
  if exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=fn) then
    perform private.register_operator_internal_contract(fn);
  end if;
end $contracts$;

commit;
