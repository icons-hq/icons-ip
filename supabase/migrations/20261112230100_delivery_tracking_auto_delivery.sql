-- 택배 추적 자동 배송완료 — QNA-028(서원 회신 D7 "온라인 쇼핑몰의 경우는 시스템에서 배송완료를 확인하는 것으로 알고 있습니다")
-- 2026-11-11 사용자 결정(묶음 8): "자동 배송완료" — 추적 서비스 계약 전에는 스위치를 끈 채 배포한다(게이트: 추적 서비스 계약·키).
-- 2026-10-15 문서 기록('배송추적 API 자동화 제외')을 이 결정이 바꾼다(ADR-0033).
--
-- 스위치는 DB가 강제한다(private.delivery_tracking_settings, 기본 꺼짐). 앱 env만으로는 켜지지 않는다 — 꺼져 있으면 조회 대상을
-- 고르지 않고, 이벤트를 받지 않고, 배송완료로 바꾸지 않는다. 켜는 것은 계약·키·자동 판정 오류 정정 정책 승인 뒤 후속 migration이다
-- (docs/runbooks/delivery-tracking.md).
--
-- 오케스트레이터 판단(④ 고객에게 불리하지 않게):
--  * 택배 배송 건만 자동 처리한다(퀵·방문수령 등 택배 외는 지금처럼 인계·수령 확인).
--  * 운송장이 여럿인 배송 건(대표 + 추가 운송장)은 모든 운송장의 최근 이벤트가 배달완료일 때만 배송완료로 바꾸고,
--    배송완료 시각은 가장 늦은 도착 시각이다(청약철회·자동 구매확정 기산). 발송 시각보다 이르면 발송 시각, 지금보다 늦으면 지금이다.
--  * 합포장은 운영 배송완료와 같이 묶음 전체를 함께 옮긴다(묶음의 모든 운송장이 도착해야 한다).
--  * 원본 이벤트를 저장하고(private, 근거), 자동으로 바꾼 배송 건은 따로 기록해 배송현황에서 '자동'·'수동'을 가른다.
--  * 수동 '선택 배송완료'는 지금 그대로다. 자동으로 바꿀 수 없는 건(취소·반품 진행 등)은 보류로 남기고 6시간 뒤 다시 본다.
begin;

-- 1. 스위치(한 행). 켤 때는 추적 서비스 이름(앱 DELIVERY_TRACKING_PROVIDER와 같아야 한다)과 켠 시각이 필요하다.
create table private.delivery_tracking_settings (
  singleton boolean primary key default true check (singleton),
  auto_delivery_enabled boolean not null default false,
  provider text check (provider is null or provider ~ '^[a-z][a-z0-9_]{1,31}$'),
  poll_interval_minutes integer not null default 120 check (poll_interval_minutes between 10 and 1440),
  enabled_at timestamptz,
  updated_at timestamptz not null default now(),
  check (not auto_delivery_enabled or (provider is not null and enabled_at is not null))
);
insert into private.delivery_tracking_settings(singleton) values (true);
alter table private.delivery_tracking_settings enable row level security;
revoke all on table private.delivery_tracking_settings from public, anon, authenticated, service_role;

-- 스위치 변경은 누가(migration·SQL 편집기 포함) 언제 바꿨는지 감사 기록에 남긴다. 행을 지우지 못하게 한다.
create function private.audit_delivery_tracking_settings() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise check_violation using message = 'delivery_tracking_settings_required'; end if;
  insert into public.audit_log(actor_id, action, target, diff) values (null, 'system.delivery_tracking.settings_changed', 'delivery_tracking_settings',
    jsonb_build_object('before', to_jsonb(old) - 'singleton', 'after', to_jsonb(new) - 'singleton', 'sessionUser', session_user::text));
  return new;
end $$;
revoke all on function private.audit_delivery_tracking_settings() from public, anon, authenticated, service_role;
create trigger delivery_tracking_settings_audit after update on private.delivery_tracking_settings
  for each row execute function private.audit_delivery_tracking_settings();
