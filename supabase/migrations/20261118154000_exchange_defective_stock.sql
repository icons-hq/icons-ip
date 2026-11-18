-- 교환 회수 불량 재고(원장 CLM-046, 관련 CLM-045·CAT-091).
--
-- 반품은 환불 확정 전에 품목마다 '판매 재고 복원/불량'을 고르고 불량은 판매 재고에 넣지 않는다(QNA-035,
-- 20261113001500). 교환은 출고지별 재출고(20261112210100)가 회수품(+)을 늘 판매 재고로 되돌려, 하자 교환으로 돌아온
-- 불량품이 다시 팔리는 재고가 됐다. 이 migration은 교환에도 같은 선택을 붙인다.
--
--  * 선택(planned): 그 출고지(배송 건)의 회수를 확인한 뒤·재출고 전에 admin_plan_claim_exchange_defective_stock이
--    회수 품목 중 불량을 고른다(빈 배열 = 모두 정상 재고 복원). 부를 때마다 그 출고지의 결정(claim_exchange_stock_decisions)이
--    남는다. 반품과 같은 원장(private.claim_defective_stock)에 출처 source='exchange'와 배송 건으로 적는다.
--  * 기록(recorded): 재출고(private.record_order_claim_shipment_reshipment)가 같은 거래에서 불량 품목의 회수품(+)을
--    판매 재고로 되돌리지 않고(보낸 옵션 −는 그대로), 그 선택을 원장에 확정한다(재출고 행·처리자·시각). 반품처럼
--    '기록 필요'로 남는 단계가 없다 — 재고가 정해지는 거래가 곧 기록 거래다.
--  * 하자·오배송 교환(reason_type='defect')은 결정 없이 판매 재고로 복원하지 않는다: 회수를 확인한 출고지를
--    재출고하려면 그 출고지의 결정이 있어야 한다(exchange_stock_decision_required). 단순 변심 교환은 결정 없이 지금처럼
--    복원하고, 원하면 같은 선택을 쓴다. 회수 생략 출고지는 회수품이 없어 결정이 필요 없다.
--  * 반품↔교환 전환은 저장된 선택(planned)을 지우는 기존 규칙(QA2 S-T14b-03)에 출고지 결정도 함께 지운다. 사유 정정은
--    선택·결정을 그대로 둔다 — 회수품을 검수한 결과이고 사유(비용 부담)와 무관하다. 둘 다 재출고 뒤에는 막혀 있다.
--  * 원장 목록·옵션별 합계·재고 대조 흐름은 교환 불량도 함께 읽는다(재고 대조는 그 클레임의 회수분을 '돌아온 수량'에서 뺀다).
--  * 이미 재출고된 교환은 소급하지 않는다.
--
-- 기존 함수는 앵커 치환만 쓴다(앵커가 정확히 한 번 나오지 않으면 실패). 바꾼 함수의 운영자 계약은 끝에서 기존 분류 그대로
-- 다시 등록한다(drift 0). 재출고의 클레임 연락처 경로(service_record_order_claim_shipment_reshipment)는 서명·본문을 바꾸지 않는다.
begin;

create function pg_temp.t3_patch(p_function regprocedure, p_pairs text[]) returns void
language plpgsql set search_path = '' as $$
declare definition text := pg_get_functiondef(p_function); i integer;
begin
  if array_length(p_pairs, 1) is null or array_length(p_pairs, 1) % 2 <> 0 then raise exception 't3 patch pairs'; end if;
  for i in 1 .. array_length(p_pairs, 1) / 2 loop
    if (length(definition) - length(replace(definition, p_pairs[2 * i - 1], ''))) / length(p_pairs[2 * i - 1]) <> 1 then
      raise exception '% anchor % must appear once', p_function, i;
    end if;
    definition := replace(definition, p_pairs[2 * i - 1], p_pairs[2 * i]);
  end loop;
  execute definition;
end $$;

