-- DRAFT: preserve purchased rows; follow immutable stock succession only for
-- collected physical returns/exchanges, never checkout or stock adjustments.
create table private.group_stock_restorations (
 order_item_id uuid not null references public.order_items(id) on delete restrict,
 generation_kind text not null check(generation_kind in ('purchase','exchange')),
 generation_id uuid not null,
 original_good_id text not null,
 original_variant_id uuid not null,
 source_good_id text not null,
 source_variant_id uuid not null,
 target_good_id text not null,
 target_variant_id uuid not null,
 operation_path uuid[] not null,
 qty integer not null check(qty>0),
 cause text not null check(cause in ('refund','exchange')),
 claim_id uuid references public.order_cancellation_requests(id) on delete restrict,
 actor_id uuid references auth.users(id) on delete restrict,
 reason text,
 created_at timestamptz not null default clock_timestamp(),
 primary key(order_item_id,generation_kind,generation_id),
 foreign key(original_variant_id,original_good_id) references public.goods_variants(id,good_id) on delete restrict,
 foreign key(source_variant_id,source_good_id) references public.goods_variants(id,good_id) on delete restrict,
 foreign key(target_variant_id,target_good_id) references public.goods_variants(id,good_id) on delete restrict,
 check((cause='exchange')=(claim_id is not null))
);
create table private.group_claim_reshipment_receipts (
 claim_id uuid primary key references public.order_cancellation_requests(id) on delete restrict,
 actor_id uuid not null references auth.users(id) on delete restrict,
 carrier text not null,
 tracking_number text not null,
 selections jsonb not null check(jsonb_typeof(selections)='array'),
 created_at timestamptz not null default clock_timestamp()
);
create table private.group_claim_reshipment_allocations (
 claim_id uuid not null references private.group_claim_reshipment_receipts(claim_id) on delete restrict,
 order_item_id uuid not null references public.order_items(id) on delete restrict,
 original_good_id text not null,
 original_variant_id uuid not null,
 source_good_id text not null,
 source_variant_id uuid not null,
 source_generation_kind text not null check(source_generation_kind in ('purchase','exchange')),
 source_generation_id uuid not null,
 returned_good_id text not null,
 returned_variant_id uuid not null,
 operation_path uuid[] not null,
 target_good_id text not null,
 target_variant_id uuid not null,
 good_name_snapshot text not null,
 variant_name_snapshot text not null,
 variant_code_snapshot text not null,
 qty integer not null check(qty>0),
 primary key(claim_id,order_item_id),
 foreign key(original_variant_id,original_good_id) references public.goods_variants(id,good_id) on delete restrict,
 foreign key(source_variant_id,source_good_id) references public.goods_variants(id,good_id) on delete restrict,
 foreign key(returned_variant_id,returned_good_id) references public.goods_variants(id,good_id) on delete restrict,
 foreign key(target_variant_id,target_good_id) references public.goods_variants(id,good_id) on delete restrict
);
create index group_claim_reshipment_allocations_item on private.group_claim_reshipment_allocations(order_item_id);
alter table private.group_stock_restorations enable row level security;
alter table private.group_claim_reshipment_receipts enable row level security;
alter table private.group_claim_reshipment_allocations enable row level security;
revoke all on private.group_stock_restorations,private.group_claim_reshipment_receipts,private.group_claim_reshipment_allocations from public,anon,authenticated,service_role;
grant all on private.group_stock_restorations,private.group_claim_reshipment_receipts,private.group_claim_reshipment_allocations to postgres;
create trigger group_stock_restorations_immutable before update or delete on private.group_stock_restorations for each row execute function private.goods_group_immutable_history();
create trigger group_claim_reshipment_receipts_immutable before update or delete on private.group_claim_reshipment_receipts for each row execute function private.goods_group_immutable_history();
create trigger group_claim_reshipment_allocations_immutable before update or delete on private.group_claim_reshipment_allocations for each row execute function private.goods_group_immutable_history();

create function private.resolve_goods_stock_successor(p_good_id text,p_variant_id uuid)
returns table(good_id text,variant_id uuid,hop_count integer,operation_path uuid[])
language plpgsql stable security invoker set search_path='' as $$
declare edge private.goods_stock_successors%rowtype; seen uuid[];
begin
 good_id:=p_good_id;variant_id:=p_variant_id;hop_count:=0;operation_path:='{}';seen:=array[p_variant_id];
 loop
  if not exists(select 1 from public.goods_variants v where v.id=resolve_goods_stock_successor.variant_id and v.good_id=resolve_goods_stock_successor.good_id) then
   raise check_violation using message='goods_stock_successor_pair_invalid';
  end if;
  select * into edge from private.goods_stock_successors s where s.source_variant_id=resolve_goods_stock_successor.variant_id;
  if not found then return next;return;end if;
  if edge.source_good_id<>good_id or edge.target_variant_id=any(seen) or hop_count>=128 then
   raise check_violation using message='goods_stock_successor_invalid';
  end if;
  good_id:=edge.target_good_id;variant_id:=edge.target_variant_id;hop_count:=hop_count+1;
  operation_path:=array_append(operation_path,edge.operation_id);seen:=array_append(seen,variant_id);
 end loop;
end;
$$;

-- One safe projection for all actual exchange allocations. Original purchase
-- identity remains explicit; the physical label comes from the shipment receipt.
create function private.claim_reshipment_items_read(p_claim_id uuid)
returns table(order_item_id uuid,original_good_id text,original_variant_id uuid,
 source_good_id text,source_variant_id uuid,good_id text,variant_id uuid,
 good_name_snapshot text,variant_name_snapshot text,variant_code_snapshot text,qty integer)
