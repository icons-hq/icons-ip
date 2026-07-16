do $$
begin
  if exists (
    select lower(btrim(nickname))
    from public.profiles
    where nickname is not null
    group by lower(btrim(nickname))
    having count(*) > 1
  ) then
    raise exception using message = 'profiles contain normalized nickname conflicts';
  end if;

  if exists (
    select 1
    from public.profiles
    where nickname is not null
      and (
        nickname <> btrim(nickname)
        or nickname = ''
        or char_length(nickname) > 512
      )
  ) then
    raise exception using message = 'profiles contain invalid nickname values';
  end if;

  if exists (
    select 1
    from public.profiles
    where avatar_path is not null
      and avatar_path !~ (
        '^'
        || id::text
        || '/profile/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
      )
  ) then
    raise exception using message = 'profiles contain invalid avatar paths';
  end if;
end;
$$;

alter table public.profiles
  add constraint profiles_nickname_identity_check
  check (
    nickname is null
    or (
      nickname = btrim(nickname)
      and nickname <> ''
      and char_length(nickname) <= 512
    )
  );

alter table public.profiles
  add constraint profiles_avatar_path_check
  check (
    avatar_path is null
    or avatar_path ~ (
      '^'
      || id::text
      || '/profile/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
    )
  );

create unique index profiles_nickname_normalized_unique_idx
  on public.profiles (lower(btrim(nickname)))
  where nickname is not null;

revoke update (nickname, avatar_path) on table public.profiles from authenticated;

create table public.profile_avatar_claims (
  path text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('pending', 'active', 'rejected', 'retired')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint profile_avatar_claims_owned_path_check
    check (
      path ~ (
        '^'
        || user_id::text
        || '/profile/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
      )
    ),
  constraint profile_avatar_claims_resolution_check
    check (
      (status = 'pending' and resolved_at is null)
      or (status <> 'pending' and resolved_at is not null)
    )
);

alter table public.profile_avatar_claims enable row level security;
revoke all on table public.profile_avatar_claims
  from public, anon, authenticated, service_role;
grant select on table public.profile_avatar_claims to service_role;

-- 배포 전에 이미 사용 중인 아바타도 replay 방어에 참여한다.
insert into public.profile_avatar_claims (
  path,
  user_id,
  status,
  resolved_at
)
select
  profile.avatar_path,
  profile.id,
  'active',
  now()
from public.profiles as profile
where profile.avatar_path is not null;

