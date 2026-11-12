-- 재고 파일 대조 흐름의 회수 시각을 회수 묶음(배송 건 × 반품지, S36-040) 단위로 센다.
--
-- 한 배송 건이 반품지별 묶음으로 갈리면 묶음마다 다른 날 창고에 도착한다. 배송 건 행(order_claim_collections)은 모든 묶음이
-- 입고된 때에야 회수 완료가 되므로, 그 시각으로 세면 먼저 도착한 묶음의 품목이 그동안 '회수 전'으로 남는다. 그래서 회수한
-- 품목은 그 품목이 든 묶음의 입고 시각(order_claim_collection_bundles.collected_at)에 돌아온 것으로 센다. 묶음 표는 배송 건
-- 행과 같은 열(claim_id·shipment_id·items_snapshot·collected_at)을 가지므로 읽는 표만 바꾼다. 회수 생략·재고 반영 판정은
-- 그대로 배송 건 단위다.
--
-- 이 치환은 배송 건 기준 흐름(웨이브 2 통합 migration 20261113120000_stock_reconcile_claim_shipments)의 본문이 있어야 한다.
-- 그 migration보다 먼저 적용되는 위치(트랙 구간)에서는 앵커가 아직 없으므로 건너뛰고 알린다 — 통합 때 이 파일을 20261113120000
-- 뒤로 옮긴다(재고 흐름 시험 goods_return_addresses.sql이 옮기지 않으면 실패해 누락을 드러낸다).
begin;

do $migration$
declare definition text:=pg_get_functiondef('private.stock_reconcile_flows(uuid[],timestamptz)'::regprocedure);
 anchor text:=$a$from public.order_claim_collections x
    join public.order_cancellation_requests c on c.id=x.claim_id$a$;
 replacement text:=$a$from public.order_claim_collection_bundles x
    join public.order_cancellation_requests c on c.id=x.claim_id$a$;
 occurrences integer;
begin
 occurrences:=(length(definition)-length(replace(definition,anchor,'')))/length(anchor);
 if occurrences=0 and position('public.order_claim_collection_bundles x' in definition)>0 then
  raise notice 'stock_reconcile_flows already counts collection bundles';
  return;
 end if;
 if occurrences=0 then
  raise notice 'stock_reconcile_flows has no per-shipment collection CTE yet (20261113120000 not applied) — bundle timing deferred';
  return;
 end if;
 if occurrences<>1 then raise exception 'stock_reconcile_flows anchor must appear once';end if;
 execute replace(definition,anchor,replacement);
 perform private.register_operator_internal_contract('private.stock_reconcile_flows(uuid[],timestamptz)'::regprocedure)
 where exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure='private.stock_reconcile_flows(uuid[],timestamptz)'::regprocedure);
end $migration$;

commit;
