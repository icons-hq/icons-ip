begin;

-- Public references are independent of UUID primary keys and PG order IDs.
-- YYYYMMDD (Asia/Seoul) + kind (1 order / 2 item / 3 shipment) + daily sequence.
-- Separate kind digits prevent an order number pasted into an item sheet from
-- accidentally identifying an unrelated item with the same daily sequence.
create table private.commerce_number_counters (
  business_date date not null,
  kind smallint not null check (kind in (1,2,3)),
  last_value integer not null check (last_value between 1 and 9999999),
  primary key (business_date,kind)
);
alter table private.commerce_number_counters enable row level security;
revoke all on private.commerce_number_counters from public,anon,authenticated,service_role;

create function private.next_commerce_number(p_created_at timestamptz,p_kind smallint)
returns text language plpgsql security definer set search_path='' as $$
declare business_day date := (p_created_at at time zone 'Asia/Seoul')::date; n integer;
begin
  if business_day is null or not isfinite(business_day) or business_day not between date '2000-01-01' and date '9999-12-31'
    or p_kind is null or p_kind not in (1,2,3) then
    raise invalid_parameter_value using message='invalid_commerce_number_input';
  end if;
  insert into private.commerce_number_counters as counter(business_date,kind,last_value)
    values(business_day,p_kind,1)
    on conflict(business_date,kind) do update set last_value=counter.last_value+1
    returning last_value into n;
  return to_char(business_day,'YYYYMMDD')||p_kind::text||lpad(n::text,7,'0');
end $$;
revoke all on function private.next_commerce_number(timestamptz,smallint) from public,anon,authenticated,service_role;

-- A migration-only backfill must not run order status, account-fence, outbox,
-- stock or updated_at triggers. Lock all three tables, save their exact trigger
-- states, update only the new columns, and restore those states in this same
-- transaction. Any failure rolls back the data AND the trigger state.
lock table public.orders,public.order_items,public.order_shipments in access exclusive mode;
create temporary table commerce_number_trigger_states on commit drop as
select tgrelid, tgname, tgenabled from pg_trigger
where tgrelid in ('public.orders'::regclass,'public.order_items'::regclass,'public.order_shipments'::regclass)
  and not tgisinternal;
do $$declare entry record;begin
  for entry in select * from commerce_number_trigger_states where tgenabled<>'D' loop
    execute format('alter table %s disable trigger %I',entry.tgrelid::regclass,entry.tgname);
  end loop;
end $$;

alter table public.orders add column order_number text;
alter table public.order_items add column product_order_number text;
alter table public.order_shipments add column shipment_number text;

with numbered as (
  select id, to_char(created_at at time zone 'Asia/Seoul','YYYYMMDD') date_key,
    row_number() over(partition by (created_at at time zone 'Asia/Seoul')::date order by created_at,id) n
  from public.orders
) update public.orders target set order_number=date_key||'1'||lpad(n::text,7,'0') from numbered where target.id=numbered.id;
with numbered as (
  select item.id, to_char(purchase.created_at at time zone 'Asia/Seoul','YYYYMMDD') date_key,
    row_number() over(partition by (purchase.created_at at time zone 'Asia/Seoul')::date order by purchase.created_at,purchase.id,item.id) n
  from public.order_items item join public.orders purchase on purchase.id=item.order_id
) update public.order_items target set product_order_number=date_key||'2'||lpad(n::text,7,'0') from numbered where target.id=numbered.id;
with numbered as (
  select shipment.id, to_char(purchase.created_at at time zone 'Asia/Seoul','YYYYMMDD') date_key,
    row_number() over(partition by (purchase.created_at at time zone 'Asia/Seoul')::date order by purchase.created_at,purchase.id,shipment.id) n
  from public.order_shipments shipment join public.orders purchase on purchase.id=shipment.order_id
) update public.order_shipments target set shipment_number=date_key||'3'||lpad(n::text,7,'0') from numbered where target.id=numbered.id;

insert into private.commerce_number_counters(business_date,kind,last_value)
select to_date(left(number,8),'YYYYMMDD'),substring(number,9,1)::smallint,max(right(number,7)::integer)
from (
  select order_number number from public.orders union all
  select product_order_number from public.order_items union all
  select shipment_number from public.order_shipments
) numbers group by 1,2;

alter table public.orders alter column order_number set not null,
  add constraint orders_number_format check(order_number ~ '^[0-9]{8}1[0-9]{7}$'),
  add constraint orders_order_number_key unique(order_number);
alter table public.order_items alter column product_order_number set not null,
  add constraint order_items_number_format check(product_order_number ~ '^[0-9]{8}2[0-9]{7}$'),
  add constraint order_items_product_order_number_key unique(product_order_number);
alter table public.order_shipments alter column shipment_number set not null,
  add constraint order_shipments_number_format check(shipment_number ~ '^[0-9]{8}3[0-9]{7}$'),
  add constraint order_shipments_shipment_number_key unique(shipment_number);

do $$declare entry record;begin
  for entry in select * from commerce_number_trigger_states where tgenabled<>'D' loop
    execute format('alter table %s %s trigger %I',entry.tgrelid::regclass,
      case entry.tgenabled when 'A' then 'enable always' when 'R' then 'enable replica' else 'enable' end,entry.tgname);
  end loop;
end $$;

create function private.assign_commerce_number() returns trigger
language plpgsql security definer set search_path='' as $$
declare column_name text := tg_argv[0]; kind smallint := tg_argv[1]::smallint; created timestamptz; number text;
begin
  if tg_op='UPDATE' then
    if (to_jsonb(new)->>column_name) is distinct from (to_jsonb(old)->>column_name) then
      raise check_violation using message='commerce_number_immutable';
    end if;
    return new;
  end if;
  if to_jsonb(new)->>column_name is not null then
    raise check_violation using message='commerce_number_is_generated';
  end if;
  if kind=1 then created:=new.created_at;
  else select created_at into strict created from public.orders where id=new.order_id;end if;
  number:=private.next_commerce_number(created,kind);
  new:=jsonb_populate_record(new,jsonb_build_object(column_name,number));
  return new;
end $$;
revoke all on function private.assign_commerce_number() from public,anon,authenticated,service_role;
create trigger orders_assign_number before insert or update of order_number on public.orders
  for each row execute function private.assign_commerce_number('order_number','1');
create trigger order_items_assign_number before insert or update of product_order_number on public.order_items
  for each row execute function private.assign_commerce_number('product_order_number','2');
create trigger order_shipments_assign_number before insert or update of shipment_number on public.order_shipments
  for each row execute function private.assign_commerce_number('shipment_number','3');

comment on column public.orders.order_number is 'Immutable display/search number: KST order date + 1 + seven digit daily sequence. UUID/PG IDs remain unchanged.';
comment on column public.order_items.product_order_number is 'Immutable product-order number: KST order date + 2 + seven digit daily sequence.';
comment on column public.order_shipments.shipment_number is 'Immutable shipment number: KST order date + 3 + seven digit daily sequence.';

notify pgrst,'reload schema';
commit;
