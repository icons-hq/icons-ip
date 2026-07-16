-- Moderate individual comments without exposing hidden content on public feeds.

alter table public.comments
  add column status public.post_status;

update public.comments
set status = 'visible'
where status is null;

alter table public.comments
  alter column status set default 'visible',
  alter column status set not null;

create index comments_visible_post_created_idx
  on public.comments (post_id, created_at, id)
  where status = 'visible';

revoke update on table public.comments from public, anon, authenticated, service_role;

drop policy if exists comments_read on public.comments;
create policy comments_read on public.comments for select
  using (
    comments.user_id = (select auth.uid())
    or (select public.is_staff())
    or exists (
        select 1
        from public.posts
        where posts.id = comments.post_id
          and (
            (comments.status = 'visible' and posts.status = 'visible')
            or posts.user_id = (select auth.uid())
          )
      )
  );

create or replace function public.submit_community_report(
  target_type public.report_target,
  target_id text,
  reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_uuid uuid;
  normalized_reason text := nullif(btrim(reason), '');
  target_ip_id text := null;
  target_post_id uuid;
  inserted_report_id uuid;
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if target_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'target_not_found' using errcode = '22023';
  end if;

  target_uuid := target_id::uuid;

  if target_type = 'post' then
    select posts.ip_id
      into target_ip_id
      from public.posts
      where posts.id = target_uuid
        and posts.status = 'visible';

    if not found then
      raise exception 'target_not_found' using errcode = '42501';
    end if;
  elsif target_type = 'comment' then
    select comments.post_id
      into target_post_id
      from public.comments
      where comments.id = target_uuid;

    if not found then
      raise exception 'target_not_found' using errcode = '42501';
    end if;

    select posts.ip_id
      into target_ip_id
      from public.posts
      where posts.id = target_post_id
        and posts.status = 'visible'
      for share;

    if not found then
      raise exception 'target_not_found' using errcode = '42501';
    end if;

    perform 1
    from public.comments
    where comments.id = target_uuid
      and comments.post_id = target_post_id
      and comments.status = 'visible'
    for share;

    if not found then
      raise exception 'target_not_found' using errcode = '42501';
    end if;
  elsif target_type = 'user' then
    perform 1
    from public.profiles
    where profiles.id = target_uuid;

    if not found then
      raise exception 'target_not_found' using errcode = '42501';
    end if;
  else
    raise exception 'target_not_found' using errcode = '22023';
  end if;

  insert into public.reports (target_type, target_id, reporter_id, reason)
  values (target_type, target_uuid::text, actor_id, normalized_reason)
  returning id into inserted_report_id;

  return jsonb_build_object('reportId', inserted_report_id, 'ipId', target_ip_id);
end;
$$;

create or replace function public.admin_hide_community_comment(
  target_comment_id uuid,
  target_report_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  previous_status public.post_status;
  target_ip_id text;
  target_post_id uuid;
  linked_report_target public.report_target;
  linked_report_target_id text;
  linked_report_status public.report_status;
begin
  if actor_id is null or not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select comments.post_id
    into target_post_id
    from public.comments
    where comments.id = target_comment_id;

  if not found then
    raise exception 'comment_not_found' using errcode = '22023';
  end if;

  select posts.ip_id
    into target_ip_id
    from public.posts
    where posts.id = target_post_id
    for update;

  if not found then
    raise exception 'comment_not_found' using errcode = '22023';
  end if;

  select comments.status
    into previous_status
    from public.comments
    where comments.id = target_comment_id
      and comments.post_id = target_post_id
    for update;

  if not found then
    raise exception 'comment_not_found' using errcode = '22023';
  end if;

  if target_report_id is not null then
    select reports.target_type, reports.target_id, reports.status
      into linked_report_target, linked_report_target_id, linked_report_status
      from public.reports
      where reports.id = target_report_id
      for update;

    if not found then
      raise exception 'report_not_found' using errcode = '22023';
    end if;

    if linked_report_target <> 'comment'
      or linked_report_target_id <> target_comment_id::text then
      raise exception 'report_target_mismatch' using errcode = '22023';
    end if;
  end if;

  if previous_status = 'hidden' then
    if target_report_id is not null and linked_report_status <> 'resolved' then
      raise exception 'comment_already_hidden' using errcode = '22023';
    end if;

    return jsonb_build_object('ipId', target_ip_id);
  end if;

  update public.comments
  set status = 'hidden'
  where id = target_comment_id;

  if target_report_id is not null then
    update public.reports
    set status = 'resolved'
    where id = target_report_id;
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'community_comment_hide',
    'comment:' || target_comment_id::text,
    jsonb_build_object(
      'from', previous_status,
      'to', 'hidden',
      'reportId', target_report_id
    )
  );

  return jsonb_build_object('ipId', target_ip_id);
end;
$$;

create or replace function public.community_post_reaction_counts(
  target_post_ids uuid[],
  blocked_user_ids uuid[] default '{}'::uuid[]
)
returns table (
  post_id uuid,
  likes_count bigint,
  comments_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with target_posts as (
    select posts.id
    from public.posts
    where posts.id = any(target_post_ids)
      and (
        posts.status = 'visible'
        or posts.user_id = (select auth.uid())
        or (select public.is_staff())
      )
  ),
  like_counts as (
    select likes.post_id, count(*)::bigint as likes_count
    from public.likes
    join target_posts on target_posts.id = likes.post_id
    group by likes.post_id
  ),
  comment_counts as (
    select comments.post_id, count(*)::bigint as comments_count
    from public.comments
    join target_posts on target_posts.id = comments.post_id
    where comments.status = 'visible'
      and not (comments.user_id = any(blocked_user_ids))
    group by comments.post_id
  )
  select
    target_posts.id as post_id,
    coalesce(like_counts.likes_count, 0)::bigint as likes_count,
    coalesce(comment_counts.comments_count, 0)::bigint as comments_count
  from target_posts
  left join like_counts on like_counts.post_id = target_posts.id
  left join comment_counts on comment_counts.post_id = target_posts.id;
$$;

revoke all on function public.submit_community_report(public.report_target, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_community_report(public.report_target, text, text)
  to authenticated;

revoke all on function public.admin_hide_community_comment(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_hide_community_comment(uuid, uuid)
  to authenticated;

revoke all on function public.community_post_reaction_counts(uuid[], uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.community_post_reaction_counts(uuid[], uuid[])
  to anon, authenticated;
