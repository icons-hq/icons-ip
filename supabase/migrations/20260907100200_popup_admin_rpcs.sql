-- 팝업 ③ — 어드민 RPC (설계서 v2 §1-8)

create or replace function private.popup_target_exists(p_type text, p_id text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  -- 보관·삭제된 원본은 없는 것으로 본다. 걸어 두면 팝업만 살아 있고 누르면 빈 화면이 나온다.
  return case p_type
    when 'good' then exists (select 1 from public.goods as g where g.id = p_id and g.archived_at is null)
    when 'campaign' then exists (select 1 from public.campaigns as c where c.id = p_id)
    when 'event' then exists (select 1 from public.events as e where e.id = p_id)
    when 'ticket_type' then exists (select 1 from public.ticket_types as t where t.id::text = p_id)
    when 'card_pool' then exists (select 1 from public.card_pools as p where p.id::text = p_id)
    when 'curation' then exists (select 1 from public.home_curations as c where c.id::text = p_id)
    when 'game' then exists (select 1 from public.games as g where g.id::text = p_id)
    else false
  end;
end;
$$;

create or replace function public.admin_upsert_popup(
  target_id text,
  target_ip_id text,
  target_title text,
  target_subtitle text default null,
  target_status text default 'draft',
  target_starts_at timestamptz default null,
  target_ends_at timestamptz default null,
  target_hero_image_path text default null,
  target_card_image_path text default null,
  target_previous_id text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_previous text := nullif(btrim(coalesce(target_previous_id, '')), '');
  v_existing public.popups;
begin
  if target_id !~ '^[a-z0-9][a-z0-9-]{1,63}$' then
    raise exception 'invalid_popup_id' using errcode = '22023';
  end if;
  if target_status not in ('draft', 'published', 'paused', 'ended') then
    raise exception 'invalid_popup_status' using errcode = '22023';
  end if;
  if target_starts_at is null or target_ends_at is null or target_ends_at <= target_starts_at then
    raise exception 'invalid_popup_period' using errcode = '22023';
  end if;
  if not exists (select 1 from public.ips as ip where ip.id = target_ip_id) then
    raise exception 'popup_ip_missing' using errcode = '23503';
  end if;
  -- 슬러그는 주소 한 칸을 두고 캠페인·이벤트와 다툰다. 한쪽만 보면 나중에 라우트가 겹친다.
  if v_previous is distinct from target_id and (
    exists (select 1 from public.campaigns as c where c.id = target_id)
    or exists (select 1 from public.events as e where e.id = target_id)
  ) then
    raise exception 'catalog_id_taken' using errcode = '23505';
  end if;
  if v_previous is not null and v_previous <> target_id then
    -- 주소가 이미 나갔을 수 있다. 슬러그는 바꾸지 않는다.
    raise exception 'catalog_id_immutable' using errcode = '22023';
  end if;

  if v_previous is not null then
    select * into v_existing from public.popups as popup where popup.id = v_previous;
    if not found then
      raise exception 'catalog_record_missing' using errcode = 'P0002';
    end if;
  end if;

  -- 페이즈가 하나도 없는 팝업을 게시하면 화면이 「지금 무엇을 하는 시간인지」 말할 수 없다.
  if target_status = 'published' and not exists (
    select 1 from public.popup_phases as phase where phase.popup_id = target_id
  ) then
    raise exception 'published_without_phases' using errcode = '22023';
  end if;

  insert into public.popups as popup (
    id, ip_id, title, subtitle, status, starts_at, ends_at, hero_image_path, card_image_path
  )
  values (
    target_id, target_ip_id, btrim(target_title), nullif(btrim(coalesce(target_subtitle, '')), ''),
    target_status, target_starts_at, target_ends_at,
    nullif(btrim(coalesce(target_hero_image_path, '')), ''),
    nullif(btrim(coalesce(target_card_image_path, '')), '')
  )
  on conflict (id) do update set
    ip_id = excluded.ip_id, title = excluded.title, subtitle = excluded.subtitle,
    status = excluded.status, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
    hero_image_path = excluded.hero_image_path, card_image_path = excluded.card_image_path,
    updated_at = now()
  where popup.id = target_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (v_actor, 'admin.popup.upsert', 'popup:' || target_id,
          jsonb_build_object('status', target_status, 'startsAt', target_starts_at, 'endsAt', target_ends_at));
  return target_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 페이즈 일괄 저장 — key 기준 upsert, 빠진 key 는 삭제. 한 트랜잭션이다.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_popup_phases(
  target_popup_id text,
  target_phases jsonb,
  target_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_popup public.popups;
  v_row record;
  v_keys text[] := '{}';
  v_ids jsonb := '[]'::jsonb;
  v_id uuid;
begin
  select * into v_popup from public.popups as popup where popup.id = target_popup_id for update;
  if not found then
    raise exception 'catalog_record_missing' using errcode = 'P0002';
  end if;
  -- 두 사람이 같은 편성을 동시에 고치면 나중 저장이 앞 저장을 조용히 지운다.
  if target_expected_updated_at is not null and v_popup.updated_at <> target_expected_updated_at then
    raise exception 'stale_write' using errcode = '40001';
  end if;
  if target_phases is null or jsonb_typeof(target_phases) <> 'array' then
    raise exception 'invalid_phases' using errcode = '22023';
  end if;

  for v_row in
    select entry.value as phase, entry.ordinality as position
    from jsonb_array_elements(target_phases) with ordinality as entry(value, ordinality)
  loop
    if coalesce(v_row.phase ->> 'key', '') !~ '^[a-z][a-z0-9_]{0,31}$'
      or nullif(btrim(coalesce(v_row.phase ->> 'label', '')), '') is null
      or nullif(v_row.phase ->> 'starts_at', '') is null
      or nullif(v_row.phase ->> 'ends_at', '') is null
    then
      raise exception 'invalid_phases' using errcode = '22023',
        detail = format('phases[%s]', v_row.position - 1);
    end if;

    insert into public.popup_phases as phase (
      popup_id, key, label, during, sort, default_sale_mode
    )
    values (
      target_popup_id,
      v_row.phase ->> 'key',
      btrim(v_row.phase ->> 'label'),
      tstzrange((v_row.phase ->> 'starts_at')::timestamptz, (v_row.phase ->> 'ends_at')::timestamptz, '[)'),
      coalesce((v_row.phase ->> 'sort')::integer, v_row.position::integer),
      coalesce((v_row.phase ->> 'default_sale_mode')::public.popup_sale_mode, 'on_sale')
    )
    on conflict (popup_id, key) do update set
      label = excluded.label, during = excluded.during,
      sort = excluded.sort, default_sale_mode = excluded.default_sale_mode
    returning phase.id into v_id;

    v_keys := v_keys || (v_row.phase ->> 'key');
    v_ids := v_ids || to_jsonb(v_id);
  end loop;

  -- 빠진 key 는 편성에서 뺀 것이다. 규칙은 cascade 로 따라 지워진다.
  delete from public.popup_phases where popup_id = target_popup_id and not (key = any(v_keys));

  update public.popups set updated_at = now() where id = target_popup_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (v_actor, 'admin.popup.phases', 'popup:' || target_popup_id,
          jsonb_build_object('keys', v_keys));
  return v_ids;
end;
$$;

-- ---------------------------------------------------------------------------
-- 연결 일괄 — 원본 존재를 검사한다(다형이라 FK 가 못 한다)
-- ---------------------------------------------------------------------------
create or replace function public.admin_link_popup_targets(
  target_popup_id text,
  target_links jsonb,
  target_replace boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_row record;
  v_rule jsonb;
  v_zone uuid;
  v_phase uuid;
  v_link uuid;
  v_ids jsonb := '[]'::jsonb;
  v_seen uuid[] := '{}';
begin
  if not exists (select 1 from public.popups as popup where popup.id = target_popup_id) then
    raise exception 'catalog_record_missing' using errcode = 'P0002';
  end if;
  if target_links is null or jsonb_typeof(target_links) <> 'array' then
    raise exception 'invalid_links' using errcode = '22023';
  end if;
  if jsonb_array_length(target_links) > 200 then
    raise exception 'too_many_links' using errcode = '22023';
  end if;

  for v_row in
    select entry.value as link, entry.ordinality as position
    from jsonb_array_elements(target_links) with ordinality as entry(value, ordinality)
  loop
    if not private.popup_target_exists(v_row.link ->> 'target_type', v_row.link ->> 'target_id') then
      raise exception 'unknown_target' using errcode = '23503',
        detail = format('%s:%s', v_row.link ->> 'target_type', v_row.link ->> 'target_id');
    end if;

    v_zone := null;
    if nullif(v_row.link ->> 'zone_code', '') is not null then
      select zone.id into v_zone from public.popup_zones as zone
      where zone.popup_id = target_popup_id and zone.code = v_row.link ->> 'zone_code';
      if v_zone is null then
        raise exception 'unknown_zone' using errcode = '22023', detail = v_row.link ->> 'zone_code';
      end if;
    end if;

    insert into public.popup_links as link (
      popup_id, zone_id, target_type, target_id, sort, default_sale_mode
    )
    values (
      target_popup_id, v_zone, v_row.link ->> 'target_type', v_row.link ->> 'target_id',
      coalesce((v_row.link ->> 'sort')::integer, v_row.position::integer),
      (nullif(v_row.link ->> 'default_sale_mode', ''))::public.popup_sale_mode
    )
    on conflict (popup_id, target_type, target_id) do update set
      zone_id = excluded.zone_id, sort = excluded.sort, default_sale_mode = excluded.default_sale_mode
    returning link.id into v_link;

    -- 규칙은 이 연결의 것을 통째로 갈아 끼운다. 남겨 두면 지운 페이즈의 규칙이 유령으로 남는다.
    delete from public.popup_link_phase_rules where link_id = v_link;
    for v_rule in select value from jsonb_array_elements(coalesce(v_row.link -> 'phase_rules', '[]'::jsonb))
    loop
      select phase.id into v_phase from public.popup_phases as phase
      where phase.popup_id = target_popup_id and phase.key = v_rule ->> 'phase_key';
      if v_phase is null then
        raise exception 'unknown_phase_key' using errcode = '22023', detail = v_rule ->> 'phase_key';
      end if;
      insert into public.popup_link_phase_rules (link_id, phase_id, sale_mode)
      values (v_link, v_phase, (v_rule ->> 'sale_mode')::public.popup_sale_mode);
    end loop;

    v_seen := v_seen || v_link;
    v_ids := v_ids || to_jsonb(v_link);
  end loop;

  if coalesce(target_replace, false) then
    delete from public.popup_links where popup_id = target_popup_id and not (id = any(v_seen));
  end if;

  update public.popups set updated_at = now() where id = target_popup_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (v_actor, 'admin.popup.links', 'popup:' || target_popup_id,
          jsonb_build_object('count', jsonb_array_length(v_ids), 'replace', coalesce(target_replace, false)));
  return v_ids;
end;
$$;

create or replace function public.admin_popup_detail(target_popup_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_popup public.popups;
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;
  select * into v_popup from public.popups as popup where popup.id = target_popup_id;
  if not found then
    raise exception 'catalog_record_missing' using errcode = 'P0002';
  end if;

  -- 편성 화면이 보는 전체다 — 감춘 연결도 포함한다(감춘 것을 편성하는 화면이라서).
  return jsonb_build_object(
    'popup', to_jsonb(v_popup),
    'displayState', public.popup_display_state(v_popup, now()),
    'updatedAt', v_popup.updated_at,
    'phases', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', phase.id, 'key', phase.key, 'label', phase.label,
        'startsAt', lower(phase.during), 'endsAt', upper(phase.during),
        'sort', phase.sort, 'defaultSaleMode', phase.default_sale_mode
      ) order by phase.sort, lower(phase.during))
      from public.popup_phases as phase where phase.popup_id = target_popup_id
    ), '[]'::jsonb),
    'zones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', zone.id, 'code', zone.code, 'kind', zone.kind, 'name', zone.name,
        'door', zone.door, 'sort', zone.sort
      ) order by zone.sort, zone.code)
      from public.popup_zones as zone where zone.popup_id = target_popup_id
    ), '[]'::jsonb),
    'links', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', link.id, 'targetType', link.target_type, 'targetId', link.target_id,
        'zoneCode', zone.code, 'sort', link.sort, 'defaultSaleMode', link.default_sale_mode,
        'currentMode', public.popup_effective_mode(link.id, now()),
        'phaseRules', coalesce((
          select jsonb_agg(jsonb_build_object('phaseKey', phase.key, 'saleMode', rule.sale_mode)
                 order by phase.sort)
          from public.popup_link_phase_rules as rule
          join public.popup_phases as phase on phase.id = rule.phase_id
          where rule.link_id = link.id
        ), '[]'::jsonb)
      ) order by link.sort, link.target_type, link.target_id)
      from public.popup_links as link
      left join public.popup_zones as zone on zone.id = link.zone_id
      where link.popup_id = target_popup_id
    ), '[]'::jsonb)
  );
end;
$$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.admin_upsert_popup(text, text, text, text, text, timestamptz, timestamptz, text, text, text)',
    'public.admin_set_popup_phases(text, jsonb, timestamptz)',
    'public.admin_link_popup_targets(text, jsonb, boolean)',
    'public.admin_popup_detail(text)'
  ] loop
    execute format('revoke all on function %s from public, anon, service_role', v_signature);
    execute format('grant execute on function %s to authenticated', v_signature);
  end loop;
end;
$$;

revoke all on function private.popup_target_exists(text, text) from public, anon, authenticated, service_role;
