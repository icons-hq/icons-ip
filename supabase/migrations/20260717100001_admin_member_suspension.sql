-- Staff member lookup and account-suspension enforcement (#111).

alter table public.profiles
  add column suspended_at timestamptz,
  add column suspension_reason text;

alter table public.profiles
  add constraint profiles_suspension_state_check
  check (
    (suspended_at is null and suspension_reason is null)
    or (
      suspended_at is not null
      and suspension_reason is not null
      and suspension_reason = pg_catalog.btrim(suspension_reason, E' \t\n\r\f\v')
      and pg_catalog.length(suspension_reason) between 1 and 200
    )
  );

create index profiles_suspended_at_idx
  on public.profiles (suspended_at desc, id)
  where suspended_at is not null;

create index reports_reporter_id_idx
  on public.reports (reporter_id);

-- Direct profile reads are self-only. Staff member lookup must pass through
-- the purpose-built masked-list or explicit-detail RPCs below.
revoke select on table public.profiles from authenticated;
grant select (
  id,
  email,
  nickname,
  birth_date,
  avatar_path,
  role,
  consents,
  onboarded_at,
  created_at,
  updated_at,
  suspended_at
) on table public.profiles to authenticated;
revoke select (suspension_reason) on table public.profiles from authenticated;

drop policy profiles_read on public.profiles;
create policy profiles_read on public.profiles for select
  using ((select auth.uid()) = id);

-- Preserve the reported member independently from later author-owned content
-- deletion. This private snapshot is not exposed through the Data API.
create table private.report_subjects (
  report_id uuid primary key references public.reports (id) on delete cascade,
  target_user_id uuid not null references public.profiles (id) on delete cascade
);

create index report_subjects_target_user_id_idx
  on private.report_subjects (target_user_id);

revoke all on table private.report_subjects
  from public, anon, authenticated, service_role;

insert into private.report_subjects (report_id, target_user_id)
select report.id, profile.id
from public.reports as report
join public.profiles as profile on profile.id::text = report.target_id
where report.target_type = 'user'
union all
select report.id, post.user_id
from public.reports as report
join public.posts as post on post.id::text = report.target_id
where report.target_type = 'post'
union all
select report.id, comment.user_id
from public.reports as report
join public.comments as comment on comment.id::text = report.target_id
where report.target_type = 'comment'
on conflict (report_id) do nothing;

create or replace function private.capture_report_subject()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  selected_target_user_id uuid;
begin
  if new.target_type = 'user' then
    select profile.id
      into selected_target_user_id
    from public.profiles as profile
    where profile.id::text = new.target_id;
  elsif new.target_type = 'post' then
    select post.user_id
      into selected_target_user_id
    from public.posts as post
    where post.id::text = new.target_id;
  elsif new.target_type = 'comment' then
    select comment.user_id
      into selected_target_user_id
    from public.comments as comment
    where comment.id::text = new.target_id;
  end if;

  if selected_target_user_id is null then
    raise exception 'target_not_found' using errcode = '22023';
  end if;

  insert into private.report_subjects (report_id, target_user_id)
  values (new.id, selected_target_user_id)
  on conflict (report_id) do update
  set target_user_id = excluded.target_user_id;

  return new;
end;
$$;

revoke all on function private.capture_report_subject()
  from public, anon, authenticated, service_role;

create trigger trg_reports_capture_subject
after insert or update of target_type, target_id on public.reports
for each row execute function private.capture_report_subject();

-- A suspended privileged profile immediately loses every RLS/RPC boundary
-- that uses is_staff(). Keep the pre-existing callable roles explicit.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as profile
    where profile.id = (select auth.uid())
      and profile.role in ('staff', 'admin')
      and profile.suspended_at is null
  );
$$;

revoke all on function public.is_staff()
  from public, anon, authenticated, service_role;
grant execute on function public.is_staff()
  to anon, authenticated, service_role;

