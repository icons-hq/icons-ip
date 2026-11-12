-- 교환 재출고를 배송 건(출고지)마다 기록하고, 하자·오배송 교환은 회수 확인 없이 재출고한다
-- (TKT-166·QNA-039, 2026-11-11 사용자 결정 "출고지별 재출고 송장" + "회수 생략 재출고", ADR-0041).
--
-- 확정 동작(원문): "배송 건(출고지)마다 재출고 택배사·송장·품목 기록, 모두 재출고하면 종결, 고객 상세에
-- 송장 여러 개 / 하자·오배송 교환은 사유·근거(사진) 남기면 회수 확인 없이 재출고, 회수품 재고 복원 안 함."
--
-- 모델
-- * public.order_claim_reshipments: (클레임, 배송 건)마다 한 행. 택배사·운송장·재출고 시각·처리자·회수 생략
--   (사유·근거 사진)·배송완료 확인을 따로 남긴다. 배송 건이 아예 없는 옛 주문은 shipment_id가 null인 한 행이
--   주문 전체를 맡는다.
-- * 재출고 대상 배송 건(private.claim_reshipment_targets)은 출고지별 회수 기록(order_claim_collections)이 있으면
--   그 배송 건들, 없으면(레거시 회수·회수 불필요) 품목이 있는 실물 배송 건들이다. 모든 대상이 재출고되면
--   클레임을 종결한다. 그 전에는 단계를 그대로 두고 화면이 '재출고 n/m'으로 보인다.
-- * 재출고 품목 원장(order_claim_reshipment_items·그룹 배정)은 그대로 쓰고 어느 배송 건 재출고인지
--   reshipment_id로 잇는다. 재고는 그 배송 건 품목만 움직인다: 회수품(+)과 보낸 옵션(−). 회수 생략이면
--   보낸 옵션(−)만 빼고 회수품은 복원하지 않는다.
-- * 옛 단일 열(reship_carrier·reship_tracking_number·reshipped_at·reship_delivered_*)은 지난 기록 읽기 호환으로
--   남긴다. 지우거나 덮지 않는다. 새 기록에서 reshipped_at은 첫 배송 건 재출고 시각(재출고 시작)이고, 대상
--   배송 건이 하나뿐인 교환만 같은 거래에서 택배사·운송장·배송완료를 그 열에도 적는다(그 교환은 옛 모델과
--   같은 한 쌍이다). 대상이 둘 이상이면 그 열은 비어 있고 배송 건 행이 진실원이다.
-- * 회수 생략은 판매자 귀책 사유(하자·오배송, reason_type='defect') 교환에서만, 출고지별 회수를 쓰는 클레임의
--   아직 입고되지 않은 배송 건에만 쓴다. 사유 10~500자와 근거 사진 1~5장(20261112210000 원장)이 필요하다.
--   금액 상한은 두지 않는다. 회수 생략한 배송 건은 회수가 끝난 것으로 본다(claim_collections_complete).
-- * 진입점: 재출고는 최종 주소 확인(10분 결속)을 거치는 service_record_order_claim_shipment_reshipment가 배송
--   건마다 받는다. 옛 service_record_order_claim_reshipment_v2·admin_record_order_claim_reshipment·
--   admin_record_order_claim_reshipment_delivery는 대상 배송 건이 하나인 교환에서만 동작하게 감싼다.
begin;

-- ---------------------------------------------------------------------------
-- 1. 배송 건별 재출고 표
-- ---------------------------------------------------------------------------
create table public.order_claim_reshipments(
 id uuid primary key default extensions.gen_random_uuid(),
 claim_id uuid not null references public.order_cancellation_requests(id) on delete restrict,
 order_id uuid not null references public.orders(id) on delete restrict,
 shipment_id uuid,
 origin_name_snapshot text,
 carrier text not null references public.shipping_carriers(code) on delete restrict,
 tracking_number text not null,
 reshipped_at timestamptz not null,
 reshipped_by uuid not null references public.profiles(id) on delete restrict,
 selections jsonb not null default '[]'::jsonb,
 collection_waived boolean not null default false,
 waiver_reason text,
 waiver_evidence_file_ids uuid[],
 delivered_at timestamptz,
 delivered_by uuid references public.profiles(id) on delete restrict,
 delivery_evidence text,
 constraint order_claim_reshipments_shipment_fkey foreign key(order_id,shipment_id) references public.order_shipments(order_id,id) on delete restrict,
 constraint order_claim_reshipments_claim_shipment_key unique nulls not distinct(claim_id,shipment_id),
 constraint order_claim_reshipments_tracking_check check(tracking_number~'^[A-Z0-9]{8,30}$'),
 constraint order_claim_reshipments_selections_check check(jsonb_typeof(selections)='array'),
 constraint order_claim_reshipments_waiver_check check(
  (not collection_waived and waiver_reason is null and waiver_evidence_file_ids is null)
  or(collection_waived and waiver_reason=btrim(waiver_reason) and char_length(waiver_reason) between 10 and 500
   and translate(waiver_reason,E'\n\r\t','')!~'[[:cntrl:]]'
   and cardinality(waiver_evidence_file_ids) between 1 and 5 and array_position(waiver_evidence_file_ids,null) is null)),
 constraint order_claim_reshipments_delivery_check check(
  (delivered_at is null and delivered_by is null and delivery_evidence is null)
  or(delivered_at is not null and delivered_by is not null and delivered_at>=reshipped_at
   and delivery_evidence=btrim(delivery_evidence) and char_length(delivery_evidence) between 1 and 500
   and translate(delivery_evidence,E'\n\r\t','')!~'[[:cntrl:]]'))
);
create index order_claim_reshipments_order_idx on public.order_claim_reshipments(order_id,reshipped_at);
alter table public.order_claim_reshipments enable row level security;
-- 고객·운영 화면은 보안 정의 RPC로만 읽는다. 처리자·회수 생략 사유·배송완료 근거는 운영 정보다.
revoke all on public.order_claim_reshipments from public,anon,authenticated,service_role;

-- 재출고 품목 원장 → 배송 건 재출고 연결. 이 migration 전 기록(클레임당 한 쌍)은 null로 남는다.
alter table public.order_claim_reshipment_items add column reshipment_id uuid references public.order_claim_reshipments(id) on delete restrict;
create index order_claim_reshipment_items_reshipment_idx on public.order_claim_reshipment_items(reshipment_id) where reshipment_id is not null;
alter table private.group_claim_reshipment_allocations add column reshipment_id uuid references public.order_claim_reshipments(id) on delete restrict;
create index group_claim_reshipment_allocations_reshipment_idx on private.group_claim_reshipment_allocations(reshipment_id) where reshipment_id is not null;
-- 그룹 배정은 클레임당 한 장이던 영수증(group_claim_reshipment_receipts)에 매달려 있었다. 배송 건 재출고는 그 영수증
-- 대신 배송 건 행에 매달린다. 영수증 행·불변 이력은 그대로 두고 외래 키만 클레임으로 넓힌다.
alter table private.group_claim_reshipment_allocations drop constraint group_claim_reshipment_allocations_claim_id_fkey;
alter table private.group_claim_reshipment_allocations add constraint group_claim_reshipment_allocations_claim_id_fkey
 foreign key(claim_id) references public.order_cancellation_requests(id) on delete restrict;

-- 최종 주소 확인 기록도 배송 건 재출고마다 남는다(작업 id가 식별자). 옛 기록은 클레임당 하나다.
alter table private.order_claim_reshipment_destinations add column reshipment_id uuid references public.order_claim_reshipments(id) on delete restrict;
alter table private.order_claim_reshipment_destinations drop constraint order_claim_reshipment_destinations_pkey;
alter table private.order_claim_reshipment_destinations drop constraint order_claim_reshipment_destinations_operation_id_key;
alter table private.order_claim_reshipment_destinations add constraint order_claim_reshipment_destinations_pkey primary key(operation_id);
create unique index order_claim_reshipment_destinations_legacy_claim on private.order_claim_reshipment_destinations(claim_id) where reshipment_id is null;
create unique index order_claim_reshipment_destinations_reshipment on private.order_claim_reshipment_destinations(reshipment_id) where reshipment_id is not null;
create index order_claim_reshipment_destinations_claim_idx on private.order_claim_reshipment_destinations(claim_id,confirmed_at);

-- ---------------------------------------------------------------------------
-- 2. 대상 배송 건과 판정 도우미
-- ---------------------------------------------------------------------------
create function private.claim_reshipment_targets(p_claim uuid)
returns table(shipment_id uuid,origin_id uuid,origin_name text,collection_tracked boolean,collected_at timestamptz,item_ids uuid[])
language sql stable set search_path='' as $$
 with claim as (select c.order_id,(c.collection_policy='origin' and c.collection_required) tracked
  from public.order_cancellation_requests c where c.id=p_claim and c.claim_type='exchange'),
 shipped as (select s.id,s.origin_id,s.origin_name_snapshot from public.order_shipments s join claim on s.order_id=claim.order_id
  where s.delivery_method<>'digital' and exists(select 1 from public.order_shipment_items l where l.shipment_id=s.id))
 select x.shipment_id,x.origin_id,x.origin_name_snapshot,true,x.collected_at,
  array(select distinct (j->>'orderItemId')::uuid from jsonb_array_elements(x.items_snapshot) j order by 1)
 from public.order_claim_collections x cross join claim where x.claim_id=p_claim and claim.tracked
 union all
 select s.id,s.origin_id,s.origin_name_snapshot,false,null::timestamptz,
  array(select l.order_item_id from public.order_shipment_items l where l.shipment_id=s.id order by 1)
 from shipped s cross join claim where not claim.tracked
 union all
 select null::uuid,null::uuid,null::text,false,null::timestamptz,array(select i.id from public.order_items i where i.order_id=claim.order_id order by 1)
 from claim where not claim.tracked and not exists(select 1 from shipped)
  and exists(select 1 from public.order_items i where i.order_id=claim.order_id);
