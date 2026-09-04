-- D-3 ⑫ — 반품 검수 · 재고 복원 (설계서 v2 §1-3)
--
-- 물건이 돌아왔다고 다 다시 팔 수 있는 것은 아니다. 검수에서 **다시 팔 수 있음(restock)**과
-- **폐기(discard)**를 갈라 적고, 그 판정이 재고를 움직인다.
-- 지금은 「수거 완료」 하나뿐이라 창고에 돌아온 물건이 재고에 언제 붙는지 아무도 모른다.

create or replace function public.admin_record_claim_inspection(
  p_claim_id uuid,
  p_outcome text,
  p_qty integer default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_claim public.order_cancellation_requests;
  v_item public.order_items;
  v_qty integer;
begin
  if p_outcome not in ('restock', 'discard') then
    raise exception 'invalid_inspection_outcome' using errcode = '22023';
  end if;

  select * into v_claim from public.order_cancellation_requests as claim
  where claim.id = p_claim_id for update;
  if not found then
    raise exception 'claim_not_found' using errcode = 'P0002';
  end if;
  if v_claim.claim_type = 'cancel' then
    raise exception 'claim_type_has_no_collection' using errcode = 'P0001';
  end if;
  if v_claim.stage <> 'collected' then
    raise exception 'claim_not_collected' using errcode = 'P0001';
  end if;
  if v_claim.inspection is not null then
    -- 검수는 한 번이다. 두 번 적으면 재고가 두 번 늘어난다.
    raise exception 'inspection_already_recorded' using errcode = 'P0001';
  end if;

  if v_claim.order_item_id is not null then
    select * into v_item from public.order_items as item where item.id = v_claim.order_item_id;
  else
    -- 품목이 지정되지 않은 옛 클레임은 주문에 품목이 하나일 때만 자동으로 고를 수 있다.
    select * into v_item from public.order_items as item
    where item.order_id = v_claim.order_id
    limit 2;
    if (select pg_catalog.count(*) from public.order_items as item where item.order_id = v_claim.order_id) <> 1 then
      raise exception 'claim_item_required' using errcode = '22023';
    end if;
  end if;

  v_qty := coalesce(p_qty, v_claim.qty, v_item.qty);
  if v_qty is null or v_qty <= 0 or v_qty > v_item.qty_delivered then
    -- 도착하지 않은 수량은 돌아올 수 없다.
    raise exception 'qty_exceeds_delivered' using errcode = '23514';
  end if;

  insert into public.stock_restorations (
    claim_id, order_item_id, variant_id, location_id, qty, outcome, actor_id
  )
  values (p_claim_id, v_item.id, v_item.variant_id, v_item.location_id, v_qty, p_outcome, v_actor);

  -- 다시 팔 수 있는 것만 재고로 돌아간다. 폐기는 기록만 남는다 — 그 손실도 원장에 있어야 한다.
  if p_outcome = 'restock' then
    perform private.apply_order_item_stock_effect(v_item.id, v_qty, 'return_restock', v_claim.order_id::text);
  end if;

  update public.order_cancellation_requests
  set inspection = p_outcome, updated_at = now()
  where id = p_claim_id;

  update public.order_items
  set qty_returned = qty_returned + v_qty
  where id = v_item.id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (v_actor, 'admin.order.claim_inspected', 'order:' || v_claim.order_id::text,
          jsonb_build_object('claimId', p_claim_id, 'outcome', p_outcome, 'qty', v_qty));
  return p_outcome;
end;
$$;

create or replace function public.admin_claim_restorations(p_claim_id uuid)
returns table (
  id uuid, order_item_id uuid, item_no text, good_name text, qty integer,
  outcome text, location_id text, actor_name text, occurred_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;
  return query
  select restoration.id, restoration.order_item_id, item.item_no, item.good_name_snapshot,
         restoration.qty, restoration.outcome, restoration.location_id,
         coalesce(actor.nickname, '(시스템)'), restoration.occurred_at
  from public.stock_restorations as restoration
  left join public.order_items as item on item.id = restoration.order_item_id
  left join public.profiles as actor on actor.id = restoration.actor_id
  where restoration.claim_id = p_claim_id
  order by restoration.occurred_at, restoration.id;
end;
$$;

revoke all on function public.admin_record_claim_inspection(uuid, text, integer) from public, anon, service_role;
grant execute on function public.admin_record_claim_inspection(uuid, text, integer) to authenticated;
revoke all on function public.admin_claim_restorations(uuid) from public, anon, service_role;
grant execute on function public.admin_claim_restorations(uuid) to authenticated;
