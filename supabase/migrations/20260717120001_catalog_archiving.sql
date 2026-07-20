-- Reversible catalog retirement (#113): preserve historical references while
-- closing every path that can create a new interaction with archived records.

alter table public.ips
  add column archived_at timestamptz;
alter table public.goods
  add column archived_at timestamptz;
alter table public.cards
  add column archived_at timestamptz;
alter table public.events
  add column archived_at timestamptz;

create index ips_archived_at_idx on public.ips (archived_at);
create index goods_archived_at_idx on public.goods (archived_at);
create index cards_archived_at_idx on public.cards (archived_at);
create index events_archived_at_idx on public.events (archived_at);

-- An active catalog child can only belong to an active IP. Card pools are
-- locked before every affected IP, with each set in lexical order; the AFTER
-- count trigger updates those IP rows, so this avoids upgrades and move cycles.
create function private.guard_active_catalog_parent()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  parent_archived_at timestamptz;
begin
  if tg_table_name = 'cards' then
    if tg_op = 'INSERT' then
      perform pool.id
      from public.card_pools as pool
      where pool.id = new.pool_id
      order by pool.id
      for update of pool;
    else
      perform pool.id
      from public.card_pools as pool
      where pool.id = old.pool_id
         or pool.id = new.pool_id
      order by pool.id
      for update of pool;
    end if;
  end if;

  if tg_op = 'INSERT' then
    perform ip.id
    from public.ips as ip
    where ip.id = new.ip_id
    order by ip.id
    for update of ip;
  else
    perform ip.id
    from public.ips as ip
    where ip.id = old.ip_id
       or ip.id = new.ip_id
    order by ip.id
    for update of ip;
  end if;

  if new.archived_at is not null or new.ip_id is null then
    return new;
  end if;

  select ip.archived_at
    into parent_archived_at
  from public.ips as ip
  where ip.id = new.ip_id;

  if found and parent_archived_at is not null then
    raise check_violation using message = 'parent_archived';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_active_catalog_parent()
  from public, anon, authenticated, service_role;

create trigger goods_active_parent_guard
before insert or update of ip_id, archived_at on public.goods
for each row execute function private.guard_active_catalog_parent();

create trigger cards_active_parent_guard
before insert or update of ip_id, pool_id, archived_at on public.cards
for each row execute function private.guard_active_catalog_parent();

create trigger events_active_parent_guard
before insert or update of ip_id, archived_at on public.events
for each row execute function private.guard_active_catalog_parent();

-- Parent retirement is blocked until every discoverable child is retired and
-- every scheduled/current issuing operation has ended.
create function private.guard_ip_archive()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.goods as good
    where good.ip_id = new.id
      and good.archived_at is null
  ) or exists (
    select 1
    from public.cards as card
    where card.ip_id = new.id
      and card.archived_at is null
  ) or exists (
    select 1
    from public.events as event_record
    where event_record.ip_id = new.id
      and event_record.archived_at is null
  ) then
    raise check_violation using message = 'ip_has_active_children';
  end if;

  if exists (
    select 1
    from public.card_pools as pool
    where pool.ip_id = new.id
      and (pool.active_to is null or pool.active_to > pg_catalog.now())
  ) or exists (
    select 1
    from public.reward_policies as policy
    where policy.target_ip_id = new.id
      and policy.active
      and (policy.active_to is null or policy.active_to > pg_catalog.now())
  ) or exists (
    select 1
    from public.games as game
    join public.events as event_record on event_record.id = game.event_id
    where event_record.ip_id = new.id
      and (game.active_to is null or game.active_to > pg_catalog.now())
  ) or exists (
    select 1
    from public.games as game
    join public.card_pools as pool on pool.id = game.reward_pool_id
    where pool.ip_id = new.id
      and (game.active_to is null or game.active_to > pg_catalog.now())
  ) then
    raise check_violation using message = 'ip_has_active_operations';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_ip_archive()
  from public, anon, authenticated, service_role;

create trigger ips_archive_children_guard
before update of archived_at on public.ips
for each row
when (old.archived_at is null and new.archived_at is not null)
execute function private.guard_ip_archive();

-- Keep denormalized counts truthful for every writer, including legacy admin
-- upserts that still assign raw totals after their catalog mutation.
create function private.enforce_active_catalog_counts()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  select count(*)::integer
    into new.goods_count
  from public.goods as good
  where good.ip_id = new.id
    and good.archived_at is null;

  select count(*)::integer
    into new.cards_count
  from public.cards as card
  where card.ip_id = new.id
    and card.archived_at is null;

  return new;
end;
$$;

create function private.refresh_active_catalog_counts()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  previous_ip_id text;
  current_ip_id text;
begin
  if tg_op = 'INSERT' then
    current_ip_id := new.ip_id;
  elsif tg_op = 'DELETE' then
    previous_ip_id := old.ip_id;
  else
    previous_ip_id := old.ip_id;
    current_ip_id := new.ip_id;
  end if;

  if tg_table_name = 'goods' then
    update public.ips as ip
    set goods_count = (
      select count(*)::integer
      from public.goods as good
      where good.ip_id = ip.id
        and good.archived_at is null
    )
    where ip.id = previous_ip_id
       or ip.id = current_ip_id;
  elsif tg_table_name = 'cards' then
    update public.ips as ip
    set cards_count = (
      select count(*)::integer
      from public.cards as card
      where card.ip_id = ip.id
        and card.archived_at is null
    )
    where ip.id = previous_ip_id
       or ip.id = current_ip_id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_active_catalog_counts()
  from public, anon, authenticated, service_role;
revoke all on function private.refresh_active_catalog_counts()
  from public, anon, authenticated, service_role;

create trigger ips_catalog_counts_guard
before insert or update of goods_count, cards_count on public.ips
for each row execute function private.enforce_active_catalog_counts();