-- Central suspension assertion used by narrow table triggers. It is private,
-- fixed-search-path, and not callable by any Data API role.
create or replace function private.assert_active_user(target_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  selected_suspended_at timestamptz;
begin
  if target_user_id is null then
    raise exception 'profile_not_found' using errcode = '22023';
  end if;

  select profile.suspended_at
    into selected_suspended_at
  from public.profiles as profile
  where profile.id = target_user_id
  for share;

  if not found then
    raise exception 'profile_not_found' using errcode = '22023';
  end if;

  if selected_suspended_at is not null then
    raise exception 'account_suspended' using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.assert_active_user(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.guard_active_user_insert()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.assert_active_user(new.user_id);
  return new;
end;
$$;

create or replace function private.guard_active_post_author_update()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) = old.user_id
    and (
      new.user_id is distinct from old.user_id
      or new.text is distinct from old.text
      or new.ip_id is distinct from old.ip_id
      or new.tag is distinct from old.tag
      or new.image_path is distinct from old.image_path
      or (old.status <> 'visible' and new.status = 'visible')
    )
  then
    perform private.assert_active_user(old.user_id);
  end if;
  return new;
end;
$$;

create or replace function private.guard_active_draw_ticket_consumption()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if old.consumed_at is null and new.consumed_at is not null then
    perform private.assert_active_user(old.user_id);
  end if;
  return new;
end;
$$;

create or replace function private.guard_active_check_in_staff()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if new.by_staff is not null then
    perform private.assert_active_user(new.by_staff);
  end if;
  return new;
end;
$$;

revoke all on function private.guard_active_user_insert()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_active_post_author_update()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_active_draw_ticket_consumption()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_active_check_in_staff()
  from public, anon, authenticated, service_role;

create trigger trg_posts_active_user_insert
  before insert on public.posts
  for each row execute function private.guard_active_user_insert();

create trigger trg_posts_active_author_update
  before update on public.posts
  for each row execute function private.guard_active_post_author_update();

create trigger trg_comments_active_user_insert
  before insert on public.comments
  for each row execute function private.guard_active_user_insert();

create trigger trg_orders_active_user_insert
  before insert on public.orders
  for each row execute function private.guard_active_user_insert();

create trigger trg_ticket_orders_active_user_insert
  before insert on public.ticket_orders
  for each row execute function private.guard_active_user_insert();

create trigger trg_game_plays_active_user_insert
  before insert on public.game_plays
  for each row execute function private.guard_active_user_insert();

create trigger trg_draw_tickets_active_consumption
  before update of consumed_at on public.draw_tickets
  for each row execute function private.guard_active_draw_ticket_consumption();

create trigger trg_check_ins_active_staff_insert
  before insert on public.check_ins
  for each row execute function private.guard_active_check_in_staff();

-- Direct post creation and community storage uploads also require an active
-- profile. Profile-avatar uploads deliberately remain available.
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
  );

drop policy if exists user_uploads_write on storage.objects;
create policy user_uploads_write on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'user-uploads'
    and (select auth.uid()) is not null
    and (
      (
        name ~ (
          '^'
          || (select auth.uid())::text
          || '/profile/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
        )
        and private.has_pending_profile_avatar_claim(name)
      )
      or (
        name ~ (
          '^'
          || (select auth.uid())::text
          || '/community/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp|gif)$'
        )
        and exists (
          select 1
          from public.profiles as profile
          where profile.id = (select auth.uid())
            and profile.suspended_at is null
        )
      )
    )
  );

