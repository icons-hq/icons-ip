-- 상품 조회/수정의 '품절 보기'·'소량 재고 보기'에 건수를 붙인다.
-- 전시상태 건수(statusCounts)는 전시상태 조건만 빼고 센다. 재고 건수(stockCounts)도 같은 규칙으로 재고 조건만 빼고 센다.
-- 그래서 카드 숫자는 그 카드를 눌렀을 때의 목록 총 개수와 같다.
--   out_of_stock = 판매중지가 아닌데 사용 옵션 할당 재고(activeStockQty)가 0
--   low          = 판매상태(goods.stock)가 '소량 재고'이고 사용 옵션 할당 재고가 1개 이상
-- 소량 재고에는 수량 임계치가 없다. goods.stock은 운영자가 상품 수정·엑셀에서 고르는 값이고, 수량으로 바꾸는 트리거도 없다.
-- 옵션별 안전재고 기준(goods_variants.low_stock_threshold)은 별도의 부족 경고이며 이 필터와 건수에 들어가지 않는다.
--
-- 재고 조건의 판정을 private.admin_goods_stock_filter_matches 하나로 모은다. 목록·엑셀 내보내기·구 작업공간 RPC가 쓰는
-- private.admin_goods_workspace_matches와 건수가 같은 판정을 쓰므로 둘이 어긋날 수 없다.
-- 평가는 지금처럼 한 번이다. 판매 준비 판정은 재고 조건과 무관하게 후보 전부에 대해 이미 돌고 있어 재고 조건을 뒤로 옮겨도 비용이 늘지 않는다.
-- 본문을 통째로 다시 쓰지 않고 현재 정의(pg_get_functiondef)에서 앵커만 치환한다. 앵커가 바뀌었으면 실패한다.
begin;

create function private.admin_goods_stock_filter_matches(p_stock text,p_good_stock text,p_active_stock_qty bigint)
returns boolean language sql immutable set search_path='' as $$
  select case p_stock
    when 'stopped' then p_good_stock='soldout'
    when 'out_of_stock' then p_good_stock<>'soldout' and p_active_stock_qty=0
    when 'soldout' then p_good_stock='soldout' or p_active_stock_qty=0
    when 'ok' then p_good_stock='ok' and p_active_stock_qty>0
    when 'low' then p_good_stock='low' and p_active_stock_qty>0
    else true end
$$;
revoke all on function private.admin_goods_stock_filter_matches(text,text,bigint) from public,anon,authenticated,service_role;
grant execute on function private.admin_goods_stock_filter_matches(text,text,bigint) to postgres;

do $patch$
declare target record; definition text; anchor text; replacement text; patch record;
begin
 for target in select * from (values
  ('private.admin_goods_workspace_matches(text,text,text,text,uuid,text)'),
  ('public.admin_search_goods_console(text,text,text,text,uuid,text,integer,integer,jsonb)')
 ) supplied(signature) loop
  definition:=pg_get_functiondef(target.signature::regprocedure);
  for patch in select * from (values
   ('private.admin_goods_workspace_matches(text,text,text,text,uuid,text)','stock_predicate',
    $old$where case p_stock when 'stopped' then (item).stock='soldout'
      when 'out_of_stock' then (item).stock<>'soldout' and (decision->>'activeStockQty')::bigint=0
      when 'soldout' then (item).stock='soldout' or (decision->>'activeStockQty')::bigint=0
      when 'ok' then (item).stock='ok' and (decision->>'activeStockQty')::bigint>0
      when 'low' then (item).stock='low' and (decision->>'activeStockQty')::bigint>0 else true end$old$,
    $new$where private.admin_goods_stock_filter_matches(p_stock,(item).stock,(decision->>'activeStockQty')::bigint)$new$),
   ('public.admin_search_goods_console(text,text,text,text,uuid,text,integer,integer,jsonb)','stock_validation',
    $old$raise invalid_parameter_value using message = 'invalid_goods_console_status';
  end if;$old$,
    $new$raise invalid_parameter_value using message = 'invalid_goods_console_status';
  end if;
  if p_stock is null or p_stock not in ('all','ok','low','soldout','stopped','out_of_stock') then
    raise invalid_parameter_value using message = 'invalid_goods_workspace_filter';
  end if;$new$),
   ('public.admin_search_goods_console(text,text,text,text,uuid,text,integer,integer,jsonb)','scope',
    $old$with scope as materialized (
    select * from private.admin_goods_console_matches(p_query,p_ip_id,'all',p_stock,p_category_id,p_readiness,p_filters)
  ), matched as materialized (
    select * from scope where case p_status$old$,
    $new$with universe as materialized (
    select * from private.admin_goods_console_matches(p_query,p_ip_id,'all','all',p_category_id,p_readiness,p_filters)
  ), scope as (
    select * from universe where private.admin_goods_stock_filter_matches(p_stock,(good).stock,(readiness->>'activeStockQty')::bigint)
  ), status_scope as materialized (
    select * from universe where case p_status$new$),
   ('public.admin_search_goods_console(text,text,text,text,uuid,text,integer,integer,jsonb)','matched',
    $old$else (good).archived_at is null end
  ), ordered as ($old$,
    $new$else (good).archived_at is null end
  ), matched as materialized (
    select * from status_scope where private.admin_goods_stock_filter_matches(p_stock,(good).stock,(readiness->>'activeStockQty')::bigint)
  ), ordered as ($new$),
   ('public.admin_search_goods_console(text,text,text,text,uuid,text,integer,integer,jsonb)','stock_counts',
    $old$'archived',count(*) filter(where (good).archived_at is not null)) from scope),$old$,
    $new$'archived',count(*) filter(where (good).archived_at is not null)) from scope),
    'stockCounts',(select jsonb_build_object(
      'out_of_stock',count(*) filter(where private.admin_goods_stock_filter_matches('out_of_stock',(good).stock,(readiness->>'activeStockQty')::bigint)),
      'low',count(*) filter(where private.admin_goods_stock_filter_matches('low',(good).stock,(readiness->>'activeStockQty')::bigint))) from status_scope),$new$)
  ) supplied(signature,name,old_text,new_text) where supplied.signature=target.signature loop
   anchor:=patch.old_text; replacement:=patch.new_text;
   if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'goods_console_stock_counts_anchor_changed: %',patch.name;
   end if;
   definition:=replace(definition,anchor,replacement);
  end loop;
  execute definition;
 end loop;
end $patch$;

-- create or replace는 ACL을 유지하지만 계약을 다시 봉인한다.
revoke all on function private.admin_goods_workspace_matches(text,text,text,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.admin_goods_workspace_matches(text,text,text,text,uuid,text) to postgres;
revoke all on function public.admin_search_goods_console(text,text,text,text,uuid,text,integer,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_search_goods_console(text,text,text,text,uuid,text,integer,integer,jsonb) to authenticated;

-- 등록된 계약이 있으면 새 본문·ACL로 다시 등록한다(없으면 아무것도 하지 않는다).
do $$declare fn regprocedure;contract record;begin
 foreach fn in array array['private.admin_goods_workspace_matches(text,text,text,text,uuid,text)'::regprocedure,
   'public.admin_search_goods_console(text,text,text,text,uuid,text,integer,integer,jsonb)'::regprocedure] loop
  select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure=fn;
  if found then perform private.register_operator_rpc_contract(fn,contract.capability,contract.guard_kind,contract.legacy_admin_only);
  elsif exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=fn) then
   perform private.register_operator_internal_contract(fn);
  end if;
 end loop;
end $$;

commit;
notify pgrst,'reload schema';