create trigger delivery_tracking_settings_keep before delete on private.delivery_tracking_settings
  for each row execute function private.audit_delivery_tracking_settings();

-- 2. 추적 서비스가 준 원본 이벤트(정규화한 상태 + 원본 일부). 같은 이벤트는 한 번만 남는다.
create table private.shipment_tracking_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider ~ '^[a-z][a-z0-9_]{1,31}$'),
  carrier text not null references public.shipping_carriers(code) on delete restrict,
  tracking_number text not null check (tracking_number ~ '^[A-Z0-9]{8,30}$'),
  event_key text not null check (char_length(event_key) between 1 and 200),
  status text not null check (status in ('accepted','in_transit','out_for_delivery','delivered','exception','returned','unknown')),
  occurred_at timestamptz not null,
  description text check (description is null or char_length(description) <= 200),
  location text check (location is null or char_length(location) <= 100),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 8192),
  received_at timestamptz not null default now(),
  constraint shipment_tracking_events_unique unique (provider, carrier, tracking_number, event_key)
);
create index shipment_tracking_events_number_idx on private.shipment_tracking_events(carrier, tracking_number, occurred_at desc, received_at desc);
alter table private.shipment_tracking_events enable row level security;
revoke all on table private.shipment_tracking_events from public, anon, authenticated, service_role;

-- 3. 운송장별 조회 상태(다음 조회 순서·실패 횟수).
create table private.shipment_tracking_polls (
  carrier text not null,
  tracking_number text not null,
  last_polled_at timestamptz not null,
  last_outcome text not null check (last_outcome in ('ok','not_found','error')),
  last_error_code text check (last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,64}$'),
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  primary key (carrier, tracking_number)
);
alter table private.shipment_tracking_polls enable row level security;
revoke all on table private.shipment_tracking_polls from public, anon, authenticated, service_role;

-- 4. 자동 배송완료 기록. completed는 추적으로 바꾼 배송 건(근거 이벤트 포함), held는 바꾸지 못한 이유다.
create table private.shipment_auto_deliveries (
  shipment_id uuid primary key references public.order_shipments(id) on delete cascade,
  state text not null check (state in ('completed','held')),
  delivered_at timestamptz,
  provider text,
  basis jsonb not null default '[]'::jsonb check (jsonb_typeof(basis) = 'array'),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  updated_at timestamptz not null default now(),
  check ((state = 'completed') = (delivered_at is not null))
);
alter table private.shipment_auto_deliveries enable row level security;
revoke all on table private.shipment_auto_deliveries from public, anon, authenticated, service_role;

-- 5. 공용 판정
-- 배송 건의 지금 운송장(대표 + 추가, 같은 번호는 하나).
create function private.shipment_current_trackings(p_shipment uuid) returns table(carrier text, tracking_number text)
language sql stable security definer set search_path = '' as $$
  select s.carrier, s.tracking_number from public.order_shipments s
    where s.id = p_shipment and s.carrier is not null and s.tracking_number is not null
  union
  select x.carrier, x.tracking_number from public.order_shipment_extra_trackings x where x.shipment_id = p_shipment;
$$;
revoke all on function private.shipment_current_trackings(uuid) from public, anon, authenticated, service_role;

-- 운송장의 가장 최근 이벤트(발생 시각 → 받은 시각 순).
create function private.tracking_latest_event(p_carrier text, p_tracking text) returns private.shipment_tracking_events
language sql stable security definer set search_path = '' as $$
  select e.* from private.shipment_tracking_events e where e.carrier = p_carrier and e.tracking_number = p_tracking
  order by e.occurred_at desc, e.received_at desc, e.id desc limit 1;
$$;
revoke all on function private.tracking_latest_event(text, text) from public, anon, authenticated, service_role;

-- 배송 건의 모든 운송장이 배달완료(최근 이벤트 기준)인가. 운송장이 없으면 아니다.
create function private.shipment_trackings_delivered(p_shipment uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.shipment_current_trackings(p_shipment))
    and not exists(select 1 from private.shipment_current_trackings(p_shipment) t
      where (private.tracking_latest_event(t.carrier, t.tracking_number)).status is distinct from 'delivered');