$$;

-- 종결된 교환의 교환품 배송완료 확인이 아직 남았는가. 배송 건 기록이 있으면 그 기록 전부, 없으면 옛 단일 열을 본다.
create function private.claim_reshipment_delivery_pending(p_claim public.order_cancellation_requests)
returns boolean language sql stable set search_path='' as $$
 select p_claim.claim_type='exchange' and p_claim.stage='completed' and case
  when exists(select 1 from public.order_claim_reshipments r where r.claim_id=p_claim.id)
   then exists(select 1 from public.order_claim_reshipments r where r.claim_id=p_claim.id and r.delivered_at is null)
  else p_claim.reshipped_at is null or p_claim.reship_carrier is null or p_claim.reship_tracking_number is null
   or p_claim.reship_delivered_at is null or p_claim.reship_delivered_by is null or p_claim.reship_delivery_evidence is null
 end;
$$;

-- 재전송 판정. 그룹 배정 경로는 요청한 선택 전체가 같아야 하고(옛 그룹 영수증과 같다), 단일 상품 경로는
-- 보낸 선택이 기록된 품목과 맞으면 같은 요청이다(옛 클레임 단위 재생과 같다).
create function private.claim_reshipment_selections_match(p_record public.order_claim_reshipments,p_selections jsonb)
returns boolean language sql stable set search_path='' as $$
 select case when exists(select 1 from private.group_claim_reshipment_allocations a where a.reshipment_id=p_record.id)
  then p_record.selections=p_selections
  else not exists(select 1 from jsonb_array_elements(p_selections) s where not exists(
   select 1 from public.order_claim_reshipment_items r where r.reshipment_id=p_record.id
    and r.order_item_id=(s->>'orderItemId')::uuid and r.variant_id=(s->>'variantId')::uuid)) end;
$$;

-- 회수 생략으로 재출고한 배송 건은 회수가 끝난 것으로 본다. 그 밖의 판정은 그대로다.
create or replace function private.claim_collections_complete(target_claim uuid)
returns boolean language sql stable set search_path='' as $$
 select coalesce((select not c.collection_required or c.collection_policy='legacy' or
   (exists(select 1 from public.order_items i where i.order_id=c.order_id)
    and exists(select 1 from public.order_claim_collections x where x.claim_id=c.id)
    and not exists(select 1 from public.order_claim_collections x where x.claim_id=c.id and x.collected_at is null
     and not exists(select 1 from public.order_claim_reshipments r where r.claim_id=x.claim_id and r.shipment_id=x.shipment_id and r.collection_waived))
    and not exists(select 1 from public.order_items i where i.order_id=c.order_id and coalesce(i.fulfillment_terms_snapshot->>'mode','shipping')<>'digital' and
      coalesce((select sum((j->>'qty')::bigint) from public.order_claim_collections x cross join lateral jsonb_array_elements(x.items_snapshot) j
       where x.claim_id=c.id and (j->>'orderItemId')::uuid=i.id),0)<>i.qty))
 from public.order_cancellation_requests c where c.id=target_claim),false);
$$;

-- ---------------------------------------------------------------------------
-- 3. 배송 건 재출고 기록(재고 이동의 유일한 쓰기 경로)
-- ---------------------------------------------------------------------------
create function private.record_order_claim_shipment_reshipment(p_claim_id uuid,p_shipment_id uuid,p_carrier text,p_tracking_number text,p_items jsonb,p_waiver jsonb default null)
returns text language plpgsql set search_path='' as $$
declare
 actor uuid:=(select auth.uid());carrier text:=nullif(btrim(p_carrier),'');tracking text:=nullif(btrim(p_tracking_number),'');
 waived boolean:=p_waiver is not null and p_waiver<>'null'::jsonb;waiver_reason text;evidence uuid[];
 selections jsonb;requested jsonb;order_key uuid;order_state public.order_status;claim public.order_cancellation_requests;
 target record;existing public.order_claim_reshipments;record_id uuid;item record;source_variant uuid;selected_variant uuid;
 variant public.goods_variants;grouped boolean;physical record;successor record;choice record;allocations jsonb:='[]';entry jsonb;
 good_ids text[];variant_ids uuid[];deltas jsonb;shipped_items jsonb;inserted integer;target_count integer;reshipped_count integer;
 stage_before text;completed boolean;now_at timestamptz;title text;body text;