-- PII-free signup aggregates preserve the admin overview without reopening
-- direct cross-user profile reads.
create or replace function public.admin_profile_signup_counts(
  target_previous_start timestamptz,
  target_current_start timestamptz,
  target_current_end timestamptz
)
returns table (
  previous_count bigint,
  current_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
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

  if target_previous_start is null
    or target_current_start is null
    or target_current_end is null
    or target_previous_start >= target_current_start
    or target_current_start >= target_current_end
  then
    raise exception 'invalid_signup_window' using errcode = '22023';
  end if;

  return query
  select
    pg_catalog.count(*) filter (
      where profile.created_at >= target_previous_start
        and profile.created_at < target_current_start
    )::bigint,
    pg_catalog.count(*) filter (
      where profile.created_at >= target_current_start
        and profile.created_at < target_current_end
    )::bigint
  from public.profiles as profile;
end;
$$;

-- Masked list search. Full email and internal suspension reason are returned
-- only by the explicit detail RPC below.
create or replace function public.admin_search_members(
  target_query text default null,
  target_limit integer default 20,
  target_offset integer default 0
)
returns table (
  profile_id uuid,
  nickname text,
  masked_email text,
  role public.user_role,
  created_at timestamptz,
  suspended_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_query text := nullif(
    pg_catalog.btrim(coalesce(target_query, ''), E' \t\n\r\f\v'),
    ''
  );
  normalized_limit integer := least(
    greatest(coalesce(target_limit, 20), 1),
    100
  );
  normalized_offset integer := greatest(
    coalesce(target_offset, 0),
    0
  );
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if normalized_query is not null and pg_catalog.length(normalized_query) > 100 then
    raise exception 'member_search_query_too_long' using errcode = '22023';
  end if;

  return query
  select
    profile.id,
    coalesce(
      nullif(pg_catalog.btrim(profile.nickname, E' \t\n\r\f\v'), ''),
      'fan_' || pg_catalog.left(profile.id::text, 6)
    ),
    case
      when nullif(pg_catalog.btrim(coalesce(profile.email, '')), '') is null
        then '이메일 없음'::text
      when pg_catalog.strpos(profile.email, '@') > 1
        then pg_catalog.left(pg_catalog.split_part(profile.email, '@', 1), 1)
          || '***@'
          || pg_catalog.split_part(profile.email, '@', 2)
      else '***'::text
    end,
    profile.role,
    profile.created_at,
    profile.suspended_at,
    pg_catalog.count(*) over()::bigint
  from public.profiles as profile
  where normalized_query is null
    or pg_catalog.strpos(
      pg_catalog.lower(coalesce(profile.nickname, '')),
      pg_catalog.lower(normalized_query)
    ) > 0
    or pg_catalog.strpos(
      pg_catalog.lower(coalesce(profile.email, '')),
      pg_catalog.lower(normalized_query)
    ) > 0
  order by profile.created_at desc, profile.id desc
  limit normalized_limit
  offset normalized_offset;
end;
$$;

create or replace function public.admin_get_member_detail(target_profile_id uuid)
returns table (
  profile_id uuid,
  email text,
  nickname text,
  role public.user_role,
  created_at timestamptz,
  consents jsonb,
  suspended_at timestamptz,
  suspension_reason text,
  goods_order_count bigint,
  ticket_order_count bigint,
  submitted_report_count bigint,
  received_report_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
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

  if target_profile_id is null then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  return query
  select
    profile.id,
    coalesce(
      nullif(pg_catalog.btrim(profile.email, E' \t\n\r\f\v'), ''),
      '이메일 없음'
    ),
    coalesce(
      nullif(pg_catalog.btrim(profile.nickname, E' \t\n\r\f\v'), ''),
      'fan_' || pg_catalog.left(profile.id::text, 6)
    ),
    profile.role,
    profile.created_at,
    profile.consents,
    profile.suspended_at,
    profile.suspension_reason,
    (
      select pg_catalog.count(*)
      from public.orders as goods_order
      where goods_order.user_id = profile.id
    )::bigint,
    (
      select pg_catalog.count(*)
      from public.ticket_orders as ticket_order
      where ticket_order.user_id = profile.id
    )::bigint,
    (
      select pg_catalog.count(*)
      from public.reports as submitted_report
      where submitted_report.reporter_id = profile.id
    )::bigint,
    (
      select pg_catalog.count(*)
      from private.report_subjects as received_report
      where received_report.target_user_id = profile.id
    )::bigint
  from public.profiles as profile
  where profile.id = target_profile_id;

  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- Active staff can suspend users; active admins can also suspend staff. Self
-- and admin targets are never eligible. Same-state replay does not rewrite the
-- reason or append another audit row.
create or replace function public.admin_suspend_user(
  target_profile_id uuid,
  target_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.user_role;
  actor_suspended_at timestamptz;
  selected_role public.user_role;
  selected_suspended_at timestamptz;
  normalized_reason text := nullif(
    pg_catalog.btrim(target_reason, E' \t\n\r\f\v'),
    ''
  );
  changed_at timestamptz;
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  select profile.role, profile.suspended_at
    into actor_role, actor_suspended_at
  from public.profiles as profile
  where profile.id = actor_id
  for update;

  if not found
    or actor_role not in ('staff', 'admin')
    or actor_suspended_at is not null
  then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if target_profile_id = actor_id then
    raise exception 'cannot_suspend_self' using errcode = '22023';
  end if;

  if normalized_reason is null or pg_catalog.length(normalized_reason) > 200 then
    raise exception 'invalid_suspension_reason' using errcode = '22023';
  end if;

  select profile.role, profile.suspended_at
    into selected_role, selected_suspended_at
  from public.profiles as profile
  where profile.id = target_profile_id
  for update;

  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  if selected_role = 'admin'
    or (actor_role = 'staff' and selected_role <> 'user')
  then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if selected_suspended_at is not null then
    return jsonb_build_object(
      'profileId', target_profile_id,
      'changed', false,
      'suspendedAt', selected_suspended_at
    );
  end if;

  changed_at := pg_catalog.clock_timestamp();

  update public.profiles as profile
  set
    suspended_at = changed_at,
    suspension_reason = normalized_reason
  where profile.id = target_profile_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'admin.member.suspended',
    'profile:' || target_profile_id::text,
    jsonb_build_object('from', 'active', 'to', 'suspended')
  );

  return jsonb_build_object(
    'profileId', target_profile_id,
    'changed', true,
    'suspendedAt', changed_at
  );
end;
$$;

create or replace function public.admin_unsuspend_user(target_profile_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.user_role;
  actor_suspended_at timestamptz;
  selected_role public.user_role;
  selected_suspended_at timestamptz;
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  select profile.role, profile.suspended_at
    into actor_role, actor_suspended_at
  from public.profiles as profile
  where profile.id = actor_id
  for update;

  if not found
    or actor_role not in ('staff', 'admin')
    or actor_suspended_at is not null
  then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if target_profile_id = actor_id then
    raise exception 'cannot_unsuspend_self' using errcode = '22023';
  end if;

  select profile.role, profile.suspended_at
    into selected_role, selected_suspended_at
  from public.profiles as profile
  where profile.id = target_profile_id
  for update;

  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  if selected_role = 'admin'
    or (actor_role = 'staff' and selected_role <> 'user')
  then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if selected_suspended_at is null then
    return jsonb_build_object(
      'profileId', target_profile_id,
      'changed', false,
      'suspendedAt', null
    );
  end if;

  update public.profiles as profile
  set
    suspended_at = null,
    suspension_reason = null
  where profile.id = target_profile_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'admin.member.unsuspended',
    'profile:' || target_profile_id::text,
    jsonb_build_object('from', 'suspended', 'to', 'active')
  );

  return jsonb_build_object(
    'profileId', target_profile_id,
    'changed', true,
    'suspendedAt', null
  );
end;
$$;

-- Preserve the existing role-management contract while requiring an active
-- admin and rejecting any new privileged role for a suspended target.
create or replace function public.admin_set_user_role(
  target_profile_id uuid,
  target_role public.user_role
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.user_role;
  actor_suspended_at timestamptz;
  previous_role public.user_role;
  target_suspended_at timestamptz;
begin
  if actor_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select profile.role, profile.suspended_at
    into actor_role, actor_suspended_at
  from public.profiles as profile
  where profile.id = actor_id
  for update;

  if actor_role is distinct from 'admin' or actor_suspended_at is not null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if target_profile_id = actor_id then
    raise exception 'cannot_change_own_role' using errcode = '22023';
  end if;

  select profile.role, profile.suspended_at
    into previous_role, target_suspended_at
  from public.profiles as profile
  where profile.id = target_profile_id
  for update;

  if not found then
    raise exception 'profile_not_found' using errcode = '22023';
  end if;

  if target_suspended_at is not null
    and target_role in ('staff', 'admin')
    and previous_role is distinct from target_role
  then
    raise exception 'account_suspended' using errcode = '42501';
  end if;

  if previous_role is distinct from target_role then
    update public.profiles as profile
    set role = target_role
    where profile.id = target_profile_id;

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      actor_id,
      'admin_user_role_update',
      'profile:' || target_profile_id::text,
      jsonb_build_object('from', previous_role, 'to', target_role)
    );
  end if;

  return jsonb_build_object(
    'profileId', target_profile_id,
    'from', previous_role,
    'to', target_role
  );
end;
$$;

revoke all on function public.admin_search_members(text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_search_members(text, integer, integer)
  to authenticated;

revoke all on function public.admin_profile_signup_counts(timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_profile_signup_counts(timestamptz, timestamptz, timestamptz)
  to authenticated;

revoke all on function public.admin_get_member_detail(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_get_member_detail(uuid)
  to authenticated;

revoke all on function public.admin_suspend_user(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_suspend_user(uuid, text)
  to authenticated;

revoke all on function public.admin_unsuspend_user(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_unsuspend_user(uuid)
  to authenticated;

revoke all on function public.admin_set_user_role(uuid, public.user_role)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_set_user_role(uuid, public.user_role)
  to authenticated;
