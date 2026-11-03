-- 10/27 회의 MD-0026: 상품 목록 판매상태 필터에서 판매중지와 품절을 나눈다(관리자 필터만, 고객 화면은 둘 다 '품절' 그대로).
-- goods.stock='soldout'은 운영자가 판매상태를 판매중지로 바꾼 값이고, 지금까지 p_stock='soldout'은
-- "판매중지 또는 사용 옵션 할당 재고 0"을 한꺼번에 찾았다(정의 20260928051726).
--   stopped      = 판매중지: goods.stock='soldout' (수량과 무관)
--   out_of_stock = 품절: 판매중지가 아닌데 사용 옵션 할당 재고(activeStockQty)가 0
--   soldout      = 둘 다(저장된 주소·홈 요약 호환용으로 그대로 받는다)
-- ok·low는 activeStockQty>0이라 stopped·out_of_stock·ok·low가 서로 겹치지 않는다.
-- 목록·엑셀 내보내기(admin_search_goods_console·admin_goods_console_export_candidates)와 구 작업공간 RPC가
-- 모두 private.admin_goods_workspace_matches 하나로 p_stock을 검증·판정하므로 이 함수만 고친다.
-- 본문을 통째로 다시 쓰지 않고 현재 정의(pg_get_functiondef)에서 두 곳만 치환한다. 앵커가 바뀌었으면 실패한다.
begin;

do $patch$
declare definition text; anchor text; replacement text; patch record;
begin
 definition:=pg_get_functiondef('private.admin_goods_workspace_matches(text,text,text,text,uuid,text)'::regprocedure);
 for patch in select * from (values
  ('values',
   $old$p_stock not in ('all','ok','low','soldout')$old$,
   $new$p_stock not in ('all','ok','low','soldout','stopped','out_of_stock')$new$),
  ('predicate',
   $old$where case p_stock when 'soldout' then (item).stock='soldout' or (decision->>'activeStockQty')::bigint=0$old$,
   $new$where case p_stock when 'stopped' then (item).stock='soldout'
      when 'out_of_stock' then (item).stock<>'soldout' and (decision->>'activeStockQty')::bigint=0
      when 'soldout' then (item).stock='soldout' or (decision->>'activeStockQty')::bigint=0$new$)
 ) supplied(name,old_text,new_text) loop
  anchor:=patch.old_text; replacement:=patch.new_text;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
   raise exception 'goods_list_stock_filter_anchor_changed: %',patch.name;
  end if;
  definition:=replace(definition,anchor,replacement);
 end loop;
 execute definition;
end $patch$;

-- create or replace는 ACL·STABLE·SECURITY DEFINER를 유지하지만 계약(postgres 전용)을 다시 봉인한다.
revoke all on function private.admin_goods_workspace_matches(text,text,text,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.admin_goods_workspace_matches(text,text,text,text,uuid,text) to postgres;

-- 등록된 계약이 있으면 새 본문으로 다시 등록한다(없으면 아무것도 하지 않는다).
do $$declare fn regprocedure:='private.admin_goods_workspace_matches(text,text,text,text,uuid,text)'::regprocedure;contract record;begin
 select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure=fn;
 if found then perform private.register_operator_rpc_contract(fn,contract.capability,contract.guard_kind,contract.legacy_admin_only);
 elsif exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=fn) then
  perform private.register_operator_internal_contract(fn);
 end if;
end $$;

commit;
notify pgrst,'reload schema';