begin
 perform private.require_operator_capability('sales.manage',false);
 if actor is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required';end if;
 if carrier is null or tracking is null or tracking!~'^[A-Z0-9]{8,30}$' then raise check_violation using message='invalid reshipment tracking';end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)>1000 then raise check_violation using message='invalid reshipment items';end if;
 for requested in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(requested) is distinct from 'object' or not(requested ?& array['orderItemId','variantId'])
   or (select count(*) from jsonb_object_keys(requested))<>2
   or (requested->>'orderItemId') is null or (requested->>'variantId') is null
   or requested->>'orderItemId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or requested->>'variantId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   then raise check_violation using message='invalid reshipment items';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_items) x group by (x->>'orderItemId')::uuid having count(*)>1) then
  raise check_violation using message='invalid reshipment items';end if;
 select coalesce(jsonb_agg(jsonb_build_object('orderItemId',(x->>'orderItemId')::uuid,'variantId',(x->>'variantId')::uuid)
  order by (x->>'orderItemId')::uuid),'[]') into selections from jsonb_array_elements(p_items) x;
 if waived then
  if jsonb_typeof(p_waiver) is distinct from 'object' or not(p_waiver ?& array['reason','evidenceFileIds'])
   or (select count(*) from jsonb_object_keys(p_waiver))<>2 or jsonb_typeof(p_waiver->'reason') is distinct from 'string'
   or jsonb_typeof(p_waiver->'evidenceFileIds') is distinct from 'array' then
   raise check_violation using message='invalid_collection_waiver';end if;
  waiver_reason:=p_waiver->>'reason';
  if waiver_reason<>btrim(waiver_reason) or char_length(waiver_reason) not between 10 and 500
   or translate(waiver_reason,E'\n\r\t','')~'[[:cntrl:]]' then raise check_violation using message='invalid_collection_waiver_reason';end if;
  if jsonb_array_length(p_waiver->'evidenceFileIds') not between 1 and 5 or exists(select 1 from jsonb_array_elements(p_waiver->'evidenceFileIds') e
   where jsonb_typeof(e) is distinct from 'string' or e#>>'{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
   raise check_violation using message='collection_waiver_evidence_required';end if;
  select array_agg(distinct (e#>>'{}')::uuid order by (e#>>'{}')::uuid) into evidence from jsonb_array_elements(p_waiver->'evidenceFileIds') e;
  if cardinality(evidence)<>jsonb_array_length(p_waiver->'evidenceFileIds') then raise check_violation using message='collection_waiver_evidence_required';end if;
 end if;
 select order_id into order_key from public.order_cancellation_requests where id=p_claim_id;
 if not found then raise no_data_found using message='claim_not_found';end if;
 -- Cancellation, payment finalization and claim operations all lock order first.
 select status into order_state from public.orders where id=order_key for update;
 perform 1 from public.order_shipments where order_id=order_key order by id for update;
 select * into claim from public.order_cancellation_requests where id=p_claim_id for update;
 if claim.claim_type<>'exchange' then raise exception using message='claim_type_has_no_reshipment';end if;
 perform private.lock_goods_stock_successor_topology();
 select * into existing from public.order_claim_reshipments where claim_id=p_claim_id and shipment_id is not distinct from p_shipment_id for update;
 if found then
  -- 같은 배송 건·같은 운송장·같은 선택의 재전송만 같은 결과다. 재고는 다시 움직이지 않는다.
  if existing.carrier=carrier and existing.tracking_number=tracking and existing.collection_waived=waived
   and existing.waiver_reason is not distinct from waiver_reason and existing.waiver_evidence_file_ids is not distinct from evidence
   and private.claim_reshipment_selections_match(existing,selections) then
   return case when claim.stage='completed' then 'completed' else 'reshipped' end;
  end if;
  raise unique_violation using message='reshipment_conflict';
 end if;
 -- 이 migration 전의 클레임 단위 재출고(한 쌍)는 그대로 종결 기록이다. 배송 건 기록을 덧대지 않는다.
 if claim.stage='completed' or claim.reship_tracking_number is not null
  or exists(select 1 from private.group_claim_reshipment_receipts where claim_id=p_claim_id)
  or exists(select 1 from public.order_claim_reshipment_items where claim_id=p_claim_id and reshipment_id is null)
  or exists(select 1 from private.group_claim_reshipment_allocations where claim_id=p_claim_id and reshipment_id is null) then
  raise unique_violation using message='reshipment_conflict';end if;
 select * into target from private.claim_reshipment_targets(p_claim_id) t where t.shipment_id is not distinct from p_shipment_id;
 if not found then raise check_violation using message='reshipment_shipment_not_found';end if;
 if not waived then
  if target.collection_tracked and target.collected_at is null then raise check_violation using message='claim_collections_incomplete';end if;
 else
  if not target.collection_tracked then raise check_violation using message='collection_waiver_unavailable';end if;
  if claim.reason_type<>'defect' then raise check_violation using message='collection_waiver_not_allowed';end if;
  if target.collected_at is not null then raise check_violation using message='collection_waiver_not_needed';end if;
  if (select count(*) from private.claim_evidence_files f where f.id=any(evidence) and f.claim_id=p_claim_id)<>cardinality(evidence) then
   raise check_violation using message='collection_waiver_evidence_required';end if;
 end if;
 if claim.stage not in('collecting','collected') or(not target.collection_tracked and claim.stage<>'collected')
  or order_state not in('shipping','delivered','done')
  or exists(select 1 from public.order_cancellation_claims where order_id=order_key) then
  raise exception using message='claim_not_reshippable';end if;
 if not exists(select 1 from public.shipping_carriers c where c.code=carrier and c.is_active) then raise check_violation using message='unknown shipping carrier';end if;
 if exists(select 1 from jsonb_array_elements(selections) s where not((s->>'orderItemId')::uuid=any(target.item_ids))) then
  raise check_violation using message='invalid reshipment items';end if;
 if exists(select 1 from public.order_items i where i.id=any(target.item_ids) and i.production_terms_snapshot is not null
  and not exists(select 1 from private.order_production_jobs j where j.order_item_id=i.id and j.claim_id=p_claim_id and j.state='completed')) then
  raise check_violation using message='production_incomplete';end if;
 grouped:=exists(select 1 from public.order_items oi cross join lateral private.order_item_physical_unit(oi.id) unit
   where oi.id=any(target.item_ids) and(unit.good_id<>oi.good_id
    or exists(select 1 from private.goods_stock_successors where source_variant_id=unit.variant_id)
    or exists(select 1 from private.goods_group_members where variant_id=unit.variant_id)
    or exists(select 1 from private.group_claim_reshipment_allocations where order_item_id=oi.id)))
  or exists(select 1 from jsonb_array_elements(selections) x join public.order_items oi on oi.id=(x->>'orderItemId')::uuid
   join public.goods_variants v on v.id=(x->>'variantId')::uuid where oi.good_id<>v.good_id);
 now_at:=clock_timestamp();
 insert into public.order_claim_reshipments(claim_id,order_id,shipment_id,origin_name_snapshot,carrier,tracking_number,reshipped_at,reshipped_by,
  selections,collection_waived,waiver_reason,waiver_evidence_file_ids)
 values(p_claim_id,order_key,p_shipment_id,target.origin_name,carrier,tracking,now_at,actor,selections,waived,waiver_reason,evidence) returning id into record_id;
 if not grouped then
  perform 1 from public.goods g where g.id in(select good_id from public.order_items where id=any(target.item_ids)) order by g.id for update;
  for item in select * from public.order_items where id=any(target.item_ids) order by good_id,id loop
   source_variant:=private.order_item_stock_variant(item.id);
   selected_variant:=null;
   select (s->>'variantId')::uuid into selected_variant from jsonb_array_elements(selections) s where (s->>'orderItemId')::uuid=item.id;
   selected_variant:=coalesce(selected_variant,source_variant);
   select * into variant from public.goods_variants where id=selected_variant and good_id=item.good_id;
   if not found or(variant.archived_at is not null and selected_variant<>source_variant) then raise check_violation using message='reshipment_variant_unavailable';end if;
   insert into public.order_claim_reshipment_items(claim_id,order_item_id,good_id,source_variant_id,variant_id,variant_name_snapshot,variant_code_snapshot,qty,reshipment_id)
   values(p_claim_id,item.id,item.good_id,source_variant,selected_variant,variant.name,variant.code,item.qty,record_id);
  end loop;
  -- 이 배송 건의 회수품(+)과 보낸 옵션(−)을 먼저 상쇄한다. 회수 생략이면 보낸 옵션만 뺀다.
  for item in select changes.good_id,changes.variant_id,sum(changes.delta)::bigint delta from(
    select good_id,source_variant_id variant_id,qty::bigint delta from public.order_claim_reshipment_items where reshipment_id=record_id and not waived
    union all select good_id,variant_id,-qty::bigint from public.order_claim_reshipment_items where reshipment_id=record_id
   ) changes group by changes.good_id,changes.variant_id having sum(changes.delta)<>0 order by changes.good_id,delta desc,changes.variant_id loop
   perform private.change_goods_variant_stock(item.good_id,item.variant_id,item.delta);
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('orderItemId',order_item_id,'goodId',good_id,'sourceVariantId',source_variant_id,'variantId',variant_id,'qty',qty) order by order_item_id),'[]')
   into shipped_items from public.order_claim_reshipment_items where reshipment_id=record_id;
 else
  for item in select * from public.order_items where id=any(target.item_ids) order by good_id,id loop
   select * into physical from private.order_item_physical_unit(item.id);
   select * into successor from private.resolve_goods_stock_successor(physical.good_id,physical.variant_id);
   selected_variant:=null;
   select (x->>'variantId')::uuid into selected_variant from jsonb_array_elements(selections) x where (x->>'orderItemId')::uuid=item.id;
   selected_variant:=coalesce(selected_variant,successor.variant_id);
   select * into choice from private.order_item_reshipment_options(item.id) where variant_id=selected_variant;
   if not found then raise check_violation using message='reshipment_variant_unavailable';end if;
   allocations:=allocations||jsonb_build_array(jsonb_build_object('orderItemId',item.id,'originalGoodId',item.good_id,'originalVariantId',item.variant_id,
    'sourceGoodId',physical.good_id,'sourceVariantId',physical.variant_id,'generationKind',physical.generation_kind,'generationId',physical.generation_id,
    'returnedGoodId',successor.good_id,'returnedVariantId',successor.variant_id,'operationPath',to_jsonb(successor.operation_path),
    'goodId',choice.good_id,'variantId',choice.variant_id,'goodName',choice.good_name,'variantName',choice.variant_name,'variantCode',choice.variant_code,'qty',item.qty));
  end loop;
  if jsonb_array_length(allocations) not between 1 and 1000 then raise check_violation using message='invalid reshipment items';end if;
  select array_agg(distinct id order by id) into good_ids from(
   select x->>'originalGoodId' id from jsonb_array_elements(allocations) x union select x->>'sourceGoodId' from jsonb_array_elements(allocations) x
   union select x->>'returnedGoodId' from jsonb_array_elements(allocations) x union select x->>'goodId' from jsonb_array_elements(allocations) x) ids;
  select array_agg(distinct id order by id) into variant_ids from(
   select (x->>'originalVariantId')::uuid id from jsonb_array_elements(allocations) x union select (x->>'sourceVariantId')::uuid from jsonb_array_elements(allocations) x
   union select (x->>'returnedVariantId')::uuid from jsonb_array_elements(allocations) x union select (x->>'variantId')::uuid from jsonb_array_elements(allocations) x) ids;
  perform 1 from public.goods where id=any(good_ids) order by id for update nowait;
  perform 1 from public.goods_variants where id=any(variant_ids) order by id for update nowait;
  -- Metadata and availability are read again after locks; topology remains fixed.
  for entry in select value from jsonb_array_elements(allocations) loop
   if not exists(select 1 from private.order_item_reshipment_options((entry->>'orderItemId')::uuid) where variant_id=(entry->>'variantId')::uuid) then
    raise sqlstate 'PT409' using message='reshipment_variant_unavailable';end if;
  end loop;
  for entry in select value from jsonb_array_elements(allocations) loop
   if not waived then
    insert into private.group_stock_restorations(order_item_id,generation_kind,generation_id,original_good_id,original_variant_id,
     source_good_id,source_variant_id,target_good_id,target_variant_id,operation_path,qty,cause,claim_id,actor_id,reason)
    values((entry->>'orderItemId')::uuid,entry->>'generationKind',(entry->>'generationId')::uuid,entry->>'originalGoodId',(entry->>'originalVariantId')::uuid,
     entry->>'sourceGoodId',(entry->>'sourceVariantId')::uuid,entry->>'returnedGoodId',(entry->>'returnedVariantId')::uuid,
     array(select value::uuid from jsonb_array_elements_text(entry->'operationPath')),(entry->>'qty')::integer,'exchange',p_claim_id,actor,'교환 회수품 입고') on conflict do nothing;
    get diagnostics inserted=row_count;
    if inserted<>1 then raise check_violation using message='physical_generation_already_restored';end if;
   end if;
   insert into private.group_claim_reshipment_allocations(claim_id,order_item_id,original_good_id,original_variant_id,source_good_id,source_variant_id,
    source_generation_kind,source_generation_id,returned_good_id,returned_variant_id,operation_path,target_good_id,target_variant_id,
    good_name_snapshot,variant_name_snapshot,variant_code_snapshot,qty,reshipment_id)
   select p_claim_id,(entry->>'orderItemId')::uuid,entry->>'originalGoodId',(entry->>'originalVariantId')::uuid,entry->>'sourceGoodId',(entry->>'sourceVariantId')::uuid,
    entry->>'generationKind',(entry->>'generationId')::uuid,entry->>'returnedGoodId',(entry->>'returnedVariantId')::uuid,
    array(select value::uuid from jsonb_array_elements_text(entry->'operationPath')),entry->>'goodId',(entry->>'variantId')::uuid,g.name,v.name,v.code,(entry->>'qty')::integer,record_id
   from public.goods g join public.goods_variants v on v.good_id=g.id where v.id=(entry->>'variantId')::uuid and g.id=entry->>'goodId';
  end loop;
  select jsonb_agg(value) into deltas from(
   select jsonb_build_object('goodId',a.returned_good_id,'variantId',a.returned_variant_id,'delta',a.qty) value
   from private.group_claim_reshipment_allocations a where a.reshipment_id=record_id and not waived
   union all select jsonb_build_object('goodId',a.target_good_id,'variantId',a.target_variant_id,'delta',-a.qty)
   from private.group_claim_reshipment_allocations a where a.reshipment_id=record_id) movement;
  perform private.apply_group_physical_stock_deltas(deltas);
  select coalesce(jsonb_agg(jsonb_build_object('orderItemId',a.order_item_id,'originalGoodId',a.original_good_id,'sourceGoodId',a.source_good_id,'sourceVariantId',a.source_variant_id,
   'goodId',a.target_good_id,'variantId',a.target_variant_id,'qty',a.qty) order by a.order_item_id),'[]') into shipped_items
  from private.group_claim_reshipment_allocations a where a.reshipment_id=record_id;
 end if;
 select count(*) into target_count from private.claim_reshipment_targets(p_claim_id);
 select count(*) into reshipped_count from public.order_claim_reshipments r where r.claim_id=p_claim_id;
 completed:=not exists(select 1 from private.claim_reshipment_targets(p_claim_id) t where not exists(
  select 1 from public.order_claim_reshipments r where r.claim_id=p_claim_id and r.shipment_id is not distinct from t.shipment_id));
 stage_before:=claim.stage;
 update public.order_cancellation_requests set reshipped_at=coalesce(reshipped_at,now_at),
  stage=case when completed then 'completed' else stage end,
  completed_at=case when completed then now_at else completed_at end,
  reship_carrier=case when completed and target_count=1 then carrier else reship_carrier end,
  reship_tracking_number=case when completed and target_count=1 then tracking else reship_tracking_number end,
  updated_at=now_at
 where id=p_claim_id returning * into claim;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.order.claim_reshipped','order:'||order_key::text,
  jsonb_build_object('claimId',p_claim_id,'claimType','exchange','from',stage_before,'to',claim.stage,'carrier',carrier,'items',shipped_items,
   'reshipmentId',record_id,'shipmentId',p_shipment_id,'originName',target.origin_name,'trackingNumber',tracking,
   'collectionWaived',waived,'waiverReason',waiver_reason,'evidenceFileIds',to_jsonb(evidence),'reshippedCount',reshipped_count,'targetCount',target_count));
 title:=case when waived then '교환 상품을 회수 없이 다시 보내드려요' when completed then '교환 상품이 재출고됐어요' else '교환 상품 일부가 먼저 재출고됐어요' end;
 body:=case when waived then '교환 상품을 새 운송장으로 발송했어요. 주문 상세에서 운송장을 확인해주세요.'
  when completed then '교환 상품을 새 운송장으로 발송했습니다.'
  else '준비된 교환 상품을 새 운송장으로 먼저 발송했어요. 나머지 교환 상품도 준비되는 대로 보내드려요.' end;
 -- 배송 건마다 한 번씩 알린다(같은 거래에서 두 배송 건을 처리해도 알림 키가 겹치지 않게 배송 건을 키에 넣는다).
 perform private.notify_order_claim(p_claim_id,'reshipped:'||coalesce(p_shipment_id::text,'order'),title,body);
 return case when completed then 'completed' else 'reshipped' end;