create trigger goods_refresh_ip_counts
after insert or delete or update of ip_id, archived_at on public.goods
for each row execute function private.refresh_active_catalog_counts();

create trigger cards_refresh_ip_counts
after insert or delete or update of ip_id, archived_at on public.cards
for each row execute function private.refresh_active_catalog_counts();

update public.ips
set
  goods_count = goods_count,
  cards_count = cards_count
where goods_count is distinct from (
    select count(*)::integer
    from public.goods as good
    where good.ip_id = ips.id
      and good.archived_at is null
  )
  or cards_count is distinct from (
    select count(*)::integer
    from public.cards as card
    where card.ip_id = ips.id
      and card.archived_at is null
  );

-- New transactions must never reference archived catalog rows. Trigger-level
-- guards preserve the existing RPC implementations and therefore their auth,
-- lock ordering, and idempotency contracts.
create function private.guard_active_good_reference()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  selected_archived_at timestamptz;
begin
  select good.archived_at
    into selected_archived_at
  from public.goods as good
  where good.id = new.good_id
  for share of good;

  if not found or selected_archived_at is not null then
    raise check_violation using message = 'catalog_item_unavailable';
  end if;

  return new;
end;
$$;

create function private.guard_active_event_reference()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  selected_archived_at timestamptz;
begin
  select event_record.archived_at
    into selected_archived_at
  from public.events as event_record
  where event_record.id = new.event_id
  for share of event_record;

  if not found or selected_archived_at is not null then
    raise check_violation using message = 'catalog_item_unavailable';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_active_good_reference()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_active_event_reference()
  from public, anon, authenticated, service_role;

create trigger cart_items_catalog_guard
before insert or update on public.cart_items
for each row execute function private.guard_active_good_reference();

create trigger order_items_catalog_guard
before insert or update on public.order_items
for each row execute function private.guard_active_good_reference();

create trigger ticket_orders_catalog_guard
before insert or update of event_id on public.ticket_orders
for each row execute function private.guard_active_event_reference();

-- The eight public RPCs share one closed private transition module. Public
-- wrappers remain explicit PostgREST contracts with fixed search paths.
create function private.set_catalog_archived(
  target_kind text,
  target_id text,
  archive_requested boolean
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  selected_archived_at timestamptz;
  transition_at timestamptz;
  audit_action text;
  audit_target text;
begin
  if actor_id is null then
    raise invalid_authorization_specification using message = 'auth_required';
  end if;

  if not public.is_staff() then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  if target_kind = 'ip' then
    select ip.archived_at
      into selected_archived_at
    from public.ips as ip
    where ip.id = target_id
    for update of ip;

    if not found then
      raise no_data_found using message = 'catalog_not_found';
    end if;
    if archive_requested = (selected_archived_at is not null) then
      return false;
    end if;

    transition_at := case when archive_requested then pg_catalog.clock_timestamp() else null end;
    update public.ips set archived_at = transition_at where id = target_id;
    audit_action := case when archive_requested then 'catalog.ip.archived' else 'catalog.ip.unarchived' end;
    audit_target := 'ips:' || target_id;

  elsif target_kind = 'good' then
    select good.archived_at
      into selected_archived_at
    from public.goods as good
    where good.id = target_id
    for update of good;

    if not found then
      raise no_data_found using message = 'catalog_not_found';
    end if;
    if archive_requested = (selected_archived_at is not null) then
      return false;
    end if;

    if archive_requested and exists (
      select 1
      from public.goods as good
      where good.id = target_id
        and good.stock_qty > 0
    ) then
      raise check_violation using message = 'good_has_stock';
    end if;

    if archive_requested and exists (
      select 1
      from public.reward_policies as policy
      where policy.target_good_id = target_id
        and policy.active
        and (policy.active_to is null or policy.active_to > pg_catalog.now())
    ) then
      raise check_violation using message = 'good_has_active_policy';
    end if;

    transition_at := case when archive_requested then pg_catalog.clock_timestamp() else null end;
    update public.goods set archived_at = transition_at where id = target_id;
    audit_action := case when archive_requested then 'catalog.good.archived' else 'catalog.good.unarchived' end;
    audit_target := 'goods:' || target_id;

  elsif target_kind = 'card' then
    select card.archived_at
      into selected_archived_at
    from public.cards as card
    where card.id = target_id
    for update of card;

    if not found then
      raise no_data_found using message = 'catalog_not_found';
    end if;
    if archive_requested = (selected_archived_at is not null) then
      return false;
    end if;

    if archive_requested and exists (
      select 1
      from public.cards as card
      join public.card_pools as pool on pool.id = card.pool_id
      where card.id = target_id
        and (pool.active_to is null or pool.active_to > pg_catalog.now())
    ) then
      raise check_violation using message = 'card_has_open_pool';
    end if;

    if archive_requested and exists (
      select 1
      from public.cards as card
      join public.draw_tickets as ticket on ticket.pool_id = card.pool_id
      where card.id = target_id
        and ticket.consumed_at is null
        and ticket.revoked_at is null
    ) then
      raise check_violation using message = 'card_has_open_tickets';
    end if;

    transition_at := case when archive_requested then pg_catalog.clock_timestamp() else null end;
    update public.cards set archived_at = transition_at where id = target_id;
    audit_action := case when archive_requested then 'catalog.card.archived' else 'catalog.card.unarchived' end;
    audit_target := 'cards:' || target_id;

  elsif target_kind = 'event' then
    select event_record.archived_at
      into selected_archived_at
    from public.events as event_record
    where event_record.id = target_id
    for update of event_record;

    if not found then
      raise no_data_found using message = 'catalog_not_found';
    end if;
    if archive_requested = (selected_archived_at is not null) then
      return false;
    end if;

    if archive_requested and exists (
      select 1
      from public.events as event_record
      join public.ticket_types as ticket_type on ticket_type.event_id = event_record.id
      where event_record.id = target_id
        and event_record.status in ('예정', '예매중', '진행중')
    ) then
      raise check_violation using message = 'event_has_open_ticketing';
    end if;

    if archive_requested and exists (
      select 1
      from public.games as game
      where game.event_id = target_id
        and (game.active_to is null or game.active_to > pg_catalog.now())
    ) then
      raise check_violation using message = 'event_has_open_game';
    end if;

    transition_at := case when archive_requested then pg_catalog.clock_timestamp() else null end;
    update public.events set archived_at = transition_at where id = target_id;
    audit_action := case when archive_requested then 'catalog.event.archived' else 'catalog.event.unarchived' end;
    audit_target := 'events:' || target_id;
  else
    raise invalid_parameter_value using message = 'invalid_catalog_kind';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    audit_action,
    audit_target,
    pg_catalog.jsonb_build_object('archived_at', transition_at)
  );

  return true;