-- ---------------------------------------------------------------------------
-- 1. 원장: 출처(반품·교환)와 교환의 배송 건·재출고
-- ---------------------------------------------------------------------------
alter table private.claim_defective_stock
  add column source text not null default 'return' check (source in ('return','exchange')),
  add column shipment_id uuid references public.order_shipments(id) on delete restrict,
  add column reshipment_id uuid references public.order_claim_reshipments(id) on delete restrict,
  add constraint claim_defective_stock_source_fields check (
    (source = 'exchange' or (shipment_id is null and reshipment_id is null))
    and (source <> 'exchange' or (state = 'recorded') = (reshipment_id is not null)));
-- 한 품목은 반품·교환을 거치며 여러 번 회수될 수 있다(교환 불량 기록 뒤 반품 불량). 기록은 클레임마다 한 번이고,
-- 아직 정해지지 않은 선택(planned)은 품목마다 하나뿐이다.
alter table private.claim_defective_stock drop constraint claim_defective_stock_item_once;
alter table private.claim_defective_stock add constraint claim_defective_stock_claim_item unique (claim_id, order_item_id);
create unique index claim_defective_stock_item_planned on private.claim_defective_stock(order_item_id) where state = 'planned';

-- 출처·배송 건도 선택 뒤에 바꾸지 않는다(재출고 행은 기록 때 한 번 적는다).
select pg_temp.t3_patch('private.guard_claim_defective_stock()'::regprocedure, array[
$a$    or new.planned_by <> old.planned_by or new.planned_at <> old.planned_at then$a$,
$a$    or new.planned_by <> old.planned_by or new.planned_at <> old.planned_at
    or new.source <> old.source or new.shipment_id is distinct from old.shipment_id then$a$
]);