exception when lock_not_available then raise sqlstate 'PT409' using message='goods_group_retry';
end $$;

-- 옛 클레임 단위 쓰기: 종결된 기록의 재생과, 대상 배송 건이 하나뿐인 교환의 재출고만 받는다.
create or replace function private.record_order_claim_reshipment_physical(p_claim_id uuid,p_carrier text,p_tracking_number text,p_items jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=(select auth.uid());selected_order uuid;order_status public.order_status;
 claim public.order_cancellation_requests;carrier text:=nullif(btrim(p_carrier),'');tracking text:=nullif(btrim(p_tracking_number),'');
 selections jsonb;requested jsonb;recorded public.order_claim_reshipments;targets integer;single_target uuid;
begin
 perform private.require_operator_capability('sales.manage',false);
 if actor is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required';end if;
 if carrier is null or tracking is null or tracking!~'^[A-Z0-9]{8,30}$' then raise check_violation using message='invalid reshipment tracking';end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)>1000 then raise check_violation using message='invalid reshipment items';end if;
 for requested in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(requested) is distinct from 'object' or not(requested ?& array['orderItemId','variantId'])
   or (select count(*) from jsonb_object_keys(requested))<>2
   or (requested->>'orderItemId') is null or (requested->>'variantId') is null
   or requested->>'orderItemId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or requested->>'variantId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   then raise check_violation using message='invalid reshipment items';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_items) x group by (x->>'orderItemId')::uuid having count(*)>1) then
  raise check_violation using message='invalid reshipment items';end if;
 select coalesce(jsonb_agg(jsonb_build_object('orderItemId',(x->>'orderItemId')::uuid,'variantId',(x->>'variantId')::uuid)
  order by (x->>'orderItemId')::uuid),'[]') into selections from jsonb_array_elements(p_items) x;
 select order_id into selected_order from public.order_cancellation_requests where id=p_claim_id;
 if not found then raise no_data_found using message='claim_not_found';end if;
 -- Cancellation, payment finalization and claim operations all lock order first.
 select status into order_status from public.orders where id=selected_order for update;
 select * into claim from public.order_cancellation_requests where id=p_claim_id for update;
 if claim.claim_type<>'exchange' then raise exception using message='claim_type_has_no_reshipment';end if;
 -- 배송 건 기록이 있으면 그 기록이 진실원이다. 옛 진입점은 배송 건이 하나인 종결 건의 같은 기록만 재생한다.
 if exists(select 1 from public.order_claim_reshipments where claim_id=p_claim_id) then
  select * into recorded from public.order_claim_reshipments where claim_id=p_claim_id order by reshipped_at,id limit 1;
  if claim.stage='completed' and (select count(*) from public.order_claim_reshipments where claim_id=p_claim_id)=1
   and recorded.carrier=carrier and recorded.tracking_number=tracking and not recorded.collection_waived
   and private.claim_reshipment_selections_match(recorded,selections) then
   return 'completed';end if;
  raise unique_violation using message='reshipment_conflict';
 end if;
 if exists(select 1 from private.group_claim_reshipment_receipts where claim_id=p_claim_id) then
  return private.record_group_claim_reshipment(p_claim_id,carrier,tracking,selections);
 end if;
 if claim.stage='completed' then
  if claim.reship_carrier=carrier and claim.reship_tracking_number=tracking and not exists(
   select 1 from jsonb_array_elements(selections) selected where not exists(
    select 1 from public.order_claim_reshipment_items shipped where shipped.claim_id=p_claim_id
     and shipped.order_item_id=(selected->>'orderItemId')::uuid and shipped.variant_id=(selected->>'variantId')::uuid))
   then return 'completed';end if;
  raise unique_violation using message='reshipment_conflict';
 end if;
 select count(*) into targets from private.claim_reshipment_targets(p_claim_id);
 if targets<>1 then
  -- 회수 확인 전 단계의 오류 순서를 옛 경로와 같게 둔다(전체 회수 → 단계 → 배송 건).
  perform private.assert_claim_collections_complete(p_claim_id);
  if claim.stage<>'collected' then raise exception using message='claim_not_reshippable';end if;
  raise check_violation using message='reshipment_shipment_required';
 end if;
 select t.shipment_id into single_target from private.claim_reshipment_targets(p_claim_id) t;
 return private.record_order_claim_shipment_reshipment(p_claim_id,single_target,carrier,tracking,selections,null);
end $$;