create or replace function public.service_prepare_profile_avatar_claim(
  p_user_id uuid,
  p_avatar_path text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_inserted boolean;
begin
  if p_user_id is null
    or p_avatar_path is null
    or p_avatar_path !~ (
      '^'
      || p_user_id::text
      || '/profile/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
    )
    or not exists (
      select 1
      from public.profiles as profile
      where profile.id = p_user_id
    )
  then
    return false;
  end if;

  insert into public.profile_avatar_claims (
    path,
    user_id,
    status
  )
  values (
    p_avatar_path,
    p_user_id,
    'pending'
  )
  on conflict (path) do nothing
  returning true into v_inserted;

  return coalesce(v_inserted, false);
end;
$$;

create or replace function public.service_reject_profile_avatar_claim(
  p_user_id uuid,
  p_avatar_path text
)
returns table (
  rejected boolean,
  cleanup_safe boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select claim.status
  into v_status
  from public.profile_avatar_claims as claim
  where claim.path = p_avatar_path
    and claim.user_id = p_user_id
  for update;

  if not found or v_status <> 'pending' then
    return query select false, false;
    return;
  end if;

  update public.profile_avatar_claims as claim
  set
    status = 'rejected',
    resolved_at = now()
  where claim.path = p_avatar_path
    and claim.user_id = p_user_id
    and claim.status = 'pending';

  if not found then
    return query select false, false;
    return;
  end if;

  return query select true, true;
end;
$$;

create or replace function public.service_log_profile_avatar_cleanup_failure(
  p_user_id uuid,
  p_avatar_path text,
  p_stage text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_user_id is null
    or p_avatar_path is null
    or p_stage is null
    or p_stage not in ('candidate', 'previous')
    or p_avatar_path !~ (
      '^'
      || p_user_id::text
      || '/profile/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
    )
    or not exists (
      select 1
      from public.profiles as profile
      where profile.id = p_user_id
    )
  then
    return false;
  end if;

  insert into public.audit_log (
    actor_id,
    action,
    target,
    diff
  )
  values (
    p_user_id,
    'profile_avatar_cleanup_failed',
    p_avatar_path,
    jsonb_build_object('stage', p_stage)
  );

  return true;
end;
$$;

create or replace function public.service_update_profile_identity(
  p_user_id uuid,
  p_nickname text,
  p_avatar_path text,
  p_replace_avatar boolean
)
returns table (
  applied boolean,
  error_code text,
  cleanup_safe boolean,
  previous_avatar_path text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_previous_avatar_path text;
  v_claim_status text;
  v_error_code text;
  v_rejected_count bigint := 0;
begin
  if p_user_id is null or p_nickname is null or p_replace_avatar is null then
    return query select false, '22023'::text, false, null::text;
    return;
  end if;

  if p_replace_avatar and p_avatar_path is null then
    return query select false, '22023'::text, false, null::text;
    return;
  end if;

  if not p_replace_avatar and p_avatar_path is not null then
    return query select false, '22023'::text, false, null::text;
    return;
  end if;

  select profile.avatar_path
  into v_previous_avatar_path
  from public.profiles as profile
  where profile.id = p_user_id
  for update;

  if not found then
    return query select false, 'P0002'::text, false, null::text;
    return;
  end if;

  if p_replace_avatar then
    select claim.status
    into v_claim_status
    from public.profile_avatar_claims as claim
    where claim.path = p_avatar_path
      and claim.user_id = p_user_id
    for update;

    if not found then
      return query select false, 'avatar_unclaimed'::text, false, null::text;
      return;
    end if;

    if v_claim_status <> 'pending' then
      return query select false, 'avatar_replayed'::text, false, null::text;
      return;
    end if;
  end if;

  begin
    update public.profiles as profile
    set
      nickname = p_nickname,
      avatar_path = case
        when p_replace_avatar then p_avatar_path
        else profile.avatar_path
      end
    where profile.id = p_user_id;

    if p_replace_avatar and v_previous_avatar_path is not null then
      update public.profile_avatar_claims as claim
      set
        status = 'retired',
        resolved_at = now()
      where claim.path = v_previous_avatar_path
        and claim.user_id = p_user_id
        and claim.status = 'active';

      if not found then
        raise exception using
          errcode = '23514',
          message = 'active previous avatar claim is missing';
      end if;
    end if;

    if p_replace_avatar then
      update public.profile_avatar_claims as claim
      set
        status = 'active',
        resolved_at = now()
      where claim.path = p_avatar_path
        and claim.user_id = p_user_id
        and claim.status = 'pending';

      if not found then
        raise exception using
          errcode = '23514',
          message = 'pending avatar claim changed during finalization';
      end if;
    end if;
  exception
    when others then
      get stacked diagnostics v_error_code = returned_sqlstate;

      if p_replace_avatar then
        update public.profile_avatar_claims as claim
        set
          status = 'rejected',
          resolved_at = now()
        where claim.path = p_avatar_path
          and claim.user_id = p_user_id
          and claim.status = 'pending';

        get diagnostics v_rejected_count = row_count;
      end if;

      return query select false, v_error_code, v_rejected_count = 1, null::text;
      return;
  end;

  return query select true, null::text, false, v_previous_avatar_path;
end;
$$;

revoke all on function public.service_prepare_profile_avatar_claim(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.service_prepare_profile_avatar_claim(uuid, text)
  to service_role;

revoke all on function public.service_reject_profile_avatar_claim(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.service_reject_profile_avatar_claim(uuid, text)
  to service_role;

revoke all on function public.service_log_profile_avatar_cleanup_failure(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.service_log_profile_avatar_cleanup_failure(uuid, text, text)
  to service_role;

revoke all on function public.service_update_profile_identity(uuid, text, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.service_update_profile_identity(uuid, text, text, boolean)
  to service_role;

do $$
begin
  update storage.buckets
  set
    file_size_limit = 5 * 1024 * 1024,
    allowed_mime_types = array[
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif'
    ]::text[]
  where id = 'user-uploads';

  if not found then
    raise exception using message = 'user-uploads bucket is missing';
  end if;
end;
$$;

drop policy if exists user_uploads_write on storage.objects;
create policy user_uploads_write on storage.objects for insert
  with check (
    bucket_id = 'user-uploads'
    and (select auth.uid()) is not null
    and name ~ (
      '^'
      || (select auth.uid())::text
      || '/('
      || 'profile/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)'
      || '|community/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp|gif)'
      || ')$'
    )
  );

drop policy if exists user_uploads_delete on storage.objects;
create policy user_uploads_delete on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'user-uploads'
    and (select auth.uid()) is not null
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name !~ (
      '^'
      || (select auth.uid())::text
      || '/profile/'
    )
  );