$$;
revoke all on function private.shipment_trackings_delivered(uuid) from public, anon, authenticated, service_role;

-- 6. 서비스 경로(service_role 전용 — 추적 cron만 부른다)
-- 이번 회차에 조회할 운송장. 꺼져 있으면 아무것도 고르지 않는다. 최근 30일 안에 발송한 배송 중 택배 건의 운송장 가운데
-- 아직 배달완료가 아니고 조회 간격이 지난 것을, 오래 조회하지 않은 것부터 고른다.
create function public.service_delivery_tracking_targets(p_limit integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare settings private.delivery_tracking_settings;
begin
  if p_limit is null or p_limit not between 1 and 200 then raise invalid_parameter_value using message = 'invalid_delivery_tracking_limit'; end if;
  select * into settings from private.delivery_tracking_settings where singleton;
  if not found or not settings.auto_delivery_enabled then return jsonb_build_object('enabled', false); end if;
  return jsonb_build_object('enabled', true, 'provider', settings.provider, 'targets', coalesce((
    select jsonb_agg(jsonb_build_object('carrier', due.carrier, 'trackingNumber', due.tracking_number) order by due.polled_at nulls first, due.shipped_at, due.carrier, due.tracking_number)
    from (
      select tracking.carrier, tracking.tracking_number, min(s.shipped_at) shipped_at, max(poll.last_polled_at) polled_at
      from public.order_shipments s join public.orders o on o.id = s.order_id
      cross join lateral private.shipment_current_trackings(s.id) tracking
      left join private.shipment_tracking_polls poll on poll.carrier = tracking.carrier and poll.tracking_number = tracking.tracking_number
      where s.status = 'shipping' and s.delivery_method = 'parcel' and o.status <> 'canceled' and s.shipped_at >= now() - interval '30 days'
        and (poll.last_polled_at is null or poll.last_polled_at < now() - make_interval(mins => settings.poll_interval_minutes))
        and (private.tracking_latest_event(tracking.carrier, tracking.tracking_number)).status is distinct from 'delivered'
      group by tracking.carrier, tracking.tracking_number
      order by max(poll.last_polled_at) nulls first, min(s.shipped_at), tracking.carrier, tracking.tracking_number
      limit p_limit
    ) due), '[]'::jsonb));
end $$;

-- 조회 결과를 남긴다. results: [{carrier, trackingNumber, outcome: ok|not_found|error, errorCode?, events: [...]}].
-- 이벤트: {eventKey, status, occurredAt, description?, location?, raw{}}. 지금 배송 건에 붙어 있지 않은 운송장은 무시한다.
-- 형식이 틀린 값이 하나라도 있으면 아무것도 남기지 않는다(어댑터가 정규화한 값만 받는다).
create function public.service_record_delivery_tracking(p_provider text, p_results jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare settings private.delivery_tracking_settings; result jsonb; event jsonb; carrier_value text; tracking_value text;
  outcome_value text; error_value text; occurred timestamptz; recorded integer := 0; duplicates integer := 0; ignored integer := 0;
begin
  select * into settings from private.delivery_tracking_settings where singleton;
  if not found or not settings.auto_delivery_enabled then raise check_violation using message = 'delivery_tracking_disabled'; end if;
  if p_provider is distinct from settings.provider then raise check_violation using message = 'delivery_tracking_provider_mismatch'; end if;
  if jsonb_typeof(p_results) is distinct from 'array' or jsonb_array_length(p_results) > 200 then
    raise invalid_parameter_value using message = 'invalid_delivery_tracking_results'; end if;
  for result in select value from jsonb_array_elements(p_results) loop
    if jsonb_typeof(result) is distinct from 'object' or jsonb_typeof(result->'carrier') is distinct from 'string'
      or jsonb_typeof(result->'trackingNumber') is distinct from 'string' or coalesce(result->>'outcome', '') not in ('ok','not_found','error')
      or (result ? 'events' and (jsonb_typeof(result->'events') <> 'array' or jsonb_array_length(result->'events') > 100)) then
      raise invalid_parameter_value using message = 'invalid_delivery_tracking_results'; end if;
    carrier_value := result->>'carrier';
    tracking_value := private.normalize_tracking_number(result->>'trackingNumber');
    outcome_value := result->>'outcome';
    error_value := case when outcome_value = 'error' then coalesce(nullif(result->>'errorCode', ''), 'upstream_error') end;
    if tracking_value is null or tracking_value !~ '^[A-Z0-9]{8,30}$' or (error_value is not null and error_value !~ '^[a-z0-9_]{1,64}$') then
      raise invalid_parameter_value using message = 'invalid_delivery_tracking_results'; end if;
    if not exists(select 1 from public.order_shipments s where s.carrier = carrier_value and s.tracking_number = tracking_value and s.delivery_method = 'parcel')
      and not exists(select 1 from public.order_shipment_extra_trackings x where x.carrier = carrier_value and x.tracking_number = tracking_value) then
      ignored := ignored + 1; continue;
    end if;
    for event in select value from jsonb_array_elements(coalesce(result->'events', '[]'::jsonb)) loop
      if jsonb_typeof(event) is distinct from 'object' or jsonb_typeof(event->'eventKey') is distinct from 'string'
        or coalesce(event->>'status', '') not in ('accepted','in_transit','out_for_delivery','delivered','exception','returned','unknown')
        or jsonb_typeof(event->'occurredAt') is distinct from 'string' or jsonb_typeof(event->'raw') is distinct from 'object' then
        raise invalid_parameter_value using message = 'invalid_delivery_tracking_event'; end if;
      begin occurred := (event->>'occurredAt')::timestamptz;
      exception when others then raise invalid_parameter_value using message = 'invalid_delivery_tracking_event'; end;
      -- 추적 서비스 시계가 앞서도 미래 시각을 그대로 받지 않는다(배송완료 시각은 지금을 넘지 않게 따로 자른다).
      if occurred > now() + interval '1 day' then raise invalid_parameter_value using message = 'invalid_delivery_tracking_event'; end if;
      insert into private.shipment_tracking_events(provider, carrier, tracking_number, event_key, status, occurred_at, description, location, payload)
      values (p_provider, carrier_value, tracking_value, event->>'eventKey', event->>'status', occurred,
        nullif(left(event->>'description', 200), ''), nullif(left(event->>'location', 100), ''), event->'raw')
      on conflict (provider, carrier, tracking_number, event_key) do nothing;
      if found then recorded := recorded + 1; else duplicates := duplicates + 1; end if;
    end loop;
    insert into private.shipment_tracking_polls(carrier, tracking_number, last_polled_at, last_outcome, last_error_code, consecutive_failures)
    values (carrier_value, tracking_value, now(), outcome_value, error_value, case when outcome_value = 'error' then 1 else 0 end)
    on conflict (carrier, tracking_number) do update set last_polled_at = excluded.last_polled_at, last_outcome = excluded.last_outcome,
      last_error_code = excluded.last_error_code,
      consecutive_failures = case when excluded.last_outcome = 'error' then private.shipment_tracking_polls.consecutive_failures + 1 else 0 end;
  end loop;
  return jsonb_build_object('recorded', recorded, 'duplicates', duplicates, 'ignored', ignored);
end $$;

-- 모든 운송장이 배달완료인 배송 중 택배 건을 배송완료로 바꾼다. 운영 배송완료(admin_update_shipment_status)와 같은 전이 규칙이다:
-- 발주확인 이후 주문, 배송 중 → 배송완료, 택배만, 합포장은 묶음 전체. 배송 건마다 저장점을 두어 한 건의 실패가 다른 건을 막지 않는다.
create function public.service_complete_tracked_deliveries(p_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare settings private.delivery_tracking_settings; candidate uuid; scope uuid[]; processed uuid[] := '{}'::uuid[];
  latest_at timestamptz; basis_value jsonb; member record; completed jsonb := '[]'::jsonb; held jsonb := '[]'::jsonb; delivered_value timestamptz;
begin
  if p_limit is null or p_limit not between 1 and 200 then raise invalid_parameter_value using message = 'invalid_delivery_tracking_limit'; end if;
  select * into settings from private.delivery_tracking_settings where singleton;
  if not found or not settings.auto_delivery_enabled then return jsonb_build_object('enabled', false, 'completed', '[]'::jsonb, 'held', '[]'::jsonb); end if;
  for candidate in
    select s.id from public.order_shipments s join public.orders o on o.id = s.order_id
    where s.status = 'shipping' and s.delivery_method = 'parcel' and s.tracking_number is not null
      and o.status in ('confirmed','shipping','delivered')
      and not exists(select 1 from private.shipment_auto_deliveries a where a.shipment_id = s.id and a.state = 'held' and a.updated_at > now() - interval '6 hours')
      and private.shipment_trackings_delivered(s.id)
    order by s.shipped_at, s.id limit p_limit
  loop
    if candidate = any(processed) then continue; end if;
    begin
      scope := private.lock_shipment_pack_scope(array[candidate]);
      processed := processed || scope;
      -- 잠근 뒤 다시 본다. 묶음의 다른 배송 건이 아직 도착 전이면 이번에는 넘긴다(보류 아님).
      if exists(select 1 from public.order_shipments s join public.orders o on o.id = s.order_id where s.id = any(scope)
          and (s.status <> 'shipping' or s.delivery_method <> 'parcel' or s.tracking_number is null or o.status not in ('confirmed','shipping','delivered')))
        or exists(select 1 from unnest(scope) member_id where not private.shipment_trackings_delivered(member_id)) then
        continue;
      end if;
      select max(e.occurred_at), jsonb_agg(jsonb_build_object('shipmentId', t.shipment_id, 'carrier', t.carrier, 'trackingNumber', t.tracking_number,
          'eventId', e.id, 'provider', e.provider, 'occurredAt', e.occurred_at) order by t.shipment_id, t.carrier, t.tracking_number)
        into latest_at, basis_value
      from (select member_id shipment_id, tracking.carrier, tracking.tracking_number from unnest(scope) member_id
        cross join lateral private.shipment_current_trackings(member_id) tracking) t
      cross join lateral private.tracking_latest_event(t.carrier, t.tracking_number) e;
      for member in select s.* from public.order_shipments s where s.id = any(scope) order by s.id loop
        -- 고객에게 불리하지 않게: 발송 시각보다 이르면 발송 시각, 지금보다 늦으면 지금(청약철회·자동 구매확정 기산).
        delivered_value := least(greatest(latest_at, coalesce(member.shipped_at, latest_at)), clock_timestamp());
        update public.order_shipments set status = 'delivered', delivered_at = delivered_value, updated_at = clock_timestamp() where id = member.id;
        insert into private.shipment_auto_deliveries(shipment_id, state, delivered_at, provider, basis, attempts, last_error, updated_at)
        values (member.id, 'completed', delivered_value, settings.provider, coalesce((select jsonb_agg(entry) from jsonb_array_elements(basis_value) entry
          where entry->>'shipmentId' = member.id::text), '[]'::jsonb), 1, null, now())
        on conflict (shipment_id) do update set state = 'completed', delivered_at = excluded.delivered_at, provider = excluded.provider,
          basis = excluded.basis, attempts = private.shipment_auto_deliveries.attempts + 1, last_error = null, updated_at = now();
        insert into public.audit_log(actor_id, action, target, diff) values (null, 'system.shipment.tracking_delivered', 'order:' || member.order_id,
          jsonb_build_object('shipmentId', member.id, 'originName', member.origin_name_snapshot, 'from', 'shipping', 'to', 'delivered',
            'deliveredAt', delivered_value, 'provider', settings.provider, 'carrier', member.carrier, 'trackingNumber', member.tracking_number,
            'trackings', (select jsonb_agg(entry - 'shipmentId') from jsonb_array_elements(basis_value) entry where entry->>'shipmentId' = member.id::text)));
        completed := completed || jsonb_build_array(jsonb_build_object('shipmentId', member.id, 'orderId', member.order_id, 'deliveredAt', delivered_value));
      end loop;
    exception when others then
      -- 바꾸지 못한 이유(취소·반품 진행, 묶음 변경 등)를 남기고 6시간 뒤 다시 본다. 운영자는 배송현황에서 수동으로 처리할 수 있다.
      insert into private.shipment_auto_deliveries(shipment_id, state, attempts, last_error, updated_at)
      values (candidate, 'held', 1, left(sqlerrm, 200), now())
      on conflict (shipment_id) do update set state = 'held', attempts = private.shipment_auto_deliveries.attempts + 1,
        last_error = excluded.last_error, updated_at = now()
      where private.shipment_auto_deliveries.state <> 'completed';
      held := held || jsonb_build_array(jsonb_build_object('shipmentId', candidate, 'error', left(sqlerrm, 200)));
    end;
  end loop;
  return jsonb_build_object('enabled', true, 'completed', completed, 'held', held);
end $$;

revoke all on function public.service_delivery_tracking_targets(integer) from public, anon, authenticated, service_role;
revoke all on function public.service_record_delivery_tracking(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.service_complete_tracked_deliveries(integer) from public, anon, authenticated, service_role;
grant execute on function public.service_delivery_tracking_targets(integer) to service_role;
grant execute on function public.service_record_delivery_tracking(text, jsonb) to service_role;
grant execute on function public.service_complete_tracked_deliveries(integer) to service_role;

-- 7. 배송현황 표시. 추가 운송장은 늘, 자동·수동 구분과 추적 진행은 스위치가 켜진 때만 싣는다(꺼져 있으면 화면이 그대로다).
create function public.admin_shipment_tracking_summaries(p_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare enabled boolean;
begin
  if (select auth.uid()) is null or not public.has_operator_capability('sales.dispatch', false) then
    raise insufficient_privilege using message = 'operator_capability_required'; end if;
  if p_ids is null or cardinality(p_ids) > 1000 or array_position(p_ids, null) is not null then
    raise invalid_parameter_value using message = 'invalid_shipment_selection'; end if;
  enabled := coalesce((select auto_delivery_enabled from private.delivery_tracking_settings where singleton), false);
  return jsonb_build_object('autoDelivery', enabled, 'shipments', coalesce((select jsonb_object_agg(s.id, jsonb_build_object(
    'extraTrackings', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'carrier', x.carrier, 'trackingNumber', x.tracking_number,
        'source', x.source, 'createdAt', x.created_at) order by x.created_at, x.id)
      from public.order_shipment_extra_trackings x where x.shipment_id = s.id), '[]'::jsonb),
    'deliveredBy', case when not enabled or s.status <> 'delivered' or s.delivery_method <> 'parcel' then null
      when exists(select 1 from private.shipment_auto_deliveries a where a.shipment_id = s.id and a.state = 'completed'
        and a.delivered_at = s.delivered_at) then 'tracking' else 'manual' end,
    'tracking', case when not enabled or s.status <> 'shipping' or s.delivery_method <> 'parcel' or s.tracking_number is null then null
      else (select jsonb_build_object('total', count(*), 'delivered', count(*) filter (where latest.status = 'delivered'),
          'latestStatus', (array_agg(latest.status order by latest.occurred_at desc nulls last))[1],
          'latestAt', max(latest.occurred_at),
          'held', exists(select 1 from private.shipment_auto_deliveries a where a.shipment_id = s.id and a.state = 'held'))
        from private.shipment_current_trackings(s.id) t cross join lateral private.tracking_latest_event(t.carrier, t.tracking_number) latest) end))
    from public.order_shipments s where s.id = any(p_ids)), '{}'::jsonb));
end $$;
revoke all on function public.admin_shipment_tracking_summaries(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.admin_shipment_tracking_summaries(uuid[]) to authenticated;

do $contracts$
begin
  perform private.register_operator_rpc_contract('public.admin_shipment_tracking_summaries(uuid[])'::regprocedure, 'sales.dispatch', 'read', false);
end $contracts$;

notify pgrst, 'reload schema';
commit;
