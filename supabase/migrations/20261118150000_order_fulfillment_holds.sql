-- 주문 출고 보류(원장 PAY-050·SHP-093·OPS-074·OPS-065·CLM-051).
--
-- 결제완료인데 돈이 실제로 들어오지 않았거나 결제사에서 이미 취소된 주문이 자동 발주확인 → 출고지시로 창고 파일에 섞이지 않게
-- 주문 단위 '출고 보류'를 둔다. 사유는 둘이다.
--  * test_payment: 운영 배포가 토스 테스트 키로 결제 준비(prepare)한 시도가 승인됐다. 앱이 prepare 때 그 시도의 키 모드를
--    private.payment_attempt_key_modes에 남기고(운영 배포에서만 — 로컬·preview·스테이징은 토스 게이트웨이가 없어 남기지 않는다),
--    승인 전이(payment_attempts.state → approved) 트리거가 보류 행을 만든다. 판정(order_fulfillment_hold_reasons)은 보류 행이 없어도
--    키 모드에서 직접 다시 읽는다 — 트리거가 실패해도(결제 확정은 되돌리지 않는다) 출고는 막힌다.
--  * provider_canceled: 토스 웹훅이 종결(approved) 결제에 오면 앱이 결제사 조회(원장을 바꾸지 않는 잔액 조회)로 상태를 확인하고,
--    결제사 취소 금액이 우리 원장의 적용된 환불(부분 취소)보다 크면 service_flag_goods_provider_cancellation이 보류를 남긴다.
--    우리가 발행 중인 취소(취소 요청·클레임·부분 취소·환불 대기)가 있으면 'in_flight'를 돌려 웹훅 재전송으로 다시 보게 한다.
-- 보류 중인 주문은 자동 발주확인에서 제외되고(fulfillment_hold), 출고지시 후보·내보내기·묶음 출고에서 빠지며, 수동 발주확인·
-- 배송 상태 전이(private.assert_order_dispatch_allowed를 쓰는 모든 출고 경로)와 주문의 발송·배송완료 전이가 거절된다.
-- 해제는 sales.manage 운영자가 사유를 적어서 하고(감사 기록), 주문이 취소되면 보류는 자동으로 닫힌다(판정도 취소 주문은 보지 않는다).
begin;

create function private.t1_hold_patch_function(p_function regprocedure, p_pairs text[]) returns void
language plpgsql set search_path = '' as $$
declare definition text := pg_get_functiondef(p_function); i integer;
begin
  if array_length(p_pairs, 1) is null or array_length(p_pairs, 1) % 2 <> 0 then raise exception 't1 hold patch pairs'; end if;
  for i in 1 .. array_length(p_pairs, 1) / 2 loop
    if (length(definition) - length(replace(definition, p_pairs[2 * i - 1], ''))) / length(p_pairs[2 * i - 1]) <> 1 then
      raise exception '% anchor % must appear once', p_function, i;
    end if;
    definition := replace(definition, p_pairs[2 * i - 1], p_pairs[2 * i]);
  end loop;
  execute definition;
end $$;

-- 1. 결제 시도의 토스 키 모드. 운영 배포의 굿즈 결제 준비가 남긴다(라이브 키도 남겨 원장에서 구분한다).
create table private.payment_attempt_key_modes (
  attempt_id uuid primary key references public.payment_attempts(id) on delete cascade,
  key_mode text not null check (key_mode in ('test', 'live')),
  recorded_at timestamptz not null default clock_timestamp()
);
create index payment_attempt_key_modes_test on private.payment_attempt_key_modes(attempt_id) where key_mode = 'test';
alter table private.payment_attempt_key_modes enable row level security;
revoke all on private.payment_attempt_key_modes from public, anon, authenticated, service_role;

