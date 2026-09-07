-- 팝업 ② — RLS · 파생 상태 · 스냅샷 (설계서 v2 §1-8)
--
-- 공개 표면은 **스냅샷 RPC 하나**다. 연결·규칙 표를 직접 열어 주면 아직 안 연 페이즈의
-- 편성이 그대로 새어 나간다 — 「무엇을 언제 열지」가 팝업의 영업 비밀인 경우가 많다.

alter table public.popups enable row level security;
alter table public.popup_phases enable row level security;
alter table public.popup_zones enable row level security;
alter table public.popup_links enable row level security;
alter table public.popup_link_phase_rules enable row level security;

drop policy if exists "everyone reads open popups" on public.popups;
create policy "everyone reads open popups" on public.popups
  for select to anon, authenticated using (
    (status <> 'draft' and archived_at is null) or public.is_staff()
  );

drop policy if exists "everyone reads phases of open popups" on public.popup_phases;
create policy "everyone reads phases of open popups" on public.popup_phases
  for select to anon, authenticated using (
    exists (
      select 1 from public.popups as popup
      where popup.id = popup_phases.popup_id
        and ((popup.status <> 'draft' and popup.archived_at is null) or public.is_staff())
    )
  );

drop policy if exists "everyone reads zones of open popups" on public.popup_zones;
create policy "everyone reads zones of open popups" on public.popup_zones
  for select to anon, authenticated using (
    exists (
      select 1 from public.popups as popup
      where popup.id = popup_zones.popup_id
        and ((popup.status <> 'draft' and popup.archived_at is null) or public.is_staff())
    )
  );

-- 연결·규칙은 공개 select 를 주지 않는다. 스냅샷 RPC 가 hidden 을 걷어낸 뒤에만 나간다.
drop policy if exists "staff reads popup links" on public.popup_links;
create policy "staff reads popup links" on public.popup_links
  for select to authenticated using (public.is_staff());
drop policy if exists "staff reads popup link rules" on public.popup_link_phase_rules;
create policy "staff reads popup link rules" on public.popup_link_phase_rules
  for select to authenticated using (public.is_staff());

revoke all on table public.popups, public.popup_phases, public.popup_zones,
  public.popup_links, public.popup_link_phase_rules
  from public, anon, authenticated, service_role;
grant select on public.popups, public.popup_phases, public.popup_zones to anon, authenticated;
grant select on public.popup_links, public.popup_link_phase_rules to authenticated;

-- ---------------------------------------------------------------------------
-- 파생 — 저장하지 않는다
-- ---------------------------------------------------------------------------
create or replace function public.popup_display_state(p public.popups, p_as_of timestamptz default now())
returns text
language sql
stable
set search_path = ''
as $$
  -- 운영자의 의사가 시각보다 세다. 기간이 남았는데 조기 종료한 팝업을 「진행중」으로 그리면
  -- 참여 버튼이 살아 있는 것처럼 보인다(캠페인 `campaignDisplayState` 와 같은 우선순위).
  select case
    when p.archived_at is not null then 'archived'
    when p.status = 'draft' then 'draft'
    when p.status = 'paused' then 'paused'
    when p.status = 'ended' or p_as_of >= p.ends_at then 'ended'
    when p_as_of < p.starts_at then 'upcoming'
    else 'live'
  end;
$$;

create or replace function public.popup_current_phase(p_popup_id text, p_as_of timestamptz default now())
returns public.popup_phases
language sql
stable
set search_path = ''
as $$
  select phase.*
  from public.popup_phases as phase
  where phase.popup_id = p_popup_id and phase.during @> p_as_of
  limit 1;
$$;

create or replace function public.popup_effective_mode(p_link_id uuid, p_as_of timestamptz default now())
returns public.popup_sale_mode
language plpgsql
stable
set search_path = ''
as $$
declare
  v_link public.popup_links;
  v_popup public.popups;
  v_phase public.popup_phases;
