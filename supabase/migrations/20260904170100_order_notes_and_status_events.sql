-- D-3 ② — 관리자 메모 · 상태 이력 (설계서 v2 §1-3)
--
-- 지금은 주문에 무슨 일이 있었는지가 타임스탬프 네 칸(confirmed_at·shipped_at·delivered_at·done_at)에만
-- 남는다. 누가 왜 그랬는지는 어디에도 없다. CS 가 「이 주문 왜 이렇게 됐어요」를 물으면
-- 답할 자리가 없다는 뜻이다.
--
-- 메모는 **덧붙이기만 한다**. 고친 메모는 기록이 아니라 주장이다 — 틀린 메모는 지우지 말고
-- 새 메모로 바로잡는다. 다만 「고정」은 표시일 뿐이라 바꿀 수 있다.

create table if not exists public.order_notes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  kind text not null default 'memo' check (kind in ('memo', 'cs', 'status', 'system')),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  pinned boolean not null default false,
  author_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists order_notes_order_idx on public.order_notes (order_id, created_at desc);
create index if not exists order_notes_pinned_idx on public.order_notes (order_id) where pinned;
alter table public.order_notes enable row level security;
comment on table public.order_notes is '주문 관리자 메모(덧붙이기 전용). 고정 표시만 바꿀 수 있다.';

create or replace function private.reject_order_note_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'order_notes_append_only' using errcode = '55000';
  end if;
  -- 고정 표시는 기록이 아니라 보기 방식이다. 그 한 칸만 열어 둔다.
  if new.order_id is distinct from old.order_id
    or new.kind is distinct from old.kind
    or new.body is distinct from old.body
    or new.author_id is distinct from old.author_id
    or new.created_at is distinct from old.created_at
  then
    raise exception 'order_notes_append_only' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists order_notes_append_only on public.order_notes;
create trigger order_notes_append_only before update or delete on public.order_notes
  for each row execute function private.reject_order_note_change();

drop policy if exists "staff reads order notes" on public.order_notes;
create policy "staff reads order notes" on public.order_notes
  for select to authenticated using (public.is_staff());
grant select on public.order_notes to authenticated;

-- ---------------------------------------------------------------------------
-- 상태 이력 — 사다리를 오르내린 기록. 트리거가 남기므로 어느 경로로 바뀌든 빠지지 않는다.
-- ---------------------------------------------------------------------------
create table if not exists public.order_status_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  from_status public.order_status,
  to_status public.order_status not null,
  actor_id uuid references auth.users (id) on delete set null,
  note text check (char_length(note) <= 300),
  source text not null default 'trigger' check (source in ('trigger', 'backfill')),
  -- `now()` 는 트랜잭션 시작 시각이라 한 트랜잭션에서 두 번 바뀌면 두 사건의 시각이 같아진다 —
  -- 그러면 이력을 순서대로 읽을 수 없다. 실제로 일어난 순간을 쓴다.
  occurred_at timestamptz not null default clock_timestamp()
);
create index if not exists order_status_events_order_idx on public.order_status_events (order_id, occurred_at, id);
alter table public.order_status_events enable row level security;

drop policy if exists "staff reads order status events" on public.order_status_events;
create policy "staff reads order status events" on public.order_status_events
  for select to authenticated using (public.is_staff());
grant select on public.order_status_events to authenticated;

create or replace function private.record_order_status_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  insert into public.order_status_events (order_id, from_status, to_status, actor_id, source)
  values (new.id, old.status, new.status, (select auth.uid()), 'trigger');
  return new;
end;
$$;

drop trigger if exists orders_record_status_event on public.orders;
create trigger orders_record_status_event after update of status on public.orders
  for each row execute function private.record_order_status_event();

-- 백필은 **있는 사실만** 쓴다. 주문에 실제로 찍힌 시각만 사건으로 옮기고,
-- 없는 전이는 지어내지 않는다(취소는 시각 칸이 없어 남기지 않는다 — 클레임 원장이 그 기록을 갖고 있다).
insert into public.order_status_events (order_id, from_status, to_status, occurred_at, source)
select ord.id, event.from_status, event.to_status, event.at, 'backfill'
from public.orders as ord
cross join lateral (
  values
    (null::public.order_status, 'pending'::public.order_status, ord.created_at),
    ('confirmed'::public.order_status, 'shipping'::public.order_status, ord.shipped_at),
    ('shipping'::public.order_status, 'delivered'::public.order_status, ord.delivered_at),
    ('delivered'::public.order_status, 'done'::public.order_status, ord.done_at)
) as event(from_status, to_status, at)
where event.at is not null
  and not exists (
    select 1 from public.order_status_events as existing where existing.order_id = ord.id
  );
