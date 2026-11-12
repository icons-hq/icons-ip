-- QNA-035(T14b) 재고 대조 흐름 패치. 20261113001500_claim_defective_stock.sql 다음에 와야 하는 이유: 재고 대조 흐름
-- (stock_reconcile_flows)은 20261113120000_stock_reconcile_claim_shipments.sql이 통째로 다시 정의하므로, 그보다 먼저 적용하면
-- 그 재정의가 이 패치를 지운다. 그래서 이 파일은 그 migration 뒤에 둔다(앵커 치환이라 흐름의 다른 부분은 그대로다).
begin;

-- 불량으로 고른 품목은 '돌아온 수량'으로 세지 않는다. 판매 재고로 돌아오지 않는 실물이라
-- 세면 대조 목표 수량(target_qty)에 그 수량이 더해져 반영이 불량품을 판매 재고로 되돌린다. 앵커 치환으로 최소 변경한다.
do $patch$
declare definition text; anchor text; patch text;
begin
  definition := pg_get_functiondef('private.stock_reconcile_flows(uuid[],timestamptz)'::regprocedure);
  anchor := E'    from collected c join members m on m.member_id=c.returned_variant_id\n';
  patch := E'    from collected c join members m on m.member_id=c.returned_variant_id\n'
    || E'    where not exists(select 1 from private.claim_defective_stock d join public.order_cancellation_requests dc on dc.id=d.claim_id\n'
    || E'      where d.order_item_id=c.item_id and dc.stage not in (\'rejected\',\'withdrawn\'))\n';
  if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'stock_reconcile_flows anchor must match once';
  end if;
  execute replace(definition, anchor, patch);
end $patch$;

select private.register_operator_internal_contract('private.stock_reconcile_flows(uuid[],timestamptz)'::regprocedure);

commit;
