-- ==========================================================================
-- ICONS · 계좌수집 입금 내역과 매칭 제안 (#257)
--
-- #256이 만든 수동 대조 콘솔 위에 얹는다. 계약(#255)이 끝나기 전이라 실제
-- provider 어댑터는 없고, 이 마이그레이션은 **적재 표면과 매칭 규칙**만 고정한다.
--
-- 이 마이그레이션이 DB 안에서 고정하는 것:
--   1. 같은 입금은 두 번 적재되지 않는다 — (source, external_id)가 유일하다
--      (장애 뒤 재수집이 안전해야 폴링이든 웹훅이든 그대로 다시 돌릴 수 있다)
--   2. 자동으로 확정하지 않는다 — 매칭은 *제안*이고 확정은 사람이 누른다
--   3. 확정은 #256의 admin_confirm_bank_transfer_deposit 한 경로만 쓴다
--   4. 입금 원문 payload는 저장하지 않는다 — 대조에 필요한 필드만 남긴다
-- ==========================================================================

create type public.bank_deposit_status as enum ('unmatched', 'matched', 'ignored');

create table public.bank_deposits (
  id             uuid primary key default extensions.gen_random_uuid(),
  -- 어댑터 이름. 계약 전에는 'fake'만 들어온다. provider가 정해지면 값이 하나
  -- 늘 뿐 스키마는 그대로다.
  source         text not null,
  -- provider가 그 입금에 붙인 고유 식별자. 재수집 멱등의 유일한 근거다.
  external_id    text not null,
  deposited_at   timestamptz not null,
  depositor_name text not null,
  amount         bigint not null,
  -- provider 원문 참조(적요·거래번호 등 사람이 은행 앱에서 되짚을 문자열).
  -- 원문 payload 전체는 담지 않는다 — 대조에 쓰지 않는 값을 보관할 이유가 없다.
  raw_reference  text,
  status         public.bank_deposit_status not null default 'unmatched',
  matched_order_id uuid references public.orders (id),
  matched_at     timestamptz,
  decided_by     uuid references public.profiles (id),
  decision_note  text,
  created_at     timestamptz not null default now(),
  constraint bank_deposits_identity_unique unique (source, external_id),
  constraint bank_deposits_amount_positive check (amount > 0),
  constraint bank_deposits_matched_shape check (
    (status = 'matched') = (matched_order_id is not null)
  )
);

create index bank_deposits_queue_idx
  on public.bank_deposits (status, deposited_at desc);

alter table public.bank_deposits enable row level security;

create policy bank_deposits_staff_read
on public.bank_deposits
for select
to authenticated
using ((select public.is_staff()));

revoke all on table public.bank_deposits
  from public, anon, authenticated, service_role;
grant select on table public.bank_deposits to authenticated;

-- ---------------------------------------------------------------------------
-- 1. 적재 — 멱등
-- ---------------------------------------------------------------------------
-- 서버 어댑터(service role)만 부른다. 같은 배치를 몇 번 흘려도 결과가 같아야
-- 폴링 중복·웹훅 재전송·장애 뒤 재수집이 모두 안전하다.
create function public.record_bank_deposits(
  p_source text,
  p_deposits jsonb
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_source text := nullif(btrim(coalesce(p_source, '')), '');
  v_inserted integer := 0;
begin
  if v_source is null or char_length(v_source) > 40 then
    raise invalid_parameter_value using message = 'invalid_deposit_source';
  end if;

  if p_deposits is null or jsonb_typeof(p_deposits) <> 'array' then
    raise invalid_parameter_value using message = 'invalid_deposit_batch';
  end if;

  with candidate as (
    select
      nullif(btrim(entry ->> 'externalId'), '') as external_id,
      (entry ->> 'depositedAt')::timestamptz as deposited_at,
      nullif(btrim(entry ->> 'depositorName'), '') as depositor_name,
      (entry ->> 'amount')::bigint as amount,
      nullif(btrim(coalesce(entry ->> 'rawReference', '')), '') as raw_reference
    from jsonb_array_elements(p_deposits) as entry
  ),
  inserted as (
    insert into public.bank_deposits (
      source, external_id, deposited_at, depositor_name, amount, raw_reference
    )
    select
      v_source,
      candidate.external_id,
      candidate.deposited_at,
      candidate.depositor_name,
      candidate.amount,
      candidate.raw_reference
    from candidate
    where candidate.external_id is not null
      and candidate.deposited_at is not null
      and candidate.depositor_name is not null
      and candidate.amount > 0
    -- 이미 본 입금은 조용히 넘어간다. 두 번째 적재가 오류가 되면 재수집이
    -- 배치 하나 때문에 통째로 실패한다.
    on conflict (source, external_id) do nothing
    returning 1
  )
  select count(*)::integer into v_inserted from inserted;

  return v_inserted;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. 매칭 제안
-- ---------------------------------------------------------------------------
-- 제안이지 확정이 아니다. 확정은 운영자가 금액까지 보고 누른다.
--
-- 우선순위:
--   ① 입금자명 안에 주문코드가 있다 — 안내대로 적은 경우다. 금액까지 같으면
--      'code_amount', 금액이 다르면 'code'로 남긴다(부분 입금·수수료 차감).
--   ② 금액이 같고 입금자명이 수령인 이름으로 시작한다 — 코드를 빠뜨린 경우다.
--      동명이인이면 후보가 여럿이므로 제안하지 않는다.
--   ③ 없으면 제안 없음. 억지 제안은 잘못된 확정을 부른다.
create function private.suggest_bank_deposit_order(
  p_depositor_name text,
  p_amount bigint
)
returns table (order_id uuid, confidence text)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  with normalized as (
    select upper(regexp_replace(coalesce(p_depositor_name, ''), '\s', '', 'g')) as name
  ),
  candidate as (
    select
      orders.id,
      orders.total,
      private.bank_transfer_deposit_code(orders.id) as code,
      upper(regexp_replace(
        coalesce(orders.address ->> 'recipientName', ''), '\s', '', 'g'
      )) as recipient
    from public.orders, normalized
    where orders.status = 'pending'
      and orders.payment_method = 'bank_transfer'
  ),
  by_code as (
    select
      candidate.id,
      case when candidate.total = p_amount then 'code_amount' else 'code' end as confidence
    from candidate, normalized
    where position(candidate.code in normalized.name) > 0
  ),
  by_amount as (
    select candidate.id, 'amount_name'::text as confidence
    from candidate, normalized
    where candidate.total = p_amount
      and candidate.recipient <> ''
      and position(candidate.recipient in normalized.name) > 0
      -- 동명이인·같은 금액이 둘 이상이면 사람이 골라야 한다.
      and (
        select count(*)
        from candidate as peer, normalized as peer_name
        where peer.total = p_amount
          and peer.recipient <> ''
          and position(peer.recipient in peer_name.name) > 0
      ) = 1
  )
  select id, confidence from by_code
  union all
  select id, confidence from by_amount where not exists (select 1 from by_code)
  limit 1;
$function$;

revoke all on function private.suggest_bank_deposit_order(text, bigint)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. 콘솔 목록
-- ---------------------------------------------------------------------------
create function public.admin_bank_deposit_queue(
  p_status public.bank_deposit_status default 'unmatched',
  p_limit integer default 30
)
returns table (
  deposit_id uuid,
  source text,
  external_id text,
  deposited_at timestamptz,
  depositor_name text,
  amount bigint,
  raw_reference text,
  status public.bank_deposit_status,
  matched_order_id uuid,
  suggested_order_id uuid,
  suggested_order_code text,
  suggested_confidence text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 200);
begin
  if not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  return query
  select
    deposit.id,
    deposit.source,
    deposit.external_id,
    deposit.deposited_at,
    deposit.depositor_name,
    deposit.amount,
    deposit.raw_reference,
    deposit.status,
    deposit.matched_order_id,
    suggestion.order_id,
    case
      when suggestion.order_id is null then null
      else private.bank_transfer_deposit_code(suggestion.order_id)
    end,
    suggestion.confidence
  from public.bank_deposits as deposit
  left join lateral private.suggest_bank_deposit_order(
    deposit.depositor_name,
    deposit.amount
  ) as suggestion on deposit.status = 'unmatched'
  where deposit.status = coalesce(p_status, 'unmatched')
  order by deposit.deposited_at desc
  limit v_limit;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. 확정 · 보류
-- ---------------------------------------------------------------------------
-- 확정은 #256의 경로를 그대로 쓴다. 여기서 orders를 직접 건드리면 무통장 확정이
-- 두 곳으로 갈라지고, 그 순간 증빙 없는 확정이 가능해진다.
create function public.admin_confirm_bank_deposit(
  p_deposit_id uuid,
  p_order_id uuid,
  p_memo text
)
returns public.payment_attempt_state
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_deposit public.bank_deposits%rowtype;
  v_outcome public.payment_attempt_state;
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  -- 잠금 순서: orders → bank_deposits → payment_attempts → payments.
  -- 주문을 먼저 잡아 #256의 확정·연장·취소와 같은 순서를 유지한다. 입금 행을
  -- 먼저 잡으면 같은 주문을 두 운영자가 서로 다른 순서로 잠가 교착이 난다.
  perform 1
  from public.orders
  where orders.id = p_order_id
  for update;

  select deposit.* into v_deposit
  from public.bank_deposits as deposit
  where deposit.id = p_deposit_id
  for update;

  if not found then
    raise no_data_found using message = 'deposit_not_found';
  end if;

  if v_deposit.status <> 'unmatched' then
    raise object_not_in_prerequisite_state using message = 'deposit_already_decided';
  end if;

  v_outcome := public.admin_confirm_bank_transfer_deposit(p_order_id, p_memo);

  -- finalizer가 approved가 아닌 값(needs_review 등)을 돌려주면 주문은 결제완료가
  -- 아니다. 그때 입금을 matched로 닫으면 "돈은 들어왔고 주문은 안 된" 건이
  -- 큐에서 사라진다 — 정합화가 끝날 때까지 큐에 남겨 둔다. attempt는 이미
  -- 종결 상태라 재확정은 막히고, 사람이 원장을 보고 처리해야 한다.
  if v_outcome = 'approved' then
    update public.bank_deposits
    set
      status = 'matched',
      matched_order_id = p_order_id,
      matched_at = now(),
      decided_by = v_actor,
      decision_note = btrim(coalesce(p_memo, ''))
    where id = v_deposit.id;
  else
    update public.bank_deposits
    set
      decided_by = v_actor,
      decision_note = btrim(coalesce(p_memo, ''))
        || ' / 확정 실패: ' || v_outcome::text
    where id = v_deposit.id;
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    case when v_outcome = 'approved'
      then 'admin.bank_deposit.matched'
      else 'admin.bank_deposit.match_failed'
    end,
    'order:' || p_order_id::text,
    jsonb_build_object(
      'depositId', v_deposit.id,
      'source', v_deposit.source,
      'externalId', v_deposit.external_id,
      'amount', v_deposit.amount,
      'depositorName', v_deposit.depositor_name,
      'outcome', v_outcome
    )
  );

  return v_outcome;
end;
$function$;

-- 미아 입금·환불 출금처럼 주문에 붙지 않는 기록을 큐에서 내린다. 지우지 않는
-- 이유는 반환 절차의 근거가 이 행이기 때문이다.
create function public.admin_ignore_bank_deposit(
  p_deposit_id uuid,
  p_reason text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if char_length(v_reason) not between 5 and 200 then
    raise check_violation using message = 'invalid ignore reason';
  end if;

  update public.bank_deposits
  set
    status = 'ignored',
    decided_by = v_actor,
    decision_note = v_reason
  where id = p_deposit_id
    and status = 'unmatched';

  if not found then
    raise no_data_found using message = 'deposit_not_ignorable';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.bank_deposit.ignored',
    'bank_deposit:' || p_deposit_id::text,
    jsonb_build_object('reason', v_reason)
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. ACL
-- ---------------------------------------------------------------------------
revoke all on function public.record_bank_deposits(text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.record_bank_deposits(text, jsonb)
  to service_role;

revoke all on function public.admin_bank_deposit_queue(public.bank_deposit_status, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_bank_deposit_queue(public.bank_deposit_status, integer)
  to authenticated;

revoke all on function public.admin_confirm_bank_deposit(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_confirm_bank_deposit(uuid, uuid, text)
  to authenticated;

revoke all on function public.admin_ignore_bank_deposit(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_ignore_bank_deposit(uuid, text)
  to authenticated;