language sql stable security invoker set search_path='' as $$
 select a.order_item_id,a.original_good_id,a.original_variant_id,a.source_good_id,a.source_variant_id,
  a.target_good_id,a.target_variant_id,a.good_name_snapshot,a.variant_name_snapshot,a.variant_code_snapshot,a.qty
 from private.group_claim_reshipment_allocations a where a.claim_id=p_claim_id
 union all
 select r.order_item_id,oi.good_id,oi.variant_id,r.good_id,r.source_variant_id,r.good_id,r.variant_id,
  oi.good_name_snapshot,r.variant_name_snapshot,r.variant_code_snapshot,r.qty
 from public.order_claim_reshipment_items r join public.order_items oi on oi.id=r.order_item_id
 where r.claim_id=p_claim_id;
$$;

create function private.order_item_physical_unit(p_item_id uuid)
returns table(good_id text,variant_id uuid,generation_kind text,generation_id uuid,qty integer,
 good_name_snapshot text,variant_name_snapshot text,variant_code_snapshot text)
language sql stable security invoker set search_path='' as $$
 select physical.good_id,physical.variant_id,physical.generation_kind,physical.generation_id,oi.qty,
  physical.good_name_snapshot,physical.variant_name_snapshot,physical.variant_code_snapshot
 from public.order_items oi
 cross join lateral (
  select r.good_id,r.variant_id,'exchange'::text generation_kind,c.id generation_id,
   r.good_name_snapshot,r.variant_name_snapshot,r.variant_code_snapshot,1 priority,c.reshipped_at,c.reference
  from public.order_cancellation_requests c cross join lateral private.claim_reshipment_items_read(c.id) r
  where c.order_id=oi.order_id and c.stage='completed' and c.reshipped_at is not null and r.order_item_id=oi.id
  union all
  select oi.good_id,oi.variant_id,'purchase',oi.id,oi.good_name_snapshot,oi.variant_name_snapshot,
   oi.variant_code_snapshot,0,null,null
  order by priority desc,reshipped_at desc,reference desc limit 1
 ) physical where oi.id=p_item_id;
$$;

-- This compatibility UUID is only a display/unused legacy-finalizer alias.
-- Every stock writer below consumes the full physical tuple instead.
create or replace function private.order_item_stock_variant(target_item_id uuid)
returns uuid language sql stable security invoker set search_path='' as $$
 select variant_id from private.order_item_physical_unit(target_item_id);
$$;

-- Callers may already own an order or original good lock. Never block on the
-- topology lock: a converter can be waiting on that original good. PT409 asks
-- the entire operation to retry, preventing an advisory/row-lock cycle.
create function private.lock_goods_stock_successor_topology() returns void
language plpgsql security invoker set search_path='' as $$
begin
 if not pg_try_advisory_xact_lock_shared(hashtextextended('goods-stock-successor-topology:v1',0)) then
  raise sqlstate 'PT409' using message='goods_group_retry';
 end if;
end;
$$;

