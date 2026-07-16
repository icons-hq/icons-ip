-- Route author-owned visible post edits through a narrow RPC so callers cannot
-- rewrite ownership, images, moderation status, or timestamps directly.

drop policy if exists posts_update on public.posts;

revoke update on table public.posts from public, anon, authenticated, service_role;

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
  edited_at timestamptz;
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if normalized_text is null then
    raise exception 'invalid_post_text' using errcode = '22023';
  end if;

  perform 1
  from public.ips
  where ips.id = normalized_ip_id
  for key share;

  if not found then
    raise exception 'invalid_post_ip' using errcode = '22023';
  end if;

  select posts.ip_id
    into previous_ip_id
    from public.posts
    where posts.id = target_post_id
      and posts.user_id = actor_id
      and posts.status = 'visible'
    for update;

  if not found then
    raise exception 'post_not_editable' using errcode = '42501';
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
grant execute on function public.edit_own_post(uuid, text, text, text) to authenticated;
