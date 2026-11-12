-- QA 라운드 1(물류) M2 — 1014-084 사용자 결정 "수령인 정보만"(묶음 14: "물류 계정의 발송 화면·내려받는 파일에서
-- 구매자 닉네임·결제수단·결제일·금액·배송비를 비움. 주매니저 파일은 그대로")과 묶음 21 "착불 금액은 보이게"
-- ("착불 배송비·합포장 착불 합계·수납 방법은 보이고 선결제 배송비·결제 금액·구매자 정보는 계속 비움")를
-- 창고 고유 양식 자료(admin_shipment_export: 김포 21열·서원·일반 양식·배송 운영 안내)에도 적용한다.
--
-- 주문 조회 권한(sales.read)이 없는 출고 전용 운영자에게는 배송 건의 선결제 배송비(shippingFee)와 줄 단가(unitPrice,
-- 김포 21열의 '주문금액/수량')를 비워 보낸다. 수량·수령인·주소·상품·번호, 착불 배송비(shippingCollectFee)·착불 수납 정보
-- (collector)·합포장 요약(pack, 합포장 착불 합계 포함)·선물 표시는 그대로다. 주문 조회 권한이 있으면 응답은 한 글자도 바뀌지 않는다.
-- ICONS 표준 양식(admin_smartstore_shipment_export)은 이 함수를 감싸 쓰므로 같은 값이 비어 오고, 줄의 구매자·결제·품목 금액은
-- 20261112140000의 private.shipment_export_detail_for_reader가 이미 비운다. 앱도 같은 규칙으로 한 번 더 비운다.
begin;

create function private.shipment_export_for_reader(p_result jsonb)
returns jsonb language sql stable set search_path='' as $$
  select case when p_result is null or jsonb_typeof(p_result->'shipments') is distinct from 'array'
      or public.has_operator_capability('sales.read',false) then p_result
    else jsonb_set(p_result,'{shipments}',coalesce((select jsonb_agg(shipment.value||jsonb_build_object('shippingFee',null,
        'lines',coalesce((select jsonb_agg(line.value||'{"unitPrice":null}'::jsonb order by line.ordinality)
          from jsonb_array_elements(case when jsonb_typeof(shipment.value->'lines')='array' then shipment.value->'lines' else '[]'::jsonb end)
            with ordinality line(value,ordinality)),'[]'::jsonb)) order by shipment.ordinality)
      from jsonb_array_elements(p_result->'shipments') with ordinality shipment(value,ordinality)),'[]'::jsonb)) end;
$$;
revoke all on function private.shipment_export_for_reader(jsonb) from public,anon,authenticated,service_role;

-- 같은 함수를 다른 트랙이 고쳐도 겹치지 않도록 마지막 반환 한 줄만 감싼다(앵커는 각각 정확히 한 번).
do $patch$
declare
  target constant regprocedure := 'public.admin_shipment_export(uuid[])'::regprocedure;
  body text;
  open_anchor constant text := $a$ return jsonb_set(result,'{shipments}',coalesce($a$;
  close_anchor constant text := $a$'[]'::jsonb));$a$;
begin
  body := pg_get_functiondef(target);
  if (length(body) - length(replace(body, open_anchor, ''))) / length(open_anchor) <> 1
    or (length(body) - length(replace(body, close_anchor, ''))) / length(close_anchor) <> 1 then
    raise exception 'qa1_logistics_shipment_export_anchor_changed';
  end if;
  body := replace(body, open_anchor, $a$ return private.shipment_export_for_reader(jsonb_set(result,'{shipments}',coalesce($a$);
  body := replace(body, close_anchor, $a$'[]'::jsonb)));$a$);
  execute body;
end $patch$;

-- 운영자 계약 지문: 능력·분류는 그대로 두고 바뀐 본문만 다시 적는다(내부 지문도 함께 갱신된다).
do $contracts$
begin
  if (select count(*) from private.operator_rpc_contracts where signature='public.admin_shipment_export(uuid[])'
      and capability='sales.dispatch' and guard_kind='read' and not legacy_admin_only) <> 1 then
    raise exception 'qa1_logistics_shipment_export_contract_changed';
  end if;
  perform private.register_operator_rpc_contract('public.admin_shipment_export(uuid[])'::regprocedure, 'sales.dispatch', 'read', false);
end $contracts$;
select private.register_operator_internal_contract('private.shipment_export_for_reader(jsonb)'::regprocedure);

commit;
