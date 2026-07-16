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

create or replace function public.service_update_profile_identity(
  p_user_id uuid,
  p_nickname text,
  p_avatar_path text,
  p_replace_avatar boolean
)
returns table (previous_avatar_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_avatar_path text;
begin
  if p_user_id is null or p_nickname is null then
    raise exception using
      errcode = '22023',
      message = 'profile identity arguments are required';
  end if;

  if p_replace_avatar and p_avatar_path is null then
    raise exception using
      errcode = '22023',
      message = 'replacement avatar path is required';
  end if;

  if not p_replace_avatar and p_avatar_path is not null then
    raise exception using
      errcode = '22023',
      message = 'avatar path requires replacement mode';
  end if;

  select profile.avatar_path
  into v_previous_avatar_path
  from public.profiles as profile
  where profile.id = p_user_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'profile not found';
  end if;

  update public.profiles as profile
  set
    nickname = p_nickname,
    avatar_path = case
      when p_replace_avatar then p_avatar_path
      else profile.avatar_path
    end
  where profile.id = p_user_id;

  return query select v_previous_avatar_path;
end;
$$;

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
