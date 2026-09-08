-- 현업 요청 슬라이스 3 — 발송 방법 · 발송지연 일괄 안내
--
-- 설계: 「어드민 현업 요청 설계안 v1」 §2-3.

-- ---------------------------------------------------------------------------
-- 1. 발송 방법은 **출고 객체**에 붙인다
-- ---------------------------------------------------------------------------
-- 주문 헤더가 아니라 출고에 붙이는 이유: 한 주문이 택배와 방문수령으로 나뉠 수 있다.
-- 어휘는 배송 정책(`shipping_policies.method`)과 같은 것을 쓴다.
alter table public.shipments
  add column if not exists method text not null default 'parcel';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'shipments_method_check') then
    alter table public.shipments add constraint shipments_method_check
      check (method in ('parcel', 'quick', 'pickup', 'freight'));
  end if;
end;
$$;

-- 송장은 **택배일 때만** 필요하다. 퀵·방문수령·화물은 송장번호가 없다 —
-- 옛 제약은 그런 출고를 아예 내보낼 수 없게 막았다.
alter table public.shipments drop constraint if exists shipments_tracking_required;
alter table public.shipments add constraint shipments_tracking_required
  check (status = 'ready' or method <> 'parcel' or tracking_number is not null);

comment on column public.shipments.method is
  '발송 방법. 주문이 아니라 출고에 붙는다 — 한 주문이 택배와 방문수령으로 나뉠 수 있다.';

-- 옛 4인자 판을 먼저 지운다. 기본값 있는 5인자를 그냥 얹으면 같은 호출이 두 함수에 걸려
-- 「function ... is not unique」로 기존 호출부가 전부 깨진다.
drop function if exists public.admin_create_shipment(uuid, jsonb, text, text);
drop function if exists private.create_shipment(uuid, jsonb, text, text, uuid);