-- ---------------------------------------------------------------------------
-- 4. 최종 주소 확인을 거친 배송 건 재출고(service 경계)
-- ---------------------------------------------------------------------------
create function public.service_record_order_claim_shipment_reshipment(p_order_id uuid,p_claim_id uuid,p_shipment_id uuid,p_actor_id uuid,p_session_id uuid,
 p_operation_id uuid,p_expected_claim_revision integer,p_expected_context jsonb,p_sealed_destination jsonb,p_request_hmac text,p_hmac_key_version text,
 p_carrier text,p_tracking_number text,p_items jsonb,p_collection_waiver jsonb,p_confirmed boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare parties uuid[]:=private.contact_parties(p_order_id);op private.order_claim_contact_operations;c public.order_cancellation_requests;view jsonb;result_revision integer;
 previous_subject text:=current_setting('request.jwt.claim.sub',true);record_id uuid;begin
 perform private.contact_operation_input(p_operation_id,'reshipment','reshipment','exchange',p_expected_claim_revision);
 perform private.contact_require_identity(p_actor_id,p_session_id,'sales.manage',false,parties,false);
 perform pg_advisory_xact_lock(hashtextextended('claim-contact-operation:'||p_operation_id,0));
 c:=private.contact_lock_scope(p_order_id,p_claim_id,parties);
 select id,actor_id,session_id,order_id,claim_id,command,target,expected_claim_type,expected_claim_revision,result_claim_revision,
 state,changed_fields,request_hmac,hmac_key_version,null::jsonb,created_at,purged_at into op
 from private.order_claim_contact_operations where id=p_operation_id;
 if found then
  perform private.contact_operation_scope(op,p_order_id,p_claim_id,p_actor_id,p_session_id,'reshipment','reshipment','exchange',p_expected_claim_revision);
  if op.state='sealed' then raise sqlstate 'PT409' using message='claim_contact_operation_sealed';end if;
  if op.purged_at is not null then raise sqlstate 'PT410' using message='claim_contact_purged';end if;
  if op.request_hmac is distinct from p_request_hmac or op.hmac_key_version is distinct from p_hmac_key_version then raise unique_violation using message='claim_contact_operation_conflict';end if;
  return private.contact_operation_receipt(op);
 end if;
 if exists(select 1 from private.account_action_fences where subject_user_id=any(parties)) then raise sqlstate 'PT409' using message='claim_contact_blocked';end if;
 if p_confirmed is distinct from true or not private.contact_digest(to_jsonb(p_request_hmac)) or not private.contact_key_version(to_jsonb(p_hmac_key_version))
 or not private.contact_keys(p_sealed_destination,array['piiVersion','keyVersion','address','addressHmac','addressHmacKeyVersion','sourceKind','sourceId','sourceRevision','sourcePlanRevision','sourcePiiVersion'])
 or not private.contact_uuid(p_sealed_destination->'piiVersion') or not private.contact_key_version(p_sealed_destination->'keyVersion')
 or not private.contact_key_version(p_sealed_destination->'addressHmacKeyVersion') or not private.contact_digest(p_sealed_destination->'addressHmac')
 or not private.contact_address_envelope(p_sealed_destination->'address',p_sealed_destination->>'keyVersion')
 or p_carrier is null or char_length(p_carrier) not between 1 and 40 or p_carrier<>btrim(p_carrier) or p_tracking_number is null or p_tracking_number!~'^[A-Z0-9]{8,30}$'
 then raise invalid_parameter_value using message='invalid_claim_contact_request';end if;
 view:=private.contact_assert_context(c,'reshipment','reshipment','exchange',p_expected_claim_revision,p_expected_context);
 if jsonb_build_object('sourceKind',p_sealed_destination->'sourceKind','sourceId',p_sealed_destination->'sourceId','sourceRevision',p_sealed_destination->'sourceRevision',
 'planRevision',p_sealed_destination->'sourcePlanRevision','piiVersion',p_sealed_destination->'sourcePiiVersion') is distinct from((view->'source')-'sourceFingerprint')
 then raise sqlstate 'PT409' using message='claim_contact_changed';end if;
 -- 이미 재출고한 배송 건에 새 작업을 덧대지 않는다. 같은 요청의 재전송은 위 작업 영수증이 받는다.
 if exists(select 1 from public.order_claim_reshipments where claim_id=p_claim_id and shipment_id is not distinct from p_shipment_id) then
  raise unique_violation using message='reshipment_conflict';end if;
 -- Preserve the explicit actor only for the already-verified physical call.
 begin
  perform set_config('request.jwt.claim.sub',p_actor_id::text,true);
  perform private.record_order_claim_shipment_reshipment(p_claim_id,p_shipment_id,p_carrier,p_tracking_number,p_items,p_collection_waiver);
  perform set_config('request.jwt.claim.sub',coalesce(previous_subject,''),true);
 exception when others then perform set_config('request.jwt.claim.sub',coalesce(previous_subject,''),true);raise;end;
 select id into record_id from public.order_claim_reshipments where claim_id=p_claim_id and shipment_id is not distinct from p_shipment_id;
 select claim_revision into result_revision from public.order_cancellation_requests where id=p_claim_id;
 insert into private.order_claim_contact_operations(id,actor_id,session_id,order_id,claim_id,command,target,expected_claim_type,expected_claim_revision,result_claim_revision,state,request_hmac,hmac_key_version)
 values(p_operation_id,p_actor_id,p_session_id,p_order_id,p_claim_id,'reshipment','reshipment','exchange',p_expected_claim_revision,result_revision,'saved',p_request_hmac,p_hmac_key_version) returning * into op;
 insert into private.order_claim_reshipment_destinations(claim_id,order_id,operation_id,confirmed_claim_revision,destination,reshipment_id)
 values(p_claim_id,p_order_id,p_operation_id,result_revision,p_sealed_destination,record_id);
 return private.contact_operation_receipt(op);
end $$;

-- 옛 계약(배송 건 인자 없음): 대상 배송 건이 하나인 교환만 받는다. 기록된 작업의 재전송은 그 작업 영수증으로 돌려준다.
create or replace function public.service_record_order_claim_reshipment_v2(p_order_id uuid,p_claim_id uuid,p_actor_id uuid,p_session_id uuid,p_operation_id uuid,
 p_expected_claim_revision integer,p_expected_context jsonb,p_sealed_destination jsonb,p_request_hmac text,p_hmac_key_version text,
 p_carrier text,p_tracking_number text,p_items jsonb,p_confirmed boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target uuid;targets integer;begin
 select count(*) into targets from private.claim_reshipment_targets(p_claim_id);
 if targets=1 then select t.shipment_id into target from private.claim_reshipment_targets(p_claim_id) t;
 elsif targets>1 and not exists(select 1 from private.order_claim_contact_operations where id=p_operation_id) then
  raise invalid_parameter_value using message='reshipment_shipment_required';
 end if;
 -- 대상이 없으면(승인 전·종결 뒤) 아래 경계가 최종 주소 확인 단계에서 막힌 상태로 답한다.
 return public.service_record_order_claim_shipment_reshipment(p_order_id,p_claim_id,target,p_actor_id,p_session_id,p_operation_id,p_expected_claim_revision,
  p_expected_context,p_sealed_destination,p_request_hmac,p_hmac_key_version,p_carrier,p_tracking_number,p_items,null,p_confirmed);
end $$;

-- ---------------------------------------------------------------------------
-- 5. 교환품 배송완료 확인(배송 건마다)
-- ---------------------------------------------------------------------------
create function public.admin_record_order_claim_shipment_reshipment_delivery(p_claim_id uuid,p_shipment_id uuid,p_evidence text)
returns text language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());order_key uuid;claim public.order_cancellation_requests;recorded public.order_claim_reshipments;observed_at timestamptz;
begin
 perform private.require_operator_capability('sales.manage',false);
 if actor is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required';end if;
 if p_evidence is null or p_evidence<>btrim(p_evidence) or char_length(p_evidence) not between 1 and 500
  or translate(p_evidence,E'\n\r\t','') ~ '[[:cntrl:]]' then raise check_violation using message='invalid_reshipment_delivery_evidence';end if;
 select order_id into order_key from public.order_cancellation_requests where id=p_claim_id;
 if not found then raise no_data_found using message='claim_not_found';end if;
 -- Same parent-first ordering as intake and reshipment.
 perform id from public.orders where id=order_key for update;
 select * into claim from public.order_cancellation_requests where id=p_claim_id for update;
 select * into recorded from public.order_claim_reshipments where claim_id=p_claim_id and shipment_id is not distinct from p_shipment_id for update;
 observed_at:=clock_timestamp();
 if recorded.id is null or claim.claim_type<>'exchange' or recorded.reshipped_at>observed_at then
  raise check_violation using message='claim_reshipment_not_dispatched';end if;
 if recorded.delivered_at is not null then
  if recorded.delivered_by=actor and recorded.delivery_evidence=p_evidence then return 'delivered';end if;
  raise unique_violation using message='reshipment_delivery_conflict';
 end if;
 update public.order_claim_reshipments set delivered_at=observed_at,delivered_by=actor,delivery_evidence=p_evidence where id=recorded.id;
 -- 대상 배송 건이 하나인 교환은 옛 단일 열에도 같은 확인을 적는다(지난 판정·화면 호환).
 if claim.stage='completed' and claim.reship_tracking_number is not null and claim.reship_delivered_at is null
  and (select count(*) from public.order_claim_reshipments where claim_id=p_claim_id)=1 then
  update public.order_cancellation_requests set reship_delivered_at=observed_at,reship_delivered_by=actor,reship_delivery_evidence=p_evidence where id=p_claim_id;
 end if;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.order.claim_reshipment_delivered','order:'||order_key::text,
  jsonb_build_object('claimId',p_claim_id,'reshipmentId',recorded.id,'shipmentId',recorded.shipment_id,'originName',recorded.origin_name_snapshot,
   'reshippedAt',recorded.reshipped_at,'reshipDeliveredAt',observed_at,'evidence',p_evidence));
 select * into claim from public.order_cancellation_requests where id=p_claim_id;
 if claim.stage='completed' and exists(select 1 from public.orders where id=order_key and status='shipping' and delivered_at is null)
  and private.claim_collections_complete(p_claim_id)
  and not exists(select 1 from public.order_cancellation_requests c where c.order_id=order_key and private.claim_reshipment_delivery_pending(c)) then
  update public.orders set status='delivered',delivered_at=observed_at where id=order_key and status='shipping' and delivered_at is null;
 end if;
 return 'delivered';
end $$;

-- 옛 계약(배송 건 인자 없음): 대상 배송 건이 하나뿐인 교환은 그 배송 건 기록으로, 배송 건 기록이 없으면 옛 단일 열로 받는다.
create or replace function public.admin_record_order_claim_reshipment_delivery(p_claim_id uuid,p_evidence text)
returns text language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=(select auth.uid());
  order_key uuid;
  claim public.order_cancellation_requests;
  observed_at timestamptz;
  recorded integer;
  single_shipment uuid;
