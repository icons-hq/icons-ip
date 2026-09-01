-- ==========================================================================
-- ICONS · 굿즈 결제 reconciliation seam 신설 (#390, 에픽 #384)
--
-- 굿즈 결제는 지금까지 콜백만 확정할 수 있었다. attempt를 선점하려면
-- callback_nonce_digest가 필요하고(claim_goods_payment_attempt), 그 nonce는
-- 브라우저 콜백 왕복에만 존재한다. 그래서 콜백이 유실되거나 provider 승인 뒤
-- finalize 전에 프로세스가 죽으면, 굿즈 attempt는 unknown·needs_review·만료된
-- confirming 리스에 갇힌 채 자동으로 되살릴 경로가 없다. 티켓 seam에는 nonce
-- 없이 서비스 롤이 그 모호 상태만 지목해 재정합화하는 claim/finalize 쌍이
-- 있지만 굿즈에는 없었다.
--
-- 토스 웹훅·reconcile(#390)은 굿즈와 티켓에서 같은 방식으로 동작해야 한다.
-- 웹훅은 nonce를 가지고 있지 않으므로, 굿즈에도 같은 seam이 있어야 웹훅과
-- 정합화 배치가 굿즈 주문을 종결할 수 있다.
--
-- 이 마이그레이션은 티켓 seam의 결제 대사 경로를 굿즈로 이식한 것이다.
-- 원본:
--   supabase/migrations/20260813230000_ticket_payment_provider_seam.sql
--     private.ticket_payment_reconciliation_audits ·
--     private.record_ticket_reconciliation_audit ·
--     public.finalize_ticket_payment_reconciliation
--   supabase/migrations/20260901100000_toss_provider_allowlist.sql
--     public.claim_ticket_payment_reconciliation (provider 허용목록 개방 최신본)
-- 이중 조회, 행 잠금 순서(주문 → 취소 요청 → attempt), terminal 재생,
-- in_progress 판정, 10분 리스는 원본 구조 그대로다. 바꾼 것은 도메인 치환
-- (ticket→goods, ticket_orders→orders, ticket_cancellation_requests→
-- order_cancellation_requests, purpose 'ticket'→'order')뿐이다.
--
-- 이식하지 않은 것: 환불 대사(claim/finalize_ticket_refund_reconciliation).
-- 굿즈 환불·취소 확정은 별도 수동복구 seam
-- (20260814030200_goods_payment_manual_cancellation_recovery.sql)이 이미
-- 소유하고 있어, 같은 대상에 두 개의 확정 경로를 만들지 않는다.
-- ==========================================================================

-- Payment reconciliation is a financially privileged, explicit staff action.
-- Keep only opaque URL-safe operator/case references and the converged common
-- outcome; email, provider payloads, and other PII are not accepted here.
create table private.goods_payment_reconciliation_audits (
  claim_token uuid primary key,
  operation text not null check (operation in ('payment', 'refund')),
  target_id uuid not null,
  actor_ref text not null check (actor_ref ~ '^[A-Za-z0-9_-]{16,128}$'),
  case_ref text not null check (case_ref ~ '^[A-Za-z0-9_-]{16,128}$'),
  claim_status text not null check (claim_status in ('claimed', 'in_progress', 'terminal')),
  outcome public.payment_attempt_state,
  requested_at timestamptz not null default now(),
  finalized_at timestamptz,
  check ((claim_status = 'terminal') = (outcome is not null)),
  check ((outcome is null) = (finalized_at is null))
);

alter table private.goods_payment_reconciliation_audits enable row level security;
revoke all on table private.goods_payment_reconciliation_audits
  from public, anon, authenticated, service_role;

create function private.record_goods_reconciliation_audit(
  p_claim_token uuid,
  p_operation text,
  p_target_id uuid,
  p_actor_ref text,
  p_case_ref text,
  p_claim_status text,
  p_outcome public.payment_attempt_state default null
)
returns void
language plpgsql
volatile
set search_path = ''
as $function$
declare
  v_audit private.goods_payment_reconciliation_audits%rowtype;
begin
  if p_claim_token is null
    or p_operation not in ('payment', 'refund')
    or p_target_id is null
    or p_actor_ref is null
    or p_actor_ref !~ '^[A-Za-z0-9_-]{16,128}$'
    or p_case_ref is null
    or p_case_ref !~ '^[A-Za-z0-9_-]{16,128}$'
    or p_claim_status not in ('claimed', 'in_progress', 'terminal')
    or ((p_claim_status = 'terminal') is distinct from (p_outcome is not null))
  then
    raise invalid_parameter_value using message = 'goods_reconciliation_audit_invalid';
  end if;

  insert into private.goods_payment_reconciliation_audits (
    claim_token,
    operation,
    target_id,
    actor_ref,
    case_ref,
    claim_status,
    outcome,
    finalized_at
  )
  values (
    p_claim_token,
    p_operation,
    p_target_id,
    p_actor_ref,
    p_case_ref,
    p_claim_status,
    p_outcome,
    case when p_outcome is null then null else pg_catalog.clock_timestamp() end
  )
  on conflict (claim_token) do nothing;

  select audit.*
  into strict v_audit
  from private.goods_payment_reconciliation_audits as audit
  where audit.claim_token = p_claim_token
  for update;

  if v_audit.operation is distinct from p_operation
    or v_audit.target_id is distinct from p_target_id
    or v_audit.actor_ref is distinct from p_actor_ref
    or v_audit.case_ref is distinct from p_case_ref
  then
    raise unique_violation using message = 'goods_reconciliation_audit_conflict';
  end if;

  if v_audit.claim_status <> 'terminal' then
    update private.goods_payment_reconciliation_audits
    set
      claim_status = p_claim_status,
      outcome = p_outcome,
      finalized_at = case
        when p_outcome is null then null
        else pg_catalog.clock_timestamp()
      end
    where claim_token = p_claim_token;
  end if;
end;
$function$;

revoke all on function private.record_goods_reconciliation_audit(
  uuid, text, uuid, text, text, text, public.payment_attempt_state
) from public, anon, authenticated, service_role;

-- Explicit staff reconciliation reclaims only ambiguous attempts (or a stale
-- confirming claim). It never scans or retries automatically: an authorized
-- service caller must name the attempt after reviewing the operational case.
create function public.claim_goods_payment_reconciliation(
  p_attempt_id uuid,
  p_claim_token uuid,
  p_case_ref text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_attempt public.payment_attempts%rowtype;
  v_order public.orders%rowtype;
begin
  if p_attempt_id is null
    or p_claim_token is null
    or p_case_ref is null
    or p_case_ref !~ '^[A-Za-z0-9_-]{16,128}$'
  then
    raise invalid_parameter_value using message = 'goods_reconciliation_claim_invalid';
  end if;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.purpose = 'order'
    and attempt.provider in ('toss', 'korpay');
  if not found then
    raise no_data_found using message = 'goods_payment_attempt_not_found';
  end if;

  if v_attempt.state in ('approved', 'declined', 'canceled') then
    perform private.record_goods_reconciliation_audit(
      p_claim_token,
      'payment',
      p_attempt_id,
      'goods_payment_reconciliation_service_v1',
      p_case_ref,
      'terminal',
      v_attempt.state
    );
    return pg_catalog.jsonb_build_object(
      'claim_status', 'terminal',
      'attempt', private.goods_payment_attempt_json(v_attempt),
      'outcome', v_attempt.state
    );
  end if;
  if v_attempt.state = 'confirming'
    and v_attempt.claim_expires_at is not null
    and v_attempt.claim_expires_at > pg_catalog.clock_timestamp()
  then
    perform private.record_goods_reconciliation_audit(
      p_claim_token,
      'payment',
      p_attempt_id,
      'goods_payment_reconciliation_service_v1',
      p_case_ref,
      'in_progress'
    );
    return pg_catalog.jsonb_build_object(
      'claim_status', 'in_progress',
      'attempt', private.goods_payment_attempt_json(v_attempt)
    );
  end if;

  select order_record.*
  into v_order
  from public.orders as order_record
  where order_record.id = v_attempt.ref_id
  for update;
  if not found then
    raise no_data_found using message = 'goods_order_not_found';
  end if;

  perform request.id
  from public.order_cancellation_requests as request
  where request.order_id = v_order.id
    and request.status in ('requested', 'processing', 'needs_review')
  order by request.requested_at desc, request.id
  for update of request;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.purpose = 'order'
    and attempt.provider in ('toss', 'korpay')
  for update;
  if not found then
    raise no_data_found using message = 'goods_payment_attempt_not_found';
  end if;

  if v_attempt.state in ('approved', 'declined', 'canceled') then
    perform private.record_goods_reconciliation_audit(
      p_claim_token,
      'payment',
      p_attempt_id,
      'goods_payment_reconciliation_service_v1',
      p_case_ref,
      'terminal',
      v_attempt.state
    );
    return pg_catalog.jsonb_build_object(
      'claim_status', 'terminal',
      'attempt', private.goods_payment_attempt_json(v_attempt),
      'outcome', v_attempt.state
    );
  end if;
  if v_attempt.state = 'confirming'
    and v_attempt.claim_expires_at is not null
    and v_attempt.claim_expires_at > pg_catalog.clock_timestamp()
  then
    perform private.record_goods_reconciliation_audit(
      p_claim_token,
      'payment',
      p_attempt_id,
      'goods_payment_reconciliation_service_v1',
      p_case_ref,
      'in_progress'
    );
    return pg_catalog.jsonb_build_object(
      'claim_status', 'in_progress',
      'attempt', private.goods_payment_attempt_json(v_attempt)
    );
  end if;
  if v_attempt.state not in ('unknown', 'needs_review', 'confirming') then
    raise object_not_in_prerequisite_state using message = 'goods_payment_not_reconcilable';
  end if;

  update public.payment_attempts
  set
    state = 'confirming',
    claim_token = p_claim_token,
    claim_expires_at = pg_catalog.clock_timestamp() + interval '10 minutes'
  where id = v_attempt.id
  returning * into v_attempt;

  perform private.record_goods_reconciliation_audit(
    p_claim_token,
    'payment',
    p_attempt_id,
    'goods_payment_reconciliation_service_v1',
    p_case_ref,
    'claimed'
  );

  return pg_catalog.jsonb_build_object(
    'claim_status', 'claimed',
    'attempt', private.goods_payment_attempt_json(v_attempt)
  );
end;
$function$;

create function public.finalize_goods_payment_reconciliation(
  p_attempt_id uuid,
  p_claim_token uuid,
  p_outcome public.payment_attempt_state,
  p_provider_payment_key text default null,
  p_provider_transaction_id text default null,
  p_provider_approval_reference text default null,
  p_result_code text default null,
  p_payment_method text default null,
  p_masked_payment_method text default null,
  p_approved_at timestamptz default null
)
returns public.payment_attempt_state
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_outcome public.payment_attempt_state;
begin
  v_outcome := public.finalize_goods_payment_attempt(
    p_attempt_id,
    p_claim_token,
    p_outcome,
    p_provider_payment_key,
    p_provider_transaction_id,
    p_provider_approval_reference,
    p_result_code,
    p_payment_method,
    p_masked_payment_method,
    p_approved_at
  );
  update private.goods_payment_reconciliation_audits
  set
    claim_status = 'terminal',
    outcome = v_outcome,
    finalized_at = pg_catalog.clock_timestamp()
  where claim_token = p_claim_token
    and operation = 'payment'
    and target_id = p_attempt_id;
  if not found then
    raise object_not_in_prerequisite_state using message = 'goods_reconciliation_audit_missing';
  end if;
  return v_outcome;
end;
$function$;

revoke all on function public.claim_goods_payment_reconciliation(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_goods_payment_reconciliation(uuid, uuid, text)
  to service_role;

revoke all on function public.finalize_goods_payment_reconciliation(
  uuid, uuid, public.payment_attempt_state, text, text, text, text, text, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.finalize_goods_payment_reconciliation(
  uuid, uuid, public.payment_attempt_state, text, text, text, text, text, text, timestamptz
) to service_role;
