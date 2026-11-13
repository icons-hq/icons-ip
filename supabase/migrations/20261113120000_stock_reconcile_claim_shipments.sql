-- 재고 파일 대조의 교환 재출고·회수 흐름을 배송 건(출고지) 기준으로 센다(웨이브 2 통합: T07 재고 대조 × T11a·T11b 출고지별
-- 재출고·회수 생략). T07 private.stock_reconcile_flows(20261112160000)는 클레임 단위 열(c.reshipped_at·c.collected_at)을 읽었다.
-- T11a 뒤로 교환 재출고는 배송 건마다 따로 나가고(public.order_claim_reshipments.reshipped_at, 클레임 열은 첫 재출고 시각),
-- 출고지별 회수도 배송 건마다 따로 입고된다(public.order_claim_collections.collected_at, 클레임 열은 회수가 모두 끝난 시각).
-- 클레임 단위로 세면 그 사이의 배송 건 흐름이 기준 시각 앞뒤로 잘못 갈리고, 하자·오배송 교환의 회수 생략 배송 건(창고로
-- 돌아오지 않음)이 회수로 세어진다.
--   · 기준 시각 뒤 출고(교환 재출고): 재출고 품목·그룹 배정이 reshipment_id로 잇는 배송 건 재출고 시각. 이 기능 전 클레임 단위
--     한 쌍(reshipment_id 없음)은 지금처럼 클레임 재출고 시각.
--   · 기준 시각 뒤 회수·회수 뒤 재고 미반영: 출고지별 회수 기록이 있는 클레임은 배송 건마다 그 입고 시각(collected_at)에 그 배송
--     건 품목(items_snapshot 수량)이 돌아온다. 회수 생략 결정이 효력 있는 배송 건(진실원 private.claim_collection_waived)은 뺀다.
--     재고 반영은 교환이면 그 배송 건 재출고 행(한 쌍이면 클레임 재출고), 취소·반품이면 지금처럼 주문 취소·클레임 완료다.
--     출고지별 회수 기록이 없는 레거시 회수는 지금처럼 클레임 회수 시각이고, 배송 건 재출고가 시작된 교환이면 품목마다 그
--     배송 건 재출고 기록으로 재고 반영을 본다.
--   · 회수 기록 없이 재고가 복원된 출고분: 그 품목이 배송 건 회수로 이미 세어졌으면 다시 세지 않는다.
-- 출고 대기·주문 출고·복원 판정은 그대로다. 다른 트랙이 이어 고칠 수 있어 앵커 치환(각 정확히 1회 검사)으로 바꾼다.
begin;

