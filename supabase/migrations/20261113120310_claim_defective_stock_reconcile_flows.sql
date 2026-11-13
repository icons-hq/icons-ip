-- QNA-035(T14b) 재고 대조 흐름 패치. 20261113120000_stock_reconcile_claim_shipments.sql 뒤에 와야 하는 이유: 이 패치가
-- 쓰는 collected CTE의 item_id 열을 그 migration이 추가한다(앞에 두면 앵커/열이 없어 실패한다). 그 뒤 회수 묶음 치환
-- 20261113120300_claim_collection_bundle_stock_flows.sql(T14a)도 같은 함수를 고치므로, 이 파일은 그보다 뒤인 120310에
-- 둔다(트랙 브랜치의 이름 20261113120300을 웨이브 2 통합 5c-1에서 옮김). 앵커(`end as restored` 2회·returned CTE 줄 1회)는
-- T14a 치환 뒤 본문에서도 그대로 맞는다. 앵커 치환이라 흐름의 다른 부분은 그대로다.
begin;

-- 불량으로 고른 품목은 '돌아온 수량'으로 세지 않는다. 판매 재고로 돌아오지 않는 실물이라
-- 세면 대조 목표 수량(target_qty)에 그 수량이 더해져 반영이 불량품을 판매 재고로 되돌린다. 앵커 치환으로 최소 변경한다.
do $patch$
declare definition text; anchor_end text; anchor text; patch text;
begin
  definition := pg_get_functiondef('private.stock_reconcile_flows(uuid[],timestamptz)'::regprocedure);
  -- collected의 두 union 가지(출고지별 회수·레거시 회수)에 클레임 id를 더해, 선택을 '그 클레임의 회수분'에만 건다.
  -- 같은 품목이 교환(V1 회수)된 뒤 반품(불량)돼도 교환 때 돌아온 수량은 그대로 센다.
  anchor_end := E'end as restored\n';
  if (length(definition) - length(replace(definition, anchor_end, ''))) / length(anchor_end) <> 2 then
    raise exception 'stock_reconcile_flows restored anchor must match twice';
  end if;
  definition := replace(definition, anchor_end, E'end as restored,c.id as claim_id\n');
  anchor := E'    from collected c join members m on m.member_id=c.returned_variant_id\n';
  patch := E'    from collected c join members m on m.member_id=c.returned_variant_id\n'
    || E'    where not exists(select 1 from private.claim_defective_stock d join public.order_cancellation_requests dc on dc.id=d.claim_id\n'
    || E'      where d.order_item_id=c.item_id and d.claim_id=c.claim_id and dc.claim_type=\'return\' and dc.stage not in (\'rejected\',\'withdrawn\'))\n';
  if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'stock_reconcile_flows anchor must match once';
  end if;
  execute replace(definition, anchor, patch);
end $patch$;

select private.register_operator_internal_contract('private.stock_reconcile_flows(uuid[],timestamptz)'::regprocedure);

commit;