-- A batch owns every involved good before any variant. Validate final per-option
-- and aggregate integer bounds before applying negative deltas first, so a swap
-- at the aggregate ceiling has no transient overflow.
create function private.apply_group_physical_stock_deltas(p_deltas jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare item record;
begin
 if jsonb_typeof(p_deltas) is distinct from 'array' or jsonb_array_length(p_deltas)>2000 then
  raise check_violation using message='group_stock_deltas_invalid';
 end if;
 perform 1 from public.goods g where g.id in(select x->>'goodId' from jsonb_array_elements(p_deltas) x) order by g.id for update nowait;
 perform 1 from public.goods_variants v where v.id in(select (x->>'variantId')::uuid from jsonb_array_elements(p_deltas) x) order by v.id for update nowait;
 for item in select x->>'goodId' good_id,(x->>'variantId')::uuid variant_id,sum((x->>'delta')::bigint) delta
  from jsonb_array_elements(p_deltas) x group by 1,2 loop
  if not exists(select 1 from public.goods_variants v where v.id=item.variant_id and v.good_id=item.good_id) then
   raise check_violation using message='goods_stock_successor_pair_invalid';
  end if;
  if (select v.stock_qty::bigint+item.delta from public.goods_variants v where v.id=item.variant_id) not between 0 and 2147483647 then
   raise check_violation using message='insufficient_or_overflowing_stock';
  end if;
 end loop;
 for item in select x->>'goodId' good_id,sum((x->>'delta')::bigint) delta from jsonb_array_elements(p_deltas) x group by 1 loop
  if (select coalesce(sum(v.stock_qty::bigint),0)+item.delta from public.goods_variants v where v.good_id=item.good_id) not between 0 and 2147483647 then
   raise check_violation using message='stock_aggregate_overflow';
  end if;
 end loop;
 for item in select x->>'goodId' good_id,(x->>'variantId')::uuid variant_id,sum((x->>'delta')::bigint) delta
  from jsonb_array_elements(p_deltas) x group by 1,2 having sum((x->>'delta')::bigint)<>0 order by 1,3,2 loop
  perform private.change_goods_variant_stock(item.good_id,item.variant_id,item.delta::bigint);
 end loop;
exception when lock_not_available then raise sqlstate 'PT409' using message='goods_group_retry';
end;
$$;

create or replace function private.restore_order_item_supply(p_order_item_id uuid,p_reason text)
returns void language plpgsql security invoker set search_path='' as $$
declare item public.order_items;reservation private.goods_preorder_reservations;physical record;target record;
 reason_value text:=coalesce(nullif(btrim(p_reason),''),'주문 전체 취소');affected boolean;inserted integer;
begin
 select * into item from public.order_items where id=p_order_item_id;
 if not found then raise no_data_found using message='order_item_not_found';end if;
 -- All public writers own this order first; the reentrant lock also protects
 -- internal direct retries from restoring one physical generation twice.
 perform 1 from public.orders where id=item.order_id for update;
 perform private.lock_goods_stock_successor_topology();
 select * into physical from private.order_item_physical_unit(item.id);
 select * into target from private.resolve_goods_stock_successor(physical.good_id,physical.variant_id);
 perform 1 from public.goods where id=any(array[item.good_id,physical.good_id,target.good_id]) order by id for update nowait;
 perform 1 from public.goods_variants where id=any(array[item.variant_id,physical.variant_id,target.variant_id]) order by id for update nowait;
 if item.supply_source='preorder' then
  select * into reservation from private.goods_preorder_reservations where order_item_id=item.id for update;
  if not found then raise check_violation using message='preorder_reservation_missing';end if;
  if reservation.state in ('released','returned') then return;end if;
  if reservation.state='reserved' then
   update private.goods_preorder_reservations set state='released',released_at=clock_timestamp(),released_by=auth.uid(),release_reason=reason_value where order_item_id=item.id;
   insert into public.audit_log(actor_id,action,target,diff) values(auth.uid(),'order.preorder_capacity_released','order:'||item.order_id::text,
    jsonb_build_object('orderItemId',item.id,'goodId',item.good_id,'variantId',item.variant_id,'policyId',reservation.policy_id,'qty',item.qty,'physicalStockDelta',0,'reason',reason_value));
   return;
  end if;
 end if;
 affected:=target.hop_count>0 or physical.good_id<>item.good_id or exists(select 1 from private.group_claim_reshipment_allocations where order_item_id=item.id);
 if affected then
  insert into private.group_stock_restorations(order_item_id,generation_kind,generation_id,original_good_id,original_variant_id,
   source_good_id,source_variant_id,target_good_id,target_variant_id,operation_path,qty,cause,actor_id,reason)
  values(item.id,physical.generation_kind,physical.generation_id,item.good_id,item.variant_id,
   physical.good_id,physical.variant_id,target.good_id,target.variant_id,target.operation_path,item.qty,'refund',auth.uid(),reason_value)
  on conflict do nothing;
  get diagnostics inserted=row_count;
  if inserted=0 then return;end if;
 end if;
 perform private.apply_group_physical_stock_deltas(jsonb_build_array(jsonb_build_object('goodId',target.good_id,'variantId',target.variant_id,'delta',item.qty)));
 if item.supply_source='preorder' then
  update private.goods_preorder_reservations set state='returned',released_at=clock_timestamp(),released_by=auth.uid(),release_reason=reason_value where order_item_id=item.id;
 end if;
 insert into public.audit_log(actor_id,action,target,diff) values(auth.uid(),'order.option_stock_restored','order:'||item.order_id::text,
  jsonb_build_object('orderItemId',item.id,'goodId',target.good_id,'variantId',target.variant_id,'delta',item.qty,
   'originalGoodId',item.good_id,'originalVariantId',item.variant_id,'physicalGoodId',physical.good_id,'physicalVariantId',physical.variant_id,
   'generationKind',physical.generation_kind,'generationId',physical.generation_id,'operationPath',target.operation_path,
   'supplySource',item.supply_source,'preorderPolicyId',item.preorder_policy_id,'reason',p_reason));
exception when lock_not_available then raise sqlstate 'PT409' using message='goods_group_retry';
end;
$$;

create function private.order_item_reshipment_options(p_item_id uuid)
returns table(good_id text,variant_id uuid,good_name text,variant_name text,variant_code text,stock_qty integer,is_current boolean)
language sql stable security invoker set search_path='' as $$
 with physical as (select * from private.order_item_physical_unit(p_item_id)),
 current_unit as (select target.* from physical cross join lateral private.resolve_goods_stock_successor(physical.good_id,physical.variant_id) target),
 current_group as (select m.group_id from current_unit c join private.goods_group_members m on m.good_id=c.good_id and m.variant_id=c.variant_id
  join private.goods_groups g on g.id=m.group_id and g.archived_at is null)
 select v.good_id,v.id,g.name,v.name,v.code,v.stock_qty,v.id=c.variant_id
 from current_unit c join public.goods_variants v on v.id=c.variant_id
  or (not exists(select 1 from current_group) and v.good_id=c.good_id and v.archived_at is null)
  or (v.archived_at is null and exists(select 1 from private.goods_group_members m join current_group cg on cg.group_id=m.group_id where m.variant_id=v.id and m.good_id=v.good_id))
 join public.goods g on g.id=v.good_id
 where v.id=c.variant_id or (g.archived_at is null and v.archived_at is null)
 order by (v.id=c.variant_id) desc,g.name,v.sort_order,v.id;
$$;

create function private.record_group_claim_reshipment(p_claim_id uuid,p_carrier text,p_tracking text,p_selections jsonb)
returns text language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid();claim public.order_cancellation_requests;order_state public.order_status;receipt private.group_claim_reshipment_receipts;
 item public.order_items;physical record;target record;choice record;selected_variant uuid;allocations jsonb:='[]';entry jsonb;
 good_ids text[];variant_ids uuid[];deltas jsonb;shipped_items jsonb;inserted integer;
begin
 perform private.require_operator_capability('sales.manage',false);
 select * into claim from public.order_cancellation_requests where id=p_claim_id;
 if not found then raise no_data_found using message='claim_not_found';end if;
 select status into order_state from public.orders where id=claim.order_id for update;
 select * into claim from public.order_cancellation_requests where id=p_claim_id for update;
 if claim.claim_type<>'exchange' then raise check_violation using message='claim_type_has_no_reshipment';end if;
 select * into receipt from private.group_claim_reshipment_receipts where claim_id=p_claim_id;
 if found then
  if claim.stage='completed' and receipt.actor_id=actor and receipt.carrier=p_carrier and receipt.tracking_number=p_tracking and receipt.selections=p_selections then return 'completed';end if;
  raise unique_violation using message='reshipment_conflict';
 end if;
 if claim.stage='completed' or exists(select 1 from public.order_claim_reshipment_items where claim_id=p_claim_id) then
  raise unique_violation using message='reshipment_conflict';
 end if;
 perform private.assert_claim_collections_complete(p_claim_id);
 if claim.stage<>'collected' or order_state not in ('delivered','done') or exists(select 1 from public.order_cancellation_claims where order_id=claim.order_id) then
  raise check_violation using message='claim_not_reshippable';
 end if;
 if not exists(select 1 from public.shipping_carriers where code=p_carrier and is_active) then raise check_violation using message='unknown shipping carrier';end if;
 if exists(select 1 from jsonb_array_elements(p_selections) x where not exists(select 1 from public.order_items oi where oi.id=(x->>'orderItemId')::uuid and oi.order_id=claim.order_id)) then
  raise check_violation using message='invalid reshipment items';
 end if;
 perform private.lock_goods_stock_successor_topology();
 for item in select * from public.order_items where order_id=claim.order_id order by good_id,id loop
  select * into physical from private.order_item_physical_unit(item.id);
  select * into target from private.resolve_goods_stock_successor(physical.good_id,physical.variant_id);
  select (x->>'variantId')::uuid into selected_variant from jsonb_array_elements(p_selections) x where (x->>'orderItemId')::uuid=item.id;
  selected_variant:=coalesce(selected_variant,target.variant_id);
  select * into choice from private.order_item_reshipment_options(item.id) where variant_id=selected_variant;
  if not found then raise check_violation using message='reshipment_variant_unavailable';end if;
  allocations:=allocations||jsonb_build_array(jsonb_build_object('orderItemId',item.id,'originalGoodId',item.good_id,'originalVariantId',item.variant_id,
   'sourceGoodId',physical.good_id,'sourceVariantId',physical.variant_id,'generationKind',physical.generation_kind,'generationId',physical.generation_id,
   'returnedGoodId',target.good_id,'returnedVariantId',target.variant_id,'operationPath',to_jsonb(target.operation_path),
   'goodId',choice.good_id,'variantId',choice.variant_id,'goodName',choice.good_name,'variantName',choice.variant_name,'variantCode',choice.variant_code,'qty',item.qty));
 end loop;
 if jsonb_array_length(allocations) not between 1 and 1000 then raise check_violation using message='invalid reshipment items';end if;
 select array_agg(distinct id order by id) into good_ids from (
  select x->>'originalGoodId' id from jsonb_array_elements(allocations) x union select x->>'sourceGoodId' from jsonb_array_elements(allocations) x
  union select x->>'returnedGoodId' from jsonb_array_elements(allocations) x union select x->>'goodId' from jsonb_array_elements(allocations) x) ids;
 select array_agg(distinct id order by id) into variant_ids from (
  select (x->>'originalVariantId')::uuid id from jsonb_array_elements(allocations) x union select (x->>'sourceVariantId')::uuid from jsonb_array_elements(allocations) x
  union select (x->>'returnedVariantId')::uuid from jsonb_array_elements(allocations) x union select (x->>'variantId')::uuid from jsonb_array_elements(allocations) x) ids;
 perform 1 from public.goods where id=any(good_ids) order by id for update nowait;
 perform 1 from public.goods_variants where id=any(variant_ids) order by id for update nowait;
 -- Metadata and availability are read again after locks; topology remains fixed.
 for entry in select value from jsonb_array_elements(allocations) loop
  if not exists(select 1 from private.order_item_reshipment_options((entry->>'orderItemId')::uuid) where variant_id=(entry->>'variantId')::uuid) then
   raise sqlstate 'PT409' using message='reshipment_variant_unavailable';
  end if;
 end loop;
 insert into private.group_claim_reshipment_receipts(claim_id,actor_id,carrier,tracking_number,selections) values(p_claim_id,actor,p_carrier,p_tracking,p_selections);
 for entry in select value from jsonb_array_elements(allocations) loop
  insert into private.group_stock_restorations(order_item_id,generation_kind,generation_id,original_good_id,original_variant_id,
   source_good_id,source_variant_id,target_good_id,target_variant_id,operation_path,qty,cause,claim_id,actor_id,reason)
  values((entry->>'orderItemId')::uuid,entry->>'generationKind',(entry->>'generationId')::uuid,entry->>'originalGoodId',(entry->>'originalVariantId')::uuid,
   entry->>'sourceGoodId',(entry->>'sourceVariantId')::uuid,entry->>'returnedGoodId',(entry->>'returnedVariantId')::uuid,
   array(select value::uuid from jsonb_array_elements_text(entry->'operationPath')),(entry->>'qty')::integer,'exchange',p_claim_id,actor,'교환 회수품 입고') on conflict do nothing;
  get diagnostics inserted=row_count;
  if inserted<>1 then raise check_violation using message='physical_generation_already_restored';end if;
  insert into private.group_claim_reshipment_allocations(claim_id,order_item_id,original_good_id,original_variant_id,source_good_id,source_variant_id,
   source_generation_kind,source_generation_id,returned_good_id,returned_variant_id,operation_path,target_good_id,target_variant_id,
   good_name_snapshot,variant_name_snapshot,variant_code_snapshot,qty)
  select p_claim_id,(entry->>'orderItemId')::uuid,entry->>'originalGoodId',(entry->>'originalVariantId')::uuid,entry->>'sourceGoodId',(entry->>'sourceVariantId')::uuid,
   entry->>'generationKind',(entry->>'generationId')::uuid,entry->>'returnedGoodId',(entry->>'returnedVariantId')::uuid,
   array(select value::uuid from jsonb_array_elements_text(entry->'operationPath')),entry->>'goodId',(entry->>'variantId')::uuid,g.name,v.name,v.code,(entry->>'qty')::integer
  from public.goods g join public.goods_variants v on v.good_id=g.id where v.id=(entry->>'variantId')::uuid and g.id=entry->>'goodId';
 end loop;
 select jsonb_agg(value) into deltas from (
  select jsonb_build_object('goodId',a.returned_good_id,'variantId',a.returned_variant_id,'delta',a.qty) value from private.group_claim_reshipment_allocations a where claim_id=p_claim_id
  union all select jsonb_build_object('goodId',a.target_good_id,'variantId',a.target_variant_id,'delta',-a.qty) from private.group_claim_reshipment_allocations a where claim_id=p_claim_id) movement;
 perform private.apply_group_physical_stock_deltas(deltas);
 select coalesce(jsonb_agg(jsonb_build_object('orderItemId',r.order_item_id,'originalGoodId',r.original_good_id,'sourceGoodId',r.source_good_id,'sourceVariantId',r.source_variant_id,
  'goodId',r.good_id,'variantId',r.variant_id,'qty',r.qty) order by r.order_item_id),'[]') into shipped_items from private.claim_reshipment_items_read(p_claim_id) r;
 update public.order_cancellation_requests set stage='completed',reship_carrier=p_carrier,reship_tracking_number=p_tracking,reshipped_at=clock_timestamp(),completed_at=clock_timestamp(),updated_at=clock_timestamp() where id=p_claim_id;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.order.claim_reshipped','order:'||claim.order_id::text,
  jsonb_build_object('claimId',p_claim_id,'claimType','exchange','from','collected','to','completed','carrier',p_carrier,'items',shipped_items));
 perform private.notify_order_claim(p_claim_id,'reshipped','교환 상품이 재출고됐어요','교환 상품을 새 운송장으로 발송했습니다.');
 return 'completed';
