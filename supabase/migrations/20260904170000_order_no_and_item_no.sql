-- D-3 ① — 주문 식별키 3중 (설계서 v2 §1-3)
--
-- 지금 화면은 주문 uuid 의 여덟 자를 잘라 「주문번호」라 부른다. 그 코드로는
-- 언제 들어온 주문인지 알 수 없고, 창고·ERP·고객이 서로 다른 자리를 잘라 부른다.
--
-- 그래서 셋을 나눈다:
--   ① `orders.order_no`  = YYYYMMDD-NNNNNN (KST) — 사람이 부르는 이름
--   ② `order_items.item_no` = order_no-NN        — 부분 취소·부분 출고가 가리키는 단위
--   ③ `order_external_refs` = 사방넷·ERP 가 우리에게 돌려주는 번호
-- 셋 다 사람이 읽고 통합검색으로 찾는다. uuid 는 시스템 안에서만 쓴다.
--
-- 입금자명 코드(`private.bank_transfer_deposit_code`)는 **건드리지 않는다** — 이미 은행에서
-- 들어오는 입금과 대조 중인 살아 있는 약속이라, 규칙을 바꾸면 진행 중인 입금이 안 붙는다.

-- ---------------------------------------------------------------------------
-- 날짜별 일련번호. 시퀀스 하나로는 날이 바뀌어도 이어져서 사람이 읽는 뜻이 사라진다.
-- ---------------------------------------------------------------------------
create table if not exists public.order_no_counters (
  day date primary key,
  last_seq integer not null default 0 check (last_seq >= 0)
);
alter table public.order_no_counters enable row level security;
comment on table public.order_no_counters is '주문번호 일련번호(KST 날짜별). 값은 트리거만 올린다.';

create or replace function private.next_order_no(p_at timestamptz)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_day date := (p_at at time zone 'Asia/Seoul')::date;
  v_seq integer;
begin
  insert into public.order_no_counters as counter (day, last_seq)
  values (v_day, 1)
  on conflict (day) do update set last_seq = counter.last_seq + 1
  returning counter.last_seq into v_seq;
  return pg_catalog.to_char(v_day, 'YYYYMMDD') || '-' || pg_catalog.lpad(v_seq::text, 6, '0');
end;
$$;

alter table public.orders add column if not exists order_no text;

create or replace function private.fill_order_no()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.order_no is null then
    new.order_no := private.next_order_no(coalesce(new.created_at, pg_catalog.now()));
  end if;
  return new;
end;
$$;

drop trigger if exists orders_fill_order_no on public.orders;
create trigger orders_fill_order_no before insert on public.orders
  for each row execute function private.fill_order_no();

-- 백필은 들어온 순서대로. 같은 날 주문이 번호 순서와 시간 순서가 어긋나면
-- 운영자가 「먼저 온 주문」을 번호로 못 고른다.
do $$
declare
  v_row record;
begin
  for v_row in
    select ord.id, (ord.created_at at time zone 'Asia/Seoul')::date as day,
           row_number() over (
             partition by (ord.created_at at time zone 'Asia/Seoul')::date
             order by ord.created_at, ord.id
           ) as seq
    from public.orders as ord
    where ord.order_no is null
    order by ord.created_at, ord.id
  loop
    update public.orders
    set order_no = to_char(v_row.day, 'YYYYMMDD') || '-' || lpad(v_row.seq::text, 6, '0')
    where id = v_row.id;

    insert into public.order_no_counters (day, last_seq)
    values (v_row.day, v_row.seq)
    on conflict (day) do update set last_seq = greatest(order_no_counters.last_seq, excluded.last_seq);
  end loop;
end;
$$;

alter table public.orders alter column order_no set not null;
create unique index if not exists orders_order_no_key on public.orders (order_no);

-- ---------------------------------------------------------------------------
-- 품목 주문번호 — 부분 취소·부분 출고가 가리키는 단위
-- ---------------------------------------------------------------------------
alter table public.order_items add column if not exists item_no text;

create or replace function private.fill_item_no()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_order_no text;
  v_seq integer;
begin
  if new.item_no is not null then
    return new;
  end if;
  select ord.order_no into v_order_no from public.orders as ord where ord.id = new.order_id;
  if v_order_no is null then
    return new;
  end if;
  select coalesce(pg_catalog.max(pg_catalog.substr(item.item_no, pg_catalog.length(v_order_no) + 2)::integer), 0) + 1
    into v_seq
  from public.order_items as item
  where item.order_id = new.order_id and item.item_no is not null;
  new.item_no := v_order_no || '-' || pg_catalog.lpad(v_seq::text, 2, '0');
  return new;
end;
$$;

drop trigger if exists order_items_fill_item_no on public.order_items;
-- 품목 채움 트리거(D-1b) 뒤에 돌도록 이름을 뒤에 둔다 — 같은 시점 트리거는 이름 순이다.
create trigger order_items_zz_fill_item_no before insert on public.order_items
  for each row execute function private.fill_item_no();

update public.order_items as item
set item_no = ord.order_no || '-' || lpad(numbered.seq::text, 2, '0')
from (
  select inner_item.id,
         row_number() over (partition by inner_item.order_id order by inner_item.id) as seq
  from public.order_items as inner_item
  where inner_item.item_no is null
) as numbered
join public.orders as ord on ord.id = (select order_id from public.order_items where id = numbered.id)
where item.id = numbered.id;

alter table public.order_items alter column item_no set not null;
create unique index if not exists order_items_item_no_key on public.order_items (item_no);

-- ---------------------------------------------------------------------------
-- 외부 참조 — 사방넷·ERP 가 우리 주문에 붙인 자기네 번호
-- ---------------------------------------------------------------------------
create table if not exists public.order_external_refs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  kind text not null check (kind in ('sabangnet_order', 'erp_shipment', 'erp_sales', 'other')),
  value text not null check (char_length(btrim(value)) between 1 and 100),
  source text not null default 'manual' check (source in ('manual', 'import', 'api')),
  recorded_by uuid references auth.users (id) on delete set null,
  recorded_at timestamptz not null default now(),
  note text check (char_length(note) <= 200)
);
-- 같은 외부 번호가 두 주문에 붙으면 어느 쪽이 맞는지 우리는 모른다. 저쪽 번호는 저쪽에서 유일하다.
create unique index if not exists order_external_refs_kind_value_key on public.order_external_refs (kind, value);
create index if not exists order_external_refs_order_idx on public.order_external_refs (order_id);
alter table public.order_external_refs enable row level security;

drop policy if exists "staff reads order external refs" on public.order_external_refs;
create policy "staff reads order external refs" on public.order_external_refs
  for select to authenticated using (public.is_staff());

grant select on public.order_external_refs to authenticated;
grant select on public.order_no_counters to service_role;

create index if not exists orders_order_no_prefix_idx on public.orders (order_no text_pattern_ops);
create index if not exists order_items_item_no_prefix_idx on public.order_items (item_no text_pattern_ops);