create or replace function private.create_shipment(
  p_order_id uuid,
  p_items jsonb,
  p_carrier text,
  p_tracking text,
  p_actor uuid,
  p_method text default 'parcel'
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_shipment uuid;
  v_row record;
  v_available integer;
  v_location text;
begin
  insert into public.shipments (order_id, shipment_no, carrier, tracking_number, created_by, method)
  values (
    p_order_id, private.next_shipment_no(p_order_id), nullif(p_carrier, ''), nullif(p_tracking, ''),
    p_actor, coalesce(nullif(p_method, ''), 'parcel')
  )
  returning id into v_shipment;

  for v_row in
    select (entry ->> 'order_item_id')::uuid as order_item_id, (entry ->> 'qty')::integer as qty
    from pg_catalog.jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as entry
  loop
    -- 아직 안 나갔고 취소되지 않은 수량까지만 담을 수 있다. 그 이상은 종이 위에서만 나간 물건이다.
    select item.qty - item.qty_canceled - item.qty_shipped, item.location_id
    into v_available, v_location
    from public.order_items as item
    where item.id = v_row.order_item_id and item.order_id = p_order_id
    for update;
    if not found then
      raise exception 'order_item_not_in_order' using errcode = '22023';
    end if;
    if v_row.qty is null or v_row.qty <= 0 or v_row.qty > v_available then
      raise exception 'qty_exceeds_available' using errcode = '23514';
    end if;

    insert into public.shipment_items (shipment_id, order_item_id, qty)
    values (v_shipment, v_row.order_item_id, v_row.qty);
    update public.shipments set location_id = coalesce(location_id, v_location) where id = v_shipment;
  end loop;

  if not exists (select 1 from public.shipment_items where shipment_id = v_shipment) then
    raise exception 'shipment_needs_items' using errcode = '23514';
  end if;
  return v_shipment;
end;
$$;

create or replace function public.admin_create_shipment(
  p_order_id uuid,
  p_items jsonb,
  p_carrier text,
  p_tracking text,
  p_method text default 'parcel'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_staff_actor();
begin
  return private.create_shipment(p_order_id, p_items, p_carrier, p_tracking, v_actor, p_method);
end;
$$;

-- 택배가 아닌 출고는 송장 없이 내보낼 수 있다.
-- **원문을 그대로 옮기고 그 한 줄만 바꿨다** — 손으로 다시 쓰면 나머지에서 조용한 차이가 난다.
create or replace function private.ship_shipment(p_shipment_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_ship public.shipments;
  v_row record;
begin
  select * into v_ship from public.shipments as ship where ship.id = p_shipment_id for update;
  if not found then
    raise exception 'shipment_not_found' using errcode = 'P0002';
  end if;
  if v_ship.status <> 'ready' then
    raise exception 'shipment_already_sent' using errcode = 'P0001';
  end if;
  -- 송장은 택배일 때만 필요하다. 퀵·방문수령에 송장을 요구하면 내보낼 방법이 없다.
  if v_ship.method = 'parcel' and v_ship.tracking_number is null then
    raise exception 'tracking_required' using errcode = '23514';
  end if;

  update public.shipments set status = 'shipped', shipped_at = pg_catalog.now() where id = p_shipment_id;

  -- 재고는 여기서 빠진다. 물건이 실제로 나가는 순간이 이 한 곳이어야 한다.
  for v_row in
    select shipment_item.order_item_id, shipment_item.qty
    from public.shipment_items as shipment_item
    where shipment_item.shipment_id = p_shipment_id
    order by shipment_item.order_item_id
  loop
    perform private.apply_order_item_stock_effect(
      v_row.order_item_id, v_row.qty, 'order_ship', v_ship.order_id::text
    );
  end loop;

  perform private.sync_order_item_counters(v_ship.order_id);
end;
$$;

revoke all on function private.create_shipment(uuid, jsonb, text, text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_create_shipment(uuid, jsonb, text, text, text) from public, anon, service_role;
grant execute on function public.admin_create_shipment(uuid, jsonb, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. 발송지연 일괄 안내
-- ---------------------------------------------------------------------------
-- 인앱 알림 종류를 하나 늘린다. 「늦어집니다」만 가는 안내는 문의를 늘리므로
-- **사유 없이는 보내지 않는다**(지연 표가 이미 사유를 강제한다).
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (
  type = any (array[
    'announcement', 'claim_updated', 'draw_ticket_issued', 'drop_published', 'event_published',
    'inquiry_answered', 'loyalty_grade_upgraded', 'order_bank_transfer_pending', 'order_delivered',
    'order_dispatch_delayed', 'order_paid', 'order_shipping', 'restock_available', 'review_replied',
    'product_question_answered'
  ])
);

/**
 * 고른 주문에 지연 사유를 한 번에 적고, 원하면 주문자에게 안내를 보낸다.
 *
 * 하나씩 적으면 열 건에 열 번 같은 문장을 친다 — 지연은 대개 한 원인으로 여러 주문에 온다.
 * **한 건이라도 실패하면 전부 되돌린다**: 절반만 안내가 나가면 어느 주문이 갔는지
 * 운영자가 다시 세야 한다.
 *
 * 알림 문구는 사실만 적는다 — 사과·해명은 CS 채널의 몫이고, 알림함에서는 소음이 된다.
 */
create or replace function public.admin_bulk_note_dispatch_delay(
  p_order_ids uuid[],
  p_reason text,
  p_expected_ship_date date,
  p_notify boolean,
  p_request_id uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_count integer := 0;
  v_order record;
begin
  if v_reason = '' then
    raise check_violation using message = 'reason_required';
  end if;
  if p_order_ids is null or pg_catalog.cardinality(p_order_ids) = 0 then
    raise check_violation using message = 'no_orders_selected';
  end if;
  -- 한 번에 다루는 수를 묶어 둔다. 실수로 전 주문을 고르면 되돌릴 방법이 없다.
  if pg_catalog.cardinality(p_order_ids) > 200 then
    raise check_violation using message = 'too_many_orders';
  end if;

  for v_order in
    select ord.id, ord.user_id, ord.order_no
    from public.orders as ord
    where ord.id = any (p_order_ids)
    order by ord.id
    for update
  loop
    insert into public.order_dispatch_delays (order_id, reason, expected_ship_date, noted_by)
    values (v_order.id, v_reason, p_expected_ship_date, v_actor)
    on conflict (order_id) do update set
      reason = excluded.reason,
      expected_ship_date = excluded.expected_ship_date,
      noted_by = excluded.noted_by,
      updated_at = pg_catalog.now();

    if coalesce(p_notify, false) and v_order.user_id is not null then
      insert into public.notifications (
        user_id, type, title, body, link_path, source_type, source_id, dedupe_key
      )
      values (
        v_order.user_id,
        'order_dispatch_delayed',
        '발송이 늦어지고 있어요',
        case
          when p_expected_ship_date is null then v_reason
          else v_reason || ' · 발송 예정 ' || pg_catalog.to_char(p_expected_ship_date, 'YYYY-MM-DD')
        end,
        '/orders/' || v_order.id::text,
        'order',
        v_order.id::text,
        -- 같은 사유·예정일로 두 번 눌러도 알림은 하나다.
        'dispatch_delay:' || v_order.id::text || ':' || pg_catalog.md5(
          v_reason || coalesce(p_expected_ship_date::text, '')
        )
      )
      -- 유일 키는 (user_id, dedupe_key) 다 — 같은 사람에게 같은 안내가 두 번 가지 않는다.
      on conflict (user_id, dedupe_key) do nothing;
    end if;

    v_count := v_count + 1;
  end loop;

  perform private.record_admin_action(
    p_request_id, v_actor, 'orders.dispatch_delay.bulk', 'orders:' || v_count::text,
    jsonb_build_object('count', v_count, 'notified', coalesce(p_notify, false))
  );
  return v_count;
end;
$$;

revoke all on function public.admin_bulk_note_dispatch_delay(uuid[], text, date, boolean, uuid) from public, anon, service_role;
grant execute on function public.admin_bulk_note_dispatch_delay(uuid[], text, date, boolean, uuid) to authenticated;