exception when lock_not_available then raise sqlstate 'PT409' using message='goods_group_retry';
end;
$$;

-- Existing same-product exchange behavior remains the fallback.
CREATE OR REPLACE FUNCTION public.admin_record_order_claim_reshipment(p_claim_id uuid, p_carrier text, p_tracking_number text, p_items jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid:=(select auth.uid()); selected_order uuid; order_status public.order_status;
  claim public.order_cancellation_requests; item record; selected_variant uuid; source_variant uuid;
  variant public.goods_variants; carrier text:=nullif(btrim(p_carrier),''); tracking text:=nullif(btrim(p_tracking_number),'');
  selections jsonb; requested jsonb; shipped_items jsonb;
begin
  perform private.require_operator_capability('sales.manage',false);

  if actor is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required'; end if;
  if carrier is null or tracking is null or tracking!~'^[A-Z0-9]{8,30}$' then raise check_violation using message='invalid reshipment tracking'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)>1000 then raise check_violation using message='invalid reshipment items'; end if;
  for requested in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(requested) is distinct from 'object' or not(requested ?& array['orderItemId','variantId'])
      or (select count(*) from jsonb_object_keys(requested))<>2
      or (requested->>'orderItemId') is null or (requested->>'variantId') is null
      or requested->>'orderItemId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or requested->>'variantId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then raise check_violation using message='invalid reshipment items'; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_items) x group by (x->>'orderItemId')::uuid having count(*)>1) then
    raise check_violation using message='invalid reshipment items';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('orderItemId',(x->>'orderItemId')::uuid,'variantId',(x->>'variantId')::uuid)
    order by (x->>'orderItemId')::uuid),'[]') into selections from jsonb_array_elements(p_items) x;
  select order_id into selected_order from public.order_cancellation_requests where id=p_claim_id;
  if not found then raise no_data_found using message='claim_not_found'; end if;
  -- Cancellation, payment finalization and claim operations all lock order first.
  select status into order_status from public.orders where id=selected_order for update;
  select * into claim from public.order_cancellation_requests where id=p_claim_id for update;
  if claim.claim_type<>'exchange' then raise exception using message='claim_type_has_no_reshipment'; end if;
  perform private.lock_goods_stock_successor_topology();
  if exists(select 1 from private.group_claim_reshipment_receipts where claim_id=p_claim_id)
    or (claim.stage<>'completed' and (
      exists(select 1 from public.order_items oi cross join lateral private.order_item_physical_unit(oi.id) unit
        where oi.order_id=selected_order and (unit.good_id<>oi.good_id
          or exists(select 1 from private.goods_stock_successors where source_variant_id=unit.variant_id)
          or exists(select 1 from private.goods_group_members where variant_id=unit.variant_id)
          or exists(select 1 from private.group_claim_reshipment_allocations where order_item_id=oi.id)))
      or exists(select 1 from jsonb_array_elements(selections) x join public.order_items oi on oi.id=(x->>'orderItemId')::uuid
        join public.goods_variants v on v.id=(x->>'variantId')::uuid where oi.good_id<>v.good_id))) then
    return private.record_group_claim_reshipment(p_claim_id,carrier,tracking,selections);
  end if;
  if claim.stage='completed' then
    if claim.reship_carrier=carrier and claim.reship_tracking_number=tracking and not exists(
      select 1 from jsonb_array_elements(selections) selected where not exists(
        select 1 from public.order_claim_reshipment_items shipped where shipped.claim_id=p_claim_id
          and shipped.order_item_id=(selected->>'orderItemId')::uuid and shipped.variant_id=(selected->>'variantId')::uuid))
      then return 'completed'; end if;
    raise unique_violation using message='reshipment_conflict';
  end if;
  perform private.assert_claim_collections_complete(p_claim_id);
  if claim.stage<>'collected' or order_status not in('delivered','done')
    or exists(select 1 from public.order_cancellation_claims where order_id=selected_order)
    then raise exception using message='claim_not_reshippable'; end if;
  if not exists(select 1 from public.shipping_carriers c where c.code=carrier and c.is_active) then raise check_violation using message='unknown shipping carrier'; end if;
  if exists(select 1 from jsonb_array_elements(selections) selected where not exists(
    select 1 from public.order_items oi where oi.id=(selected->>'orderItemId')::uuid and oi.order_id=selected_order)) then
    raise check_violation using message='invalid reshipment items';
  end if;
  perform 1 from public.goods g where g.id in(select good_id from public.order_items where order_id=selected_order) order by g.id for update;
  for item in select * from public.order_items where order_id=selected_order order by good_id,id loop
    source_variant:=private.order_item_stock_variant(item.id);
    select (selected->>'variantId')::uuid into selected_variant from jsonb_array_elements(selections) selected where (selected->>'orderItemId')::uuid=item.id;
    selected_variant:=coalesce(selected_variant,source_variant);
    select * into variant from public.goods_variants where id=selected_variant and good_id=item.good_id;
    if not found or (variant.archived_at is not null and selected_variant<>source_variant) then raise check_violation using message='reshipment_variant_unavailable'; end if;
    insert into public.order_claim_reshipment_items(claim_id,order_item_id,good_id,source_variant_id,variant_id,variant_name_snapshot,variant_code_snapshot,qty)
      values(p_claim_id,item.id,item.good_id,source_variant,selected_variant,variant.name,variant.code,item.qty);
  end loop;
  -- Net all returned/shipped options first. A two-line blue/red swap also works
  -- with no spare stock; every recovered unit belongs to this collected claim.
  for item in select changes.good_id,changes.variant_id,sum(changes.delta)::bigint delta from (
    select good_id,source_variant_id variant_id,qty::bigint delta from public.order_claim_reshipment_items where claim_id=p_claim_id
    union all select good_id,variant_id,-qty::bigint from public.order_claim_reshipment_items where claim_id=p_claim_id
  ) changes group by changes.good_id,changes.variant_id having sum(changes.delta)<>0 order by changes.good_id,delta desc,changes.variant_id loop
    perform private.change_goods_variant_stock(item.good_id,item.variant_id,item.delta::bigint);
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('orderItemId',order_item_id,'goodId',good_id,'sourceVariantId',source_variant_id,'variantId',variant_id,'qty',qty) order by order_item_id),'[]')
    into shipped_items from public.order_claim_reshipment_items where claim_id=p_claim_id;
  update public.order_cancellation_requests set stage='completed',reship_carrier=carrier,reship_tracking_number=tracking,
    reshipped_at=now(),completed_at=now(),updated_at=now() where id=p_claim_id;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.order.claim_reshipped','order:'||selected_order::text,
    jsonb_build_object('claimId',p_claim_id,'claimType','exchange','from','collected','to','completed','carrier',carrier,'items',shipped_items));
  perform private.notify_order_claim(p_claim_id,'reshipped','교환 상품이 재출고됐어요','교환 상품을 새 운송장으로 발송했습니다.');
  return 'completed';
