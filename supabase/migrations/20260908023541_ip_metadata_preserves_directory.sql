-- #412: null featured means metadata-only save; directory controls retain the current DB value.
create or replace function public.admin_upsert_ip(
  target_id text,
  target_title text,
  target_sub text,
  target_vertical_key text,
  target_tagline text,
  target_synopsis text,
  target_glyph text,
  target_bg text,
  target_image_path text,
  target_featured boolean,
  target_previous_id text default null,
  target_publish boolean default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_previous_id text := nullif(btrim(coalesce(target_previous_id, ''), E' \t\n\r\f\v'), '');
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if normalized_previous_id is not null then
    if normalized_previous_id is distinct from target_id then
      raise exception 'catalog_id_immutable' using errcode = '22023';
    end if;

    perform 1 from public.ips where id = target_id for update;

    if not found then
      raise exception 'catalog_record_missing' using errcode = 'P0002';
    end if;
  end if;

  -- 신규 등록(normalized_previous_id is null)에서는 do update 가 걸러진다.
  -- 충돌한 행이 갱신되지 않으므로 found 가 false 가 되고 아래에서 막는다.
  insert into public.ips (
    id,
    title,
    sub,
    vertical_key,
    tagline,
    synopsis,
    glyph,
    bg,
    image_path,
    featured
  )
  values (
    target_id,
    target_title,
    target_sub,
    target_vertical_key,
    target_tagline,
    target_synopsis,
    target_glyph,
    target_bg,
    target_image_path,
    coalesce(target_featured, false)
  )
  on conflict (id) do update set
    title = excluded.title,
    sub = excluded.sub,
    vertical_key = excluded.vertical_key,
    tagline = excluded.tagline,
    synopsis = excluded.synopsis,
    glyph = excluded.glyph,
    bg = excluded.bg,
    image_path = excluded.image_path,
    featured = coalesce(target_featured, ips.featured),
    updated_at = now()
  where normalized_previous_id is not null;

  if not found then
    raise exception 'catalog_id_taken' using errcode = '23505';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'catalog.ip.upsert',
    'ips:' || target_id,
    jsonb_build_object(
      'id', target_id,
      'title', target_title,
      'vertical_key', target_vertical_key,
      'mode', case when normalized_previous_id is null then 'create' else 'update' end
    )
  );

  -- 게시 상태는 저장과 같은 transaction 에서 한 번만 전환하고 별도로 감사한다.
  if target_publish is not null then
    perform private.set_ip_published(target_id, target_publish);
  end if;
end;
$$;

revoke all on function public.admin_upsert_ip(
  text, text, text, text, text, text, text, text, text, boolean, text, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.admin_upsert_ip(
  text, text, text, text, text, text, text, text, text, boolean, text, boolean
) to authenticated;
