-- 1014-084 물류 착불(사용자 결정 2026-11-12 "착불 금액은 보이게 (Recommended)"):
-- 물류출고관리(주문 조회 권한 sales.read 없음)에게도 착불 배송비(배송 건별)·합포장 착불 합계·착불 수납 정보(수납 주체·수납 방법·
-- 고객 안내·착불 환급 문의)는 보이고, 선결제 배송비·주문 총액·품목 금액·결제수단·결제일·구매자 정보는 계속 비운다.
--
-- DB에서 착불 값을 비우던 곳은 합포장 요약(admin_shipment_pack_summaries)의 묶음 착불 합계(collectFee) 하나뿐이다
-- (20261112140000 4절). 목록 행의 shippingFee는 선결제 배송비, 인계 정보의 shippingFee도 선결제 배송비, 표준 출고지시 줄의
-- 제주/도서 추가배송비·배송비 할인은 선결제 배송비의 일부라 그대로 비운다. 배송 건의 착불 배송비·착불 수납 정보는 DB가 원래 비우지
-- 않았고, 표준 양식 파일에서 앱이 비우던 것은 앱(lib/admin/shipment-export-recipient-only.ts)에서 함께 되돌린다.
-- 20261112140000이 넣은 비움 식을 앵커로 찾아 원래 호출로 되돌린다(정확히 한 번). 가드(sales.dispatch)는 그대로다.
begin;

do $patch$
declare
  target constant regprocedure := 'public.admin_shipment_pack_summaries(uuid[])'::regprocedure;
  body text;
  anchor constant text := $a$jsonb_object_agg(id,case when (select public.has_operator_capability('sales.read',false)) then private.shipment_pack_summary(id)
    else private.shipment_pack_summary(id)||'{"collectFee":null}'::jsonb end)$a$;
begin
  body := pg_get_functiondef(target);
  if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'logistics_collect_fee_pack_anchor_changed';
  end if;
  execute replace(body, anchor, $a$jsonb_object_agg(id,private.shipment_pack_summary(id))$a$);
end $patch$;

-- 운영자 계약 지문: 능력·분류·legacy 여부는 등록된 값(sales.dispatch, read) 그대로 다시 적는다.
do $contracts$
declare
  fn constant regprocedure := 'public.admin_shipment_pack_summaries(uuid[])'::regprocedure;
  contract record;
begin
  select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure=fn;
  if not found or contract.capability<>'sales.dispatch' then raise exception 'logistics_collect_fee_contract_baseline_changed'; end if;
  perform private.register_operator_rpc_contract(fn, contract.capability, contract.guard_kind, contract.legacy_admin_only);
  perform private.register_operator_internal_contract(fn);
end $contracts$;

commit;