end $function$
;

CREATE OR REPLACE FUNCTION private.admin_order_claim_detail_before_operational_fee(p_claim_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_claim record;
  v_result jsonb;
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  select request.*
  into v_claim
  from public.order_cancellation_requests as request
  where request.id = p_claim_id;

  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'claim', jsonb_build_object(
      'id', v_claim.id,
      'collectionPolicy',v_claim.collection_policy,
      'collectionComplete',private.claim_collections_complete(v_claim.id),
      'collections',private.claim_collection_records(v_claim.id),
      'reference', v_claim.reference,
      'orderId', v_claim.order_id,
      'claimType', v_claim.claim_type,
      'stage', v_claim.stage,
      'status', v_claim.status,
      'reason', v_claim.reason,
      'reasonType', v_claim.reason_type,
      'decisionNote', v_claim.decision_note,
      'holdReason', v_claim.hold_reason,
      'heldAt', v_claim.held_at,
      -- 보류를 풀었을 때 돌아갈 단계. 화면이 이 값을 봐야 processing에서 건 보류에
      -- 거부 버튼을 그리지 않는다(DB의 claim_not_rejectable와 같은 판정).
      'heldFrom', v_claim.held_from,
      'requestedAt', v_claim.requested_at,
      'decidedAt', v_claim.decided_at,
      'collectingAt', v_claim.collecting_at,
      'collectedAt', v_claim.collected_at,
      'completedAt', v_claim.completed_at,
      'reshipCarrier', v_claim.reship_carrier,
      'reshipTrackingNumber', v_claim.reship_tracking_number,
      'reshippedAt', v_claim.reshipped_at,
      'reshipDeliveredAt', v_claim.reship_delivered_at,
      'reshipDeliveredBy', v_claim.reship_delivered_by,
      'reshipDeliveredByName', (select nickname from public.profiles where id=v_claim.reship_delivered_by),
      'reshipDeliveryEvidence', v_claim.reship_delivery_evidence,
      'reshippedItems', (select coalesce(jsonb_agg(jsonb_build_object('orderItemId',r.order_item_id,'name',r.good_name_snapshot,'goodId',r.good_id,'originalGoodId',r.original_good_id,
        'variantId',r.variant_id,'variantName',r.variant_name_snapshot,'variantCode',r.variant_code_snapshot,'qty',r.qty) order by r.order_item_id),'[]')
        from private.claim_reshipment_items_read(v_claim.id) r),
      'lastErrorCode', v_claim.last_error_code,
      'handlerName', (
        select handler.nickname
        from public.profiles as handler
        where handler.id = v_claim.decided_by
      )
    ),
    'order', (
      select jsonb_build_object(
        'id', orders.id,
        'status', orders.status,
        'total', orders.total,
        'shippingFee', orders.shipping_fee,
        'createdAt', orders.created_at,
        'deliveredAt', orders.delivered_at,
        'shipments', private.order_shipment_records(orders.id),
        'buyerName', profile.nickname,
        'buyerEmail', profile.email,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', item.id,
            'goodId', item.good_id,
            'variantId', item.variant_id,
            'variantName', item.variant_name_snapshot,
            'currentVariantId', (select variant_id from private.order_item_reshipment_options(item.id) where is_current),
            'currentGoodId', (select good_id from private.order_item_reshipment_options(item.id) where is_current),
            'options', (select coalesce(jsonb_agg(jsonb_build_object('id',v.variant_id,'goodId',v.good_id,'goodName',v.good_name,'name',v.variant_name,'code',v.variant_code,'stockQty',v.stock_qty)
              order by v.is_current desc,v.good_name,v.variant_name,v.variant_id),'[]') from private.order_item_reshipment_options(item.id) v),
            'name', item.good_name_snapshot,
            'qty', item.qty,
            'unitPrice', item.unit_price
          ) order by item.id)
          from public.order_items as item
          where item.order_id = orders.id
        ), '[]'::jsonb)
      )
      from public.orders as orders
      join public.profiles as profile on profile.id = orders.user_id
      where orders.id = v_claim.order_id
    ),
    'payment', (
      select jsonb_build_object(
        'id', payment.id,
        'provider', payment.provider,
        'status', payment.status,
        'amount', payment.amount,
        'createdAt', payment.created_at
      )
      from public.payments as payment
      where payment.purpose = 'order'
        and payment.ref_id = v_claim.order_id
        and payment.status <> 'failed'
      order by payment.created_at desc, payment.id desc
      limit 1
    ),
    'refund', (
      select jsonb_build_object(
        'status', refund.status,
        'amount', refund.amount,
        'method', refund.method,
        'filedAt', refund.filed_at,
        'completedAt', refund.completed_at,
        'settlementNote', refund.settlement_note,
        'handlerName', (
          select handler.nickname
          from public.profiles as handler
          where handler.id = refund.handled_by
        )
      )
      from public.refunds as refund
      join public.payments as payment on payment.id = refund.payment_id
      where payment.purpose = 'order'
        and payment.ref_id = v_claim.order_id
      order by refund.created_at desc, refund.id desc
      limit 1
    ),
    -- 뽑기권 발급/사용 여부. 취소·반품 완료 시 회수 대상이 남아 있는지를
    -- 운영자가 승인 전에 봐야 한다(약관 제17조).
    'cardPacks', (
      select jsonb_build_object(
        'issued', count(*),
        'consumed', count(*) filter (where ticket.consumed_at is not null),
        'revoked', count(*) filter (where ticket.revoked_at is not null)
      )
      from public.draw_tickets as ticket
      where ticket.source = 'order_paid'
        and ticket.source_id = v_claim.order_id
    ),
    'refundAccount', (
      select jsonb_build_object(
        'maskedAccount', account.masked_account,
        'maskedHolder', account.masked_holder,
        'purgeAfter', account.purge_after,
        'purgedAt', account.purged_at
      )
      from private.claim_refund_accounts as account
      where account.claim_id = v_claim.id
    ),
    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object(
        'action', entry.action,
        'createdAt', entry.created_at,
        'diff', entry.diff,
        'actorName', (
          select actor.nickname
          from public.profiles as actor
          where actor.id = entry.actor_id
        )
      ) order by entry.created_at, entry.id)
      from public.audit_log as entry
      where entry.target = 'order:' || v_claim.order_id::text
        -- 레거시 감사 액션(admin.order.cancellation_*)도 같은 클레임의 이력이다.
        -- 'claim'만 찾으면 #252 이전 경로로 처리된 건의 타임라인이 비어 보인다.
        and (entry.action like '%claim%' or entry.action like '%cancellation%')
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.order_claim_type_change_blocker(p_claim order_cancellation_requests)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select case
 when p_claim.claim_type not in('return','exchange') then 'claim_conversion_type_unavailable'
 when (case when p_claim.stage='on_hold' then coalesce(p_claim.held_from,'requested') else p_claim.stage end)
  not in('requested','in_review','collecting','collected') then 'claim_conversion_stage_unavailable'
 when p_claim.reshipped_at is not null or p_claim.reship_tracking_number is not null
  or exists(select 1 from private.claim_reshipment_items_read(p_claim.id)) then 'claim_conversion_reshipped'
 when exists(select 1 from public.order_cancellation_claims where order_id=p_claim.order_id)
  or exists(select 1 from public.refunds r join public.payments p on p.id=r.payment_id where p.purpose='order' and p.ref_id=p_claim.order_id)
  or exists(select 1 from public.orders where id=p_claim.order_id and status='canceled') then 'claim_conversion_finance_started'
 else null end;