do $do$
declare
 definition text:=pg_get_functiondef('private.stock_reconcile_flows(uuid[],timestamptz)'::regprocedure);
 reship_anchor text:=$a$  ), reshipped as (
    -- 교환 재출고: 재출고 시각에 재고를 빼고 바로 보낸다. 그룹상품 교환은 별도 배정 원장에 남는다.
    select m.holder_id,ri.qty::bigint as qty,c.reshipped_at as left_at
    from public.order_claim_reshipment_items ri
    join public.order_cancellation_requests c on c.id=ri.claim_id
    join members m on m.member_id=ri.variant_id
    where c.reshipped_at is not null
    union all
    select m.holder_id,a.qty::bigint,c.reshipped_at
    from private.group_claim_reshipment_allocations a
    join public.order_cancellation_requests c on c.id=a.claim_id
    join members m on m.member_id=a.target_variant_id
    where c.reshipped_at is not null
$a$;
 reship_replacement text:=$r$  ), reshipped as (
    -- 교환 재출고: 재출고 시각에 재고를 빼고 바로 보낸다. 배송 건(출고지)마다 재출고하면 그 배송 건 재출고 행의 시각이고,
    -- 이 기능 전 클레임 단위 한 쌍(reshipment_id 없음)은 클레임 재출고 시각이다. 그룹상품 교환은 별도 배정 원장에 남는다.
    select m.holder_id,ri.qty::bigint as qty,coalesce(r.reshipped_at,c.reshipped_at) as left_at
    from public.order_claim_reshipment_items ri
    join public.order_cancellation_requests c on c.id=ri.claim_id
    left join public.order_claim_reshipments r on r.id=ri.reshipment_id
    join members m on m.member_id=ri.variant_id
    where coalesce(r.reshipped_at,c.reshipped_at) is not null
    union all
    select m.holder_id,a.qty::bigint,coalesce(r.reshipped_at,c.reshipped_at)
    from private.group_claim_reshipment_allocations a
    join public.order_cancellation_requests c on c.id=a.claim_id
    left join public.order_claim_reshipments r on r.id=a.reshipment_id
    join members m on m.member_id=a.target_variant_id
    where coalesce(r.reshipped_at,c.reshipped_at) is not null
$r$;
 collected_anchor text:=$a$  ), collected as (
    -- 회수한 클레임의 실물(주문 단위 클레임이라 그 주문에서 창고를 떠난 품목 전부). 회수 옵션은 교환 재출고가 끝났으면
    -- 기록된 회수 옵션, 아니면 그 클레임 전의 실물 단위다. 복원 여부: 교환은 재출고, 취소·반품은 주문 취소·완료.
    select c.collected_at,oi.qty::bigint as qty,
      coalesce(
        (select ri.source_variant_id from public.order_claim_reshipment_items ri where ri.claim_id=c.id and ri.order_item_id=oi.id),
        (select a.returned_variant_id from private.group_claim_reshipment_allocations a where a.claim_id=c.id and a.order_item_id=oi.id),
        (select p.variant_id from private.order_item_physical_unit(oi.id) p)) as returned_variant_id,
      case when c.claim_type='exchange' then c.reshipped_at is not null else o.status='canceled' or c.stage='completed' end as restored
    from public.order_cancellation_requests c
    join public.orders o on o.id=c.order_id
    join public.order_items oi on oi.order_id=c.order_id
    where c.collected_at is not null and c.stage not in ('rejected','withdrawn') and oi.id in (select mi.id from member_items mi)
      and (oi.supply_source='stock' or exists(select 1 from private.goods_preorder_reservations r
        where r.order_item_id=oi.id and r.state in ('allocated','returned')))
      and coalesce((select (s.status in ('shipping','delivered') or s.shipped_at is not null) and s.fulfillment_partition<>'digital'
          from public.order_shipment_items si join public.order_shipments s on s.id=si.shipment_id where si.order_item_id=oi.id),
        o.shipped_at is not null)
$a$;
 collected_replacement text:=$r$  ), collected as (
    -- 회수한 클레임의 실물. 출고지별 회수 기록이 있는 클레임은 배송 건마다 그 입고 시각에 그 배송 건 품목이 돌아온다.
    -- 회수 생략 결정이 효력 있는 배송 건(private.claim_collection_waived)은 창고로 돌아오지 않으므로 뺀다. 회수 옵션은 교환
    -- 재출고가 끝났으면 기록된 회수 옵션, 아니면 그 클레임 전의 실물 단위다. 복원 여부: 교환은 회수품을 복원한 그 배송 건 재출고
    -- 행(회수 생략으로 보낸 재출고는 복원하지 않았다, 이 기능 전 클레임 단위 한 쌍이면 클레임 재출고), 취소·반품은 주문 취소·완료.
    select x.collected_at,(j->>'qty')::bigint as qty,oi.id as item_id,
      coalesce(
        (select ri.source_variant_id from public.order_claim_reshipment_items ri where ri.claim_id=c.id and ri.order_item_id=oi.id limit 1),
        (select a.returned_variant_id from private.group_claim_reshipment_allocations a where a.claim_id=c.id and a.order_item_id=oi.id limit 1),
        (select p.variant_id from private.order_item_physical_unit(oi.id) p)) as returned_variant_id,
      case when c.claim_type='exchange' then exists(select 1 from public.order_claim_reshipments r where r.claim_id=c.id and r.shipment_id=x.shipment_id
            and not r.collection_waived)
          or (c.reshipped_at is not null and not exists(select 1 from public.order_claim_reshipments r where r.claim_id=c.id))
        else o.status='canceled' or c.stage='completed' end as restored
    from public.order_claim_collections x
    join public.order_cancellation_requests c on c.id=x.claim_id
    join public.orders o on o.id=c.order_id
    cross join lateral jsonb_array_elements(x.items_snapshot) j
    join public.order_items oi on oi.id=(j->>'orderItemId')::uuid and oi.order_id=c.order_id
    where x.collected_at is not null and c.stage not in ('rejected','withdrawn')
      and not private.claim_collection_waived(x.claim_id,x.shipment_id)
      and oi.id in (select mi.id from member_items mi)
      and (oi.supply_source='stock' or exists(select 1 from private.goods_preorder_reservations r
        where r.order_item_id=oi.id and r.state in ('allocated','returned')))
    union all
    -- 출고지별 회수 기록이 없는 클레임(레거시 회수): 주문 단위 클레임이라 그 주문에서 창고를 떠난 품목 전부가 클레임 회수
    -- 시각에 돌아온다. 교환 재고 반영은 그 품목의 배송 건 재출고 기록(배송 건 재출고가 시작된 클레임), 아니면 클레임 재출고다.
    select c.collected_at,oi.qty::bigint as qty,oi.id,
      coalesce(
        (select ri.source_variant_id from public.order_claim_reshipment_items ri where ri.claim_id=c.id and ri.order_item_id=oi.id limit 1),
        (select a.returned_variant_id from private.group_claim_reshipment_allocations a where a.claim_id=c.id and a.order_item_id=oi.id limit 1),
        (select p.variant_id from private.order_item_physical_unit(oi.id) p)) as returned_variant_id,
      case when c.claim_type<>'exchange' then o.status='canceled' or c.stage='completed'
        when exists(select 1 from public.order_claim_reshipments r where r.claim_id=c.id) then
          exists(select 1 from public.order_claim_reshipment_items ri where ri.claim_id=c.id and ri.order_item_id=oi.id and ri.reshipment_id is not null)
          or exists(select 1 from private.group_claim_reshipment_allocations a where a.claim_id=c.id and a.order_item_id=oi.id and a.reshipment_id is not null)
        else c.reshipped_at is not null end as restored
    from public.order_cancellation_requests c
    join public.orders o on o.id=c.order_id
    join public.order_items oi on oi.order_id=c.order_id
    where c.collected_at is not null and c.stage not in ('rejected','withdrawn') and oi.id in (select mi.id from member_items mi)
      and not exists(select 1 from public.order_claim_collections x where x.claim_id=c.id)
      and (oi.supply_source='stock' or exists(select 1 from private.goods_preorder_reservations r
        where r.order_item_id=oi.id and r.state in ('allocated','returned')))
      and coalesce((select (s.status in ('shipping','delivered') or s.shipped_at is not null) and s.fulfillment_partition<>'digital'
          from public.order_shipment_items si join public.order_shipments s on s.id=si.shipment_id where si.order_item_id=oi.id),
        o.shipped_at is not null)
$r$;
 guard_anchor text:=$a$      and not exists(select 1 from public.order_cancellation_requests c where c.order_id=r.order_id
        and c.collected_at is not null and c.stage not in ('rejected','withdrawn'))
  )