-- 교환 출고지마다 '재고 처리를 정했다'는 결정. 불량 품목은 원장의 planned 행이고, 이 행은 '불량 0개(모두 정상 복원)'도
-- 결정으로 남기기 위한 것이다. 하자·오배송 교환의 재출고는 이 행이 있어야 한다. shipment_id가 null이면 배송 건 없는 옛 주문 전체다.
create table private.claim_exchange_stock_decisions (
  claim_id uuid not null references public.order_cancellation_requests(id) on delete restrict,
  shipment_id uuid references public.order_shipments(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  decided_by uuid not null references public.profiles(id) on delete restrict,
  decided_at timestamptz not null,
  constraint claim_exchange_stock_decisions_key unique nulls not distinct (claim_id, shipment_id)
);
alter table private.claim_exchange_stock_decisions enable row level security;
revoke all on private.claim_exchange_stock_decisions from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. 반품 선택 저장: 바뀐 고유 키와 교환 출처를 읽는다
-- ---------------------------------------------------------------------------
-- * 고유 키가 (클레임, 품목)과 '품목당 planned 하나'로 바뀌어 충돌 대상을 지정하지 않는다(어느 키든 충돌하면 아래 건수 검사가 막는다).
-- * 다른 클레임의 기록(recorded)은 이력이다 — 교환 때 불량으로 기록된 품목도 뒤의 반품에서 다시 고를 수 있다.
-- * 낡은 선택: 출처와 클레임 유형이 달라진(전환) 선택만 낡았다. 진행 중인 교환의 선택은 낡지 않았다.
select pg_temp.t3_patch('public.admin_plan_claim_defective_stock(uuid,uuid[])'::regprocedure, array[
$a$    and (c.stage in ('rejected','withdrawn') or c.claim_type <> 'return');$a$,
$a$    and (c.stage in ('rejected','withdrawn') or c.claim_type <> d.source);$a$,
$a$  if exists(select 1 from private.claim_defective_stock d where d.order_item_id = any(ids) and d.claim_id <> p_claim_id) then$a$,
$a$  if exists(select 1 from private.claim_defective_stock d where d.order_item_id = any(ids) and d.claim_id <> p_claim_id and d.state = 'planned') then$a$,
$a$    on conflict (order_item_id) do nothing;$a$,
$a$    on conflict do nothing;$a$
]);

-- ---------------------------------------------------------------------------
-- 3. 교환 선택 저장(출고지마다)
-- ---------------------------------------------------------------------------
-- 회수를 확인했고(회수 생략이 아니고) 아직 재출고하지 않은 출고지에서만 부른다. 빈 배열은 '모두 정상 재고 복원' 결정이다.
-- 잠금 순서는 재출고와 같다(주문 → 배송 건 → 클레임). 클레임 버전(claim_revision)은 올리지 않는다 — 재고 처리는 주소·소포와
-- 무관하고, 재출고는 실행 시점의 결정을 읽는다.
create function public.admin_plan_claim_exchange_defective_stock(p_claim_id uuid, p_shipment_id uuid, p_order_item_ids uuid[])
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare actor uuid; claim public.order_cancellation_requests; ord public.orders; ids uuid[]; target record; item record;
  planned_count integer; target_order uuid; collected boolean; at_value timestamptz := clock_timestamp();
begin
  actor := private.require_operator_capability('sales.manage', false);
  if p_claim_id is null or p_order_item_ids is null or cardinality(p_order_item_ids) > 200 then
    raise invalid_parameter_value using message = 'invalid_defective_stock_plan';
  end if;
  ids := coalesce(array(select distinct x from unnest(p_order_item_ids) x order by x), '{}');
  if exists(select 1 from unnest(ids) x where x is null) then raise invalid_parameter_value using message = 'invalid_defective_stock_plan'; end if;
  select c.order_id into target_order from public.order_cancellation_requests c where c.id = p_claim_id;
  if not found then raise no_data_found using message = 'claim_not_found'; end if;
  select * into ord from public.orders where id = target_order for update;
  perform 1 from public.order_shipments where order_id = target_order order by id for update;
  select * into claim from public.order_cancellation_requests where id = p_claim_id for update;
  if not found or claim.order_id <> target_order then raise sqlstate 'PT409' using message = 'defective_stock_plan_conflict'; end if;
  if claim.claim_type <> 'exchange' then raise check_violation using message = 'defective_stock_exchange_only'; end if;
  -- 재출고할 수 있는 단계(보류 중이면 보류 전 단계)의 교환만. 이 기능 전의 클레임 단위 재출고 기록이 있으면 닫힌 교환이다.
  if not (claim.stage in ('collecting','collected') or (claim.stage = 'on_hold' and claim.held_from in ('collecting','collected')))
    or ord.status = 'canceled' or claim.reship_tracking_number is not null
    or exists(select 1 from private.group_claim_reshipment_receipts r where r.claim_id = p_claim_id)
    or exists(select 1 from public.order_claim_reshipment_items ri where ri.claim_id = p_claim_id and ri.reshipment_id is null) then
    raise check_violation using message = 'defective_stock_claim_closed';
  end if;
  select * into target from private.claim_reshipment_targets(p_claim_id) t where t.shipment_id is not distinct from p_shipment_id;
  if not found then raise check_violation using message = 'reshipment_shipment_not_found'; end if;
  -- 재출고한 출고지는 재고가 정해졌다.
  if exists(select 1 from public.order_claim_reshipments r where r.claim_id = p_claim_id and r.shipment_id is not distinct from p_shipment_id) then
    raise check_violation using message = 'defective_stock_claim_closed';
  end if;
  -- 회수 생략이 효력 있는 출고지는 회수품이 창고로 오지 않는다(재출고도 회수품을 복원하지 않는다).
  if p_shipment_id is not null and private.claim_collection_waived(p_claim_id, p_shipment_id) then
    raise check_violation using message = 'exchange_defective_collection_waived';
  end if;
  collected := case when target.collection_tracked then target.collected_at is not null else claim.collected_at is not null end;
  if not collected then raise check_violation using message = 'exchange_defective_not_collected'; end if;
  if exists(select 1 from unnest(ids) x where not (x = any(target.item_ids))) then
    raise check_violation using message = 'defective_stock_item_not_in_order';
  end if;
  -- 불량 수량은 재출고가 회수품으로 되돌릴 수량(살아 있는 수량)이다. 남은 수량이 없는 품목은 고를 수 없다.
  if exists(select 1 from unnest(ids) x where coalesce(private.order_item_active_qty(x), 0) <= 0) then
    raise check_violation using message = 'defective_stock_item_fully_canceled';
  end if;
  delete from private.claim_defective_stock d using public.order_cancellation_requests c
  where c.id = d.claim_id and d.state = 'planned' and d.order_item_id = any(ids) and d.claim_id <> p_claim_id
    and (c.stage in ('rejected','withdrawn') or c.claim_type <> d.source);
  if exists(select 1 from private.claim_defective_stock d where d.order_item_id = any(ids) and d.claim_id <> p_claim_id and d.state = 'planned') then
    raise unique_violation using message = 'defective_stock_item_in_other_claim';
  end if;
  delete from private.claim_defective_stock d where d.claim_id = p_claim_id and d.state = 'planned'
    and d.order_item_id = any(target.item_ids) and not (d.order_item_id = any(ids));
  for item in select oi.id, private.order_item_active_qty(oi.id) as qty from public.order_items oi where oi.id = any(ids) order by oi.id loop
    insert into private.claim_defective_stock(claim_id, order_item_id, qty, planned_by, source, shipment_id)
    values (p_claim_id, item.id, item.qty, actor, 'exchange', p_shipment_id)
    on conflict do nothing;
  end loop;
  select count(*) into planned_count from private.claim_defective_stock d
  where d.claim_id = p_claim_id and d.state = 'planned' and d.source = 'exchange' and d.order_item_id = any(target.item_ids);
  if planned_count <> cardinality(ids) then raise sqlstate 'PT409' using message = 'defective_stock_plan_conflict'; end if;
  insert into private.claim_exchange_stock_decisions(claim_id, shipment_id, order_id, decided_by, decided_at)
  values (p_claim_id, p_shipment_id, claim.order_id, actor, at_value)
  on conflict on constraint claim_exchange_stock_decisions_key do update set decided_by = excluded.decided_by, decided_at = excluded.decided_at;
  insert into public.audit_log(actor_id, action, target, diff) values (actor, 'admin.order.claim_defective_stock_planned', 'order:' || claim.order_id::text,
    jsonb_build_object('claimId', p_claim_id, 'claimType', 'exchange', 'shipmentId', p_shipment_id, 'originName', target.origin_name,
      'orderItemIds', to_jsonb(ids),
      'restoredOrderItemIds', to_jsonb(array(select x from unnest(target.item_ids) x where not (x = any(ids)) order by x))));
  return jsonb_build_object('claimId', p_claim_id, 'shipmentId', p_shipment_id, 'planned', planned_count, 'decided', true);
end $$;

-- 운영 상세(reshipmentTargets[].stockDecision): 출고지의 재고 처리 결정과 불량 품목.
create function private.claim_exchange_stock_decision_json(p_claim uuid, p_shipment uuid, p_item_ids uuid[])
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'required', c.claim_type = 'exchange' and c.reason_type = 'defect',
    'decided', d.claim_id is not null,
    'decidedAt', d.decided_at,
    'decidedByName', (select p.nickname from public.profiles p where p.id = d.decided_by),
    'defectiveOrderItemIds', coalesce((select jsonb_agg(x.order_item_id order by x.order_item_id) from private.claim_defective_stock x
      where x.claim_id = p_claim and x.source = 'exchange' and x.order_item_id = any(p_item_ids)), '[]'::jsonb),
    'recordedOrderItemIds', coalesce((select jsonb_agg(x.order_item_id order by x.order_item_id) from private.claim_defective_stock x
      where x.claim_id = p_claim and x.source = 'exchange' and x.state = 'recorded' and x.order_item_id = any(p_item_ids)), '[]'::jsonb))
  from public.order_cancellation_requests c
  left join private.claim_exchange_stock_decisions d on d.claim_id = c.id and d.shipment_id is not distinct from p_shipment
  where c.id = p_claim;
