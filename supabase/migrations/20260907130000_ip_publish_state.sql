-- IP 게시 상태: 초안 → 공개 → 보관 (어드민 운영 콘솔 재설계, 첫 슬라이스).
--
-- `ips` 에는 보관(`archived_at`)만 있어서 등록 중인 IP 가 저장 즉시 공개 표면에 노출됐다.
-- `published_at` 을 더해 세 상태를 만든다.
--   archived_at is not null                        → 보관(종료). 게시 상태 전환은 막힌다.
--   archived_at is null and published_at is null   → 초안(등록 중·비공개).
--   archived_at is null and published_at not null  → 공개(노출).
--
-- 공개 읽기는 보관 필터와 같은 층에서 초안을 제외한다 — 앱 로더(lib/catalog.ts)와
-- security definer 검색 RPC(다음 migration). `ips_read` RLS 는 그대로 `using (true)` 라
-- 기존 주문·바인더·팔로우·커뮤니티 이력 읽기와 staff 읽기가 바뀌지 않는다.
--
-- 백필: 지금 공개 중(미보관)인 IP 는 전부 공개 상태로 옮긴다 — 현재 노출된 IP 가 사라지면
-- 안 된다. 보관된 IP 에는 게시 이력을 남기지 않아 복원하면 초안으로 돌아온다. 복원이
-- 곧 재노출이 되지 않게 fail-closed 로 둔 것이고, 재노출은 운영자가 명시적으로 공개한다.

alter table public.ips
  add column published_at timestamptz;

update public.ips
set published_at = coalesce(created_at, now())
where archived_at is null
  and published_at is null;

create index ips_published_at_idx on public.ips (published_at);

-- ---------------------------------------------------------------------------
-- 게시 상태 전환 한 곳. upsert 의 target_publish 와 단독 토글 RPC 가 같은 잠금·감사
-- 규칙을 쓴다(private.set_catalog_archived 와 같은 배치).
--   publish_requested = true  → published_at = coalesce(published_at, now())
--   publish_requested = false → published_at = null
-- 같은 상태로의 반복 호출은 false 를 돌려주고 감사하지 않는다(멱등).
-- 보관된 IP 는 catalog_item_archived 로 거절한다 — 먼저 복원해야 한다.
-- ---------------------------------------------------------------------------
create function private.set_ip_published(
  target_id text,
  publish_requested boolean
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
  selected_published_at timestamptz;
  selected_title text;
  transition_at timestamptz;
begin
  if actor_id is null then
    raise invalid_authorization_specification using message = 'auth_required';
  end if;

  if not public.is_staff() then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  if publish_requested is null then
    raise invalid_parameter_value using message = 'invalid_publish_state';
  end if;

  select ip.archived_at, ip.published_at, ip.title
    into selected_archived_at, selected_published_at, selected_title
  from public.ips as ip
  where ip.id = target_id
  for update of ip;

  if not found then
    raise no_data_found using message = 'catalog_not_found';
  end if;

  if selected_archived_at is not null then
    raise check_violation using message = 'catalog_item_archived';
  end if;

  if publish_requested = (selected_published_at is not null) then
    return false;
  end if;

  -- 공개 전환의 최소 요건. 앱 폼이 같은 규칙(ID·이름·버티컬)을 먼저 검증하지만, 초안은
  -- 직접 DML·과거 데이터로도 만들어질 수 있으므로 공개 경계에서 다시 확인한다.
  -- 버티컬은 FK(not null)가, ID 는 PK 가 이미 보장한다.
  if publish_requested and pg_catalog.btrim(coalesce(selected_title, '')) = '' then
    raise check_violation using message = 'ip_publish_incomplete';
  end if;

  transition_at := case when publish_requested then pg_catalog.clock_timestamp() else null end;

  update public.ips
  set published_at = transition_at,
      updated_at = pg_catalog.now()
  where id = target_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    case when publish_requested then 'admin.ip.published' else 'admin.ip.unpublished' end,
    'ips:' || target_id,
    pg_catalog.jsonb_build_object('published_at', transition_at)
  );

  return true;
end;
$$;

revoke all on function private.set_ip_published(text, boolean)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 단독 토글: 폼 옆의 "공개로 전환 / 초안으로 되돌리기".
-- ---------------------------------------------------------------------------
create function public.admin_set_ip_published(
  target_id text,
  target_published boolean
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$ select private.set_ip_published($1, $2); $$;

revoke all on function public.admin_set_ip_published(text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_set_ip_published(text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_upsert_ip 에 target_publish 를 더한다(20260807090001 정의 + 마지막 블록).
--   null  → 게시 상태 유지. 신규 행은 초안으로 시작한다.
--   true  → 저장 뒤 공개. 이미 공개면 published_at 을 유지한다.
--   false → 저장 뒤 초안으로.
-- 저장과 게시 전환이 한 transaction 이라, 공개가 거절되면(보관된 IP 등) 저장도 롤백된다.
-- default 인자만 늘어나므로 기존 10·11인자 호출은 그대로 해석된다.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_upsert_ip(
  text, text, text, text, text, text, text, text, text, boolean, text
);

create function public.admin_upsert_ip(
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
    target_featured
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
    featured = excluded.featured,
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