-- 2. 출고 보류. (주문, 사유, 근거) 하나에 행 하나 — 같은 근거는 해제된 뒤에도 다시 걸리지 않는다(웹훅 재전송·역순 도착에 멱등).
--    근거: test_payment는 결제 시도, provider_canceled는 결제 시도와 결제사가 취소한 누계 금액(더 취소되면 새 보류).
create table private.order_fulfillment_holds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  reason text not null check (reason in ('test_payment', 'provider_canceled')),
  evidence_key text not null,
  payment_attempt_id uuid references public.payment_attempts(id),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  released_at timestamptz,
  release_kind text check (release_kind in ('operator', 'order_canceled')),
  released_by uuid references public.profiles(id) on delete set null,
  release_note text check (release_note is null or (release_note = btrim(release_note) and char_length(release_note) between 5 and 500)),
  constraint order_fulfillment_holds_evidence check (
    (reason = 'test_payment' and payment_attempt_id is not null and evidence_key = 'test_payment:' || payment_attempt_id::text)
    or (reason = 'provider_canceled' and payment_attempt_id is not null and evidence_key ~ ('^provider_canceled:' || payment_attempt_id::text || ':[1-9][0-9]{0,14}$'))),
  constraint order_fulfillment_holds_release check (
    (released_at is null) = (release_kind is null)
    and (release_kind is distinct from 'operator' or release_note is not null)
    and (release_kind is distinct from 'order_canceled' or release_note is null)),
  constraint order_fulfillment_holds_evidence_key unique (order_id, reason, evidence_key)
);
create index order_fulfillment_holds_active on private.order_fulfillment_holds(order_id) where released_at is null;
create index order_fulfillment_holds_attempt on private.order_fulfillment_holds(payment_attempt_id);
alter table private.order_fulfillment_holds enable row level security;
revoke all on private.order_fulfillment_holds from public, anon, authenticated, service_role;

