-- D-3 ⑤ — 라인 수량 카운터 · 출고 객체 (설계서 v2 §1-3)
--
-- 카페24의 13단(배송준비·배송대기·부분배송·부분취소…)을 헤더 enum 에 더하지 않는다.
-- 그 값들은 **수량 산술의 결과**지 별도의 상태가 아니다 — 라인마다 몇 개가 나갔고 몇 개가
-- 취소됐는지를 세면 부분 배송·부분 취소가 저절로 나온다. 헤더 7값은 그대로 둔다.
--
-- 출고는 1급 객체가 된다. 지금은 주문 하나에 송장 하나(`orders.tracking_number`)뿐이라
-- 「두 상자로 나눠 보냄」을 적을 자리가 없다. 그래서 `shipments` 를 두고, **모든 출고가
-- 이 문을 지난다** — 헤더를 배송중으로 미는 기존 경로도 안에서 출고 하나를 만들어 보낸다.
-- 재고 차감도 이 문에 걸린다(D-1b 의 `order_ship` 을 출고 단위로 쪼갠 것).

-- ---------------------------------------------------------------------------
-- 1. 라인 카운터
-- ---------------------------------------------------------------------------
alter table public.order_items
  add column if not exists qty_shipped integer not null default 0,
  add column if not exists qty_delivered integer not null default 0,
  add column if not exists qty_canceled integer not null default 0,
  add column if not exists qty_return_requested integer not null default 0,
  add column if not exists qty_returned integer not null default 0,
  add column if not exists qty_exchanged integer not null default 0;

-- 기존 주문은 헤더 상태가 곧 라인 상태였다. 그 뜻을 그대로 옮긴다.
update public.order_items as item
set qty_shipped = case when ord.status in ('shipping', 'delivered', 'done') then item.qty else 0 end,
    qty_delivered = case when ord.status in ('delivered', 'done') then item.qty else 0 end,
    qty_canceled = case when ord.status = 'canceled' then item.qty else 0 end
from public.orders as ord
where ord.id = item.order_id
  and (item.qty_shipped, item.qty_delivered, item.qty_canceled) is distinct from (
    case when ord.status in ('shipping', 'delivered', 'done') then item.qty else 0 end,
    case when ord.status in ('delivered', 'done') then item.qty else 0 end,
    case when ord.status = 'canceled' then item.qty else 0 end
  );

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'order_items_qty_ledger' and conrelid = 'public.order_items'::regclass
  ) then
    alter table public.order_items add constraint order_items_qty_ledger check (
      qty_shipped >= 0 and qty_delivered >= 0 and qty_canceled >= 0
      and qty_return_requested >= 0 and qty_returned >= 0 and qty_exchanged >= 0
      -- 취소한 수량은 나갈 수 없고, 나가지 않은 수량은 도착할 수 없고,
      -- 도착하지 않은 수량은 돌아오거나 교환될 수 없다.
      and qty_shipped <= qty - qty_canceled
      and qty_delivered <= qty_shipped
      and qty_returned + qty_exchanged <= qty_delivered
      and qty_return_requested <= qty_delivered
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. 출고 객체
-- ---------------------------------------------------------------------------
create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  shipment_no text not null,
  kind text not null default 'sale' check (kind in ('sale', 'exchange')),
  status text not null default 'ready' check (status in ('ready', 'shipped', 'delivered', 'canceled')),
  carrier text,
  tracking_number text,
  location_id text references public.stock_locations (id),
  shipped_at timestamptz,
  delivered_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- 송장 없이 나갈 수는 없다. 준비 중일 때만 비어 있어도 된다.
  constraint shipments_tracking_required check (status = 'ready' or tracking_number is not null),
  -- 송장번호의 모양은 `orders.tracking_number` 와 같은 규칙이다. 두 자리가 다르면
  -- 출고에는 들어가는 번호가 헤더에는 안 들어가 대표 송장이 비어 버린다.
  constraint shipments_tracking_number_check check (
    tracking_number is null or tracking_number ~ '^[A-Z0-9]{8,30}$'
  )
);
create unique index if not exists shipments_shipment_no_key on public.shipments (shipment_no);
create index if not exists shipments_order_idx on public.shipments (order_id, created_at);
create index if not exists shipments_tracking_idx on public.shipments (tracking_number) where tracking_number is not null;
alter table public.shipments enable row level security;

create table if not exists public.shipment_items (
  shipment_id uuid not null references public.shipments (id) on delete cascade,
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  qty integer not null check (qty > 0),
  primary key (shipment_id, order_item_id)
);
create index if not exists shipment_items_order_item_idx on public.shipment_items (order_item_id);
alter table public.shipment_items enable row level security;

drop policy if exists "staff reads shipments" on public.shipments;
create policy "staff reads shipments" on public.shipments
  for select to authenticated using (public.is_staff());
drop policy if exists "buyer reads own shipments" on public.shipments;
create policy "buyer reads own shipments" on public.shipments
  for select to authenticated using (
    exists (select 1 from public.orders as ord where ord.id = shipments.order_id and ord.user_id = (select auth.uid()))
  );

drop policy if exists "staff reads shipment items" on public.shipment_items;
create policy "staff reads shipment items" on public.shipment_items
  for select to authenticated using (public.is_staff());
drop policy if exists "buyer reads own shipment items" on public.shipment_items;
create policy "buyer reads own shipment items" on public.shipment_items
  for select to authenticated using (
    exists (
      select 1 from public.shipments as ship
      join public.orders as ord on ord.id = ship.order_id
      where ship.id = shipment_items.shipment_id and ord.user_id = (select auth.uid())
    )
  );

grant select on public.shipments, public.shipment_items to authenticated;

create or replace function private.next_shipment_no(p_order_id uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_order_no text;
  v_seq integer;
begin
  select ord.order_no into v_order_no from public.orders as ord where ord.id = p_order_id;
  if v_order_no is null then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  select pg_catalog.count(*)::integer + 1 into v_seq
  from public.shipments as ship where ship.order_id = p_order_id;
  return v_order_no || '-S' || pg_catalog.lpad(v_seq::text, 2, '0');
end;
$$;