begin
  perform private.require_operator_capability('sales.manage',false);

  if actor is null or not public.has_operator_capability('sales.manage',false) then
    raise insufficient_privilege using message='staff required';
  end if;
  if p_evidence is null or p_evidence<>btrim(p_evidence)
    or char_length(p_evidence) not between 1 and 500
    or translate(p_evidence,E'\n\r\t','') ~ '[[:cntrl:]]' then
    raise check_violation using message='invalid_reshipment_delivery_evidence';
  end if;
  select order_id into order_key from public.order_cancellation_requests where id=p_claim_id;
  if not found then raise no_data_found using message='claim_not_found'; end if;
  -- Same parent-first ordering as intake and reshipment: concurrent confirmation
  -- cannot reopen intake against a different replacement transaction.
  perform id from public.orders where id=order_key for update;
  select * into claim from public.order_cancellation_requests where id=p_claim_id for update;
  if not found then raise no_data_found using message='claim_not_found'; end if;
  select count(*) into recorded from public.order_claim_reshipments where claim_id=p_claim_id;
  if recorded>0 then
    if recorded>1 or (select count(*) from private.claim_reshipment_targets(p_claim_id))<>1 then
      raise check_violation using message='reshipment_shipment_required';
    end if;
    select shipment_id into single_shipment from public.order_claim_reshipments where claim_id=p_claim_id;
    return public.admin_record_order_claim_shipment_reshipment_delivery(p_claim_id,single_shipment,p_evidence);
  end if;
  observed_at:=clock_timestamp();
  if claim.claim_type<>'exchange' or claim.stage<>'completed' or claim.reshipped_at is null
    or claim.reship_carrier is null or btrim(claim.reship_carrier)=''
    or claim.reship_tracking_number is null or btrim(claim.reship_tracking_number)=''
    or claim.reshipped_at>observed_at then
    raise check_violation using message='claim_reshipment_not_dispatched';
  end if;
  if claim.reship_delivered_at is not null then
    if claim.reship_delivered_by=actor and claim.reship_delivery_evidence=p_evidence then return 'delivered'; end if;
    raise unique_violation using message='reshipment_delivery_conflict';
  end if;
  update public.order_cancellation_requests
    set reship_delivered_at=observed_at,reship_delivered_by=actor,reship_delivery_evidence=p_evidence
    where id=p_claim_id;
  insert into public.audit_log(actor_id,action,target,diff)
    values(actor,'admin.order.claim_reshipment_delivered','order:'||order_key::text,
      jsonb_build_object('claimId',p_claim_id,'reshippedAt',claim.reshipped_at,
        'reshipDeliveredAt',observed_at,'evidence',p_evidence));
  if exists(select 1 from public.orders where id=order_key and status='shipping' and delivered_at is null)
    and private.claim_collections_complete(p_claim_id) and not exists(select 1 from public.order_cancellation_requests c where c.order_id=order_key
      and private.claim_reshipment_delivery_pending(c)) then
    update public.orders set status='delivered',delivered_at=observed_at where id=order_key and status='shipping' and delivered_at is null;
  end if;
  return 'delivered';
end $$;

-- ---------------------------------------------------------------------------
-- 6. 배송완료·접수·연락처 보관 판정을 배송 건 기록에 맞춘다
-- ---------------------------------------------------------------------------
create or replace function private.order_all_items_delivered(target_order uuid)
returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.orders o where o.id=target_order and o.status in ('delivered','done'))
  and exists(select 1 from public.order_items i where i.order_id=target_order)
  and not exists(select 1 from public.order_items i where i.order_id=target_order and
   coalesce((select sum(link.qty) from public.order_shipment_items link where link.order_item_id=i.id and link.order_id=i.order_id),0)<>i.qty)
  and (not exists(select 1 from public.order_items i where i.order_id=target_order and
    coalesce((select sum(link.qty) from public.order_shipment_items link join public.order_shipments s on s.id=link.shipment_id
     where link.order_item_id=i.id and link.order_id=i.order_id and s.status='delivered' and s.delivered_at is not null),0)<>i.qty)
   or exists(select 1 from public.order_cancellation_requests c where c.order_id=target_order and c.claim_type='exchange' and c.stage='completed'
    and not private.claim_reshipment_delivery_pending(c) and private.claim_collections_complete(c.id)))
  and not exists(select 1 from public.order_cancellation_requests c where c.order_id=target_order and private.claim_reshipment_delivery_pending(c));
$$;

create or replace function private.contact_order_reshipment_pending(p_order uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.order_cancellation_requests c where c.order_id=p_order and private.claim_reshipment_delivery_pending(c));
$$;