$a$;
 guard_replacement text:=$r$      and not exists(select 1 from public.order_cancellation_requests c where c.order_id=r.order_id
        and c.collected_at is not null and c.stage not in ('rejected','withdrawn'))
      -- 배송 건 회수로 이미 센 품목은 복원 시각에 다시 세지 않는다(클레임 회수 완료 전의 출고지별 입고).
      and not exists(select 1 from collected cc where cc.item_id=r.item_id)
  )
$r$;
begin
 if (length(definition)-length(replace(definition,reship_anchor,'')))/length(reship_anchor)<>1
  or (length(definition)-length(replace(definition,collected_anchor,'')))/length(collected_anchor)<>1
  or (length(definition)-length(replace(definition,guard_anchor,'')))/length(guard_anchor)<>1 then
  raise exception 'stock_reconcile_flows anchors must appear once';
 end if;
 execute replace(replace(replace(definition,reship_anchor,reship_replacement),collected_anchor,collected_replacement),guard_anchor,guard_replacement);
end $do$;
revoke all on function private.stock_reconcile_flows(uuid[],timestamptz) from public,anon,authenticated,service_role;

-- 재정의한 함수에 등록된 운영자 계약이 있으면 새 본문·ACL로 다시 적는다(분류는 기존 행 그대로).
do $$declare fn regprocedure:='private.stock_reconcile_flows(uuid[],timestamptz)'::regprocedure;contract record;begin
 select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure=fn;
 if found then perform private.register_operator_rpc_contract(fn,contract.capability,contract.guard_kind,contract.legacy_admin_only);
 elsif exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=fn) then
  perform private.register_operator_internal_contract(fn);
 end if;
end $$;

commit;