$$;

select pg_temp.t3_patch('private.claim_reshipment_targets_json(uuid)'::regprocedure, array[
$a$  'productionRequired',exists($a$,
$a$  'stockDecision',private.claim_exchange_stock_decision_json(p_claim,t.shipment_id,t.item_ids),
  'productionRequired',exists($a$
]);

-- ---------------------------------------------------------------------------
-- 4. 재출고: 불량 품목은 회수품을 복원하지 않고 원장에 기록한다
-- ---------------------------------------------------------------------------
-- 재출고 행이 생긴 같은 거래에서 그 출고지의 교환 선택을 기록으로 확정한다. 불량 옵션은 복원됐을 회수 옵션
-- (일반: order_claim_reshipment_items.source_variant_id, 그룹상품: group_claim_reshipment_allocations.returned_variant_id)이다.
create function private.record_claim_exchange_defective_stock(p_claim_id uuid, p_reshipment_id uuid, p_shipment_id uuid, p_actor uuid)
returns integer language plpgsql volatile set search_path = '' as $$
declare row_ private.claim_defective_stock; claim_order uuid; returned_good text; returned_variant uuid; returned_qty integer;
  target_good public.goods; target_variant public.goods_variants; recorded integer := 0;
begin
  select order_id into claim_order from public.order_cancellation_requests where id = p_claim_id;
  for row_ in select d.* from private.claim_defective_stock d
    where d.claim_id = p_claim_id and d.state = 'planned' and d.source = 'exchange'
      and (exists(select 1 from public.order_claim_reshipment_items ri where ri.reshipment_id = p_reshipment_id and ri.order_item_id = d.order_item_id)
        or exists(select 1 from private.group_claim_reshipment_allocations a where a.reshipment_id = p_reshipment_id and a.order_item_id = d.order_item_id))
    order by d.order_item_id for update loop
    returned_good := null; returned_variant := null; returned_qty := null;
    select x.good_id, x.variant_id, x.qty into returned_good, returned_variant, returned_qty from (
      select ri.good_id, ri.source_variant_id as variant_id, ri.qty from public.order_claim_reshipment_items ri
      where ri.reshipment_id = p_reshipment_id and ri.order_item_id = row_.order_item_id
      union all
      select a.returned_good_id, a.returned_variant_id, a.qty from private.group_claim_reshipment_allocations a
      where a.reshipment_id = p_reshipment_id and a.order_item_id = row_.order_item_id) x limit 1;
    -- 선택 때의 수량과 회수품 수량이 다르면 선택이 낡았다. 재출고 전체를 되돌리고 다시 고르게 한다.
    if returned_qty is distinct from row_.qty then raise sqlstate 'PT409' using message = 'defective_stock_plan_conflict'; end if;
    select * into target_good from public.goods where id = returned_good;
    select * into target_variant from public.goods_variants where id = returned_variant;
    update private.claim_defective_stock set state = 'recorded', good_id = returned_good, variant_id = returned_variant,
      good_name = target_good.name, variant_name = target_variant.name, variant_code = target_variant.code,
      reshipment_id = p_reshipment_id, recorded_by = p_actor, recorded_at = clock_timestamp()
    where id = row_.id;
    insert into public.audit_log(actor_id, action, target, diff) values (p_actor, 'order.claim_defective_stock_recorded', 'order:' || claim_order::text,
      jsonb_build_object('claimId', p_claim_id, 'claimType', 'exchange', 'orderItemId', row_.order_item_id, 'goodId', returned_good,
        'variantId', returned_variant, 'qty', row_.qty, 'reshipmentId', p_reshipment_id, 'shipmentId', p_shipment_id, 'physicalStockDelta', 0));
    recorded := recorded + 1;
  end loop;
  return recorded;
end $$;

select pg_temp.t3_patch('private.record_order_claim_shipment_reshipment(uuid,uuid,text,text,jsonb,jsonb)'::regprocedure, array[
-- 선언
$a$ stage_before text;completed boolean;now_at timestamptz;title text;body text;$a$,
$a$ stage_before text;completed boolean;now_at timestamptz;title text;body text;defective_ids uuid[]:='{}';defective_recorded integer;$a$,
-- 결정 확인과 불량 품목: 품목 검사 뒤, 회수 생략 결정 기록·재출고 행 생성 전.
$a$ if exists(select 1 from jsonb_array_elements(selections) s where not((s->>'orderItemId')::uuid=any(target.item_ids))) then
  raise check_violation using message='invalid reshipment items';end if;$a$,
$a$ if exists(select 1 from jsonb_array_elements(selections) s where not((s->>'orderItemId')::uuid=any(target.item_ids))) then
  raise check_violation using message='invalid reshipment items';end if;
 -- 교환 회수 불량 재고(CLM-046): 회수품을 복원하는 재출고는 그 출고지에서 고른 불량 품목을 복원하지 않는다. 하자·오배송 교환은
 -- 출고지의 재고 처리 결정(불량 분리 또는 정상 복원)이 있어야 재출고한다. 회수 생략 재출고는 회수품이 없어 남은 선택을 지운다.
 if not waived then
  defective_ids:=array(select d.order_item_id from private.claim_defective_stock d where d.claim_id=p_claim_id and d.state='planned'
   and d.source='exchange' and d.order_item_id=any(target.item_ids) order by d.order_item_id);
  if claim.reason_type='defect' and not exists(select 1 from private.claim_exchange_stock_decisions sd
   where sd.claim_id=p_claim_id and sd.shipment_id is not distinct from p_shipment_id) then
   raise check_violation using message='exchange_stock_decision_required';end if;
 else
  delete from private.claim_defective_stock d where d.claim_id=p_claim_id and d.state='planned' and d.order_item_id=any(target.item_ids);
 end if;$a$,
-- 일반 상품: 불량 품목의 회수품(+)을 빼고 상쇄한다.
$a$    select good_id,source_variant_id variant_id,qty::bigint delta from public.order_claim_reshipment_items where reshipment_id=record_id and not waived$a$,
$a$    select good_id,source_variant_id variant_id,qty::bigint delta from public.order_claim_reshipment_items where reshipment_id=record_id and not waived
     and not(order_item_id=any(defective_ids))$a$,
-- 그룹상품: 불량 품목은 실물 세대 복원 기록을 남기지 않고(회수 생략과 같다) 회수품(+)도 뺀다.
$a$   if not waived then
    insert into private.group_stock_restorations($a$,
$a$   if not waived and not((entry->>'orderItemId')::uuid=any(defective_ids)) then
    insert into private.group_stock_restorations($a$,
$a$   from private.group_claim_reshipment_allocations a where a.reshipment_id=record_id and not waived$a$,
$a$   from private.group_claim_reshipment_allocations a where a.reshipment_id=record_id and not waived and not(a.order_item_id=any(defective_ids))$a$,
-- 재고를 움직인 뒤 같은 거래에서 불량 재고 원장에 기록한다.
$a$ select count(*) into target_count from private.claim_reshipment_targets(p_claim_id);$a$,
$a$ if cardinality(defective_ids)>0 then
  defective_recorded:=private.record_claim_exchange_defective_stock(p_claim_id,record_id,p_shipment_id,actor);
  if defective_recorded<>cardinality(defective_ids) then raise sqlstate 'PT409' using message='defective_stock_plan_conflict';end if;
 end if;
 select count(*) into target_count from private.claim_reshipment_targets(p_claim_id);$a$,
-- 재출고 감사 기록에 불량으로 남긴 품목을 싣는다.
$a$'collectionWaived',waived,'waiverReason',waiver_reason,$a$,
$a$'collectionWaived',waived,'defectiveOrderItemIds',to_jsonb(defective_ids),'waiverReason',waiver_reason,$a$
]);

-- ---------------------------------------------------------------------------
-- 5. 반품↔교환 전환: 출고지 결정도 이전 유형의 것이라 함께 지운다
-- ---------------------------------------------------------------------------
select pg_temp.t3_patch('public.admin_convert_order_claim_type(uuid,uuid,integer,text,text,boolean,jsonb)'::regprocedure, array[
$a$defective_plans_cleared integer:=0;$a$,
$a$defective_plans_cleared integer:=0;stock_decisions_cleared integer:=0;$a$,
$a$ get diagnostics defective_plans_cleared=row_count;$a$,
$a$ get diagnostics defective_plans_cleared=row_count;
 -- 교환 회수 불량 재고(CLM-046): 교환 출고지의 재고 처리 결정도 같은 규칙이다. 다시 교환이 되면 결정부터 다시 한다.
 delete from private.claim_exchange_stock_decisions where claim_id=p_claim_id;
 get diagnostics stock_decisions_cleared=row_count;$a$,
$a$'defectivePlanCleared',defective_plans_cleared));$a$,
$a$'defectivePlanCleared',defective_plans_cleared,'stockDecisionCleared',stock_decisions_cleared));$a$
]);