create or replace function private.order_return_intake_eligible(p_order_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select private.order_all_items_delivered(p_order_id) or exists(
  select 1 from public.orders o where o.id=p_order_id and o.status='shipping'
   and exists(select 1 from public.order_items i where i.order_id=o.id)
   and exists(select 1 from public.order_shipments s where s.order_id=o.id and s.status in ('shipping','delivered') and s.shipped_at is not null)
   and not exists(select 1 from public.order_shipments s where s.order_id=o.id and s.status='canceled')
   and not exists(select 1 from public.order_items i where i.order_id=o.id and coalesce((select sum(link.qty) from public.order_shipment_items link
    join public.order_shipments s on s.id=link.shipment_id where link.order_id=i.order_id and link.order_item_id=i.id and s.status in ('ready','shipping','delivered')),0)<>i.qty)
   and not exists(select 1 from public.order_cancellation_requests c where c.order_id=o.id and private.claim_reshipment_delivery_pending(c))
 );
$$;

create or replace function private.contact_order_obligations(p_order uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare purchase public.orders;begin
 select * into purchase from public.orders where id=p_order;if not found then return 'operational_unknown';end if;
 if purchase.status not in('delivered','done','canceled') or exists(select 1 from public.order_cancellation_requests where order_id=p_order and status in('requested','processing','needs_review'))
 or exists(select 1 from public.order_cancellation_claims where order_id=p_order)
 or exists(select 1 from public.payments p where p.ref_id=p_order and p.purpose='order' and p.status='pending')
 or exists(select 1 from public.payment_attempts where ref_id=p_order and purpose='order' and(state in('prepared','confirming','unknown','needs_review') or(state='approved' and payment_id is null)))
 or exists(select 1 from public.refunds r join public.payments p on p.id=r.payment_id where p.ref_id=p_order and p.purpose='order' and r.status<>'done') then return 'operational_pending';end if;
 if purchase.status in('delivered','done') and not private.order_all_items_delivered(p_order) then return 'operational_unknown';end if;
 if purchase.status='canceled' and(not exists(select 1 from public.order_items where order_id=p_order)
 or exists(select 1 from public.order_items i where i.order_id=p_order and coalesce((select sum(l.qty) from public.order_shipment_items l join public.order_shipments s on s.id=l.shipment_id
 where l.order_item_id=i.id and l.order_id=p_order and s.shipped_at is not null and s.delivered_at is not null),0)<>i.qty)) then return 'operational_unknown';end if;
 if purchase.status='canceled' and(not exists(select 1 from public.order_cancellation_requests c where c.order_id=p_order and c.claim_type='return' and c.stage='completed' and c.collected_at is not null and c.completed_at is not null)
 or(purchase.total>0 and(not exists(select 1 from public.payments p join public.refunds r on r.payment_id=p.id where p.ref_id=p_order and p.purpose='order' and p.status='refunded' and r.status='done' and r.completed_at is not null)
 or exists(select 1 from public.payments p where p.ref_id=p_order and p.purpose='order' and p.status in('pending','paid'))))) then return 'operational_unknown';end if;
 -- 회수 생략으로 재출고한 배송 건은 입고 기록 없이도 끝난 회수다.
 if exists(select 1 from public.order_cancellation_requests c where c.order_id=p_order and private.claim_reshipment_delivery_pending(c))
 or exists(select 1 from public.order_cancellation_requests c where c.order_id=p_order and c.stage='completed' and c.collection_required and c.collected_at is null
  and not(c.claim_type='exchange' and private.claim_collections_complete(c.id)
   and exists(select 1 from public.order_claim_reshipments r where r.claim_id=c.id and r.collection_waived)))
 or exists(select 1 from public.order_cancellation_requests c join public.order_claim_collections x on x.claim_id=c.id where c.order_id=p_order and c.stage='completed' and c.collection_required
  and(x.collected_at is null or x.collected_by is null or x.evidence is null)
  and not exists(select 1 from public.order_claim_reshipments r where r.claim_id=x.claim_id and r.shipment_id=x.shipment_id and r.collection_waived))
 or exists(select 1 from public.refunds r join public.payments p on p.id=r.payment_id where p.ref_id=p_order and r.status='done' and r.completed_at is null)
 then return 'operational_unknown';end if;
 return null;
end $$;

create or replace function private.contact_retention(p_claim uuid,p_now timestamptz)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.order_cancellation_requests;state text;ended timestamptz;base_at timestamptz;effective timestamptz;hold_until timestamptz;active_count integer;expired_count integer;
begin
 select * into c from public.order_cancellation_requests where id=p_claim;
 state:=private.contact_order_obligations(c.order_id);
 if state is null then
  ended:=case c.stage when 'completed' then c.completed_at when 'rejected' then c.decided_at when 'withdrawn' then c.withdrawn_at else null end;
  if c.stage not in('completed','rejected','withdrawn') then state:='operational_pending';elsif ended is null or not isfinite(ended) or ended>p_now then state:='operational_unknown';end if;
 end if;
 select count(*) filter(where r.state='held' and r.retain_until>p_now),count(*) filter(where r.state='held' and r.retain_until<=p_now),max(r.retain_until) filter(where r.state='held' and r.retain_until>p_now)
 into active_count,expired_count,hold_until from private.order_claim_contact_retention_cases r where r.claim_id=p_claim;
 if state is null then
  select greatest(ended,(select max(delivered_at) from public.order_shipments where order_id=c.order_id),
   (select max(greatest(completed_at,reship_delivered_at,decided_at,withdrawn_at,operational_fee_confirmed_at)) from public.order_cancellation_requests where order_id=c.order_id),
   (select max(r.delivered_at) from public.order_claim_reshipments r where r.order_id=c.order_id),
   (select max(r.completed_at) from public.refunds r join public.payments p on p.id=r.payment_id where p.ref_id=c.order_id and p.purpose='order'),
   (select max(case_closed_at) from private.order_claim_contact_retention_cases where claim_id=p_claim and legal_basis='dispute_resolution')) into ended;
  base_at:=ended+interval '30 days';effective:=greatest(base_at,hold_until);
  state:=case when effective<=p_now then 'due' when hold_until>base_at then 'held' else 'not_due' end;
 end if;
 if exists(select 1 from private.order_claim_contact_plans where claim_id=p_claim and purged_at is not null) then state:='purged';end if;
 return jsonb_build_object('state',state,'purposeEndedAt',ended,'basePurgeAt',base_at,'effectivePurgeAt',effective,'activeHoldCount',active_count,'expiredHoldCount',expired_count);
end $$;

-- 재배송지 정정은 첫 재출고 뒤로 막고(나간 소포와 다음 소포의 주소가 갈리지 않게), 재출고 등록은 남은 배송 건이 있는 동안 연다.
create or replace function private.contact_blocker(p_claim public.order_cancellation_requests,p_target text,p_command text)
returns text language plpgsql stable security definer set search_path='' as $$
declare stage text:=case when p_claim.stage='on_hold' then p_claim.held_from else p_claim.stage end;intake jsonb;row jsonb;
begin
 if p_claim.claim_type not in('return','exchange') or(p_target='reshipment' and p_claim.claim_type<>'exchange') then return 'not_applicable';end if;
 if exists(select 1 from public.orders where id=p_claim.order_id and status='canceled') or exists(select 1 from public.order_cancellation_claims where order_id=p_claim.order_id)
 or exists(select 1 from public.refunds r join public.payments p on p.id=r.payment_id where p.ref_id=p_claim.order_id and p.purpose='order') then return 'financial_state';end if;
 if stage is null or stage not in('requested','in_review','collecting','collected') then return 'claim_stage';end if;
 if p_target='reshipment' then
  if p_command='reshipment' then
   -- 이 migration 전의 클레임 단위 재출고 흔적이 있으면 배송 건 기록을 덧대지 않는다.
   if p_claim.reship_carrier is not null or p_claim.reship_tracking_number is not null or p_claim.reship_delivered_at is not null
   or exists(select 1 from private.group_claim_reshipment_receipts where claim_id=p_claim.id)
   or exists(select 1 from public.order_claim_reshipment_items where claim_id=p_claim.id and reshipment_id is null)
   or exists(select 1 from private.group_claim_reshipment_allocations where claim_id=p_claim.id and reshipment_id is null)
   or exists(select 1 from private.order_claim_reshipment_destinations where claim_id=p_claim.id and reshipment_id is null)
   or not exists(select 1 from private.claim_reshipment_targets(p_claim.id) t where not exists(
    select 1 from public.order_claim_reshipments r where r.claim_id=p_claim.id and r.shipment_id is not distinct from t.shipment_id)) then return 'reshipment_started';end if;
   if p_claim.stage not in('collecting','collected') or(p_claim.stage<>'collected' and not(p_claim.collection_policy='origin' and p_claim.collection_required)) then return 'claim_stage';end if;
   if not exists(select 1 from private.claim_reshipment_targets(p_claim.id) t where not exists(
    select 1 from public.order_claim_reshipments r where r.claim_id=p_claim.id and r.shipment_id is not distinct from t.shipment_id)
    and(not t.collection_tracked or t.collected_at is not null or p_claim.reason_type='defect')) then return 'collection_incomplete';end if;
  elsif p_claim.reshipped_at is not null or p_claim.reship_carrier is not null or p_claim.reship_tracking_number is not null or p_claim.reship_delivered_at is not null
  or exists(select 1 from private.claim_reshipment_items_read(p_claim.id)) or exists(select 1 from private.group_claim_reshipment_receipts where claim_id=p_claim.id)
  or exists(select 1 from public.order_claim_reshipments where claim_id=p_claim.id)
  or exists(select 1 from private.order_claim_reshipment_destinations where claim_id=p_claim.id) then return 'reshipment_started';end if;
 else
  if stage not in('requested','in_review') or p_claim.collecting_at is not null or p_claim.collected_at is not null
  or exists(select 1 from public.order_claim_collections where claim_id=p_claim.id and(collected_at is not null or collected_by is not null or evidence is not null)) then return 'collection_started';end if;
  if exists(select 1 from private.claim_collection_plans where claim_id=p_claim.id and requested_once) then return 'collection_started';end if;
  select payload->'collections' into intake from private.seller_order_claim_intakes where claim_id=p_claim.id;
  if found then
   if jsonb_typeof(intake) is distinct from 'array' or jsonb_array_length(intake)=0 then return 'collection_unknown';end if;
   for row in select value from jsonb_array_elements(intake) loop
    if not private.contact_keys(row,array['shipmentId','method','carrier','trackingNumber','note']) or not private.contact_uuid(row->'shipmentId')
    or row->>'method' is distinct from 'not_requested' or row->'carrier' is distinct from 'null'::jsonb or row->'trackingNumber' is distinct from 'null'::jsonb then return 'collection_started';end if;
   end loop;
  end if;
 end if;
 return null;
end $$;

-- 선물 보낸 분의 최근 클레임: 교환품 배송완료 시각은 모든 배송 건이 확인된 때다.
create or replace function public.get_my_gift_latest_claim(p_order_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',c.id,'status',c.status,'claimType',c.claim_type,'stage',c.stage,'reference',c.reference,
  'requestedAt',c.requested_at,'decidedAt',c.decided_at,'decisionNote',null,'reshipCarrier',null,'reshipTrackingNumber',null,
  'reshipDeliveredAt',case when exists(select 1 from public.order_claim_reshipments r where r.claim_id=c.id)
   then (select case when bool_and(r.delivered_at is not null) and c.stage='completed' then max(r.delivered_at) end from public.order_claim_reshipments r where r.claim_id=c.id)
   else c.reship_delivered_at end)
 from public.order_cancellation_requests c join private.gift_intents g on g.order_id=c.order_id
 where c.order_id=p_order_id and g.sender_id=auth.uid() order by c.requested_at desc,c.id desc limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 7. 읽기: 운영 상세·고객 주문 상세
-- ---------------------------------------------------------------------------
create function private.claim_reshipment_records_json(p_claim uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'shipmentId',r.shipment_id,'originName',r.origin_name_snapshot,
  'carrier',r.carrier,'carrierLabel',(select label from public.shipping_carriers where code=r.carrier),'trackingNumber',r.tracking_number,
  'reshippedAt',r.reshipped_at,'reshippedBy',r.reshipped_by,'reshippedByName',(select nickname from public.profiles where id=r.reshipped_by),
  'collectionWaived',r.collection_waived,'waiverReason',r.waiver_reason,
  'waiverEvidence',(select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'mimeType',f.mime_type,'size',f.size_bytes) order by v.n),'[]'::jsonb)
   from unnest(coalesce(r.waiver_evidence_file_ids,'{}'::uuid[])) with ordinality v(id,n) join private.claim_evidence_files f on f.id=v.id),
  'deliveredAt',r.delivered_at,'deliveredBy',r.delivered_by,'deliveredByName',(select nickname from public.profiles where id=r.delivered_by),
  'deliveryEvidence',r.delivery_evidence,
  'items',(select coalesce(jsonb_agg(jsonb_build_object('orderItemId',x.order_item_id,'name',x.name,'goodId',x.good_id,'variantId',x.variant_id,
    'variantName',x.variant_name,'variantCode',x.variant_code,'qty',x.qty) order by x.order_item_id),'[]'::jsonb) from(
   select ri.order_item_id,oi.good_name_snapshot name,ri.good_id,ri.variant_id,ri.variant_name_snapshot variant_name,ri.variant_code_snapshot variant_code,ri.qty
   from public.order_claim_reshipment_items ri join public.order_items oi on oi.id=ri.order_item_id where ri.reshipment_id=r.id
   union all
   select a.order_item_id,a.good_name_snapshot,a.target_good_id,a.target_variant_id,a.variant_name_snapshot,a.variant_code_snapshot,a.qty
   from private.group_claim_reshipment_allocations a where a.reshipment_id=r.id) x)
 ) order by r.reshipped_at,r.id),'[]'::jsonb)
 from public.order_claim_reshipments r where r.claim_id=p_claim;
$$;

create function private.claim_reshipment_targets_json(p_claim uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('shipmentId',t.shipment_id,'originName',t.origin_name,'collectionTracked',t.collection_tracked,
  'collectedAt',t.collected_at,'reshipped',exists(select 1 from public.order_claim_reshipments r where r.claim_id=p_claim and r.shipment_id is not distinct from t.shipment_id),
  'orderItemIds',to_jsonb(t.item_ids)) order by t.origin_name nulls last,t.shipment_id),'[]'::jsonb)
 from private.claim_reshipment_targets(p_claim) t;
$$;

