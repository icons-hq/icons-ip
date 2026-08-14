-- Korpay's published card flow rejects amounts below KRW 1,000. Enforce the
-- bound inside the same reservation transaction so capacity is never held for
-- an order that the configured provider cannot prepare.

create or replace function private.enforce_korpay_ticket_minimum_amount()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'pending' and new.total > 0 and new.total < 1000 then
    raise check_violation using message = 'payment amount below provider minimum';
  end if;
  if new.status = 'pending' and new.total > 999999999999 then
    raise check_violation using message = 'payment amount above provider maximum';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_korpay_ticket_minimum_amount()
  from public, anon, authenticated, service_role;

drop trigger if exists ticket_orders_korpay_minimum_amount
  on public.ticket_orders;

create trigger ticket_orders_korpay_minimum_amount
before insert or update of total on public.ticket_orders
for each row
execute function private.enforce_korpay_ticket_minimum_amount();

-- place_order creates its pending shell at total=0 and then calculates the
-- authoritative total while inventory/cart rows are locked. Reject the final
-- update, not the shell insert, so an unpayable zero-total cart rolls back the
-- whole reservation transaction.
create or replace function private.enforce_korpay_goods_minimum_amount()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'pending' and new.total < 1000 then
    raise check_violation using message = 'payment amount below provider minimum';
  end if;
  if new.status = 'pending' and new.total > 999999999999 then
    raise check_violation using message = 'payment amount above provider maximum';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_korpay_goods_minimum_amount()
  from public, anon, authenticated, service_role;

drop trigger if exists orders_korpay_minimum_amount
  on public.orders;

create trigger orders_korpay_minimum_amount
before update of total on public.orders
for each row
execute function private.enforce_korpay_goods_minimum_amount();