-- ---------------------------------------------------------------------------
-- 6. 읽기: 재고 대조 흐름·원장 목록이 교환 불량도 읽는다
-- ---------------------------------------------------------------------------
-- 재고 대조: 불량으로 고른 회수분은 '돌아온 수량'으로 세지 않는다. 반품 선택은 반품 클레임, 교환 선택은 교환 클레임의 회수분에만 건다.
select pg_temp.t3_patch('private.stock_reconcile_flows(uuid[],timestamptz)'::regprocedure, array[
$a$dc.claim_type='return'$a$,
$a$dc.claim_type=d.source$a$
]);

-- 원장 목록의 최근 기록에 출처(반품·교환)를 싣는다. 옵션별 합계·옵션별 불량 수량은 기록된 행을 모두 세므로 그대로 교환 불량을 포함한다.
select pg_temp.t3_patch('public.admin_list_defective_stock(integer)'::regprocedure, array[
$a$'recordedAt', d.recorded_at, 'recordedByName', coalesce(p.nickname, '')) as row$a$,
$a$'recordedAt', d.recorded_at, 'recordedByName', coalesce(p.nickname, ''), 'claimType', d.source) as row$a$
]);

-- ---------------------------------------------------------------------------
-- 7. 권한과 운영자 계약
-- ---------------------------------------------------------------------------
revoke all on function public.admin_plan_claim_exchange_defective_stock(uuid,uuid,uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.admin_plan_claim_exchange_defective_stock(uuid,uuid,uuid[]) to authenticated;
revoke all on function private.claim_exchange_stock_decision_json(uuid,uuid,uuid[]) from public, anon, authenticated, service_role;
revoke all on function private.record_claim_exchange_defective_stock(uuid,uuid,uuid,uuid) from public, anon, authenticated, service_role;
select private.register_operator_rpc_contract('public.admin_plan_claim_exchange_defective_stock(uuid,uuid,uuid[])'::regprocedure, 'sales.manage', 'write', false);

-- 재정의한 함수의 등록된 계약을 새 본문·ACL로 다시 적는다(분류는 기존 행 그대로).
do $$declare fn regprocedure; contract record; begin
  foreach fn in array array[
    'private.guard_claim_defective_stock()'::regprocedure,
    'public.admin_plan_claim_defective_stock(uuid,uuid[])'::regprocedure,
    'private.claim_reshipment_targets_json(uuid)'::regprocedure,
    'private.record_order_claim_shipment_reshipment(uuid,uuid,text,text,jsonb,jsonb)'::regprocedure,
    'public.admin_convert_order_claim_type(uuid,uuid,integer,text,text,boolean,jsonb)'::regprocedure,
    'private.stock_reconcile_flows(uuid[],timestamptz)'::regprocedure,
    'public.admin_list_defective_stock(integer)'::regprocedure] loop
    select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure = fn;
    if found then perform private.register_operator_rpc_contract(fn, contract.capability, contract.guard_kind, contract.legacy_admin_only);
    elsif exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure = fn) then
      perform private.register_operator_internal_contract(fn);
    end if;
  end loop;
end $$;

commit;
notify pgrst, 'reload schema';