$function$
;

CREATE OR REPLACE FUNCTION private.order_claim_reason_blocker(p_claim order_cancellation_requests)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select case
 when p_claim.claim_type<>'exchange' then 'claim_reason_type_unavailable'
 when p_claim.stage='on_hold' and p_claim.held_from is null then 'claim_reason_stage_unavailable'
 when (case when p_claim.stage='on_hold' then p_claim.held_from else p_claim.stage end)
  not in('requested','in_review','collecting','collected') then 'claim_reason_stage_unavailable'
 when p_claim.reshipped_at is not null or p_claim.reship_tracking_number is not null
  or exists(select 1 from private.claim_reshipment_items_read(p_claim.id)) then 'claim_reason_reshipped'
 when exists(select 1 from public.order_cancellation_claims where order_id=p_claim.order_id)
  or exists(select 1 from public.refunds r join public.payments p on p.id=r.payment_id where p.purpose='order' and p.ref_id=p_claim.order_id)
  or exists(select 1 from public.orders where id=p_claim.order_id and status='canceled') then 'claim_reason_finance_started'
 else null end;
$function$
;

create function private.order_claim_reshipment_history(p_order_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$declare result jsonb;begin
 select coalesce(jsonb_agg(jsonb_build_object('claimId',c.id,'reshippedAt',c.reshipped_at,'items',(
  select coalesce(jsonb_agg(jsonb_build_object('orderItemId',r.order_item_id,'goodId',r.good_id,'name',r.good_name_snapshot,
   'variantId',r.variant_id,'variantName',r.variant_name_snapshot,'variantCode',r.variant_code_snapshot,'qty',r.qty) order by r.order_item_id),'[]')
  from private.claim_reshipment_items_read(c.id) r)) order by c.reshipped_at,c.reference),'[]') into result
 from public.order_cancellation_requests c where c.order_id=p_order_id and c.stage='completed' and c.reshipped_at is not null
  and exists(select 1 from private.claim_reshipment_items_read(c.id));
 return result;end;$$;

-- Customer read is scoped to the actual recipient. Gift payer projections keep
-- their existing privacy contract (no recipient exchange fulfillment details).
create function public.get_my_order_claim_reshipment_items(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();result jsonb;
begin
 if actor is null or not exists(select 1 from public.orders o left join private.gift_intents gift on gift.order_id=o.id
  where o.id=p_order_id and ((gift.id is null and o.user_id=actor) or gift.recipient_id=actor)) then
  raise no_data_found using message='order_not_found';
 end if;
 result:=private.order_claim_reshipment_history(p_order_id);
 return result;
end;
$$;
revoke all on function public.get_my_order_claim_reshipment_items(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_my_order_claim_reshipment_items(uuid) to authenticated;

CREATE OR REPLACE FUNCTION private.gift_claim_context(p_actor uuid, p_gift_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$declare gift private.gift_intents;claim public.order_cancellation_requests;purchase public.orders;own boolean;account private.claim_refund_accounts;begin
 select * into gift from private.gift_intents where id=p_gift_id and(p_actor=sender_id or p_actor=recipient_id);
 if not found or p_actor is null then return null;end if;
 select * into purchase from public.orders where id=gift.order_id;
 select * into claim from public.order_cancellation_requests where order_id=gift.order_id order by requested_at desc,id desc limit 1;
 own:=claim.id is not null and private.gift_claim_actor(claim.id)=p_actor;
 select * into account from private.claim_refund_accounts where claim_id=claim.id;
 return jsonb_build_object('giftId',gift.id,'isSender',p_actor=gift.sender_id,'isRecipient',p_actor=gift.recipient_id,
  'reshipmentHistory',case when p_actor=gift.recipient_id then private.order_claim_reshipment_history(gift.order_id) else '[]'::jsonb end,
  'canRequest',purchase.id is not null and private.order_all_items_delivered(purchase.id) and purchase.status<>'canceled'
    and not exists(select 1 from public.order_cancellation_requests where order_id=purchase.id and status in('requested','processing','needs_review')),
  'claim',case when claim.id is null then null else jsonb_build_object('id',claim.id,'type',claim.claim_type,'stage',claim.stage,'revision',claim.claim_revision,'requestedAt',claim.requested_at,
   'isRequester',own,'canWithdraw',own and private.order_claim_withdrawal_blocker(claim) is null,
   'refundAccountNeeded',p_actor=gift.sender_id and(purchase.payment_method='bank_transfer' or claim.stage='needs_review') and claim.claim_type<>'exchange' and claim.stage not in('completed','rejected','withdrawn') and(account.claim_id is null or account.purged_at is not null),
   'maskedRefundAccount',case when p_actor=gift.sender_id then account.masked_account else null end,
   'reshipCarrier',case when p_actor=gift.recipient_id then claim.reship_carrier else null end,
   'reshipTrackingNumber',case when p_actor=gift.recipient_id then claim.reship_tracking_number else null end) end);
end $function$

;

do $$declare fn regprocedure;begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname=any(array['resolve_goods_stock_successor','claim_reshipment_items_read','order_item_physical_unit',
   'order_claim_reshipment_history','lock_goods_stock_successor_topology','apply_group_physical_stock_deltas','order_item_reshipment_options','record_group_claim_reshipment']) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',fn);
  execute format('grant execute on function %s to postgres',fn);
  perform private.register_operator_internal_contract(fn);
 end loop;
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname=any(array['order_item_stock_variant','restore_order_item_supply',
   'gift_claim_context','admin_order_claim_detail_before_operational_fee','order_claim_type_change_blocker','order_claim_reason_blocker']) loop
  perform private.register_operator_internal_contract(fn);
 end loop;
end $$;
select private.register_operator_rpc_contract('public.admin_record_order_claim_reshipment(uuid,text,text,jsonb)'::regprocedure,'sales.manage','write',false);
notify pgrst,'reload schema';