begin
  select * into v_link from public.popup_links as link where link.id = p_link_id;
  if not found then
    return null;
  end if;
  select * into v_popup from public.popups as popup where popup.id = v_link.popup_id;
  select * into v_phase from public.popup_current_phase(v_link.popup_id, p_as_of) as phase;

  -- 팝업 기간 밖에서는 페이즈 규칙을 보지 않는다. 시작 전은 감추고, 끝난 뒤는 닫는다.
  if p_as_of < v_popup.starts_at then
    return 'hidden'::public.popup_sale_mode;
  end if;
  if p_as_of >= v_popup.ends_at then
    return 'closed'::public.popup_sale_mode;
  end if;

  -- 규칙 › 연결 기본 › 페이즈 기본. 좁은 것이 넓은 것을 이긴다.
  return coalesce(
    (select rule.sale_mode from public.popup_link_phase_rules as rule
     where rule.link_id = p_link_id and rule.phase_id = v_phase.id),
    v_link.default_sale_mode,
    v_phase.default_sale_mode,
    'closed'::public.popup_sale_mode
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 스냅샷 — 소비자 화면과 운영자 미리보기가 **같은 함수**를 쓴다
--
-- 미리보기를 따로 만들면 「미리보기에서는 됐는데 실제로는 안 열린」 팝업이 생긴다.
-- 다른 것은 시계뿐이라, 시계만 인자로 받는다(그 인자는 staff 만 줄 수 있다).
-- ---------------------------------------------------------------------------
create or replace function public.popup_snapshot(p_popup_id text, p_as_of timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_popup public.popups;
  v_now timestamptz := now();
  v_as_of timestamptz;
  v_state text;
  v_phase public.popup_phases;
begin
  if p_as_of is not null and not public.is_staff() then
    -- 임의 시각 미리보기는 편성을 미리 보는 것이다. 운영자만 준다.
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_as_of := coalesce(p_as_of, v_now);

  select * into v_popup from public.popups as popup where popup.id = p_popup_id;
  if not found then
    raise exception 'popup_unavailable' using errcode = 'P0002';
  end if;

  v_state := public.popup_display_state(v_popup, v_as_of);
  if v_state in ('draft', 'archived') and not public.is_staff() then
    raise exception 'popup_unavailable' using errcode = 'P0002';
  end if;

  select * into v_phase from public.popup_current_phase(p_popup_id, v_as_of) as phase;

  return jsonb_build_object(
    'popup', jsonb_build_object(
      'id', v_popup.id,
      'ipId', v_popup.ip_id,
      'title', v_popup.title,
      'subtitle', v_popup.subtitle,
      'status', v_popup.status,
      'startsAt', v_popup.starts_at,
      'endsAt', v_popup.ends_at,
      'heroImagePath', v_popup.hero_image_path,
      'cardImagePath', v_popup.card_image_path
    ),
    'displayState', v_state,
    -- 판정 시계를 응답에 동봉한다. 화면이 자기 시계로 다시 판정하면 서버와 갈라진다.
    'serverNow', v_now,
    'asOf', v_as_of,
    'currentPhase', case when v_phase.id is null then null else v_phase.key end,
    'phases', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', phase.key,
        'label', phase.label,
        'startsAt', lower(phase.during),
        'endsAt', upper(phase.during),
        'on', phase.during @> v_as_of,
        'done', upper(phase.during) <= v_as_of
      ) order by phase.sort, lower(phase.during))
      from public.popup_phases as phase where phase.popup_id = p_popup_id
    ), '[]'::jsonb),
    'zones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', zone.code, 'kind', zone.kind, 'name', zone.name,
        'door', zone.door, 'config', zone.config
      ) order by zone.sort, zone.code)
      from public.popup_zones as zone where zone.popup_id = p_popup_id
    ), '[]'::jsonb),
    'links', coalesce((
      select jsonb_agg(jsonb_build_object(
        'targetType', link.target_type,
        'targetId', link.target_id,
        'zoneCode', zone.code,
        'mode', mode.value
      ) order by link.sort, link.target_type, link.target_id)
      from public.popup_links as link
      left join public.popup_zones as zone on zone.id = link.zone_id
      cross join lateral (select public.popup_effective_mode(link.id, v_as_of) as value) as mode
      -- 감춘 연결은 아예 내보내지 않는다. 「있는데 안 보이는」 것과 「없는」 것은 다르다.
      where link.popup_id = p_popup_id and mode.value <> 'hidden'
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.popup_snapshot(text, timestamptz) from public;
grant execute on function public.popup_snapshot(text, timestamptz) to anon, authenticated;
revoke all on function public.popup_display_state(public.popups, timestamptz) from public;
grant execute on function public.popup_display_state(public.popups, timestamptz) to anon, authenticated;
revoke all on function public.popup_current_phase(text, timestamptz) from public;
grant execute on function public.popup_current_phase(text, timestamptz) to anon, authenticated;
revoke all on function public.popup_effective_mode(uuid, timestamptz) from public;
grant execute on function public.popup_effective_mode(uuid, timestamptz) to anon, authenticated;
