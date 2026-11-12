-- 반품 자동 회수 접수(QNA-032) — 스위치·출고지별 회수 계약 택배사·회수 접수 큐·서비스 경로·운영 재시도·고객 표시.
-- 2026-11-11 사용자 결정(묶음 8): "반품 자동 회수 접수" — 계약 전에는 스위치를 끈 채 배포한다
-- (게이트: 우체국·한진 반품 회수 계약·API 키·회수 운임, 개인정보 처리위탁 계약·처리방침 고지). ADR-0034.
--
-- 오케스트레이터 판단(④ 돈·재고·개인정보는 안전한 쪽):
--  * 자동 회수 접수는 승인 트랜잭션 밖의 지연 큐(크론)다. 승인(prepare_claim_collections)은 바꾸지 않는다 — 접수 실패가 승인을
--    되돌리지 않는다. 크론이 회수 묶음(배송 건 × 반품지, T14a)마다 큐 행을 만들고, 그 출고지의 회수 계약 택배사에 접수한다.
--  * 스위치는 DB가 강제한다(private.return_pickup_settings, 기본 꺼짐). 켤 때는 서비스 이름·근거·시각이 필요하고 바뀔 때마다
--    감사 기록에 남는다. 꺼져 있으면 큐를 만들지 않고, 외부를 부르지 않고, 고객·운영 화면에 아무 키도 더하지 않는다.
--  * 출고지마다 회수 계약을 따로 켠다(private.return_pickup_origins). 계약하지 않은 출고지는 지금처럼 고객이 보낸다.
--  * 켜기 전에 승인된 회수 묶음은 접수하지 않는다(고객이 이미 착불로 보냈을 수 있다). 회수 생략(collection_waived, ADR-0041)
--    배송 건, 고객이 이미 보냈다고 기록된 배송 건, 운영자가 회수 정보를 따로 기록한 배송 건도 접수하지 않는다.
--  * 접수 실패는 상한까지 간격을 늘려 다시 시도하고, '자동 수거 실패'로 세어 운영자가 다시 접수할 수 있다.
--  * 요청이 철회·거절·종결되거나 회수 생략·고객 직접 발송으로 회수가 필요 없어지면 접수한 수거를 취소한다(접수 전이면 그냥 닫는다).
--  * 택배사로 보내는 개인정보는 회수지 최소 필드(받는 분 이름·연락처·우편번호·주소)뿐이고, 응답·감사 기록에는 싣지 않는다.
--    고객이 회수 주소를 바꿨으면(클레임 연락처 정정 — 암호문) 그 주소를 쓴다(앱 서버가 키로 연다).
begin;

