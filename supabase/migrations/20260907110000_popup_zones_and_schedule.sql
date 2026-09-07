-- 팝업 ⑥ — 존 편집 · 편성 달력 (설계서 v2 §1-8)
--
-- 존은 지금 SQL 로만 들어간다. 편성 화면이 존을 읽기만 하니, 새 팝업을 여는 사람은
-- 개발자를 불러야 한다 — 편성은 운영의 일이지 배포의 일이 아니다.

create or replace function public.admin_set_popup_zones(
  target_popup_id text,
  target_zones jsonb,
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
  v_codes text[] := '{}';
  v_ids jsonb := '[]'::jsonb;
  v_id uuid;
begin
  select * into v_popup from public.popups as popup where popup.id = target_popup_id for update;
  if not found then
    raise exception 'catalog_record_missing' using errcode = 'P0002';
  end if;
  if target_expected_updated_at is not null and v_popup.updated_at <> target_expected_updated_at then
    raise exception 'stale_write' using errcode = '40001';
  end if;
  if target_zones is null or jsonb_typeof(target_zones) <> 'array' then
    raise exception 'invalid_zones' using errcode = '22023';
  end if;

  for v_row in
    select entry.value as zone, entry.ordinality as position
    from jsonb_array_elements(target_zones) with ordinality as entry(value, ordinality)
  loop
    if coalesce(v_row.zone ->> 'code', '') !~ '^[A-Z][A-Z0-9]{0,7}$'
      or nullif(btrim(coalesce(v_row.zone ->> 'name', '')), '') is null
      or coalesce(v_row.zone ->> 'kind', '') not in ('info', 'record', 'experience', 'commerce', 'event', 'community')
    then
      raise exception 'invalid_zones' using errcode = '22023',
        detail = format('zones[%s]', v_row.position - 1);
    end if;

    insert into public.popup_zones as zone (popup_id, code, kind, name, door, sort)
    values (
      target_popup_id, v_row.zone ->> 'code', v_row.zone ->> 'kind',
      btrim(v_row.zone ->> 'name'), nullif(btrim(coalesce(v_row.zone ->> 'door', '')), ''),
      coalesce((v_row.zone ->> 'sort')::integer, v_row.position::integer)
    )
    on conflict (popup_id, code) do update set
      kind = excluded.kind, name = excluded.name, door = excluded.door, sort = excluded.sort
    returning zone.id into v_id;

    v_codes := v_codes || (v_row.zone ->> 'code');
    v_ids := v_ids || to_jsonb(v_id);
  end loop;

  -- 빠진 코드는 편성에서 뺀 것이다. 그 존에 걸려 있던 연결은 **지우지 않고 존만 떼어낸다**
  -- (`zone_id on delete set null`) — 존을 정리하다 연결까지 사라지면 편성을 처음부터 다시 한다.
  delete from public.popup_zones where popup_id = target_popup_id and not (code = any(v_codes));

  update public.popups set updated_at = now() where id = target_popup_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (v_actor, 'admin.popup.zones', 'popup:' || target_popup_id,
          jsonb_build_object('codes', v_codes));
  return v_ids;
end;
$$;

-- ---------------------------------------------------------------------------
-- 편성 달력 — 여러 팝업의 페이즈를 한 시간축에
--
-- 팝업 하나만 보면 「이 주에 뭐가 겹치나」를 알 수 없다. 겹치는 것 자체는 막을 일이 아니지만
-- (동시에 두 팝업을 여는 것은 정상이다), 모르고 겹치는 것은 사고다.
-- ---------------------------------------------------------------------------
create or replace function public.admin_popup_schedule(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_from timestamptz := coalesce(p_from, date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul');
  v_to timestamptz;
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;
  v_to := coalesce(p_to, v_from + interval '14 days');
  if v_to <= v_from then
    raise check_violation using message = 'invalid schedule range';
  end if;

  return jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'serverNow', now(),
    'popups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', popup.id,
        'title', popup.title,
        'ipId', popup.ip_id,
        'status', popup.status,
        'displayState', public.popup_display_state(popup, now()),
        'startsAt', popup.starts_at,
        'endsAt', popup.ends_at,
        'currentPhase', (select phase.key from public.popup_current_phase(popup.id, now()) as phase),
        'phases', coalesce((
          select jsonb_agg(jsonb_build_object(
            'key', phase.key, 'label', phase.label,
            'startsAt', lower(phase.during), 'endsAt', upper(phase.during),
            'defaultSaleMode', phase.default_sale_mode,
            'on', phase.during @> now()
          ) order by lower(phase.during))
          from public.popup_phases as phase where phase.popup_id = popup.id
        ), '[]'::jsonb)
      ) order by popup.starts_at, popup.id)
      from public.popups as popup
      -- 창에 걸치기만 해도 보여준다. 「이 주에 시작하는」 것만 보면 이미 돌고 있는 팝업이 안 보인다.
      where popup.archived_at is null
        and popup.starts_at < v_to and popup.ends_at > v_from
    ), '[]'::jsonb)
  );
end;
$$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.admin_set_popup_zones(text, jsonb, timestamptz)',
    'public.admin_popup_schedule(timestamptz, timestamptz)'
  ] loop
    execute format('revoke all on function %s from public, anon, service_role', v_signature);
    execute format('grant execute on function %s to authenticated', v_signature);
  end loop;
end;
$$;
