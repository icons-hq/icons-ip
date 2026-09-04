-- D-8 ② — 구매 실적 롤업 (설계서 v2 §1-6)
--
-- 「구매액 상위 회원」과 「회원 목록을 구매액 순으로」는 지금 매번 주문 전체를 훑어야 나온다.
-- 회원 수가 늘면 그 화면이 먼저 느려지고, 느려진 뒤에는 아무도 안 본다.
--
-- 그래서 회원당 한 줄로 굳힌다 — 원장(주문)에서 다시 계산하는 **캐시**이고,
-- 주문 상태가 바뀔 때마다 그 회원 것만 다시 센다(D-1 재고 캐시와 같은 규율).
-- 기간을 지정한 랭킹은 캐시로 답할 수 없으므로 그때만 조회 시 집계한다.

create table if not exists public.member_purchase_stats (
  user_id uuid primary key references auth.users (id) on delete cascade,
  order_count integer not null default 0 check (order_count >= 0),
  gross_total bigint not null default 0 check (gross_total >= 0),
  refund_total bigint not null default 0 check (refund_total >= 0),
  first_order_at timestamptz,
  last_order_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists member_purchase_stats_gross_idx on public.member_purchase_stats (gross_total desc, user_id);
alter table public.member_purchase_stats enable row level security;

drop policy if exists "staff reads member purchase stats" on public.member_purchase_stats;
create policy "staff reads member purchase stats" on public.member_purchase_stats
  for select to authenticated using (public.is_staff());
drop policy if exists "member reads own purchase stats" on public.member_purchase_stats;
create policy "member reads own purchase stats" on public.member_purchase_stats
  for select to authenticated using (user_id = (select auth.uid()));
grant select on public.member_purchase_stats to authenticated;

create or replace function private.recalculate_member_purchase_stats(p_user_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into public.member_purchase_stats as stats (
    user_id, order_count, gross_total, refund_total, first_order_at, last_order_at, updated_at
  )
  select
    p_user_id,
    coalesce(pg_catalog.count(*), 0)::integer,
    coalesce(pg_catalog.sum(ord.total), 0)::bigint,
    coalesce((
      select pg_catalog.sum(refund.amount)
      from public.refunds as refund
      join public.payments as payment on payment.id = refund.payment_id
      where payment.purpose = 'order' and payment.user_id = p_user_id and refund.completed_at is not null
    ), 0)::bigint,
    pg_catalog.min(coalesce(ord.paid_at, ord.created_at)),
    pg_catalog.max(coalesce(ord.paid_at, ord.created_at)),
    pg_catalog.now()
  from public.orders as ord
  where ord.user_id = p_user_id
    and ord.status in ('paid', 'confirmed', 'shipping', 'delivered', 'done')
  on conflict (user_id) do update set
    order_count = excluded.order_count,
    gross_total = excluded.gross_total,
    refund_total = excluded.refund_total,
    first_order_at = excluded.first_order_at,
    last_order_at = excluded.last_order_at,
    updated_at = excluded.updated_at;
end;
$$;

create or replace function private.sync_member_purchase_stats()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.recalculate_member_purchase_stats(coalesce(new.user_id, old.user_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists orders_sync_member_purchase_stats on public.orders;
create trigger orders_sync_member_purchase_stats after insert or update of status on public.orders
  for each row execute function private.sync_member_purchase_stats();

-- 백필. 주문이 있는 회원만 줄을 만든다 — 없는 회원의 0줄은 화면이 알아서 0으로 읽는다.
insert into public.member_purchase_stats (user_id, order_count, gross_total, first_order_at, last_order_at)
select ord.user_id,
       count(*)::integer,
       sum(ord.total)::bigint,
       min(coalesce(ord.paid_at, ord.created_at)),
       max(coalesce(ord.paid_at, ord.created_at))
from public.orders as ord
where ord.status in ('paid', 'confirmed', 'shipping', 'delivered', 'done')
group by ord.user_id
on conflict (user_id) do nothing;

-- 야간 전체 재계산 — 캐시가 원장에서 벗어나면 이 잡이 되돌린다.
create or replace function public.recalculate_all_member_purchase_stats()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in select distinct user_id from public.orders loop
    perform private.recalculate_member_purchase_stats(v_row.user_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function private.recalculate_member_purchase_stats(uuid) from public, anon, authenticated, service_role;
revoke all on function public.recalculate_all_member_purchase_stats() from public, anon, authenticated;
grant execute on function public.recalculate_all_member_purchase_stats() to service_role;

select cron.schedule('recalculate-member-purchase-stats', '40 18 * * *',
  $$select public.recalculate_all_member_purchase_stats();$$)
where not exists (select 1 from cron.job where jobname = 'recalculate-member-purchase-stats');
