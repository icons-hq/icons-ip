-- 재고 파일 대조 흐름의 회수 시각을 회수 묶음(배송 건 × 반품지, S36-040) 단위로 센다.
--
-- 한 배송 건이 반품지별 묶음으로 갈리면 묶음마다 다른 날 창고에 도착한다. 배송 건 행(order_claim_collections)은 모든 묶음이
-- 입고된 때에야 회수 완료가 되므로, 그 시각으로 세면 먼저 도착한 묶음의 품목이 그동안 '회수 전'으로 남는다. 그래서 회수한
-- 품목은 그 품목이 든 묶음의 입고 시각(order_claim_collection_bundles.collected_at)에 돌아온 것으로 센다. 묶음 표는 배송 건
-- 행과 같은 열(claim_id·shipment_id·items_snapshot·collected_at)을 가지므로 읽는 표만 바꾼다. 회수 생략·재고 반영 판정은
-- 그대로 배송 건 단위다.
--
-- 이 치환은 배송 건 기준 흐름(웨이브 2 통합 migration 20261113120000_stock_reconcile_claim_shipments)의 본문이 있어야 한다.
-- 그 본문이 없거나 앵커가 사라졌으면 조용히 넘어가지 않고 migration이 멈춘다 — 그래서 이 파일은 20261113120000 뒤
-- (20261113120300)에 둔다(트랙 브랜치의 이름 20261113001400을 웨이브 2 통합 5b에서 옮김).
--
-- 배포 경합 복구: 옛 앱 본문의 회수 확인이 20261113000100의 묶음 backfill·FK 뒤에 실행되면 묶음 없는 배송 건 행이 생기거나
-- 배송 건 행만 입고되고 묶음은 미입고로 남을 수 있다. 묶음 입고 시각을 세는 이 흐름에서 그 반품이 빠지지 않도록
-- (1) 이 migration이 그런 행을 복구하고 (2) 배송 건 행의 입고(UPDATE)가 미입고 묶음 하나뿐인 배송 건의 묶음에 동기화된다.
-- INSERT 트리거는 두지 않는다(승인 스냅샷이 묶음을 나누는 순서를 막는다).
begin;

-- 묶음이 하나뿐이고 미입고인데 배송 건 행이 입고된 배송 건: 입고 열을 묶음에 옮긴다.
create function private.sync_single_collection_bundle_receipt(p_claim uuid,p_shipment uuid) returns void
language sql security definer set search_path='' as $$
 update public.order_claim_collection_bundles b set collected_at=x.collected_at,collected_by=x.collected_by,evidence=x.evidence,received_on=x.received_on,
  return_address_snapshot=case when btrim(b.return_address_snapshot)<>'' then b.return_address_snapshot else x.return_address_snapshot end
 from public.order_claim_collections x
 where x.claim_id=p_claim and x.shipment_id=p_shipment and b.claim_id=x.claim_id and b.shipment_id=x.shipment_id
  and x.collected_at is not null and x.collected_by is not null and x.evidence is not null and b.collected_at is null
  and (btrim(b.return_address_snapshot)<>'' or btrim(x.return_address_snapshot)<>'')
  and (select count(*) from public.order_claim_collection_bundles o where o.claim_id=x.claim_id and o.shipment_id=x.shipment_id)=1;
$$;
revoke all on function private.sync_single_collection_bundle_receipt(uuid,uuid) from public,anon,authenticated,service_role;

create function private.sync_collection_bundle_receipt() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.collected_at is not null and old.collected_at is null then
  perform private.sync_single_collection_bundle_receipt(new.claim_id,new.shipment_id);
 end if;
 return new;
end $$;
revoke all on function private.sync_collection_bundle_receipt() from public,anon,authenticated,service_role;
create trigger order_claim_collections_sync_bundle_receipt after update of collected_at on public.order_claim_collections
 for each row execute function private.sync_collection_bundle_receipt();

-- 복구: 묶음 없는 배송 건 행에는 기본 묶음(backfill과 같은 값), 입고됐는데 미입고로 남은 단일 묶음에는 입고 열을 옮긴다.
insert into public.order_claim_collection_bundles(claim_id,shipment_id,return_address_id,return_name_snapshot,return_address_snapshot,
 return_phone_snapshot,items_snapshot,collected_at,collected_by,evidence,received_on,created_at)
select x.claim_id,x.shipment_id,null,'',x.return_address_snapshot,'',x.items_snapshot,x.collected_at,x.collected_by,x.evidence,x.received_on,
 coalesce(x.collected_at,clock_timestamp())
from public.order_claim_collections x
where not exists(select 1 from public.order_claim_collection_bundles b where b.claim_id=x.claim_id and b.shipment_id=x.shipment_id)
 and jsonb_typeof(x.items_snapshot)='array' and jsonb_array_length(x.items_snapshot)>0
 and (x.collected_at is null or (x.collected_by is not null and x.evidence is not null and btrim(x.return_address_snapshot)<>''));
select private.sync_single_collection_bundle_receipt(x.claim_id,x.shipment_id) from public.order_claim_collections x where x.collected_at is not null;

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
  raise exception 'stock_reconcile_flows has no per-shipment collection CTE (20261113120000 not applied or its anchor changed)';
 end if;
 if occurrences<>1 then raise exception 'stock_reconcile_flows anchor must appear once';end if;
 execute replace(definition,anchor,replacement);
 perform private.register_operator_internal_contract('private.stock_reconcile_flows(uuid[],timestamptz)'::regprocedure)
 where exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure='private.stock_reconcile_flows(uuid[],timestamptz)'::regprocedure);
end $migration$;

commit;
