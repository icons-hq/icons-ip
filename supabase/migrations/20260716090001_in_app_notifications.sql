-- In-app notification ledger, delivery triggers, and user preference RPCs (#104).

alter table public.ip_follows
  add column notify_drops boolean not null default true,
  add column notify_events boolean not null default true;

create index ip_follows_ip_notification_idx
  on public.ip_follows (ip_id, user_id)
  include (notify_drops, notify_events);

create table public.notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (
    type in (
      'order_paid',
      'order_shipping',
      'draw_ticket_issued',
      'drop_published',
      'event_published',
      'announcement'
    )
  ),
  title text not null check (
    char_length(title) between 1 and 120
    and title ~ '[^[:space:]]'
  ),
  body text not null check (
    char_length(body) between 1 and 500
    and body ~ '[^[:space:]]'
  ),
  link_path text not null check (
    char_length(link_path) between 1 and 2048
    and left(link_path, 1) = '/'
    and left(link_path, 2) <> '//'
    and strpos(link_path, chr(92)) = 0
    and link_path !~ '[[:cntrl:]]'
  ),
  source_type text not null check (
    char_length(source_type) between 1 and 64
    and source_type ~ '[^[:space:]]'
  ),
  source_id text not null check (
    source_id ~ '[^[:space:]]'
  ),
  dedupe_key text not null check (
    char_length(dedupe_key) between 1 and 128
    and dedupe_key ~ '[^[:space:]]'
  ),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create index notifications_user_created_idx
  on public.notifications (user_id, created_at desc, id desc);

create index notifications_user_unread_idx
  on public.notifications (user_id, created_at desc, id desc)
  where read_at is null;

alter table public.notifications enable row level security;

create policy notifications_read_own
  on public.notifications
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.notifications
  from public, anon, authenticated, service_role;
grant select on table public.notifications to authenticated;

create or replace function public.open_notification(target_notification_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  notification_link text;
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  update public.notifications as notification
  set read_at = coalesce(notification.read_at, now())
  where notification.id = target_notification_id
    and notification.user_id = actor_id
  returning notification.link_path into notification_link;

  if not found then
    raise exception 'notification_not_found' using errcode = 'P0002';
  end if;

  return notification_link;
end;
$$;

create or replace function public.set_ip_notification_preferences(
  target_ip_id text,
  target_notify_drops boolean default null,
  target_notify_events boolean default null,
  target_auto_follow boolean default false
)
returns table (notify_drops boolean, notify_events boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  updated_notify_drops boolean;
  updated_notify_events boolean;
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if target_auto_follow then
    perform public.follow_ip(target_ip_id);
  end if;

  update public.ip_follows as follow
  set
    notify_drops = coalesce(target_notify_drops, follow.notify_drops),
    notify_events = coalesce(target_notify_events, follow.notify_events)
  where follow.user_id = actor_id
    and follow.ip_id = target_ip_id
  returning follow.notify_drops, follow.notify_events
  into updated_notify_drops, updated_notify_events;

  if not found then
    raise exception 'notification_preferences_not_found' using errcode = 'P0002';
  end if;

  return query
    select updated_notify_drops, updated_notify_events;
end;
$$;

create or replace function private.notify_order_status_change()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  if new.status = 'paid' then
    insert into public.notifications (
      user_id,
      type,
      title,
      body,
      link_path,
      source_type,
      source_id,
      dedupe_key
    )
    values (
      new.user_id,
      'order_paid',
      '결제가 확인됐어요',
      '주문 결제가 완료됐습니다.',
      '/orders/' || new.id::text,
      'order',
      new.id::text,
      'order:paid:' || new.id::text
    )
    on conflict (user_id, dedupe_key) do nothing;
  elsif new.status = 'shipping' then
    insert into public.notifications (
      user_id,
      type,
      title,
      body,
      link_path,
      source_type,
      source_id,
      dedupe_key
    )
    values (
      new.user_id,
      'order_shipping',
      '배송이 시작됐어요',
      '주문한 굿즈의 배송이 시작됐습니다.',
      '/orders/' || new.id::text,
      'order',
      new.id::text,
      'order:shipping:' || new.id::text
    )
    on conflict (user_id, dedupe_key) do nothing;
  end if;

  return new;
end;
$$;

create trigger trg_orders_notify_status_change
after update of status on public.orders
for each row
execute function private.notify_order_status_change();

create or replace function private.notify_draw_ticket_insert_statement()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  locked_source record;
begin
  for locked_source in
    select
      inserted_ticket.user_id,
      inserted_ticket.source,
      inserted_ticket.source_id
    from inserted_draw_tickets as inserted_ticket
    group by
      inserted_ticket.user_id,
      inserted_ticket.source,
      inserted_ticket.source_id
    order by
      inserted_ticket.user_id,
      inserted_ticket.source,
      inserted_ticket.source_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        locked_source.user_id::text
          || pg_catalog.chr(31)
          || locked_source.source
          || pg_catalog.chr(31)
          || locked_source.source_id::text,
        0
      )
    );
  end loop;

  with inserted_sources as (
    select
      inserted_ticket.user_id,
      inserted_ticket.source,
      inserted_ticket.source_id
    from inserted_draw_tickets as inserted_ticket
    group by
      inserted_ticket.user_id,
      inserted_ticket.source,
      inserted_ticket.source_id
  ),
  source_totals as (
    select
      inserted_source.user_id,
      inserted_source.source,
      inserted_source.source_id,
      count(*)::integer as ticket_count
    from inserted_sources as inserted_source
    join public.draw_tickets as draw_ticket
      on draw_ticket.user_id = inserted_source.user_id
      and draw_ticket.source = inserted_source.source
      and draw_ticket.source_id = inserted_source.source_id
    group by
      inserted_source.user_id,
      inserted_source.source,
      inserted_source.source_id
  )
  insert into public.notifications (
    user_id,
    type,
    title,
    body,
    link_path,
    source_type,
    source_id,
    dedupe_key
  )
  select
    source_total.user_id,
    'draw_ticket_issued',
    '카드팩이 도착했어요',
    '카드팩 ' || source_total.ticket_count::text || '개가 발급됐습니다.',
    '/packs',
    source_total.source,
    source_total.source_id::text,
    'draw_ticket:' || source_total.source || ':' || source_total.source_id::text
  from source_totals as source_total
  on conflict (user_id, dedupe_key) do update set
    title = excluded.title,
    body = excluded.body,
    read_at = null,
    created_at = now();

  return null;
end;
$$;

create trigger trg_draw_tickets_notify_insert
after insert on public.draw_tickets
referencing new table as inserted_draw_tickets
for each statement
execute function private.notify_draw_ticket_insert_statement();

create or replace function private.notify_good_insert()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (select public.is_staff()) then
    return new;
  end if;

  insert into public.notifications (
    user_id,
    type,
    title,
    body,
    link_path,
    source_type,
    source_id,
    dedupe_key
  )
  select
    follow.user_id,
    'drop_published',
    '새 굿즈가 공개됐어요',
    left(new.name || ' 굿즈가 공개됐습니다.', 500),
    '/shop',
    'good',
    new.id,
    'good:' || pg_catalog.encode(
      extensions.digest(new.id, 'sha256'),
      'hex'
    )
  from public.ip_follows as follow
  where follow.ip_id = new.ip_id
    and follow.notify_drops
  on conflict (user_id, dedupe_key) do nothing;

  return new;
end;
$$;

create trigger trg_goods_notify_insert
after insert on public.goods
for each row
execute function private.notify_good_insert();

create or replace function private.notify_event_insert()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if new.ip_id is null
    or (select auth.uid()) is null
    or not (select public.is_staff())
  then
    return new;
  end if;

  insert into public.notifications (
    user_id,
    type,
    title,
    body,
    link_path,
    source_type,
    source_id,
    dedupe_key
  )
  select
    follow.user_id,
    'event_published',
    '새 이벤트가 공개됐어요',
    left(new.title || ' 이벤트가 공개됐습니다.', 500),
    '/events',
    'event',
    new.id,
    'event:' || pg_catalog.encode(
      extensions.digest(new.id, 'sha256'),
      'hex'
    )
  from public.ip_follows as follow
  where follow.ip_id = new.ip_id
    and follow.notify_events
  on conflict (user_id, dedupe_key) do nothing;

  return new;
end;
$$;

create trigger trg_events_notify_insert
after insert on public.events
for each row
execute function private.notify_event_insert();

revoke all on function public.open_notification(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.open_notification(uuid) to authenticated;

revoke all on function public.set_ip_notification_preferences(text, boolean, boolean, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.set_ip_notification_preferences(text, boolean, boolean, boolean)
  to authenticated;

revoke all on function private.notify_order_status_change()
  from public, anon, authenticated, service_role;
revoke all on function private.notify_draw_ticket_insert_statement()
  from public, anon, authenticated, service_role;
revoke all on function private.notify_good_insert()
  from public, anon, authenticated, service_role;
revoke all on function private.notify_event_insert()
  from public, anon, authenticated, service_role;
