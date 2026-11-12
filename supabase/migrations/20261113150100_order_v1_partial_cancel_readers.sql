-- 재고 부족 부분 취소(ADR-0032 보완 2026-11-13) — 출고·거래확정 엑셀·배분 화면이 얼린 버전 1 배분 원장을 버전 2 원장과 같은 모양으로 읽는다.
--
-- 앞 migration(20261113150000)의 불변 배분 원장 읽기(private.order_price_allocation_ledger = 버전 2 원장 ∪ 얼린 버전 1 원장)를 잇는다.
-- 버전 1 원장은 첫 부분 취소 시작 때만 생기므로, 부분 취소를 시작한 적 없는 버전 1 주문의 출고 파일·거래확정 수집·배분 입력은
-- 이 migration 전과 한 글자도 다르지 않다(원장 행이 없어 같은 분기를 탄다).
--  * 출고지시 표준 양식·배송 목록 내보내기: 부분 취소가 있는 버전 1 주문의 품목 금액·할인액이 남은 몫이다(얼린 배분 − 취소분).
--    전에는 할인 없는 버전 1 주문이 '단가 × 주문 수량'을, 할인 있는 주문은 빈칸(앱이 공통 배분으로 채움)을 냈다.
--  * 거래확정 엑셀 수집: 품목 배분(allocation)을 얼린 원장에서 싣는다 — 앱이 버전 2와 같은 경로로 남은 몫을 계산한다.
--  * 배분 화면 입력(주문 상세·상품주문 조회·출고 양식 보충): 얼린 원장이 있으면 그 값을 싣는다(앱이 다시 계산하지 않는다).
begin;

create function private.t12c_patch_function(p_function regprocedure, p_pairs text[]) returns void
language plpgsql set search_path = '' as $$
declare definition text := pg_get_functiondef(p_function); i integer;
begin
  if array_length(p_pairs, 1) is null or array_length(p_pairs, 1) % 2 <> 0 then raise exception 't12c patch pairs'; end if;
  for i in 1 .. array_length(p_pairs, 1) / 2 loop
    if (length(definition) - length(replace(definition, p_pairs[2 * i - 1], ''))) / length(p_pairs[2 * i - 1]) <> 1 then
      raise exception '% anchor % must appear once', p_function, i;
    end if;
    definition := replace(definition, p_pairs[2 * i - 1], p_pairs[2 * i]);
  end loop;
  execute definition;
end $$;

-- 1. 출고지시 표준 양식: 줄 금액의 배분 원장(버전 2 누락 검사는 그대로 버전 2 원장만 본다).
select private.t12c_patch_function('public.admin_smartstore_shipment_export(uuid[])'::regprocedure, array[
$a$      ) item on item.line_number=line.ordinality
      left join private.order_price_allocations allocation on allocation.order_item_id=item.id and allocation.order_id=purchase.id$a$,
$a$      ) item on item.line_number=line.ordinality
      left join private.order_price_allocation_ledger allocation on allocation.order_item_id=item.id and allocation.order_id=purchase.id$a$
]);

-- 2. 배송 목록 내보내기: 같은 줄 금액.
select private.t12c_patch_function('public.admin_delivery_list_export_lines(uuid[])'::regprocedure, array[
$a$address
    left join private.order_price_allocations allocation on allocation.order_item_id=item.id and allocation.order_id=purchase.id$a$,
$a$address
    left join private.order_price_allocation_ledger allocation on allocation.order_item_id=item.id and allocation.order_id=purchase.id$a$
]);

-- 3. 거래확정 엑셀 수집: 품목 배분.
select private.t12c_patch_function('private.collect_settled_export_for_search(date,date,text,text,text)'::regprocedure, array[
$a$from private.order_price_allocations allocation where allocation.order_item_id=item.id and allocation.order_id=o.id$a$,
$a$from private.order_price_allocation_ledger allocation where allocation.order_item_id=item.id and allocation.order_id=o.id$a$
]);

-- 4. 배분 화면 입력.
select private.t12c_patch_function('public.admin_order_item_allocation_inputs(uuid[])'::regprocedure, array[
$a$left join private.order_price_allocations a on a.order_item_id=i.id and a.order_id=o.id$a$,
$a$left join private.order_price_allocation_ledger a on a.order_item_id=i.id and a.order_id=o.id$a$
]);

do $$declare fn regprocedure; contract record; begin
  foreach fn in array array[
    'public.admin_smartstore_shipment_export(uuid[])'::regprocedure,
    'public.admin_delivery_list_export_lines(uuid[])'::regprocedure,
    'private.collect_settled_export_for_search(date,date,text,text,text)'::regprocedure,
    'public.admin_order_item_allocation_inputs(uuid[])'::regprocedure] loop
    select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure = fn;
    if found then perform private.register_operator_rpc_contract(fn, contract.capability, contract.guard_kind, contract.legacy_admin_only);
    elsif exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure = fn) then
      perform private.register_operator_internal_contract(fn);
    end if;
  end loop;
end $$;

drop function private.t12c_patch_function(regprocedure, text[]);

commit;
notify pgrst, 'reload schema';