end;
$$;

revoke all on function private.set_catalog_archived(text, text, boolean)
  from public, anon, authenticated, service_role;

create function public.admin_archive_ip(target_id text)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$ select private.set_catalog_archived('ip', $1, true); $$;

create function public.admin_unarchive_ip(target_id text)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$ select private.set_catalog_archived('ip', $1, false); $$;

create function public.admin_archive_good(target_id text)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$ select private.set_catalog_archived('good', $1, true); $$;

create function public.admin_unarchive_good(target_id text)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$ select private.set_catalog_archived('good', $1, false); $$;

create function public.admin_archive_card(target_id text)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$ select private.set_catalog_archived('card', $1, true); $$;

create function public.admin_unarchive_card(target_id text)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$ select private.set_catalog_archived('card', $1, false); $$;

create function public.admin_archive_event(target_id text)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$ select private.set_catalog_archived('event', $1, true); $$;

create function public.admin_unarchive_event(target_id text)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$ select private.set_catalog_archived('event', $1, false); $$;

revoke all on function public.admin_archive_ip(text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_unarchive_ip(text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_archive_good(text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_unarchive_good(text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_archive_card(text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_unarchive_card(text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_archive_event(text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_unarchive_event(text)
  from public, anon, authenticated, service_role;

grant execute on function public.admin_archive_ip(text) to authenticated;
grant execute on function public.admin_unarchive_ip(text) to authenticated;
grant execute on function public.admin_archive_good(text) to authenticated;
grant execute on function public.admin_unarchive_good(text) to authenticated;
grant execute on function public.admin_archive_card(text) to authenticated;
grant execute on function public.admin_unarchive_card(text) to authenticated;
grant execute on function public.admin_archive_event(text) to authenticated;
grant execute on function public.admin_unarchive_event(text) to authenticated;

-- A follow is a new interaction; preserve old follows but reject new ones for
-- an archived IP. The initial UPDATE lock also serializes concurrent fan-count
-- writers without a SHARE-to-UPDATE lock upgrade.
create or replace function public.follow_ip(target_ip_id text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  inserted_count integer := 0;
  current_fans_count integer := 0;
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  perform 1
  from public.ips as ip
  where ip.id = target_ip_id
    and ip.archived_at is null
  for update of ip;

  if not found then
    raise exception 'ip_not_found' using errcode = 'P0002';
  end if;

  insert into public.ip_follows (user_id, ip_id)
  values (actor_id, target_ip_id)
  on conflict (user_id, ip_id) do nothing;

  get diagnostics inserted_count = row_count;

  if inserted_count > 0 then
    update public.ips
    set fans_count = fans_count + 1,
        updated_at = now()
    where id = target_ip_id
    returning fans_count into current_fans_count;
  else
    select fans_count into current_fans_count
    from public.ips
    where id = target_ip_id;
  end if;

  return coalesce(current_fans_count, 0);
end;
$$;

revoke all on function public.follow_ip(text)
  from public, anon, authenticated, service_role;
grant execute on function public.follow_ip(text) to authenticated;

-- Discovery hides retired catalog rows and retired parents. Community posts
-- and tags intentionally keep their historical IP metadata searchable.
create or replace function public.search_public_content(
  search_query text,
  per_group_limit integer default 6
)
returns table (
  kind text,
  id text,
  label text,
  subtitle text,
  ip_id text,
  ip_title text,
  image_path text,
  bg text,
  accent text,
  score real
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with raw_params as (
    select
      nullif(left(btrim(search_query), 80), '') as q,
      greatest(1, least(coalesce(per_group_limit, 6), 20)) as result_limit,
      auth.uid() as actor_id
  ),
  params as (
    select
      raw_params.q,
      case
        when raw_params.q is null then null
        else '%' || replace(replace(replace(raw_params.q, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%'
      end as q_like,
      raw_params.result_limit,
      raw_params.actor_id
    from raw_params
  ),
  visible_posts as (
    select
      posts.id,
      posts.user_id,
      posts.ip_id,
      posts.text,
      posts.tag,
      posts.image_path,
      ips.title as ip_title,
      verticals.color as accent
    from public.posts
    left join public.ips on ips.id = posts.ip_id
    left join public.verticals on verticals.key = ips.vertical_key
    cross join params
    where params.q is not null
      and posts.status = 'visible'
      and not exists (
        select 1
        from public.blocks
        where blocks.user_id = params.actor_id
          and blocks.blocked_user_id = posts.user_id
      )
  ),
  all_matches as (
    select
      'ip'::text as kind,
      ips.id::text as id,
      ips.title as label,
      concat_ws(' · ', verticals.label, ips.sub) as subtitle,
      ips.id::text as ip_id,
      ips.title as ip_title,
      ips.image_path,
      ips.bg,
      verticals.color as accent,
      greatest(
        extensions.similarity(ips.title, params.q),
        case when ips.title ilike params.q_like escape E'\\' then 1 else 0 end,
        case when coalesce(ips.sub, '') ilike params.q_like escape E'\\' then 0.7 else 0 end,
        case when coalesce(ips.tagline, '') ilike params.q_like escape E'\\' then 0.6 else 0 end,
        case when coalesce(ips.synopsis, '') ilike params.q_like escape E'\\' then 0.4 else 0 end
      )::real as score,
      params.result_limit
    from params
    join public.ips on params.q is not null
    join public.verticals on verticals.key = ips.vertical_key
    where ips.archived_at is null
      and (
        ips.title ilike params.q_like escape E'\\'
        or coalesce(ips.sub, '') ilike params.q_like escape E'\\'
        or coalesce(ips.tagline, '') ilike params.q_like escape E'\\'
        or coalesce(ips.synopsis, '') ilike params.q_like escape E'\\'
        or extensions.similarity(ips.title, params.q) > 0.15
      )

    union all

    select
      'good'::text as kind,
      goods.id::text as id,
      goods.name as label,
      concat_ws(' · ', ips.title, goods.type) as subtitle,
      goods.ip_id::text,
      ips.title as ip_title,
      goods.image_path,
      goods.bg,
      verticals.color as accent,
      greatest(
        extensions.similarity(goods.name, params.q),
        case when goods.name ilike params.q_like escape E'\\' then 1 else 0 end,
        case when goods.type ilike params.q_like escape E'\\' then 0.7 else 0 end,
        case when coalesce(goods.badge, '') ilike params.q_like escape E'\\' then 0.4 else 0 end,
        case when ips.title ilike params.q_like escape E'\\' then 0.35 else 0 end
      )::real as score,
      params.result_limit
    from params
    join public.goods on params.q is not null
    join public.ips on ips.id = goods.ip_id
    join public.verticals on verticals.key = ips.vertical_key
    where goods.archived_at is null
      and ips.archived_at is null
      and (
        goods.name ilike params.q_like escape E'\\'
        or goods.type ilike params.q_like escape E'\\'
        or coalesce(goods.badge, '') ilike params.q_like escape E'\\'
        or ips.title ilike params.q_like escape E'\\'
        or extensions.similarity(goods.name, params.q) > 0.15
      )

    union all

    select
      'card'::text as kind,
      cards.id::text as id,
      cards.name as label,
      concat_ws(' · ', ips.title, cards.rarity::text, cards.no) as subtitle,
      cards.ip_id::text,
      ips.title as ip_title,
      cards.image_path,
      cards.bg,
      verticals.color as accent,
      greatest(
        extensions.similarity(cards.name, params.q),
        case when cards.name ilike params.q_like escape E'\\' then 1 else 0 end,
        case when coalesce(cards.no, '') ilike params.q_like escape E'\\' then 0.5 else 0 end,
        case when cards.rarity::text ilike params.q_like escape E'\\' then 0.5 else 0 end,
        case when ips.title ilike params.q_like escape E'\\' then 0.35 else 0 end
      )::real as score,
      params.result_limit
    from params
    join public.cards on params.q is not null
    join public.ips on ips.id = cards.ip_id
    join public.verticals on verticals.key = ips.vertical_key
    where cards.archived_at is null
      and ips.archived_at is null
      and (
        cards.name ilike params.q_like escape E'\\'
        or coalesce(cards.no, '') ilike params.q_like escape E'\\'
        or cards.rarity::text ilike params.q_like escape E'\\'
        or ips.title ilike params.q_like escape E'\\'
        or extensions.similarity(cards.name, params.q) > 0.15
      )

    union all

    select
      'post'::text as kind,
      visible_posts.id::text as id,
      visible_posts.text as label,
      concat_ws(' · ', visible_posts.ip_title, case when visible_posts.tag is null then null else '#' || visible_posts.tag end) as subtitle,
      visible_posts.ip_id::text,
      visible_posts.ip_title,
      null::text as image_path,
      null::text as bg,
      visible_posts.accent,
      greatest(
        extensions.similarity(visible_posts.text, params.q),
        case when visible_posts.text ilike params.q_like escape E'\\' then 1 else 0 end,
        case when coalesce(visible_posts.tag, '') ilike params.q_like escape E'\\' then 0.8 else 0 end,
        case when coalesce(visible_posts.ip_title, '') ilike params.q_like escape E'\\' then 0.35 else 0 end
      )::real as score,
      params.result_limit
    from params
    join visible_posts on true
    where visible_posts.text ilike params.q_like escape E'\\'
      or coalesce(visible_posts.tag, '') ilike params.q_like escape E'\\'
      or coalesce(visible_posts.ip_title, '') ilike params.q_like escape E'\\'
      or extensions.similarity(visible_posts.text, params.q) > 0.15

    union all

    select
      'tag'::text as kind,
      visible_posts.tag as id,
      '#' || visible_posts.tag as label,
      '커뮤니티 태그'::text as subtitle,
      null::text as ip_id,
      null::text as ip_title,
      null::text as image_path,
      null::text as bg,
      max(visible_posts.accent) as accent,
      max(greatest(
        extensions.similarity(visible_posts.tag, params.q),
        case when visible_posts.tag ilike params.q_like escape E'\\' then 1 else 0 end
      ))::real as score,
      params.result_limit
    from params
    join visible_posts on visible_posts.tag is not null
    where visible_posts.tag ilike params.q_like escape E'\\'
      or extensions.similarity(visible_posts.tag, params.q) > 0.15
    group by visible_posts.tag, params.result_limit
  ),
  ranked as (
    select
      all_matches.*,
      row_number() over (
        partition by all_matches.kind
        order by all_matches.score desc, all_matches.label asc, all_matches.id asc
      ) as group_rank
    from all_matches
  )
  select
    ranked.kind,
    ranked.id,
    ranked.label,
    ranked.subtitle,
    ranked.ip_id,
    ranked.ip_title,
    ranked.image_path,
    ranked.bg,
    ranked.accent,
    ranked.score
  from ranked
  where ranked.group_rank <= ranked.result_limit
  order by
    case ranked.kind
      when 'ip' then 1
      when 'good' then 2
      when 'card' then 3
      when 'post' then 4
      when 'tag' then 5
      else 6
    end,
    ranked.score desc,
    ranked.label asc,
    ranked.id asc;
$$;

revoke all on function public.search_public_content(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.search_public_content(text, integer)
  to anon, authenticated;

-- Retirement is a persistent invariant, not only a one-time archive check.
-- Every catalog association created or reactivated after this migration locks
-- its parent row so it serializes with a concurrent archive transition.
create function private.catalog_pool_has_active_lineup(target_pool_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    count(*) = 5
    and coalesce(sum(pool_odd.probability), 0) = 1
    and coalesce(
      bool_and(pool_odd.probability between 0 and 1),
      false
    )
    and not exists (
      select 1
      from public.pool_odds as positive_odd
      where positive_odd.pool_id = target_pool_id
        and positive_odd.probability > 0
        and not exists (
          select 1
          from public.cards as card
          where card.pool_id = target_pool_id
            and card.rarity = positive_odd.rarity
            and card.archived_at is null
        )
    )
  from public.pool_odds as pool_odd
  where pool_odd.pool_id = target_pool_id;
$$;

revoke all on function private.catalog_pool_has_active_lineup(uuid)
  from public, anon, authenticated, service_role;

-- Preserve the archive RPC's established dependency tokens for privileged
-- direct DML while the paired child triggers close post-check write races.
create function private.guard_catalog_archive_dependencies()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'goods' then
    if new.stock_qty > 0 then
      raise check_violation using message = 'good_has_stock';
    end if;

    if exists (
      select 1
      from public.reward_policies as policy
      where policy.target_good_id = new.id
        and policy.active
        and (policy.active_to is null or policy.active_to > pg_catalog.now())
    ) then
      raise check_violation using message = 'good_has_active_policy';
    end if;

  elsif tg_table_name = 'cards' then
    if exists (
      select 1
      from public.card_pools as pool
      where pool.id = new.pool_id
        and (pool.active_to is null or pool.active_to > pg_catalog.now())
    ) then
      raise check_violation using message = 'card_has_open_pool';
    end if;

    if exists (
      select 1
      from public.draw_tickets as ticket
      where ticket.pool_id = new.pool_id
        and ticket.consumed_at is null
        and ticket.revoked_at is null
    ) then
      raise check_violation using message = 'card_has_open_tickets';
    end if;

  elsif tg_table_name = 'events' then
    if new.status in ('예정', '예매중', '진행중') and exists (
      select 1
      from public.ticket_types as ticket_type
      where ticket_type.event_id = new.id
    ) then
      raise check_violation using message = 'event_has_open_ticketing';
    end if;

    if exists (
      select 1
      from public.games as game
      where game.event_id = new.id
        and (game.active_to is null or game.active_to > pg_catalog.now())
    ) then
      raise check_violation using message = 'event_has_open_game';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.guard_catalog_archive_dependencies()
  from public, anon, authenticated, service_role;

create trigger goods_archive_dependency_guard
before update of archived_at on public.goods
for each row
when (old.archived_at is null and new.archived_at is not null)
execute function private.guard_catalog_archive_dependencies();

create trigger cards_archive_dependency_guard
before update of archived_at on public.cards
for each row
when (old.archived_at is null and new.archived_at is not null)
execute function private.guard_catalog_archive_dependencies();

create trigger events_archive_dependency_guard
before update of archived_at on public.events
for each row
when (old.archived_at is null and new.archived_at is not null)
execute function private.guard_catalog_archive_dependencies();

create function private.guard_catalog_card_pool()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  selected_archived_at timestamptz;
begin
  if new.active_to is not null and new.active_to <= pg_catalog.now() then
    return new;
  end if;

  if exists (
    select 1
    from public.cards as card
    where card.pool_id = new.id
      and card.archived_at is not null
  ) then
    raise check_violation using message = 'catalog_item_archived';
  end if;

  select ip.archived_at
    into selected_archived_at
  from public.ips as ip
  where ip.id = new.ip_id
  for share of ip;

  if found and selected_archived_at is not null then
    raise check_violation using message = 'catalog_item_archived';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_catalog_card_pool()
  from public, anon, authenticated, service_role;

create trigger card_pools_catalog_guard
before insert or update of ip_id, active_from, active_to on public.card_pools
for each row execute function private.guard_catalog_card_pool();

create function private.guard_catalog_card_binding()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  selected_active_to timestamptz;
begin
  if new.pool_id is null then
    return new;
  end if;

  select pool.active_to
    into selected_active_to
  from public.card_pools as pool
  where pool.id = new.pool_id
  for update of pool;

  if found
    and (selected_active_to is null or selected_active_to > pg_catalog.now())
    and new.archived_at is not null
  then
    raise check_violation using message = 'catalog_item_archived';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_catalog_card_binding()
  from public, anon, authenticated, service_role;

create trigger cards_pool_catalog_guard
before insert or update of pool_id, archived_at on public.cards
for each row execute function private.guard_catalog_card_binding();

create function private.guard_catalog_reward_policy()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  selected_archived_at timestamptz;
  selected_pool_id uuid;
begin
  if not new.active
    or (new.active_to is not null and new.active_to <= pg_catalog.now())
  then
    return new;
  end if;

  if new.target_good_id is not null then
    select good.archived_at
      into selected_archived_at
    from public.goods as good
    where good.id = new.target_good_id
    for share of good;

    if found and selected_archived_at is not null then
      raise check_violation using message = 'catalog_item_archived';
    end if;
  end if;

  select pool.id
    into selected_pool_id
  from public.card_pools as pool
  where pool.id = new.pool_id
  for share of pool;

  if selected_pool_id is null then
    return new;
  end if;

  if not private.catalog_pool_has_active_lineup(new.pool_id)
    and exists (
    select 1
    from public.cards as card
    where card.pool_id = new.pool_id
      and card.archived_at is not null
    )
  then
    raise check_violation using message = 'catalog_item_archived';
  end if;

  select ip.archived_at
    into selected_archived_at
  from public.ips as ip
  where ip.id = new.target_ip_id
  for share of ip;

  if found and selected_archived_at is not null then
    raise check_violation using message = 'catalog_item_archived';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_catalog_reward_policy()
  from public, anon, authenticated, service_role;

create trigger reward_policies_catalog_guard
before insert or update of
  pool_id, target_ip_id, target_good_id, active, active_from, active_to
on public.reward_policies
for each row execute function private.guard_catalog_reward_policy();

create function private.guard_catalog_pool_odd()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  selected_active_to timestamptz;
begin
  if new.probability <= 0 then
    return new;
  end if;

  select pool.active_to
    into selected_active_to
  from public.card_pools as pool
  where pool.id = new.pool_id
  for share of pool;

  if not found
    or (selected_active_to is not null and selected_active_to <= pg_catalog.now())
  then
    return new;
  end if;

  if not exists (
    select 1
    from public.cards as card
    where card.pool_id = new.pool_id
      and card.rarity = new.rarity
      and card.archived_at is null
  ) and exists (
    select 1
    from public.cards as archived_card
    where archived_card.pool_id = new.pool_id
      and archived_card.rarity = new.rarity
      and archived_card.archived_at is not null
  ) then
    raise check_violation using message = 'catalog_item_archived';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_catalog_pool_odd()
  from public, anon, authenticated, service_role;

create trigger pool_odds_catalog_guard
before insert or update of pool_id, rarity, probability on public.pool_odds
for each row execute function private.guard_catalog_pool_odd();

create function private.guard_catalog_game()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  selected_archived_at timestamptz;
  selected_pool_id uuid;
begin
  if new.active_to is not null and new.active_to <= pg_catalog.now() then
    return new;
  end if;

  if new.event_id is not null then
    select event_record.archived_at
      into selected_archived_at
    from public.events as event_record
    where event_record.id = new.event_id
    for share of event_record;

    if found and selected_archived_at is not null then
      raise check_violation using message = 'catalog_item_archived';
    end if;
  end if;

  if new.reward_pool_id is null then
    return new;
  end if;

  select pool.id
    into selected_pool_id
  from public.card_pools as pool
  where pool.id = new.reward_pool_id
  for share of pool;

  if selected_pool_id is null then
    return new;
  end if;

  if not private.catalog_pool_has_active_lineup(new.reward_pool_id)
    and exists (
    select 1
    from public.cards as card
    where card.pool_id = new.reward_pool_id
      and card.archived_at is not null
    )
  then
    raise check_violation using message = 'catalog_item_archived';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_catalog_game()
  from public, anon, authenticated, service_role;

create trigger games_catalog_guard
before insert or update of
  event_id, reward_pool_id, active_from, active_to
on public.games
for each row execute function private.guard_catalog_game();

create function private.guard_catalog_game_play()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  selected_event_id text;
  selected_archived_at timestamptz;
begin
  select game.event_id
    into selected_event_id
  from public.games as game
  where game.id = new.game_id
  for share of game;

  if selected_event_id is null then
    return new;
  end if;

  select event_record.archived_at
    into selected_archived_at
  from public.events as event_record
  where event_record.id = selected_event_id
  for share of event_record;

  if found and selected_archived_at is not null then
    raise check_violation using message = 'catalog_item_archived';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_catalog_game_play()
  from public, anon, authenticated, service_role;

create trigger game_plays_catalog_guard
before insert on public.game_plays
for each row execute function private.guard_catalog_game_play();

create function private.guard_catalog_ticket_type()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  selected_archived_at timestamptz;
begin
  if tg_op = 'UPDATE' and old.event_id is not distinct from new.event_id then
    return new;
  end if;

  select event_record.archived_at
    into selected_archived_at
  from public.events as event_record
  where event_record.id = new.event_id
  for share of event_record;

  if found and selected_archived_at is not null then
    raise check_violation using message = 'catalog_item_archived';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_catalog_ticket_type()
  from public, anon, authenticated, service_role;

create trigger ticket_types_catalog_guard
before insert or update of event_id on public.ticket_types
for each row execute function private.guard_catalog_ticket_type();

create function private.guard_catalog_post()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  selected_archived_at timestamptz;
begin
  if new.ip_id is null
    or (tg_op = 'UPDATE' and old.ip_id is not distinct from new.ip_id)
  then
    return new;
  end if;

  select ip.archived_at
    into selected_archived_at
  from public.ips as ip
  where ip.id = new.ip_id
  for share of ip;

  if found and selected_archived_at is not null then
    raise check_violation using message = 'catalog_item_archived';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_catalog_post()
  from public, anon, authenticated, service_role;

create trigger posts_catalog_guard
before insert or update of ip_id on public.posts
for each row execute function private.guard_catalog_post();

drop policy if exists posts_insert on public.posts;
create policy posts_insert on public.posts for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and (
      image_path is null
      or (storage.foldername(image_path))[1] = (select auth.uid())::text
    )
    and exists (
      select 1
      from public.profiles as profile
      where profile.id = (select auth.uid())
        and profile.suspended_at is null
    )
    and (
      ip_id is null
      or exists (
        select 1
        from public.ips as post_ip
        where post_ip.id = posts.ip_id
          and post_ip.archived_at is null
      )
    )
  );

-- Manual positive stock adjustments reopen inventory and therefore reject a
-- retired good. Negative reconciliation remains possible, and order
-- cancellation/expiry restocks continue through their existing internal path.
create or replace function public.admin_adjust_stock(
  target_adjustment_id uuid,
  target_good_id text,
  target_expected_stock_qty integer,
  target_delta integer,
  target_reason text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_reason text;
  previous_stock_qty integer;
  selected_archived_at timestamptz;
  next_stock_qty bigint;
  requested_diff jsonb;
  existing_actor_id uuid;
  existing_action text;
  existing_target text;
  existing_diff jsonb;
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  normalized_reason := btrim(target_reason, E' \t\n\r\f\v');

  if target_adjustment_id is null then
    raise exception 'invalid_adjustment_id' using errcode = '22004';
  end if;

  if target_expected_stock_qty is null or target_expected_stock_qty < 0 then
    raise exception 'invalid_expected_stock_qty' using errcode = '22023';
  end if;

  if target_delta is null or target_delta = 0 then
    raise exception 'invalid_stock_delta' using errcode = '22023';
  end if;

  if normalized_reason is null
    or char_length(normalized_reason) < 1
    or char_length(normalized_reason) > 200
  then
    raise exception 'invalid_stock_reason' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin_stock_adjustment:' || target_adjustment_id::text, 0)
  );

  next_stock_qty := target_expected_stock_qty::bigint + target_delta::bigint;
  requested_diff := jsonb_build_object(
    'from', target_expected_stock_qty,
    'delta', target_delta,
    'to', next_stock_qty,
    'reason', normalized_reason
  );

  select audit.actor_id, audit.action, audit.target, audit.diff
    into existing_actor_id, existing_action, existing_target, existing_diff
  from public.audit_log as audit
  where audit.id = target_adjustment_id;

  if found then
    if existing_actor_id = actor_id
      and existing_action = 'admin.good.stock_adjusted'
      and existing_target = 'goods:' || target_good_id
      and existing_diff = requested_diff
    then
      return (existing_diff ->> 'to')::integer;
    end if;

    raise exception 'adjustment_conflict' using errcode = '23505';
  end if;

  select good.stock_qty, good.archived_at
    into previous_stock_qty, selected_archived_at
  from public.goods as good
  where good.id = target_good_id
  for update;

  if not found then
    raise exception 'good_not_found' using errcode = 'P0002';
  end if;

  if target_delta > 0 and selected_archived_at is not null then
    raise check_violation using message = 'catalog_item_archived';
  end if;

  if previous_stock_qty <> target_expected_stock_qty then
    raise exception 'stock_changed' using errcode = 'P0001';
  end if;

  next_stock_qty := previous_stock_qty::bigint + target_delta::bigint;

  if next_stock_qty < 0 or next_stock_qty > 2147483647 then
    raise exception 'stock_out_of_range' using errcode = '22003';
  end if;

  update public.goods
  set stock_qty = next_stock_qty::integer
  where id = target_good_id;

  insert into public.audit_log (id, actor_id, action, target, diff)
  values (
    target_adjustment_id,
    actor_id,
    'admin.good.stock_adjusted',
    'goods:' || target_good_id,
    jsonb_build_object(
      'from', previous_stock_qty,
      'delta', target_delta,
      'to', next_stock_qty,
      'reason', normalized_reason
    )
  );

  return next_stock_qty::integer;
end;
$$;

revoke all on function public.admin_adjust_stock(uuid, text, integer, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_adjust_stock(uuid, text, integer, integer, text)
  to authenticated;

-- Card grants hold the pool while selecting only live cards. Card mutations
-- take a conflicting pool lock first, so selection and archive cannot overlap.
create or replace function public.grant_cards(
  p_user_id uuid,
  p_pool_id uuid,
  p_source text,
  p_source_id uuid,
  p_idempotency_key text,
  p_count integer default 1
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing jsonb;
  v_cards jsonb := '[]'::jsonb;
  v_rarity rarity;
  v_card text;
  v_new boolean;
begin
  if p_count < 1 or p_count > 100 then
    raise exception 'invalid count';
  end if;

  perform 1
  from public.card_pools
  where id = p_pool_id
  for share;

  if not found then
    raise exception 'pool_not_found' using errcode = 'P0002';
  end if;

  select granted_cards
    into v_existing
  from public.card_grants
  where idempotency_key = p_idempotency_key;

  if v_existing is not null then
    return v_existing;
  end if;

  for i in 1..p_count loop
    v_rarity := public.roll_rarity(p_pool_id);

    select card.id
      into v_card
    from public.cards as card
    where card.pool_id = p_pool_id
      and card.rarity = v_rarity
      and card.archived_at is null
    order by random()
    limit 1;

    if v_card is null then
      if exists (
        select 1
        from public.cards as archived_card
        where archived_card.pool_id = p_pool_id
          and archived_card.rarity = v_rarity
          and archived_card.archived_at is not null
      ) then
        raise check_violation using message = 'catalog_item_archived';
      end if;

      raise exception 'pool has no card of rarity %', v_rarity;
    end if;

    v_new := not exists (
      select 1
      from public.user_cards
      where user_id = p_user_id
        and card_id = v_card
    );

    insert into public.user_cards as user_card (user_id, card_id, qty)
    values (p_user_id, v_card, 1)
    on conflict on constraint user_cards_pkey
    do update set qty = user_card.qty + 1;

    v_cards := v_cards || jsonb_build_object(
      'cardId', v_card,
      'rarity', v_rarity,
      'isNew', v_new
    );
  end loop;

  insert into public.card_grants (
    user_id,
    pool_id,
    source,
    source_id,
    granted_cards,
    idempotency_key
  )
  values (
    p_user_id,
    p_pool_id,
    p_source,
    p_source_id,
    v_cards,
    p_idempotency_key
  );

  return v_cards;
end;
$$;

revoke all on function public.grant_cards(uuid, uuid, text, uuid, text, integer)
  from public, anon, authenticated, service_role;

-- Lock the post before considering a new IP reference. Editing text or tags on
-- a historical post keeps working when its existing IP is already archived.
create or replace function public.edit_own_post(
  target_post_id uuid,
  post_text text,
  post_ip_id text,
  post_tag text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  normalized_text text := nullif(btrim(post_text), '');
  normalized_ip_id text := nullif(btrim(post_ip_id), '');
  normalized_tag text := nullif(btrim(post_tag), '');
  previous_ip_id text;
  selected_archived_at timestamptz;
  edited_at timestamptz;
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if normalized_text is null then
    raise exception 'invalid_post_text' using errcode = '22023';
  end if;

  select post.ip_id
    into previous_ip_id
  from public.posts as post
  where post.id = target_post_id
    and post.user_id = actor_id
    and post.status = 'visible'
  for update of post;

  if not found then
    raise exception 'post_not_editable' using errcode = '42501';
  end if;

  if normalized_ip_id is distinct from previous_ip_id then
    select ip.archived_at
      into selected_archived_at
    from public.ips as ip
    where ip.id = normalized_ip_id
    for share of ip;

    if not found then
      raise exception 'invalid_post_ip' using errcode = '22023';
    end if;

    if selected_archived_at is not null then
      raise check_violation using message = 'catalog_item_archived';
    end if;
  end if;

  update public.posts
  set
    text = normalized_text,
    ip_id = normalized_ip_id,
    tag = normalized_tag
  where id = target_post_id
  returning updated_at into edited_at;

  return jsonb_build_object(
    'previousIpId', previous_ip_id,
    'ipId', normalized_ip_id,
    'updatedAt', edited_at
  );
end;
$$;

revoke all on function public.edit_own_post(uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.edit_own_post(uuid, text, text, text)
  to authenticated;

-- Keep the mature play implementation intact behind a sealed private symbol.
-- The public wrapper closes both fresh plays and replay calls when the linked
-- event has since been archived.
alter function public.play_game(text) set schema private;
alter function private.play_game(text) rename to play_game_without_catalog_guard;

revoke all on function private.play_game_without_catalog_guard(text)
  from public, anon, authenticated, service_role;

create function public.play_game(p_game_id text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  selected_event_id text;
  selected_archived_at timestamptz;
begin
  select game.event_id
    into selected_event_id
  from public.games as game
  where game.id = p_game_id
  for share of game;

  if found and selected_event_id is not null then
    select event_record.archived_at
      into selected_archived_at
    from public.events as event_record
    where event_record.id = selected_event_id
    for share of event_record;

    if found and selected_archived_at is not null then
      raise check_violation using message = 'catalog_item_archived';
    end if;
  end if;

  return private.play_game_without_catalog_guard(p_game_id);
end;
$$;

revoke all on function public.play_game(text)
  from public, anon, authenticated, service_role;
grant execute on function public.play_game(text) to authenticated;

-- The admin readiness projection uses the same live-card definition as write
-- guards and grants, so an archived-only rarity is never reported as ready.
create or replace function public.admin_list_games()
returns table (
  id text,
  type text,
  title text,
  event_id text,
  event_title text,
  config jsonb,
  variant_kind text,
  marble_count integer,
  reward_pool_id uuid,
  reward_pool_name text,
  reward_pool_active_from timestamptz,
  reward_pool_active_to timestamptz,
  reward_pool_ready boolean,
  ip_id text,
  ip_title text,
  per_user_daily_limit integer,
  active_from timestamptz,
  active_to timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  play_count bigint,
  last_played_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select
    game.id,
    game.type,
    game.title,
    game.event_id,
    event_record.title as event_title,
    game.config,
    case
      when game.config #>> '{variant,kind}' in ('card', 'goods')
        then game.config #>> '{variant,kind}'
      else 'unknown'
    end as variant_kind,
    case
      when game.config ->> 'marbleCount' ~ '^[0-9]{1,9}$'
        then (game.config ->> 'marbleCount')::integer
      else null
    end as marble_count,
    game.reward_pool_id,
    pool.name as reward_pool_name,
    pool.active_from as reward_pool_active_from,
    pool.active_to as reward_pool_active_to,
    private.catalog_pool_has_active_lineup(pool.id) as reward_pool_ready,
    pool.ip_id,
    ip.title as ip_title,
    game.per_user_daily_limit,
    game.active_from,
    game.active_to,
    game.created_at,
    game.updated_at,
    play_summary.play_count,
    play_summary.last_played_at
  from public.games as game
  left join public.card_pools as pool
    on pool.id = game.reward_pool_id
  left join public.ips as ip
    on ip.id = pool.ip_id
  left join public.events as event_record
    on event_record.id = game.event_id
  left join lateral (
    select
      count(*)::bigint as play_count,
      max(game_play.created_at) as last_played_at
    from public.game_plays as game_play
    where game_play.game_id = game.id
  ) as play_summary on true
  order by game.created_at desc, game.id;
end;
$$;

revoke all on function public.admin_list_games()
  from public, anon, authenticated, service_role;
grant execute on function public.admin_list_games() to authenticated;