-- 3. 판정. 취소된 주문은 보지 않는다. 테스트 키 승인은 보류 행이 없어도(트리거 실패) 키 모드에서 직접 보류로 읽는다.
create function private.order_fulfillment_hold_reasons(p_order_id uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select case when not exists(select 1 from public.orders o where o.id = p_order_id and o.status <> 'canceled') then '{}'::text[]
    else coalesce((select array_agg(distinct r.reason order by r.reason) from (
      select h.reason from private.order_fulfillment_holds h where h.order_id = p_order_id and h.released_at is null
      union all
      select 'test_payment' from public.payment_attempts a join private.payment_attempt_key_modes k on k.attempt_id = a.id
      where a.purpose = 'order' and a.ref_id = p_order_id and a.state = 'approved' and k.key_mode = 'test'
        and not exists(select 1 from private.order_fulfillment_holds h where h.order_id = p_order_id and h.evidence_key = 'test_payment:' || a.id::text)
    ) r), '{}'::text[]) end;
$$;
revoke all on function private.order_fulfillment_hold_reasons(uuid) from public, anon, authenticated, service_role;

create function private.order_fulfillment_held(p_order_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(cardinality(private.order_fulfillment_hold_reasons(p_order_id)) > 0, false);
$$;
revoke all on function private.order_fulfillment_held(uuid) from public, anon, authenticated, service_role;

-- 보류 중인(취소되지 않은) 주문. 운영 할 일·목록 패널이 쓴다. 작은 표(보류·테스트 키)에서 출발한다.
create function private.order_fulfillment_held_orders() returns table(order_id uuid, placed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select x.order_id, min(x.placed_at) from (
    select h.order_id, h.created_at as placed_at from private.order_fulfillment_holds h join public.orders o on o.id = h.order_id
    where h.released_at is null and o.status <> 'canceled'
    union all
    select a.ref_id, a.updated_at from private.payment_attempt_key_modes k join public.payment_attempts a on a.id = k.attempt_id
    join public.orders o on o.id = a.ref_id
    where k.key_mode = 'test' and a.purpose = 'order' and a.state = 'approved' and o.status <> 'canceled'
      and not exists(select 1 from private.order_fulfillment_holds h where h.order_id = a.ref_id and h.evidence_key = 'test_payment:' || a.id::text)
  ) x group by x.order_id;
$$;
revoke all on function private.order_fulfillment_held_orders() from public, anon, authenticated, service_role;

-- 테스트 키 승인의 보류 행을 만든다(이미 있으면 그대로 — 해제된 행도 다시 걸지 않는다). 만든 행 수를 돌려준다.
create function private.materialize_order_fulfillment_holds(p_order_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare inserted integer;
begin
  insert into private.order_fulfillment_holds(order_id, reason, evidence_key, payment_attempt_id, detail)
  select p_order_id, 'test_payment', 'test_payment:' || a.id::text, a.id,
    jsonb_build_object('keyMode', 'test', 'paymentAmount', a.amount)
  from public.payment_attempts a join private.payment_attempt_key_modes k on k.attempt_id = a.id
  where a.purpose = 'order' and a.ref_id = p_order_id and a.state = 'approved' and k.key_mode = 'test'
  on conflict (order_id, reason, evidence_key) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end $$;
revoke all on function private.materialize_order_fulfillment_holds(uuid) from public, anon, authenticated, service_role;

-- 4. 승인 전이에서 테스트 키 보류를 남긴다. 실패해도 결제 확정을 되돌리지 않는다(판정이 키 모드를 직접 다시 읽는다).
create function private.place_test_payment_fulfillment_hold() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    if private.materialize_order_fulfillment_holds(new.ref_id) > 0 then
      insert into public.audit_log(actor_id, action, target, diff) values (null, 'system.order.fulfillment_hold_placed', 'order:' || new.ref_id,
        jsonb_build_object('reason', 'test_payment', 'attemptId', new.id, 'keyMode', 'test'));
    end if;
  exception when others then
    raise warning 'order fulfillment hold materialization failed (attempt %, sqlstate %)', new.id, sqlstate;
  end;
  return null;
end $$;
revoke all on function private.place_test_payment_fulfillment_hold() from public, anon, authenticated, service_role;
create trigger payment_attempt_test_payment_hold after update of state on public.payment_attempts
  for each row when (new.state = 'approved' and old.state is distinct from new.state and new.purpose = 'order'
    and new.provider = 'toss' and new.ref_id is not null)
  execute function private.place_test_payment_fulfillment_hold();

-- 주문이 취소되면 남은 보류를 닫는다(판정은 이미 취소 주문을 보지 않는다 — 기록 정리와 감사용).
create function private.release_order_fulfillment_holds_on_cancel() returns trigger
language plpgsql security definer set search_path = '' as $$
declare released integer;
begin
  update private.order_fulfillment_holds set released_at = clock_timestamp(), release_kind = 'order_canceled'
  where order_id = new.id and released_at is null;
  get diagnostics released = row_count;
  if released > 0 then
    insert into public.audit_log(actor_id, action, target, diff) values (null, 'system.order.fulfillment_hold_released', 'order:' || new.id,
      jsonb_build_object('trigger', 'order_canceled', 'released', released));
  end if;
  return null;
end $$;
revoke all on function private.release_order_fulfillment_holds_on_cancel() from public, anon, authenticated, service_role;
create trigger orders_release_fulfillment_holds after update of status on public.orders
  for each row when (new.status = 'canceled' and old.status is distinct from new.status)
  execute function private.release_order_fulfillment_holds_on_cancel();

-- 5. 결제 준비 때 키 모드를 남긴다(service_role 전용). 결제 전(prepared)에만 바꿀 수 있고, 이미 남긴 값과 다른 모드로
--    승인 뒤 덮어쓰지 않는다. 행이 없으면 상태와 무관하게 남긴다(테스트 키라면 그 즉시 보류로 읽힌다 — 출고 쪽으로 안전하다).
create function public.service_record_goods_payment_key_mode(p_attempt_id uuid, p_key_mode text) returns void
language plpgsql security definer set search_path = '' as $$
declare attempt public.payment_attempts; current_mode text;
begin
  if p_attempt_id is null or p_key_mode is null or p_key_mode not in ('test', 'live') then
    raise invalid_parameter_value using message = 'invalid_payment_key_mode';
  end if;
  select * into attempt from public.payment_attempts where id = p_attempt_id for update;
  if not found or attempt.provider <> 'toss' or attempt.purpose <> 'order' then
    raise no_data_found using message = 'payment_attempt_not_found';
  end if;
  select key_mode into current_mode from private.payment_attempt_key_modes where attempt_id = p_attempt_id;
  if not found then
    insert into private.payment_attempt_key_modes(attempt_id, key_mode) values (p_attempt_id, p_key_mode);
  elsif current_mode <> p_key_mode then
    if attempt.state <> 'prepared' then raise check_violation using message = 'payment_key_mode_locked'; end if;
    update private.payment_attempt_key_modes set key_mode = p_key_mode, recorded_at = clock_timestamp() where attempt_id = p_attempt_id;
  end if;
end $$;
revoke all on function public.service_record_goods_payment_key_mode(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.service_record_goods_payment_key_mode(uuid, text) to service_role;

-- 6. 결제사 직접 취소 감지. 앱이 웹훅을 받은 종결 결제를 조회하기 전에 대상인지와 원장 결제 키를 읽는다(돈·상태를 바꾸지 않는다).
--    대상: 토스 굿즈 결제 승인 + 결제 원장 paid + 결제 키 있음 + 주문이 취소되지 않음. 아니면 null.
create function public.service_goods_provider_cancellation_context(p_attempt_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('attempt', jsonb_build_object('id', a.id, 'provider', a.provider, 'purpose', a.purpose, 'ref_id', a.ref_id,
      'amount', a.amount, 'currency', a.currency, 'idempotency_key', a.idempotency_key, 'provider_order_id', a.provider_order_id,
      'provider_product_code', a.provider_product_code, 'expires_at', a.expires_at),
    'paymentKey', p.payment_key)
  from public.payment_attempts a
  join public.payments p on p.id = a.payment_id
  join public.orders o on o.id = a.ref_id
  where a.id = p_attempt_id and a.provider = 'toss' and a.purpose = 'order' and a.state = 'approved'
    and p.purpose = 'order' and p.ref_id = a.ref_id and p.status = 'paid' and p.payment_key is not null
    and o.status <> 'canceled';
$$;
revoke all on function public.service_goods_provider_cancellation_context(uuid) from public, anon, authenticated, service_role;
grant execute on function public.service_goods_provider_cancellation_context(uuid) to service_role;

-- 결제사 조회 결과(잔액)를 원장과 대조해 보류를 남긴다. 돌려주는 판정:
--  held(새 보류) · already_recorded(같은 근거가 이미 있음 — 해제된 것 포함) · consistent(원장이 이미 그 취소를 안다·취소 없음) ·
--  in_flight(우리가 발행 중인 취소가 있어 판정을 미룬다 — 웹훅 재전송으로 다시 본다) · not_applicable(대상 아님).
create function public.service_flag_goods_provider_cancellation(p_attempt_id uuid, p_provider_status text, p_provider_balance bigint, p_case_ref text)
returns text
language plpgsql security definer set search_path = '' as $$
declare attempt public.payment_attempts; payment public.payments; purchase public.orders; canceled bigint; recorded bigint; inserted integer; hold_id uuid;
begin
  if p_attempt_id is null or p_provider_status is null or p_provider_status !~ '^[A-Z_]{1,40}$'
    or p_provider_balance is null or p_provider_balance < 0 or p_case_ref is null or p_case_ref !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise invalid_parameter_value using message = 'invalid_provider_cancellation';
  end if;
  select * into attempt from public.payment_attempts where id = p_attempt_id;
  if not found or attempt.provider <> 'toss' or attempt.purpose <> 'order' or attempt.ref_id is null
    or attempt.state <> 'approved' or attempt.payment_id is null then
    return 'not_applicable';
  end if;
  -- 주문 → 결제 순서로 잠근다(취소·클레임 경로와 같은 순서).
  select * into purchase from public.orders where id = attempt.ref_id for update;
  if not found or purchase.status = 'canceled' then return 'not_applicable'; end if;
  select * into payment from public.payments where id = attempt.payment_id for share;
  if not found or payment.status <> 'paid' then return 'not_applicable'; end if;
  if p_provider_balance > payment.amount then raise invalid_parameter_value using message = 'invalid_provider_cancellation'; end if;
  canceled := payment.amount - p_provider_balance;
  if canceled = 0 then return 'consistent'; end if;
  recorded := private.payment_partial_refunded_amount(payment.id);
  if canceled <= recorded then return 'consistent'; end if;
  -- 우리가 발행한 취소의 웹훅이 원장 기록보다 먼저 온 정상 경우를 오탐하지 않는다.
  if exists(select 1 from public.order_cancellation_requests r where r.order_id = purchase.id and r.status in ('requested', 'processing', 'needs_review'))
    or exists(select 1 from public.order_cancellation_claims c where c.order_id = purchase.id)
    or private.order_partial_cancel_in_flight(purchase.id)
    or exists(select 1 from public.refunds rf where rf.payment_id = payment.id and rf.status in ('requested', 'awaiting_transfer')) then
    return 'in_flight';
  end if;
  insert into private.order_fulfillment_holds(order_id, reason, evidence_key, payment_attempt_id, detail)
  values (purchase.id, 'provider_canceled', 'provider_canceled:' || attempt.id::text || ':' || canceled::text, attempt.id,
    jsonb_build_object('providerStatus', p_provider_status, 'providerCanceledAmount', canceled, 'recordedRefundedAmount', recorded,
      'paymentAmount', payment.amount, 'caseRef', p_case_ref))
  on conflict (order_id, reason, evidence_key) do nothing
  returning id into hold_id;
  get diagnostics inserted = row_count;
  if inserted = 0 then return 'already_recorded'; end if;
  insert into public.audit_log(actor_id, action, target, diff) values (null, 'system.order.fulfillment_hold_placed', 'order:' || purchase.id,
    jsonb_build_object('reason', 'provider_canceled', 'attemptId', attempt.id, 'providerStatus', p_provider_status,
      'providerCanceledAmount', canceled, 'recordedRefundedAmount', recorded, 'caseRef', p_case_ref));
  -- 결제사 직접 취소는 드물고 바로 확인할 일이라 운영 알림에도 남긴다(테스트 키 보류는 결제마다 생겨 알림에 싣지 않는다).
  insert into private.admin_operation_alerts(event_key, category, title, href)
  values ('order_fulfillment_holds:' || hold_id::text || ':placed', 'orders', '결제사에서 취소된 주문이 출고 보류되었습니다.', '/admin/sales/orders/' || purchase.id)
  on conflict (event_key) do nothing;
  return 'held';
end $$;
revoke all on function public.service_flag_goods_provider_cancellation(uuid, text, bigint, text) from public, anon, authenticated, service_role;
grant execute on function public.service_flag_goods_provider_cancellation(uuid, text, bigint, text) to service_role;

-- 7. 운영 화면 읽기. 주문 id별 보류 사유와 근거(금액·상태). 결제 키·원문은 싣지 않는다.
create function private.order_fulfillment_hold_document(p_order_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'reason', r.reason,
      'placedAt', coalesce(h.created_at, (select a.updated_at from public.payment_attempts a where a.purpose = 'order' and a.ref_id = p_order_id)),
      'providerStatus', h.detail->>'providerStatus',
      'providerCanceledAmount', (h.detail->>'providerCanceledAmount')::bigint,
      'paymentAmount', (h.detail->>'paymentAmount')::bigint) order by r.reason), '[]'::jsonb)
  from unnest(private.order_fulfillment_hold_reasons(p_order_id)) r(reason)
  left join lateral (select x.created_at, x.detail from private.order_fulfillment_holds x
    where x.order_id = p_order_id and x.reason = r.reason and x.released_at is null order by x.created_at desc, x.id desc limit 1) h on true;
$$;
revoke all on function private.order_fulfillment_hold_document(uuid) from public, anon, authenticated, service_role;

create function public.admin_order_fulfillment_holds(p_order_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform private.require_operator_capability('sales.read', false);
  if p_order_ids is null or coalesce(array_length(p_order_ids, 1), 0) > 200 then
    raise invalid_parameter_value using message = 'invalid_fulfillment_hold_query';
  end if;
  select coalesce(jsonb_object_agg(o.id::text, private.order_fulfillment_hold_document(o.id)), '{}'::jsonb) into result
  from public.orders o where o.id = any(p_order_ids) and private.order_fulfillment_held(o.id);
  return result;
end $$;
revoke all on function public.admin_order_fulfillment_holds(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.admin_order_fulfillment_holds(uuid[]) to authenticated;

create function public.admin_list_order_fulfillment_holds(p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform private.require_operator_capability('sales.read', false);
  if p_limit is null or p_limit not between 1 and 100 then raise invalid_parameter_value using message = 'invalid_fulfillment_hold_query'; end if;
  with held as materialized (select * from private.order_fulfillment_held_orders())
  select jsonb_build_object('total', (select count(*) from held),
    'items', coalesce((select jsonb_agg(jsonb_build_object('orderId', o.id, 'orderNumber', o.order_number, 'status', o.status,
        'holds', private.order_fulfillment_hold_document(o.id)) order by page.placed_at, page.order_id)
      from (select * from held order by placed_at, order_id limit p_limit) page join public.orders o on o.id = page.order_id), '[]'::jsonb))
  into result;
  return result;
end $$;
revoke all on function public.admin_list_order_fulfillment_holds(integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_list_order_fulfillment_holds(integer) to authenticated;

-- 발송처리 화면의 행 표시(출고 전용 권한). 배송 건 id만 돌려준다 — 사유·금액·구매자 없음.
create function public.admin_shipment_fulfillment_hold_flags(p_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.has_operator_capability('sales.dispatch', false) then
    raise insufficient_privilege using message = 'operator_capability_required';
  end if;
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) > 1000 then
    raise exception using message = 'shipment_ids_invalid';
  end if;
  select coalesce(pg_catalog.jsonb_agg(s.id order by s.id), '[]'::jsonb) into result
  from public.order_shipments s where s.id = any(p_ids) and private.order_fulfillment_held(s.order_id);
  return result;
end $$;
revoke all on function public.admin_shipment_fulfillment_hold_flags(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.admin_shipment_fulfillment_hold_flags(uuid[]) to authenticated;

-- 8. 해제. sales.manage 운영자가 사유(5~500자)를 적는다. 같은 요청번호의 재요청은 처음 결과를 돌려준다.
create function public.admin_release_order_fulfillment_hold(p_order_id uuid, p_reason text, p_note text, p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; note text := btrim(coalesce(p_note, '')); released integer; previous public.audit_log;
begin
  actor := private.require_operator_capability('sales.manage', false);
  if p_order_id is null or p_operation_id is null or p_reason is null or p_reason not in ('test_payment', 'provider_canceled')
    or char_length(note) not between 5 and 500 or translate(note, E'\n\t', '') ~ '[[:cntrl:]]' then
    raise invalid_parameter_value using message = 'invalid_fulfillment_hold_release';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('order-fulfillment-hold-release:' || p_operation_id::text, 0));
  select * into previous from public.audit_log where id = p_operation_id;
  if found then
    if previous.actor_id is distinct from actor or previous.action <> 'admin.order.fulfillment_hold_released'
      or previous.target is distinct from 'order:' || p_order_id or previous.diff->>'reason' is distinct from p_reason then
      raise sqlstate 'PT409' using message = 'fulfillment_hold_operation_conflict';
    end if;
    return jsonb_build_object('operationId', p_operation_id, 'orderId', p_order_id, 'reason', p_reason,
      'released', (previous.diff->>'released')::integer, 'replayed', true);
  end if;
  perform 1 from public.orders where id = p_order_id for update;
  if not found then raise no_data_found using message = 'order_not_found'; end if;
  perform private.materialize_order_fulfillment_holds(p_order_id);
  update private.order_fulfillment_holds set released_at = clock_timestamp(), release_kind = 'operator', released_by = actor, release_note = note
  where order_id = p_order_id and reason = p_reason and released_at is null;
  get diagnostics released = row_count;
  if released = 0 then raise check_violation using message = 'fulfillment_hold_not_active'; end if;
  insert into public.audit_log(id, actor_id, action, target, diff) values (p_operation_id, actor, 'admin.order.fulfillment_hold_released',
    'order:' || p_order_id, jsonb_build_object('reason', p_reason, 'note', note, 'released', released));
  return jsonb_build_object('operationId', p_operation_id, 'orderId', p_order_id, 'reason', p_reason, 'released', released, 'replayed', false);
end $$;
revoke all on function public.admin_release_order_fulfillment_hold(uuid, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_release_order_fulfillment_hold(uuid, text, text, uuid) to authenticated;

-- 9. 기존 판정·출고 경로가 보류를 읽는다(앵커 치환).
-- 수동 발주확인·자동 발주확인(confirm_paid_order)·출고지시 완료 기록·배송 상태 전이·배송 방식·예약 할당 등 출고 경로 공통 검사.
select private.t1_hold_patch_function('private.assert_order_dispatch_allowed(uuid)'::regprocedure, array[
$a$    raise check_violation using message='order cancellation in progress';
  end if;$a$,
$a$    raise check_violation using message='order cancellation in progress';
  end if;
  -- 출고 보류(테스트 키 결제·결제사 직접 취소)가 있으면 발주확인·출고·발송·배송완료를 막는다.
  if private.order_fulfillment_held(target_order) then
    raise check_violation using message='order fulfillment hold';
  end if;$a$
]);

alter table private.auto_order_confirmation_outcomes drop constraint auto_order_confirmation_outcomes_outcome_check;
alter table private.auto_order_confirmation_outcomes add constraint auto_order_confirmation_outcomes_outcome_check
  check (outcome in ('confirmed', 'cancellation_in_progress', 'fulfillment_hold', 'preorder_unallocated', 'status_changed', 'locked', 'failed'));

select private.t1_hold_patch_function('private.auto_order_confirmation_blocker(uuid)'::regprocedure, array[
$a$ then 'cancellation_in_progress'$a$,
$a$ then 'cancellation_in_progress'
  when private.order_fulfillment_held(p_order_id) then 'fulfillment_hold'$a$
]);

select private.t1_hold_patch_function('public.admin_origin_pending_export_ids(uuid)'::regprocedure, array[
$a$   and not private.order_partial_cancel_in_flight(o.id)$a$,
$a$   and not private.order_partial_cancel_in_flight(o.id)
   and not private.order_fulfillment_held(o.id)$a$
]);

select private.t1_hold_patch_function('private.shipment_pack_ready(uuid)'::regprocedure, array[
$a$  or private.order_partial_cancel_in_flight(o.id)$a$,
$a$  or private.order_partial_cancel_in_flight(o.id)
  or private.order_fulfillment_held(o.id)$a$
]);

select private.t1_hold_patch_function('private.admin_shipment_export_before_preorder(uuid[])'::regprocedure, array[
$a$ or exists(select 1 from public.order_shipments s where s.id=any(target_ids) and private.order_partial_cancel_in_flight(s.order_id)) then raise check_violation using message='order cancellation in progress';end if;$a$,
$a$ or exists(select 1 from public.order_shipments s where s.id=any(target_ids) and private.order_partial_cancel_in_flight(s.order_id)) then raise check_violation using message='order cancellation in progress';end if;
 if exists(select 1 from public.order_shipments s where s.id=any(target_ids) and private.order_fulfillment_held(s.order_id)) then raise check_violation using message='order fulfillment hold';end if;$a$
]);

-- 거래확정(done)은 막지 않는다 — 자동 거래확정은 주문별 예외를 PC001·잠금만 삼켜, 여기서 막으면 묶음 전체가 실패한다.
select private.t1_hold_patch_function('public.guard_order_transition_during_cancellation()'::regprocedure, array[
$a$  -- 결제사 확인을 기다리는 재고 부족 부분 취소(ADR-0032)가 있으면 발송·배송완료로 넘어가지 않는다.$a$,
$a$  -- 출고 보류(테스트 키 결제·결제사 직접 취소)가 있으면 발송·배송완료로 넘어가지 않는다.
  if new.status is distinct from old.status and new.status in ('shipping', 'delivered')
    and private.order_fulfillment_held(old.id) then
    raise exception using errcode = '23514', message = 'order fulfillment hold';
  end if;
  -- 결제사 확인을 기다리는 재고 부족 부분 취소(ADR-0032)가 있으면 발송·배송완료로 넘어가지 않는다.$a$
]);

-- 운영 할 일(운영 알림 패널)에 보류 건수. 주문 조회 권한(sales.read)에게 보인다.
select private.t1_hold_patch_function('public.admin_operation_tasks()'::regprocedure, array[
$a$'href','/admin/sales/orders?status=paid') payload where public.has_operator_capability('sales.read')$a$,
$a$'href','/admin/sales/orders?status=paid') payload where public.has_operator_capability('sales.read')
 union all
select 1.5,jsonb_build_object('id','fulfillment_hold','label','출고 보류','count',(select count(*) from private.order_fulfillment_held_orders()),'href','/admin/sales/orders') where public.has_operator_capability('sales.read')$a$
]);

-- 10. 새 RPC·재정의한 함수의 운영자 계약(분류는 기존 행 그대로).
select private.register_operator_rpc_contract('public.admin_order_fulfillment_holds(uuid[])'::regprocedure, 'sales.read', 'read', false);
select private.register_operator_rpc_contract('public.admin_list_order_fulfillment_holds(integer)'::regprocedure, 'sales.read', 'read', false);
select private.register_operator_rpc_contract('public.admin_shipment_fulfillment_hold_flags(uuid[])'::regprocedure, 'sales.dispatch', 'read', false);
select private.register_operator_rpc_contract('public.admin_release_order_fulfillment_hold(uuid,text,text,uuid)'::regprocedure, 'sales.manage', 'write', false);

do $$declare fn regprocedure; contract record; begin
  foreach fn in array array[
    'private.assert_order_dispatch_allowed(uuid)'::regprocedure,
    'private.auto_order_confirmation_blocker(uuid)'::regprocedure,
    'public.admin_origin_pending_export_ids(uuid)'::regprocedure,
    'private.shipment_pack_ready(uuid)'::regprocedure,
    'private.admin_shipment_export_before_preorder(uuid[])'::regprocedure,
    'public.guard_order_transition_during_cancellation()'::regprocedure,
    'public.admin_operation_tasks()'::regprocedure] loop
    select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure = fn;
    if found then perform private.register_operator_rpc_contract(fn, contract.capability, contract.guard_kind, contract.legacy_admin_only);
    elsif exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure = fn) then
      perform private.register_operator_internal_contract(fn);
    end if;
  end loop;
end $$;

drop function private.t1_hold_patch_function(regprocedure, text[]);

commit;
notify pgrst, 'reload schema';