-- 고객이 받는 교환 소포. 배송 건 기록과, 그 전의 클레임 단위 재출고(한 쌍)를 같은 모양으로 돌려준다.
-- 출고지 이름·처리자·사유·근거는 싣지 않는다.
create function private.order_claim_reshipment_parcels(p_order_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(p.parcel order by p.reshipped_at,p.reference,p.sort_key),'[]'::jsonb) from(
  select r.reshipped_at,c.reference,r.id::text sort_key,jsonb_build_object('claimId',c.id,'reshipmentId',r.id,'carrier',r.carrier,
   'trackingNumber',r.tracking_number,'reshippedAt',r.reshipped_at,'deliveredAt',r.delivered_at,'collectionWaived',r.collection_waived,
   'items',(select coalesce(jsonb_agg(jsonb_build_object('orderItemId',x.order_item_id,'name',x.name,'variantName',x.variant_name,'qty',x.qty) order by x.order_item_id),'[]'::jsonb) from(
    select ri.order_item_id,oi.good_name_snapshot name,ri.variant_name_snapshot variant_name,ri.qty
    from public.order_claim_reshipment_items ri join public.order_items oi on oi.id=ri.order_item_id where ri.reshipment_id=r.id
    union all
    select a.order_item_id,a.good_name_snapshot,a.variant_name_snapshot,a.qty from private.group_claim_reshipment_allocations a where a.reshipment_id=r.id) x)) parcel
  from public.order_claim_reshipments r join public.order_cancellation_requests c on c.id=r.claim_id
  where r.order_id=p_order_id and c.order_id=p_order_id
  union all
  select c.reshipped_at,c.reference,'',jsonb_build_object('claimId',c.id,'reshipmentId',null,'carrier',c.reship_carrier,
   'trackingNumber',c.reship_tracking_number,'reshippedAt',c.reshipped_at,'deliveredAt',c.reship_delivered_at,'collectionWaived',false,
   'items',(select coalesce(jsonb_agg(jsonb_build_object('orderItemId',x.order_item_id,'name',x.good_name_snapshot,'variantName',x.variant_name_snapshot,'qty',x.qty) order by x.order_item_id),'[]'::jsonb)
    from private.claim_reshipment_items_read(c.id) x))
  from public.order_cancellation_requests c
  where c.order_id=p_order_id and c.claim_type='exchange' and c.reshipped_at is not null and c.reship_carrier is not null and c.reship_tracking_number is not null
   and not exists(select 1 from public.order_claim_reshipments r where r.claim_id=c.id)
 ) p;
$$;

create function public.get_my_order_claim_reshipments(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 if actor is null or not exists(select 1 from public.orders o left join private.gift_intents gift on gift.order_id=o.id
  where o.id=p_order_id and((gift.id is null and o.user_id=actor) or gift.recipient_id=actor)) then
  raise no_data_found using message='order_not_found';
 end if;
 return private.order_claim_reshipment_parcels(p_order_id);
end $$;

-- 운영 상세에 배송 건별 재출고 대상·기록과 회수 생략 가능 여부를 더한다(다른 트랙이 같은 함수를 이어 고치므로 앵커 치환).
do $patch$
declare definition text:=pg_get_functiondef('public.admin_order_claim_detail(uuid)'::regprocedure);
 anchor text:='  return result || jsonb_build_object(''sellerIntake'', private.seller_claim_intake_json(p_claim_id),''gift'',private.gift_admin_claim_party(p_claim_id));';
 replacement text:='  -- 배송 건별 재출고(TKT-166·QNA-039): 대상 배송 건, 배송 건 재출고 기록, 회수 생략 가능 여부.
  if jsonb_typeof(result->''claim'')=''object'' then
    result:=jsonb_set(result,''{claim}'',(result->''claim'')||jsonb_build_object(''reshipmentTargets'',private.claim_reshipment_targets_json(p_claim_id),
      ''reshipments'',private.claim_reshipment_records_json(p_claim_id),
      ''collectionWaiverAllowed'',(select c.claim_type=''exchange'' and c.reason_type=''defect'' and c.collection_policy=''origin'' and c.collection_required
        from public.order_cancellation_requests c where c.id=p_claim_id)));
  end if;
  return result || jsonb_build_object(''sellerIntake'', private.seller_claim_intake_json(p_claim_id),''gift'',private.gift_admin_claim_party(p_claim_id));';
begin
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'admin_order_claim_detail anchor must appear once';end if;
 execute replace(definition,anchor,replacement);
end $patch$;

-- 연락처 이력의 최종 재배송지는 가장 최근 배송 건 확인 기록이다(배송 건마다 확인한다).
do $patch$
declare definition text:=pg_get_functiondef('public.service_read_order_claim_contact_history(uuid,uuid,uuid,uuid,text,integer,jsonb)'::regprocedure);
 anchor text:='into dest from private.order_claim_reshipment_destinations where claim_id=p_claim_id;';
 replacement text:='into dest from private.order_claim_reshipment_destinations where claim_id=p_claim_id order by confirmed_at desc,operation_id desc limit 1;';
begin
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'service_read_order_claim_contact_history anchor must appear once';end if;
 execute replace(definition,anchor,replacement);
end $patch$;

-- ---------------------------------------------------------------------------
-- 8. 권한 봉인과 운영자 계약
-- ---------------------------------------------------------------------------
revoke all on function private.claim_reshipment_targets(uuid) from public,anon,authenticated,service_role;
revoke all on function private.claim_reshipment_delivery_pending(public.order_cancellation_requests) from public,anon,authenticated,service_role;
revoke all on function private.claim_reshipment_selections_match(public.order_claim_reshipments,jsonb) from public,anon,authenticated,service_role;
revoke all on function private.claim_collections_complete(uuid) from public,anon,authenticated,service_role;
revoke all on function private.record_order_claim_shipment_reshipment(uuid,uuid,text,text,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function private.record_order_claim_reshipment_physical(uuid,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function private.order_all_items_delivered(uuid) from public,anon,authenticated,service_role;
revoke all on function private.contact_order_reshipment_pending(uuid) from public,anon,authenticated,service_role;
revoke all on function private.order_return_intake_eligible(uuid) from public,anon,authenticated,service_role;
revoke all on function private.contact_order_obligations(uuid) from public,anon,authenticated,service_role;
revoke all on function private.contact_retention(uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function private.contact_blocker(public.order_cancellation_requests,text,text) from public,anon,authenticated,service_role;
revoke all on function private.claim_reshipment_records_json(uuid) from public,anon,authenticated,service_role;
revoke all on function private.claim_reshipment_targets_json(uuid) from public,anon,authenticated,service_role;
revoke all on function private.order_claim_reshipment_parcels(uuid) from public,anon,authenticated,service_role;
revoke all on function public.service_record_order_claim_shipment_reshipment(uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb,jsonb,text,text,text,text,jsonb,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.service_record_order_claim_shipment_reshipment(uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb,jsonb,text,text,text,text,jsonb,jsonb,boolean) to service_role;
revoke all on function public.service_record_order_claim_reshipment_v2(uuid,uuid,uuid,uuid,uuid,integer,jsonb,jsonb,text,text,text,text,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.service_record_order_claim_reshipment_v2(uuid,uuid,uuid,uuid,uuid,integer,jsonb,jsonb,text,text,text,text,jsonb,boolean) to service_role;
revoke all on function public.admin_record_order_claim_shipment_reshipment_delivery(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_record_order_claim_shipment_reshipment_delivery(uuid,uuid,text) to authenticated;
revoke all on function public.admin_record_order_claim_reshipment_delivery(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_record_order_claim_reshipment_delivery(uuid,text) to authenticated;
revoke all on function public.get_my_gift_latest_claim(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_my_gift_latest_claim(uuid) to authenticated;
revoke all on function public.get_my_order_claim_reshipments(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_my_order_claim_reshipments(uuid) to authenticated;

select private.register_operator_rpc_contract('public.service_record_order_claim_shipment_reshipment(uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb,jsonb,text,text,text,text,jsonb,jsonb,boolean)'::regprocedure,'sales.manage','service_start',false);
select private.register_operator_rpc_contract('public.admin_record_order_claim_shipment_reshipment_delivery(uuid,uuid,text)'::regprocedure,'sales.manage','write',false);
select private.register_operator_internal_contract('private.record_order_claim_shipment_reshipment(uuid,uuid,text,text,jsonb,jsonb)'::regprocedure);
select private.register_operator_internal_contract('private.claim_reshipment_targets(uuid)'::regprocedure);
select private.register_operator_internal_contract('private.claim_reshipment_delivery_pending(public.order_cancellation_requests)'::regprocedure);

-- 재정의한 함수의 등록된 계약을 새 본문·ACL로 다시 적는다(분류는 기존 행 그대로).
do $$declare fn regprocedure;contract record;begin
 foreach fn in array array[
  'private.record_order_claim_reshipment_physical(uuid,text,text,jsonb)'::regprocedure,
  'public.service_record_order_claim_reshipment_v2(uuid,uuid,uuid,uuid,uuid,integer,jsonb,jsonb,text,text,text,text,jsonb,boolean)'::regprocedure,
  'public.admin_record_order_claim_reshipment_delivery(uuid,text)'::regprocedure,
  'private.order_all_items_delivered(uuid)'::regprocedure,
  'private.claim_collections_complete(uuid)'::regprocedure,
  'private.contact_order_reshipment_pending(uuid)'::regprocedure,
  'private.order_return_intake_eligible(uuid)'::regprocedure,
  'private.contact_order_obligations(uuid)'::regprocedure,
  'private.contact_retention(uuid,timestamptz)'::regprocedure,
  'private.contact_blocker(public.order_cancellation_requests,text,text)'::regprocedure,
  'public.get_my_gift_latest_claim(uuid)'::regprocedure,
  'public.service_read_order_claim_contact_history(uuid,uuid,uuid,uuid,text,integer,jsonb)'::regprocedure,
  'public.admin_order_claim_detail(uuid)'::regprocedure] loop
  select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure=fn;
  if found then perform private.register_operator_rpc_contract(fn,contract.capability,contract.guard_kind,contract.legacy_admin_only);
  elsif exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=fn) then
   perform private.register_operator_internal_contract(fn);
  end if;
 end loop;
end $$;

commit;
notify pgrst,'reload schema';