-- 1. 스위치(한 행). 자동 회수 접수와 반품입고 파일 반영(QNA-034)은 게이트가 달라 따로 켠다.
--    반품입고 파일의 열 이름 대응표도 여기 둔다(서원 양식이 오면 값만 바꾼다 — 화면 코드는 그대로).
create function private.return_intake_columns_valid(p_columns jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_columns) = 'object'
    and (select array_agg(key order by key) from jsonb_object_keys(p_columns) key) = array['orderNumber','phone','receivedOn','trackingNumber']
    and not exists(select 1 from jsonb_each(p_columns) entry
      where jsonb_typeof(entry.value) <> 'array' or jsonb_array_length(entry.value) not between 1 and 10
        or exists(select 1 from jsonb_array_elements(entry.value) alias
          where jsonb_typeof(alias) <> 'string' or char_length(btrim(alias #>> '{}')) not between 1 and 40 or (alias #>> '{}') ~ '[[:cntrl:]]'))
    -- 한 머리글이 두 칸에 대응하지 않게 한다(공백 무시·대소문자 무시로 비교).
    and (select count(*) = count(distinct lower(regexp_replace(alias #>> '{}', '[[:space:]]', '', 'g')))
      from jsonb_each(p_columns) entry cross join lateral jsonb_array_elements(entry.value) alias);
$$;
revoke all on function private.return_intake_columns_valid(jsonb) from public, anon, authenticated, service_role;

create table private.return_pickup_settings (
  singleton boolean primary key default true check (singleton),
  pickup_enabled boolean not null default false,
  provider text check (provider is null or provider ~ '^[a-z][a-z0-9_]{1,31}$'),
  pickup_evidence text check (pickup_evidence is null or (pickup_evidence = btrim(pickup_evidence) and char_length(pickup_evidence) between 2 and 1000 and pickup_evidence !~ '[[:cntrl:]]')),
  pickup_enabled_at timestamptz,
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  retry_minutes integer not null default 30 check (retry_minutes between 5 and 1440),
  intake_enabled boolean not null default false,
  intake_evidence text check (intake_evidence is null or (intake_evidence = btrim(intake_evidence) and char_length(intake_evidence) between 2 and 1000 and intake_evidence !~ '[[:cntrl:]]')),
  intake_enabled_at timestamptz,
  intake_columns jsonb not null default jsonb_build_object(
    'trackingNumber', jsonb_build_array('회수송장번호', '반품송장번호', '회수운송장번호', '송장번호', '운송장번호'),
    'orderNumber', jsonb_build_array('주문번호', '쇼핑몰주문번호'),
    'phone', jsonb_build_array('연락처', '전화번호', '휴대폰', '휴대폰번호', '고객연락처'),
    'receivedOn', jsonb_build_array('입고일', '입고일자', '반품입고일', '입고날짜'))
    check (private.return_intake_columns_valid(intake_columns)),
  revision integer not null default 1 check (revision >= 1),
  updated_at timestamptz not null default clock_timestamp(),
  constraint return_pickup_settings_pickup_shape check (not pickup_enabled or (provider is not null and pickup_evidence is not null and pickup_enabled_at is not null)),
  constraint return_pickup_settings_intake_shape check (not intake_enabled or (intake_evidence is not null and intake_enabled_at is not null))
);
insert into private.return_pickup_settings(singleton) values (true);
alter table private.return_pickup_settings enable row level security;
revoke all on table private.return_pickup_settings from public, anon, authenticated, service_role;

-- 2. 출고지별 회수 계약. 행이 있고 enabled인 출고지만 자동 회수 접수 대상이다(택배사 = 그 출고지의 회수 계약 택배사).
create table private.return_pickup_origins (
  origin_id uuid primary key references public.fulfillment_origins(id) on delete restrict,
  carrier text not null references public.shipping_carriers(code) on delete restrict,
  enabled boolean not null default true,
  evidence text not null check (evidence = btrim(evidence) and char_length(evidence) between 2 and 1000 and evidence !~ '[[:cntrl:]]'),
  enabled_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
alter table private.return_pickup_origins enable row level security;
revoke all on table private.return_pickup_origins from public, anon, authenticated, service_role;

-- 스위치·출고지 계약 변경은 누가(migration·SQL 편집기 포함) 언제 바꿨는지 감사 기록에 남기고 리비전을 올린다. 행은 지우지 못한다.
create function private.audit_return_pickup_settings() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise check_violation using message = 'return_pickup_settings_required'; end if;
  if tg_when = 'BEFORE' then
    if tg_table_name = 'return_pickup_settings' then
      new.revision := old.revision + 1;
      -- 꺼졌다 다시 켜면 켠 시각을 새로 적는다 — 꺼져 있던 동안 승인돼 고객이 이미 착불로 보냈을 수 있는 묶음을 접수하지 않는다.
      if new.pickup_enabled and not old.pickup_enabled then new.pickup_enabled_at := clock_timestamp(); end if;
    elsif new.enabled and not old.enabled then new.enabled_at := clock_timestamp();
    end if;
    new.updated_at := clock_timestamp();
    return new;
  end if;
  insert into public.audit_log(actor_id, action, target, diff)
  values (null, 'system.return_pickup.settings_changed', tg_table_name,
    jsonb_build_object('operation', lower(tg_op), 'before', case when tg_op = 'INSERT' then null else to_jsonb(old) - 'singleton' end,
      'after', to_jsonb(new) - 'singleton', 'sessionUser', session_user::text));
  return new;
end $$;
revoke all on function private.audit_return_pickup_settings() from public, anon, authenticated, service_role;
create trigger return_pickup_settings_touch before update on private.return_pickup_settings
  for each row execute function private.audit_return_pickup_settings();
create trigger return_pickup_settings_audit after update on private.return_pickup_settings
  for each row execute function private.audit_return_pickup_settings();
create trigger return_pickup_settings_keep before delete on private.return_pickup_settings
  for each row execute function private.audit_return_pickup_settings();
create trigger return_pickup_origins_touch before update on private.return_pickup_origins
  for each row execute function private.audit_return_pickup_settings();
create trigger return_pickup_origins_audit after insert or update on private.return_pickup_origins
  for each row execute function private.audit_return_pickup_settings();
create trigger return_pickup_origins_keep before delete on private.return_pickup_origins
  for each row execute function private.audit_return_pickup_settings();

-- 3. 회수 접수 큐(회수 묶음 하나에 한 행). 상태:
--    pending(접수 대기) → requested(접수됨, 회수 송장) → collected(그 묶음 입고 확인)
--    pending → failed(접수 실패 — 상한까지 자동 재시도, 운영자 재시도) → pending …
--    필요 없어지면: 한 번도 보내지 않았으면 canceled, 접수됐거나 접수됐을 수 있으면 cancel_pending → canceled | cancel_failed.
--    idempotency_key는 택배사에 함께 보내는 값이다 — 재시도·응답 유실 뒤 다시 보내도 수거가 두 번 잡히지 않게 한다(어댑터 계약).
create table private.claim_return_pickups (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null unique references public.order_claim_collection_bundles(id) on delete cascade,
  claim_id uuid not null references public.order_cancellation_requests(id) on delete restrict,
  shipment_id uuid not null,
  order_id uuid not null,
  origin_id uuid not null,
  provider text not null check (provider ~ '^[a-z][a-z0-9_]{1,31}$'),
  carrier text not null references public.shipping_carriers(code) on delete restrict,
  idempotency_key text not null unique check (idempotency_key ~ '^[a-z0-9-]{8,64}$'),
  state text not null default 'pending' check (state in ('pending','failed','requested','collected','cancel_pending','cancel_failed','canceled')),
  attempts integer not null default 0 check (attempts >= 0),
  cancel_attempts integer not null default 0 check (cancel_attempts >= 0),
  -- 운영자가 다시 접수하면 자동 재시도 횟수를 그 시점부터 다시 센다(attempts는 누적 — 한 번이라도 보냈는지 판정에 쓴다).
  retry_base integer not null default 0 check (retry_base between 0 and attempts),
  cancel_retry_base integer not null default 0 check (cancel_retry_base between 0 and cancel_attempts),
  next_attempt_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  tracking_number text check (tracking_number is null or tracking_number ~ '^[A-Z0-9]{8,30}$'),
  external_id text check (external_id is null or external_id ~ '^[\x21-\x7e]{1,100}$'),
  requested_at timestamptz,
  last_error_code text check (last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,64}$'),
  cancel_reason text check (cancel_reason is null or cancel_reason in ('withdrawn','rejected','completed','not_required','waived','customer_sent','manual','collected')),
  canceled_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint claim_return_pickups_lease check ((lease_token is null) = (lease_until is null)),
  constraint claim_return_pickups_requested check (state not in ('requested','collected') or (tracking_number is not null and requested_at is not null)),
  constraint claim_return_pickups_canceled check ((state = 'canceled') = (canceled_at is not null)),
  constraint claim_return_pickups_cancel_reason check (state not in ('cancel_pending','cancel_failed','canceled') or cancel_reason is not null)
);
create index claim_return_pickups_active on private.claim_return_pickups(state, next_attempt_at)
  where state in ('pending','failed','requested','cancel_pending','cancel_failed');
create index claim_return_pickups_claim on private.claim_return_pickups(claim_id);
create index claim_return_pickups_tracking on private.claim_return_pickups(tracking_number) where tracking_number is not null;
alter table private.claim_return_pickups enable row level security;
revoke all on table private.claim_return_pickups from public, anon, authenticated, service_role;

-- 접수·취소 시도 기록(개인정보 없음 — 결과·오류 코드만).
create table private.claim_return_pickup_attempts (
  id bigint generated always as identity primary key,
  pickup_id uuid not null references private.claim_return_pickups(id) on delete cascade,
  kind text not null check (kind in ('request','cancel','retry','local_cancel')),
  outcome text not null check (outcome in ('requested','error','canceled','not_found','scheduled')),
  error_code text check (error_code is null or error_code ~ '^[a-z0-9_]{1,64}$'),
  actor_id uuid,
  created_at timestamptz not null default clock_timestamp()
);
create index claim_return_pickup_attempts_pickup on private.claim_return_pickup_attempts(pickup_id, created_at desc);
alter table private.claim_return_pickup_attempts enable row level security;
revoke all on table private.claim_return_pickup_attempts from public, anon, authenticated, service_role;

-- 4. 판정
-- 이미 있는 회수 접수가 더는 필요 없는 이유(필요하면 null). 묶음 입고는 'collected'다(접수된 수거는 정상 종료).
create function private.claim_return_pickup_block(p_bundle public.order_claim_collection_bundles) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when p_bundle.collected_at is not null then 'collected'
    when c.stage = 'withdrawn' then 'withdrawn'
    when c.stage = 'rejected' then 'rejected'
    when c.stage = 'completed' then 'completed'
    when c.claim_type not in ('return','exchange') or c.collection_policy is distinct from 'origin' or not c.collection_required then 'not_required'
    when private.claim_collection_waived(c.id, p_bundle.shipment_id) then 'waived'
    when exists(select 1 from private.claim_collection_plans plan where plan.claim_id = c.id and plan.shipment_id = p_bundle.shipment_id and plan.customer_sent_once)
      or exists(select 1 from private.seller_order_claim_intakes intake cross join lateral jsonb_array_elements(intake.payload->'collections') item
        where intake.claim_id = c.id and item->>'shipmentId' = p_bundle.shipment_id::text and item->>'method' = 'customer_sent') then 'customer_sent'
    else null end
  from public.order_cancellation_requests c where c.id = p_bundle.claim_id;
$$;
revoke all on function private.claim_return_pickup_block(public.order_claim_collection_bundles) from public, anon, authenticated, service_role;

-- 새로 접수할 회수 묶음인가. 스위치·출고지 계약이 켜진 뒤 승인된 묶음이고, 수거중 단계이고, 운영자·판매자가 회수 방법을 따로
-- 기록하지 않았고(수거 정정 계획·판매자 접수의 회수 방법), 회수 주소가 있어야 한다.
create function private.claim_return_pickup_eligible(p_bundle public.order_claim_collection_bundles) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select settings.pickup_enabled and origin.enabled and c.stage = 'collecting'
      and p_bundle.created_at >= greatest(settings.pickup_enabled_at, origin.enabled_at)
      and private.claim_return_pickup_block(p_bundle) is null
      and coalesce(nullif(btrim(p_bundle.return_address_snapshot), ''), nullif(btrim(fo.return_address), '')) is not null
      and not exists(select 1 from private.claim_collection_plans plan where plan.claim_id = c.id and plan.shipment_id = p_bundle.shipment_id and plan.requested_once)
      and not exists(select 1 from private.seller_order_claim_intakes intake cross join lateral jsonb_array_elements(intake.payload->'collections') item
        where intake.claim_id = c.id and item->>'shipmentId' = p_bundle.shipment_id::text and coalesce(item->>'method', 'not_requested') <> 'not_requested')
    from private.return_pickup_settings settings
    join public.order_cancellation_requests c on c.id = p_bundle.claim_id
    join public.order_claim_collections x on x.claim_id = p_bundle.claim_id and x.shipment_id = p_bundle.shipment_id
    join private.return_pickup_origins origin on origin.origin_id = x.origin_id
    join public.fulfillment_origins fo on fo.id = x.origin_id
    where settings.singleton), false);
$$;
revoke all on function private.claim_return_pickup_eligible(public.order_claim_collection_bundles) from public, anon, authenticated, service_role;

-- 회수 묶음의 회수 접수 표시. 운영자는 상태·시도·오류 코드까지, 고객은 접수된(회수 송장이 있는) 것만 본다.
-- 행이 없으면 빈 객체 — 부르는 쪽이 키를 더하지 않는다(스위치를 켠 적 없으면 지금 문서와 같다).
create function private.claim_return_pickup_json(p_bundle uuid, p_operator boolean) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case
      when p_operator then jsonb_build_object('pickup', jsonb_build_object(
        'pickupId', p.id, 'state', p.state, 'provider', p.provider, 'carrier', p.carrier, 'carrierLabel', carrier.label,
        'trackingNumber', p.tracking_number, 'requestedAt', p.requested_at, 'attempts', p.attempts, 'cancelAttempts', p.cancel_attempts,
        'autoAttempts', case when p.state in ('cancel_pending','cancel_failed') then p.cancel_attempts - p.cancel_retry_base else p.attempts - p.retry_base end,
        'maxAttempts', settings.max_attempts, 'lastErrorCode', p.last_error_code, 'nextAttemptAt', p.next_attempt_at,
        'inProgress', p.lease_until is not null and p.lease_until > clock_timestamp(),
        'cancelReason', p.cancel_reason, 'canceledAt', p.canceled_at))
      when p.state in ('requested','collected') then jsonb_build_object('pickup', jsonb_build_object(
        'carrier', p.carrier, 'carrierLabel', carrier.label, 'trackingNumber', p.tracking_number, 'requestedAt', p.requested_at))
      else '{}'::jsonb end
    from private.claim_return_pickups p
    left join public.shipping_carriers carrier on carrier.code = p.carrier
    cross join private.return_pickup_settings settings
    where p.bundle_id = p_bundle and settings.singleton), '{}'::jsonb);
$$;
revoke all on function private.claim_return_pickup_json(uuid, boolean) from public, anon, authenticated, service_role;

-- 회수지(고객 쪽) 주소. 클레임 연락처 정정과 같은 순서로 고른다: 회수 주소 정정(암호문, 앱이 연다) → 판매자 접수 회수 주소 → 주문 배송지.
-- 보존 기한이 지났거나 읽을 수 없으면 null(접수하지 않고 실패로 남긴다).
create function private.claim_return_pickup_sender(p_order uuid, p_claim uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare view jsonb;
begin
  view := private.contact_target(p_order, p_claim, 'collection', true, private.contact_retention(p_claim, clock_timestamp()));
  if view->>'piiState' is distinct from 'available' then return null; end if;
  if view#>>'{source,sourceKind}' = 'contact_plan' then
    return jsonb_build_object('source', 'sealed', 'orderId', p_order, 'claimId', p_claim, 'plan', view->'plan');
  end if;
  return jsonb_build_object('source', 'plain', 'address', view->'sourceAddress');
end $$;
revoke all on function private.claim_return_pickup_sender(uuid, uuid) from public, anon, authenticated, service_role;

-- 크론에 넘길 접수 한 건. 개인정보는 회수지 최소 필드뿐이다(받는 분 이름·연락처·우편번호·주소).
create function private.claim_return_pickup_request_item(p_pickup uuid, p_token uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('kind', 'request', 'pickupId', p.id, 'leaseToken', p_token, 'provider', p.provider,
    'idempotencyKey', p.idempotency_key, 'carrier', p.carrier, 'outboundTrackingNumber', s.tracking_number,
    'sender', private.claim_return_pickup_sender(p.order_id, p.claim_id),
    'receiver', jsonb_build_object('name', coalesce(nullif(b.return_name_snapshot, ''), x.origin_name_snapshot),
      'phone', b.return_phone_snapshot, 'address', coalesce(nullif(btrim(b.return_address_snapshot), ''), fo.return_address)),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('name', j.value->>'name', 'qty', (j.value->>'qty')::integer) order by j.ordinality), '[]'::jsonb)
      from jsonb_array_elements(b.items_snapshot) with ordinality j))
  from private.claim_return_pickups p
  join public.order_claim_collection_bundles b on b.id = p.bundle_id
  join public.order_claim_collections x on x.claim_id = b.claim_id and x.shipment_id = b.shipment_id
  join public.fulfillment_origins fo on fo.id = x.origin_id
  join public.order_shipments s on s.id = p.shipment_id
  where p.id = p_pickup;
$$;
revoke all on function private.claim_return_pickup_request_item(uuid, uuid) from public, anon, authenticated, service_role;

-- 다음 시도 시각(상한을 넘으면 null — 자동 재시도 끝, 운영자 재시도만).
create function private.claim_return_pickup_next_attempt(p_attempts integer, p_settings private.return_pickup_settings) returns timestamptz
language sql set search_path = '' as $$
  select case when p_attempts >= p_settings.max_attempts then null
    else clock_timestamp() + least(interval '24 hours', make_interval(mins => p_settings.retry_minutes * (2 ^ greatest(p_attempts - 1, 0))::integer)) end;
$$;
revoke all on function private.claim_return_pickup_next_attempt(integer, private.return_pickup_settings) from public, anon, authenticated, service_role;

-- 5. 서비스 경로(service_role 전용 — 회수 접수 크론만 부른다)
-- 이번 회차의 할 일. 꺼져 있으면 아무것도 만들지 않는다. 순서: 새 묶음을 큐에 넣는다 → 필요 없어진 접수를 닫거나 취소로 돌린다
-- → 기한이 된 접수·취소를 임대(lease 10분)해 돌려준다. 다른 회차·운영자 재시도와는 행 잠금(skip locked)으로 겹치지 않는다.
create function public.service_return_pickup_work(p_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare settings private.return_pickup_settings; now_at timestamptz := clock_timestamp(); pickup private.claim_return_pickups;
  bundle public.order_claim_collection_bundles; reason text; token uuid; items jsonb := '[]'::jsonb; queued integer := 0; closed integer := 0;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise invalid_parameter_value using message = 'invalid_return_pickup_limit'; end if;
  select * into settings from private.return_pickup_settings where singleton;
  if not found or not settings.pickup_enabled then return jsonb_build_object('enabled', false); end if;

  insert into private.claim_return_pickups(bundle_id, claim_id, shipment_id, order_id, origin_id, provider, carrier, idempotency_key, next_attempt_at)
  select b.id, b.claim_id, b.shipment_id, c.order_id, x.origin_id, settings.provider, origin.carrier,
    'icons-return-' || replace(b.id::text, '-', ''), now_at
  from public.order_claim_collection_bundles b
  join public.order_cancellation_requests c on c.id = b.claim_id
  join public.order_claim_collections x on x.claim_id = b.claim_id and x.shipment_id = b.shipment_id
  join private.return_pickup_origins origin on origin.origin_id = x.origin_id and origin.enabled
  where c.stage = 'collecting' and b.collected_at is null and b.created_at >= greatest(settings.pickup_enabled_at, origin.enabled_at)
    and not exists(select 1 from private.claim_return_pickups p where p.bundle_id = b.id)
    and private.claim_return_pickup_eligible(b)
  order by b.created_at, b.id
  limit 500
  on conflict (bundle_id) do nothing;
  get diagnostics queued = row_count;

  for pickup in select p.* from private.claim_return_pickups p
    where p.state in ('pending','failed','requested') and (p.lease_until is null or p.lease_until < now_at)
    order by p.id for update skip locked loop
    select * into bundle from public.order_claim_collection_bundles where id = pickup.bundle_id;
    reason := private.claim_return_pickup_block(bundle);
    -- 아직 한 번도 보내지 않은 접수는, 그 사이 운영자·판매자가 회수 방법을 따로 기록했으면 보내지 않고 닫는다(이중 수거 방지).
    if reason is null and pickup.attempts = 0 and pickup.state = 'pending'
      and (exists(select 1 from private.claim_collection_plans plan where plan.claim_id = pickup.claim_id and plan.shipment_id = pickup.shipment_id and plan.requested_once)
        or exists(select 1 from private.seller_order_claim_intakes intake cross join lateral jsonb_array_elements(intake.payload->'collections') item
          where intake.claim_id = pickup.claim_id and item->>'shipmentId' = pickup.shipment_id::text and coalesce(item->>'method', 'not_requested') <> 'not_requested')) then
      reason := 'manual';
    end if;
    continue when reason is null;
    if reason = 'collected' and pickup.state = 'requested' then
      update private.claim_return_pickups set state = 'collected', next_attempt_at = null, lease_token = null, lease_until = null, updated_at = now_at
      where id = pickup.id;
    elsif pickup.state <> 'requested' and pickup.attempts = 0 then
      update private.claim_return_pickups set state = 'canceled', cancel_reason = reason, canceled_at = now_at, next_attempt_at = null,
        lease_token = null, lease_until = null, updated_at = now_at where id = pickup.id;
      insert into private.claim_return_pickup_attempts(pickup_id, kind, outcome) values (pickup.id, 'local_cancel', 'canceled');
    else
      update private.claim_return_pickups set state = 'cancel_pending', cancel_reason = reason, next_attempt_at = now_at, cancel_retry_base = cancel_attempts,
        lease_token = null, lease_until = null, updated_at = now_at where id = pickup.id;
    end if;
    closed := closed + 1;
  end loop;

  for pickup in select p.* from private.claim_return_pickups p
    where p.state in ('pending','failed','cancel_pending','cancel_failed') and p.next_attempt_at is not null and p.next_attempt_at <= now_at
      and (p.lease_until is null or p.lease_until < now_at)
      -- 접수는 수거중 단계에서만 보낸다(보류·처리중 등은 단계가 돌아올 때까지 기다린다). 취소는 단계와 관계없이 보낸다.
      and (p.state in ('cancel_pending','cancel_failed')
        or exists(select 1 from public.order_cancellation_requests c where c.id = p.claim_id and c.stage = 'collecting'))
    order by p.next_attempt_at, p.id limit p_limit for update skip locked loop
    token := gen_random_uuid();
    if pickup.state in ('pending','failed') then
      update private.claim_return_pickups set lease_token = token, lease_until = now_at + interval '10 minutes', attempts = attempts + 1, updated_at = now_at
      where id = pickup.id;
      items := items || jsonb_build_array(private.claim_return_pickup_request_item(pickup.id, token));
    else
      update private.claim_return_pickups set lease_token = token, lease_until = now_at + interval '10 minutes', cancel_attempts = cancel_attempts + 1, updated_at = now_at
      where id = pickup.id;
      items := items || jsonb_build_array(jsonb_build_object('kind', 'cancel', 'pickupId', pickup.id, 'leaseToken', token, 'provider', pickup.provider,
        'idempotencyKey', pickup.idempotency_key, 'carrier', pickup.carrier, 'trackingNumber', pickup.tracking_number, 'externalId', pickup.external_id));
    end if;
  end loop;
  return jsonb_build_object('enabled', true, 'provider', settings.provider, 'queued', queued, 'closed', closed, 'items', items);
end $$;
revoke all on function public.service_return_pickup_work(integer) from public, anon, authenticated, service_role;
grant execute on function public.service_return_pickup_work(integer) to service_role;

-- 접수·취소 결과를 남긴다. results: [{pickupId, leaseToken, kind: request|cancel, outcome, trackingNumber?, externalId?, errorCode?}].
-- 임대가 바뀐(다른 회차가 다시 잡은) 결과는 stale로 센다. 접수되면 회수 송장을 저장하고 클레임 회수 이력(claim_collection_events)·
-- 감사 기록에 남기고 고객에게 알린다. 감사·이력에는 개인정보(회수지 이름·연락처·주소)를 싣지 않는다.
create function public.service_record_return_pickup_results(p_results jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare settings private.return_pickup_settings; result jsonb; pickup private.claim_return_pickups; tracking text; external text; code text;
  bundle public.order_claim_collection_bundles; label text; recorded integer := 0; requested integer := 0; failed integer := 0; canceled integer := 0;
  cancel_failed integer := 0; stale integer := 0; invalid integer := 0; deferred integer := 0; late text; system_actor constant uuid := '00000000-0000-0000-0000-000000000000';
begin
  if jsonb_typeof(p_results) is distinct from 'array' or jsonb_array_length(p_results) > 100 then
    raise invalid_parameter_value using message = 'invalid_return_pickup_results'; end if;
  select * into settings from private.return_pickup_settings where singleton;
  for result in select value from jsonb_array_elements(p_results) loop
    if jsonb_typeof(result) is distinct from 'object' or coalesce(result->>'pickupId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(result->>'leaseToken', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(result->>'kind', '') not in ('request','cancel') then invalid := invalid + 1; continue; end if;
    select * into pickup from private.claim_return_pickups where id = (result->>'pickupId')::uuid for update;
    if not found or pickup.lease_token is distinct from (result->>'leaseToken')::uuid
      or (result->>'kind' = 'request') <> (pickup.state in ('pending','failed')) then stale := stale + 1; continue; end if;
    -- 회차 시간 예산이 끝나 보내지 못한 일: 한 번도 보내지 않았으니 임대를 풀고 이번 회차가 센 시도를 되돌린다(다음 회차가 다시 잡는다).
    if result->>'outcome' = 'deferred' then
      update private.claim_return_pickups set lease_token = null, lease_until = null, updated_at = clock_timestamp(),
        attempts = case when result->>'kind' = 'request' then greatest(attempts - 1, retry_base) else attempts end,
        cancel_attempts = case when result->>'kind' = 'cancel' then greatest(cancel_attempts - 1, cancel_retry_base) else cancel_attempts end
      where id = pickup.id;
      deferred := deferred + 1;
      continue;
    end if;
    code := nullif(result->>'errorCode', '');
    if code is not null and code !~ '^[a-z0-9_]{1,64}$' then code := 'upstream_error'; end if;
    if result->>'kind' = 'request' then
      tracking := upper(regexp_replace(coalesce(result->>'trackingNumber', ''), '[^A-Za-z0-9]', '', 'g'));
      external := nullif(result->>'externalId', '');
      if result->>'outcome' = 'requested' and tracking ~ '^[A-Z0-9]{8,30}$' and (external is null or external ~ '^[\x21-\x7e]{1,100}$') then
        update private.claim_return_pickups set state = 'requested', tracking_number = tracking, external_id = external, requested_at = clock_timestamp(),
          last_error_code = null, next_attempt_at = null, lease_token = null, lease_until = null, updated_at = clock_timestamp()
        where id = pickup.id;
        insert into private.claim_return_pickup_attempts(pickup_id, kind, outcome) values (pickup.id, 'request', 'requested');
        select * into bundle from public.order_claim_collection_bundles where id = pickup.bundle_id;
        -- 요청이 나가는 사이 철회·거절됐거나 회수가 필요 없어졌으면 접수됐다고 알리지 않고 바로 취소로 돌린다('collected'는 정상 종료라 다음 회차가 닫는다).
        late := private.claim_return_pickup_block(bundle);
        if late is not null and late <> 'collected' then
          update private.claim_return_pickups set state = 'cancel_pending', cancel_reason = late, next_attempt_at = clock_timestamp(),
            cancel_retry_base = cancel_attempts, updated_at = clock_timestamp() where id = pickup.id;
        end if;
        label := coalesce(nullif(bundle.return_name_snapshot, ''), '출고지 반품 주소');
        insert into private.claim_collection_events(id, claim_id, shipment_id, actor_id, session_id, request, result)
        values (gen_random_uuid(), pickup.claim_id, pickup.shipment_id, system_actor, system_actor,
          jsonb_build_object('claimId', pickup.claim_id, 'shipmentId', pickup.shipment_id, 'bundleId', pickup.bundle_id, 'source', 'return_pickup',
            'values', jsonb_build_object('method', 'seller_arranged', 'carrier', pickup.carrier, 'trackingNumber', tracking,
              'evidence', case when late is not null and late <> 'collected' then '자동 회수 접수 후 즉시 취소 · ' else '자동 회수 접수 · ' end || label)),
          jsonb_build_object('pickupId', pickup.id, 'state', 'requested'));
        insert into public.audit_log(actor_id, action, target, diff) values (null, 'system.order.claim_return_pickup_requested', 'order:' || pickup.order_id,
          jsonb_build_object('claimId', pickup.claim_id, 'shipmentId', pickup.shipment_id, 'bundleId', pickup.bundle_id, 'pickupId', pickup.id,
            'provider', pickup.provider, 'carrier', pickup.carrier, 'trackingNumber', tracking, 'attempts', pickup.attempts,
            'canceledAtOnce', case when late is not null and late <> 'collected' then late else null end));
        if late is null then
          perform private.notify_order_claim(pickup.claim_id, 'return_pickup_requested', '방문 회수가 접수됐어요',
            '택배 기사가 방문해 굿즈를 회수합니다. 주문 상세의 회수 정보에서 회수 송장을 확인해주세요.');
        end if;
        requested := requested + 1;
      else
        update private.claim_return_pickups set state = 'failed',
          last_error_code = case when result->>'outcome' = 'requested' then 'invalid_tracking' else coalesce(code, 'upstream_error') end,
          next_attempt_at = private.claim_return_pickup_next_attempt(pickup.attempts - pickup.retry_base, settings),
          lease_token = null, lease_until = null, updated_at = clock_timestamp()
        where id = pickup.id;
        insert into private.claim_return_pickup_attempts(pickup_id, kind, outcome, error_code)
        values (pickup.id, 'request', 'error', case when result->>'outcome' = 'requested' then 'invalid_tracking' else coalesce(code, 'upstream_error') end);
        failed := failed + 1;
      end if;
    else
      if result->>'outcome' in ('canceled','not_found') then
        update private.claim_return_pickups set state = 'canceled', canceled_at = clock_timestamp(), last_error_code = null, next_attempt_at = null,
          lease_token = null, lease_until = null, updated_at = clock_timestamp() where id = pickup.id;
        insert into private.claim_return_pickup_attempts(pickup_id, kind, outcome) values (pickup.id, 'cancel', result->>'outcome');
        if pickup.tracking_number is not null then
          insert into private.claim_collection_events(id, claim_id, shipment_id, actor_id, session_id, request, result)
          values (gen_random_uuid(), pickup.claim_id, pickup.shipment_id, system_actor, system_actor,
            jsonb_build_object('claimId', pickup.claim_id, 'shipmentId', pickup.shipment_id, 'bundleId', pickup.bundle_id, 'source', 'return_pickup',
              'values', jsonb_build_object('method', 'seller_arranged', 'carrier', pickup.carrier, 'trackingNumber', pickup.tracking_number,
                'evidence', '자동 회수 취소 · ' || case pickup.cancel_reason when 'withdrawn' then '요청 철회' when 'rejected' then '요청 거절'
                  when 'completed' then '요청 종결' when 'waived' then '회수 생략' when 'customer_sent' then '고객 직접 발송' when 'manual' then '수거 방법 별도 기록' else '회수 불필요' end)),
            jsonb_build_object('pickupId', pickup.id, 'state', 'canceled'));
        end if;
        insert into public.audit_log(actor_id, action, target, diff) values (null, 'system.order.claim_return_pickup_canceled', 'order:' || pickup.order_id,
          jsonb_build_object('claimId', pickup.claim_id, 'bundleId', pickup.bundle_id, 'pickupId', pickup.id, 'provider', pickup.provider,
            'carrier', pickup.carrier, 'trackingNumber', pickup.tracking_number, 'reason', pickup.cancel_reason, 'outcome', result->>'outcome'));
        canceled := canceled + 1;
      else
        update private.claim_return_pickups set state = 'cancel_failed', last_error_code = coalesce(code, 'upstream_error'),
          next_attempt_at = private.claim_return_pickup_next_attempt(pickup.cancel_attempts - pickup.cancel_retry_base, settings),
          lease_token = null, lease_until = null, updated_at = clock_timestamp() where id = pickup.id;
        insert into private.claim_return_pickup_attempts(pickup_id, kind, outcome, error_code) values (pickup.id, 'cancel', 'error', coalesce(code, 'upstream_error'));
        cancel_failed := cancel_failed + 1;
      end if;
    end if;
    recorded := recorded + 1;
  end loop;
  return jsonb_build_object('recorded', recorded, 'requested', requested, 'failed', failed, 'canceled', canceled, 'cancelFailed', cancel_failed,
    'stale', stale, 'invalid', invalid, 'deferred', deferred);
end $$;
revoke all on function public.service_record_return_pickup_results(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.service_record_return_pickup_results(jsonb) to service_role;

-- 6. 운영자: 자동 수거 실패 건수·목록(반품입고 파일 설정과 함께 읽는다), 다시 접수.
-- 꺼져 있으면 {enabled:false}만 돌려준다 — 화면은 아무것도 그리지 않는다.
create function public.admin_claim_return_operations() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare settings private.return_pickup_settings;
begin
  perform private.require_operator_capability('sales.manage', false);
  select * into settings from private.return_pickup_settings where singleton;
  return jsonb_build_object(
    'pickup', case when not coalesce(settings.pickup_enabled, false) then jsonb_build_object('enabled', false) else jsonb_build_object('enabled', true,
      'failed', (select count(*) from private.claim_return_pickups where state in ('failed','cancel_failed')),
      'pending', (select count(*) from private.claim_return_pickups where state in ('pending','cancel_pending')),
      'items', coalesce((select jsonb_agg(jsonb_build_object('claimId', f.claim_id, 'claimType', f.claim_type, 'reference', f.reference, 'orderNumber', f.order_number,
          'bundleId', f.bundle_id, 'state', f.state, 'lastErrorCode', f.last_error_code, 'attempts', f.attempts, 'updatedAt', f.updated_at) order by f.updated_at, f.id)
        from (select p.id, p.claim_id, c.claim_type, c.reference, o.order_number, p.bundle_id, p.state, p.last_error_code,
            case when p.state = 'cancel_failed' then p.cancel_attempts else p.attempts end attempts, p.updated_at
          from private.claim_return_pickups p join public.order_cancellation_requests c on c.id = p.claim_id join public.orders o on o.id = p.order_id
          where p.state in ('failed','cancel_failed') order by p.updated_at, p.id limit 20) f), '[]'::jsonb)) end,
    'intake', case when not coalesce(settings.intake_enabled, false) then jsonb_build_object('enabled', false)
      else jsonb_build_object('enabled', true, 'columns', settings.intake_columns) end);
end $$;
revoke all on function public.admin_claim_return_operations() from public, anon, authenticated, service_role;
grant execute on function public.admin_claim_return_operations() to authenticated;
select private.register_operator_rpc_contract('public.admin_claim_return_operations()'::regprocedure, 'sales.manage', 'read', false);

-- 자동 수거 실패(접수 실패·취소 실패)를 지금 다시 시도하도록 큐에 돌린다. 크론이 다음 회차에 같은 멱등 키로 다시 보낸다.
create function public.admin_retry_claim_return_pickup(p_claim_id uuid, p_bundle_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); settings private.return_pickup_settings; pickup private.claim_return_pickups; next_state text;
begin
  perform private.require_operator_capability('sales.manage', false);
  if actor is null or not public.has_operator_capability('sales.manage', false) then raise insufficient_privilege using message = 'staff required'; end if;
  select * into settings from private.return_pickup_settings where singleton;
  if not found or not settings.pickup_enabled then raise check_violation using message = 'return_pickup_disabled'; end if;
  select * into pickup from private.claim_return_pickups where bundle_id = p_bundle_id and claim_id = p_claim_id for update;
  if not found then raise no_data_found using message = 'return_pickup_not_found'; end if;
  if pickup.lease_until is not null and pickup.lease_until > clock_timestamp() then raise sqlstate 'PT409' using message = 'return_pickup_in_progress'; end if;
  if pickup.state not in ('failed','cancel_failed') then
    return jsonb_build_object('pickupId', pickup.id, 'state', pickup.state, 'nextAttemptAt', pickup.next_attempt_at, 'replayed', true);
  end if;
  next_state := case pickup.state when 'failed' then 'pending' else 'cancel_pending' end;
  update private.claim_return_pickups set state = next_state, next_attempt_at = clock_timestamp(),
    retry_base = case when pickup.state = 'failed' then attempts else retry_base end,
    cancel_retry_base = case when pickup.state = 'cancel_failed' then cancel_attempts else cancel_retry_base end,
    lease_token = null, lease_until = null, updated_at = clock_timestamp()
  where id = pickup.id;
  insert into private.claim_return_pickup_attempts(pickup_id, kind, outcome, actor_id) values (pickup.id, 'retry', 'scheduled', actor);
  insert into public.audit_log(actor_id, action, target, diff) values (actor, 'admin.order.claim_return_pickup_retried', 'order:' || pickup.order_id,
    jsonb_build_object('claimId', pickup.claim_id, 'bundleId', pickup.bundle_id, 'pickupId', pickup.id, 'previousState', pickup.state,
      'lastErrorCode', pickup.last_error_code, 'attempts', pickup.attempts, 'cancelAttempts', pickup.cancel_attempts));
  return jsonb_build_object('pickupId', pickup.id, 'state', next_state, 'nextAttemptAt', clock_timestamp(), 'replayed', false);
end $$;
revoke all on function public.admin_retry_claim_return_pickup(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_retry_claim_return_pickup(uuid, uuid) to authenticated;
select private.register_operator_rpc_contract('public.admin_retry_claim_return_pickup(uuid,uuid)'::regprocedure, 'sales.manage', 'write', false);

-- 7. 고객 안내(스위치에 묶음): 상품 상세의 반송 안내, 주문 상세의 수거중 안내를 방문 회수 안내로 바꿀지.
-- 굿즈의 출고지가 회수 계약으로 켜져 있으면 true. 꺼져 있으면 false(지금 문장).
create function public.get_good_return_pickup(target_good_id text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select settings.pickup_enabled from private.return_pickup_settings settings where settings.singleton), false)
    and exists(select 1 from public.goods g join private.return_pickup_origins origin on origin.origin_id = g.origin_id and origin.enabled
      where g.id = target_good_id);
$$;
revoke all on function public.get_good_return_pickup(text) from public, anon, authenticated, service_role;
grant execute on function public.get_good_return_pickup(text) to anon, authenticated;

-- 구매자 본인 주문의 진행 중 반품·교환 회수 묶음이 몇 개는 방문 회수이고 몇 개는 고객이 직접 보내야 하는지(묶음 = 배송 건 × 반품지).
-- 방문 회수 묶음 = 접수됐거나(requested) 접수될 예정인(pending·failed는 스위치가 켜져 있을 때만, 또는 곧 큐에 들어갈) 묶음.
-- 직접 발송 묶음 = 아직 회수가 끝나지 않았고 회수 생략·고객 발송 기록도 없는데 방문 회수가 아닌 묶음(회수 계약이 없는 출고지 등).
-- 선물 주문은 read_my_claim_return_bundles와 같이 받는 분이 읽고 보낸 분은 둘 다 0이다. 키는 pickupBundles·directBundles 둘뿐이다.
create function public.get_my_order_return_pickup(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); viewer text; enabled boolean; pickup_count integer; direct_count integer;
begin
  select case when g.recipient_id = actor then 'recipient' when g.sender_id = actor then 'sender' when g.id is null and o.user_id = actor then 'buyer' end
  into viewer from public.orders o left join private.gift_intents g on g.order_id = o.id where o.id = p_order_id;
  if viewer is null or viewer = 'sender' then return jsonb_build_object('pickupBundles', 0, 'directBundles', 0); end if;
  select coalesce((select settings.pickup_enabled from private.return_pickup_settings settings where settings.singleton), false) into enabled;
  select count(*) filter (where x.pickup), count(*) filter (where not x.pickup) into pickup_count, direct_count
  from (select exists(select 1 from private.claim_return_pickups p where p.bundle_id = b.id
        and (p.state = 'requested' or (enabled and p.state in ('pending','failed')))) or private.claim_return_pickup_eligible(b) as pickup
    from public.order_cancellation_requests c join public.order_claim_collection_bundles b on b.claim_id = c.id
    where c.order_id = p_order_id and c.claim_type in ('return','exchange')
      and (case when c.stage = 'on_hold' then c.held_from else c.stage end) = 'collecting'
      and private.claim_return_pickup_block(b) is null) x;
  return jsonb_build_object('pickupBundles', coalesce(pickup_count, 0), 'directBundles', coalesce(direct_count, 0));
end $$;
revoke all on function public.get_my_order_return_pickup(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_my_order_return_pickup(uuid) to authenticated;

-- 8. 회수 묶음 읽기(운영 상세·일괄 사실·고객 회수 주소)에 회수 접수를 더한다. 행이 있는 묶음에만 'pickup' 키가 생긴다.
-- 앵커 치환(재정의 최소화). 각 앵커는 정확히 한 번 나와야 한다.
create or replace function pg_temp.return_pickup_patch(p_function regprocedure, p_anchor text, p_replacement text) returns void language plpgsql as $$
declare definition text := pg_get_functiondef(p_function);
begin
  if (length(definition) - length(replace(definition, p_anchor, ''))) / length(p_anchor) <> 1 then
    raise exception '% anchor must appear once', p_function; end if;
  execute replace(definition, p_anchor, p_replacement);
end $$;
select pg_temp.return_pickup_patch('private.claim_collection_bundles_json(uuid,uuid,boolean)'::regprocedure,
  $a$and coalesce(btrim(o.return_address),'')<>'')))$a$,
  $a$and coalesce(btrim(o.return_address),'')<>'')))||private.claim_return_pickup_json(b.id,true)$a$);
select pg_temp.return_pickup_patch('private.claim_collection_bundles_json(uuid,uuid,boolean)'::regprocedure,
  $a$'collectedAt',b.collected_at) end$a$,
  $a$'collectedAt',b.collected_at)||private.claim_return_pickup_json(b.id,false) end$a$);

-- 재정의한 함수의 등록된 계약을 새 본문·ACL로 다시 적는다(분류는 기존 행 그대로).
do $$declare fn regprocedure; contract record; begin
  foreach fn in array array['private.claim_collection_bundles_json(uuid,uuid,boolean)'::regprocedure] loop
    select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure = fn;
    if found then perform private.register_operator_rpc_contract(fn, contract.capability, contract.guard_kind, contract.legacy_admin_only);
    elsif exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure = fn) then
      perform private.register_operator_internal_contract(fn);
    end if;
  end loop;
end $$;

commit;
notify pgrst, 'reload schema';
