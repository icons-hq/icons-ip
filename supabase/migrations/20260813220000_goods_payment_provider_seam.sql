-- ==========================================================================
-- Goods checkout through the provider-neutral payment seam (#205)
--
-- The runtime provider remains explicitly unavailable until #207 installs the
-- rotated Korpay adapter and rollout gate. These service-only RPCs provide the
-- durable attempt/claim/finalization boundary exercised by the fake gateway.
-- No callback body or browser session can directly mark an order paid.
-- ==========================================================================

alter table public.payment_attempts
  add column callback_nonce_digest text,
  add constraint payment_attempts_callback_nonce_digest_valid check (
    callback_nonce_digest is null
    or callback_nonce_digest ~ '^[0-9a-f]{64}$'
  );

-- A goods order has one durable provider attempt. Later payment purposes own
-- their own cardinality contracts and are intentionally not constrained here.
create unique index payment_attempts_one_goods_order_idx
  on public.payment_attempts (ref_id)
  where purpose = 'order' and ref_id is not null;

create function private.goods_payment_attempt_json(
  p_attempt public.payment_attempts
)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'id', p_attempt.id,
    'provider', p_attempt.provider,
    'purpose', p_attempt.purpose,
    'ref_id', p_attempt.ref_id,
    'amount', p_attempt.amount,
    'currency', p_attempt.currency,
    'idempotency_key', p_attempt.idempotency_key,
    'provider_order_id', p_attempt.provider_order_id,
    'provider_product_code', p_attempt.provider_product_code,
    'expires_at', p_attempt.expires_at
  );
$function$;

create function private.goods_order_snapshot_matches(
  p_order_id uuid,
  p_total bigint,
  p_shipping_fee bigint
)
returns boolean
language sql
stable
set search_path = ''
as $function$
  select
    pg_catalog.count(*) > 0
    and coalesce(
      pg_catalog.sum(item.qty::bigint * item.unit_price::bigint),
      0
    ) + p_shipping_fee = p_total
  from public.order_items as item
  where item.order_id = p_order_id;
$function$;

revoke all on function private.goods_payment_attempt_json(public.payment_attempts)
  from public, anon, authenticated, service_role;
revoke all on function private.goods_order_snapshot_matches(uuid, bigint, bigint)
  from public, anon, authenticated, service_role;

-- The application passes the authenticated user id through a service-role
-- adapter. Ownership, suspension, deletion fence, amount, order snapshot, and
-- reservation state are revalidated under the order row lock.
create function public.prepare_goods_payment_attempt(
  p_user_id uuid,
  p_order_id uuid,
  p_provider public.payment_provider
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_order public.orders%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_attempt_id uuid;
  v_attempt_expires_at timestamptz;
begin
  if p_user_id is null or p_order_id is null or p_provider is distinct from 'korpay' then
    raise exception 'goods_payment_unavailable' using errcode = '55000';
  end if;

  select order_record.*
  into v_order
  from public.orders as order_record
  where order_record.id = p_order_id
  for update;

  if not found or v_order.user_id is distinct from p_user_id then
    raise no_data_found using message = 'goods_order_not_found';
  end if;

  if v_order.status is distinct from 'pending'
    or v_order.expires_at is null
    or v_order.expires_at <= pg_catalog.clock_timestamp()
    or v_order.total <= 0
  then
    raise object_not_in_prerequisite_state using message = 'goods_order_not_payable';
  end if;

  if private.is_account_write_fenced(p_user_id)
    or exists (
      select 1
      from public.profiles as profile
      where profile.id = p_user_id
        and profile.suspended_at is not null
    )
  then
    raise insufficient_privilege using message = 'goods_payment_account_blocked';
  end if;

  if not private.goods_order_snapshot_matches(
    v_order.id,
    v_order.total,
    v_order.shipping_fee
  ) then
    raise check_violation using message = 'goods_order_snapshot_mismatch';
  end if;

  if exists (
    select 1
    from public.order_cancellation_requests as request
    where request.order_id = v_order.id
      and request.status in ('requested', 'processing', 'needs_review')
  ) or exists (
    select 1
    from public.payments as payment
    where payment.purpose = 'order'
      and payment.ref_id = v_order.id
      and payment.status in ('pending', 'paid')
  ) then
    raise object_not_in_prerequisite_state using message = 'goods_order_not_payable';
  end if;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.purpose = 'order'
    and attempt.ref_id = v_order.id
  for update;

  if found then
    if v_attempt.user_id is distinct from p_user_id
      or v_attempt.provider is distinct from p_provider
      or v_attempt.amount is distinct from v_order.total
      or v_attempt.currency is distinct from 'KRW'
      or v_attempt.state is distinct from 'prepared'
      or v_attempt.expires_at <= pg_catalog.clock_timestamp()
    then
      raise object_not_in_prerequisite_state using message = 'goods_payment_attempt_not_preparable';
    end if;
    return private.goods_payment_attempt_json(v_attempt);
  end if;

  v_attempt_id := extensions.gen_random_uuid();
  v_attempt_expires_at := least(
    v_order.expires_at,
    pg_catalog.clock_timestamp() + interval '10 minutes'
  );

  insert into public.payment_attempts (
    id,
    provider,
    user_id,
    purpose,
    ref_id,
    amount,
    currency,
    state,
    idempotency_key,
    provider_order_id,
    provider_product_code,
    expires_at
  )
  values (
    v_attempt_id,
    p_provider,
    p_user_id,
    'order',
    v_order.id,
    v_order.total,
    'KRW',
    'prepared',
    'goods:' || v_order.id::text,
    'O' || pg_catalog.replace(v_attempt_id::text, '-', ''),
    'P' || pg_catalog.replace(v_attempt_id::text, '-', ''),
    v_attempt_expires_at
  )
  returning * into v_attempt;

  return private.goods_payment_attempt_json(v_attempt);
end;
$function$;

-- Only a SHA-256 digest crosses into the ledger. Repeated prepare calls may
-- bind the same nonce, while a provider adapter producing a different nonce
-- for the same idempotency key fails closed.
create function public.bind_goods_payment_callback_nonce(
  p_attempt_id uuid,
  p_callback_nonce_digest text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_attempt public.payment_attempts%rowtype;
begin
  if p_attempt_id is null
    or p_callback_nonce_digest is null
    or p_callback_nonce_digest !~ '^[0-9a-f]{64}$'
  then
    raise invalid_parameter_value using message = 'goods_payment_nonce_invalid';
  end if;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.purpose = 'order'
  for update;

  if not found or v_attempt.provider is distinct from 'korpay' then
    raise no_data_found using message = 'goods_payment_attempt_not_found';
  end if;

  if v_attempt.state is distinct from 'prepared'
    or v_attempt.expires_at <= pg_catalog.clock_timestamp()
  then
    raise object_not_in_prerequisite_state using message = 'goods_payment_attempt_not_preparable';
  end if;

  if v_attempt.callback_nonce_digest is null then
    update public.payment_attempts
    set callback_nonce_digest = p_callback_nonce_digest
    where id = v_attempt.id;
  elsif v_attempt.callback_nonce_digest is distinct from p_callback_nonce_digest then
    raise unique_violation using message = 'goods_payment_nonce_conflict';
  end if;
end;
$function$;

-- Callback lookup is session independent: provider order id + nonce digest
-- locate and atomically claim the attempt before any provider network call.
create function public.claim_goods_payment_attempt(
  p_provider public.payment_provider,
  p_provider_order_id text,
  p_callback_nonce_digest text,
  p_claim_token uuid
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
  if p_provider is distinct from 'korpay'
    or p_provider_order_id is null
    or pg_catalog.length(p_provider_order_id) not between 1 and 200
    or p_callback_nonce_digest is null
    or p_callback_nonce_digest !~ '^[0-9a-f]{64}$'
    or p_claim_token is null
  then
    raise invalid_parameter_value using message = 'goods_payment_callback_invalid';
  end if;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.provider = p_provider
    and attempt.provider_order_id = p_provider_order_id
    and attempt.purpose = 'order';

  if not found
    or v_attempt.callback_nonce_digest is null
    or v_attempt.callback_nonce_digest is distinct from p_callback_nonce_digest
  then
    raise no_data_found using message = 'goods_payment_callback_invalid';
  end if;

  if v_attempt.state in ('approved', 'declined', 'canceled', 'unknown', 'needs_review') then
    return pg_catalog.jsonb_build_object(
      'claim_status', 'terminal',
      'attempt', private.goods_payment_attempt_json(v_attempt),
      'outcome', v_attempt.state
    );
  end if;

  if v_attempt.state = 'confirming' then
    return pg_catalog.jsonb_build_object(
      'claim_status', 'in_progress',
      'attempt', private.goods_payment_attempt_json(v_attempt)
    );
  end if;

  if v_attempt.state is distinct from 'prepared'
    or v_attempt.expires_at <= pg_catalog.clock_timestamp()
  then
    raise object_not_in_prerequisite_state using message = 'goods_payment_attempt_expired';
  end if;

  -- All goods transitions lock order before attempt. This matches prepare,
  -- cancellation, and expiry ordering and avoids an order/attempt deadlock.
  select order_record.*
  into v_order
  from public.orders as order_record
  where order_record.id = v_attempt.ref_id
  for update;

  if not found then
    raise no_data_found using message = 'goods_order_not_found';
  end if;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.provider = p_provider
    and attempt.provider_order_id = p_provider_order_id
    and attempt.purpose = 'order'
  for update;

  if not found
    or v_attempt.callback_nonce_digest is null
    or v_attempt.callback_nonce_digest is distinct from p_callback_nonce_digest
  then
    raise no_data_found using message = 'goods_payment_callback_invalid';
  end if;

  if v_attempt.state in ('approved', 'declined', 'canceled', 'unknown', 'needs_review') then
    return pg_catalog.jsonb_build_object(
      'claim_status', 'terminal',
      'attempt', private.goods_payment_attempt_json(v_attempt),
      'outcome', v_attempt.state
    );
  end if;

  if v_attempt.state = 'confirming' then
    return pg_catalog.jsonb_build_object(
      'claim_status', 'in_progress',
      'attempt', private.goods_payment_attempt_json(v_attempt)
    );
  end if;

  if v_attempt.state is distinct from 'prepared'
    or v_attempt.expires_at <= pg_catalog.clock_timestamp()
  then
    raise object_not_in_prerequisite_state using message = 'goods_payment_attempt_expired';
  end if;

  if v_order.user_id is distinct from v_attempt.user_id
    or v_order.status is distinct from 'pending'
    or v_order.expires_at is null
    or v_order.expires_at <= pg_catalog.clock_timestamp()
    or v_order.total is distinct from v_attempt.amount
    or v_attempt.currency is distinct from 'KRW'
    or private.is_account_write_fenced(v_attempt.user_id)
    or exists (
      select 1
      from public.profiles as profile
      where profile.id = v_attempt.user_id
        and profile.suspended_at is not null
    )
    or not private.goods_order_snapshot_matches(
      v_order.id,
      v_order.total,
      v_order.shipping_fee
    )
    or exists (
      select 1
      from public.order_cancellation_requests as request
      where request.order_id = v_order.id
        and request.status in ('requested', 'processing', 'needs_review')
    )
    or exists (
      select 1
      from public.payments as payment
      where payment.purpose = 'order'
        and payment.ref_id = v_order.id
        and payment.status in ('pending', 'paid')
    )
  then
    raise object_not_in_prerequisite_state using message = 'goods_order_not_payable';
  end if;

  update public.payment_attempts
  set
    state = 'confirming',
    claim_token = p_claim_token,
    claim_expires_at = pg_catalog.clock_timestamp() + interval '10 minutes'
  where id = v_attempt.id
  returning * into v_attempt;

  return pg_catalog.jsonb_build_object(
    'claim_status', 'claimed',
    'attempt', private.goods_payment_attempt_json(v_attempt)
  );
end;
$function$;

-- A claimed attempt is the only route to a terminal state. Provider fields are
-- allowlisted scalars; raw callback or confirm bodies have no parameter and can
-- never reach either public.payments.raw or private evidence storage.
create function public.finalize_goods_payment_attempt(
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
  v_attempt public.payment_attempts%rowtype;
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_final_outcome public.payment_attempt_state;
  v_payment_key text;
begin
  if p_attempt_id is null
    or p_claim_token is null
    or p_outcome is null
    or p_outcome not in ('approved', 'declined', 'canceled', 'unknown', 'needs_review')
  then
    raise invalid_parameter_value using message = 'goods_payment_finalization_invalid';
  end if;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.purpose = 'order'
    and attempt.provider = 'korpay';

  if not found then
    raise no_data_found using message = 'goods_payment_attempt_not_found';
  end if;

  -- Lost DB responses replay the already committed terminal state instead of
  -- repeating provider or fulfillment work.
  if v_attempt.state in ('approved', 'declined', 'canceled', 'unknown', 'needs_review') then
    return v_attempt.state;
  end if;

  select order_record.*
  into v_order
  from public.orders as order_record
  where order_record.id = v_attempt.ref_id
  for update;

  if not found then
    raise no_data_found using message = 'goods_order_not_found';
  end if;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.purpose = 'order'
    and attempt.provider = 'korpay'
  for update;

  if not found then
    raise no_data_found using message = 'goods_payment_attempt_not_found';
  end if;

  if v_attempt.state in ('approved', 'declined', 'canceled', 'unknown', 'needs_review') then
    return v_attempt.state;
  end if;

  if v_attempt.state is distinct from 'confirming'
    or v_attempt.claim_token is distinct from p_claim_token
  then
    raise object_not_in_prerequisite_state using message = 'goods_payment_claim_invalid';
  end if;

  v_final_outcome := p_outcome;
  v_payment_key := coalesce(
    nullif(pg_catalog.btrim(p_provider_payment_key), ''),
    nullif(pg_catalog.btrim(p_provider_transaction_id), '')
  );

  if p_outcome = 'approved' then
    -- Expiry is intentionally absent here. Once a valid callback claimed the
    -- attempt, provider finalization may finish after either expiry timestamp.
    if v_payment_key is null
      or v_order.user_id is distinct from v_attempt.user_id
      or v_order.status is distinct from 'pending'
      or v_order.total is distinct from v_attempt.amount
      or v_attempt.currency is distinct from 'KRW'
      or private.is_account_write_fenced(v_attempt.user_id)
      or exists (
        select 1
        from public.profiles as profile
        where profile.id = v_attempt.user_id
          and profile.suspended_at is not null
      )
      or not private.goods_order_snapshot_matches(
        v_order.id,
        v_order.total,
        v_order.shipping_fee
      )
      or exists (
        select 1
        from public.order_cancellation_requests as request
        where request.order_id = v_order.id
          and request.status in ('requested', 'processing', 'needs_review')
      )
      or exists (
        select 1
        from public.payments as payment
        where payment.purpose = 'order'
          and payment.ref_id = v_order.id
          and payment.status in ('pending', 'paid')
          and payment.idempotency_key <> 'attempt:' || v_attempt.id::text
      )
      or (
        v_payment_key is not null
        and exists (
          select 1
          from public.payments as payment
          where payment.payment_key = v_payment_key
            and payment.idempotency_key <> 'attempt:' || v_attempt.id::text
        )
      )
    then
      v_final_outcome := 'needs_review';
    end if;
  end if;

  if v_final_outcome = 'approved' then
    select payment.*
    into v_payment
    from public.payments as payment
    where payment.idempotency_key = 'attempt:' || v_attempt.id::text
    for update;

    if found then
      if v_payment.user_id is distinct from v_attempt.user_id
        or v_payment.purpose is distinct from 'order'
        or v_payment.ref_id is distinct from v_attempt.ref_id
        or v_payment.amount is distinct from v_attempt.amount
        or v_payment.provider is distinct from v_attempt.provider
        or v_payment.payment_key is distinct from v_payment_key
        or v_payment.status not in ('pending', 'paid')
        or v_payment.raw is not null
      then
        v_final_outcome := 'needs_review';
      end if;
    else
      begin
        insert into public.payments (
          user_id,
          purpose,
          ref_id,
          provider,
          amount,
          status,
          payment_key,
          idempotency_key,
          raw
        )
        values (
          v_attempt.user_id,
          'order',
          v_attempt.ref_id,
          v_attempt.provider,
          v_attempt.amount,
          'paid',
          v_payment_key,
          'attempt:' || v_attempt.id::text,
          null
        )
        returning * into v_payment;
      exception
        when unique_violation then
          -- A provider identifier racing across two orders is ambiguous. The
          -- inner subtransaction rolls back only this insert and preserves the
          -- claimed attempt for explicit reconciliation.
          v_final_outcome := 'needs_review';
      end;
    end if;
  end if;

  if v_final_outcome = 'approved' then
    update public.payments
    set status = 'paid'
    where id = v_payment.id;

    update public.orders
    set status = 'paid', expires_at = null
    where id = v_attempt.ref_id;

    -- Preserve the existing free-reward side effect. The independent global
    -- reward trigger remains OFF and suppresses inserts without rolling back a
    -- valid goods payment.
    insert into public.draw_tickets (
      user_id,
      pool_id,
      source,
      source_id,
      ordinal,
      reward_policy_id
    )
    select
      v_attempt.user_id,
      reward_policy.pool_id,
      'order_paid',
      v_attempt.ref_id,
      pg_catalog.row_number() over (
        order by reward_policy.id, grant_series.n
      ),
      reward_policy.id
    from public.reward_policies as reward_policy
    join public.card_pools as card_pool
      on card_pool.id = reward_policy.pool_id
    join lateral (
      select pg_catalog.sum(item.qty * item.unit_price) as target_subtotal
      from public.order_items as item
      where item.order_id = v_attempt.ref_id
        and item.good_ip_id_snapshot = reward_policy.target_ip_id
        and (
          reward_policy.target_good_id is null
          or item.good_id = reward_policy.target_good_id
        )
    ) as subtotal on true
    cross join lateral pg_catalog.generate_series(
      1,
      reward_policy.tickets_per_grant
    ) as grant_series(n)
    where reward_policy.trigger = 'order_paid'
      and reward_policy.active
      and subtotal.target_subtotal is not null
      and subtotal.target_subtotal >= reward_policy.min_amount
      and pg_catalog.now() >= reward_policy.active_from
      and (reward_policy.active_to is null or pg_catalog.now() < reward_policy.active_to)
      and pg_catalog.now() >= card_pool.active_from
      and (card_pool.active_to is null or pg_catalog.now() < card_pool.active_to)
    on conflict (source, source_id, ordinal) do nothing;
  end if;

  if p_provider_payment_key is not null
    or p_provider_transaction_id is not null
    or p_provider_approval_reference is not null
    or p_result_code is not null
    or p_payment_method is not null
    or p_masked_payment_method is not null
    or p_approved_at is not null
  then
    insert into private.payment_provider_evidence (
      payment_attempt_id,
      evidence_kind,
      provider_payment_key,
      provider_transaction_id,
      provider_approval_reference,
      result_code,
      payment_method,
      masked_payment_method,
      approved_at
    )
    values (
      v_attempt.id,
      'confirm_' || p_outcome::text,
      p_provider_payment_key,
      p_provider_transaction_id,
      p_provider_approval_reference,
      p_result_code,
      p_payment_method,
      p_masked_payment_method,
      p_approved_at
    );
  end if;

  update public.payment_attempts
  set
    state = v_final_outcome,
    payment_id = case
      when v_final_outcome = 'approved' then v_payment.id
      else payment_id
    end,
    claim_token = null,
    claim_expires_at = null
  where id = v_attempt.id;

  return v_final_outcome;
end;
$function$;

revoke all on function public.prepare_goods_payment_attempt(
  uuid, uuid, public.payment_provider
) from public, anon, authenticated, service_role;
grant execute on function public.prepare_goods_payment_attempt(
  uuid, uuid, public.payment_provider
) to service_role;

revoke all on function public.bind_goods_payment_callback_nonce(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.bind_goods_payment_callback_nonce(uuid, text)
  to service_role;

revoke all on function public.claim_goods_payment_attempt(
  public.payment_provider, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.claim_goods_payment_attempt(
  public.payment_provider, text, text, uuid
) to service_role;

revoke all on function public.finalize_goods_payment_attempt(
  uuid,
  uuid,
  public.payment_attempt_state,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.finalize_goods_payment_attempt(
  uuid,
  uuid,
  public.payment_attempt_state,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz
) to service_role;

-- Keep the latest ticket sweep unchanged and add only the attempt states that
-- must retain a goods reservation for reconciliation. Prepared/declined/
-- canceled attempts may expire through the existing inventory restore path.
create or replace function public.expire_stale_checkouts()
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_count integer := 0;
  r record;
begin
  for r in
    select orders.id
    from public.orders
    where orders.status = 'pending'
      and orders.expires_at is not null
      and orders.expires_at < now() - interval '5 minutes'
      and not exists (
        select 1
        from public.payments as payment
        where payment.purpose = 'order'
          and payment.ref_id = orders.id
          and payment.status in ('pending', 'paid')
      )
      and not exists (
        select 1
        from public.order_cancellation_requests as request
        where request.order_id = orders.id
          and request.status in ('requested', 'processing', 'needs_review')
      )
      and not exists (
        select 1
        from public.payment_attempts as attempt
        where attempt.purpose = 'order'
          and attempt.ref_id = orders.id
          and attempt.state in ('confirming', 'unknown', 'needs_review', 'approved')
      )
    order by orders.expires_at
    limit 200
    for update of orders skip locked
  loop
    perform public.cancel_order(r.id, '결제 시간 만료 자동 취소');
    v_count := v_count + 1;
  end loop;

  for r in
    select ticket_orders.id
    from public.ticket_orders
    where ticket_orders.status = 'pending'
      and ticket_orders.expires_at is not null
      and ticket_orders.expires_at < now() - interval '5 minutes'
      and not exists (
        select 1
        from public.payments as payment
        where payment.purpose = 'ticket'
          and payment.ref_id = ticket_orders.id
          and payment.status in ('pending', 'paid')
      )
      and not exists (
        select 1
        from public.ticket_cancellation_requests as request
        where request.ticket_order_id = ticket_orders.id
          and request.status in ('requested', 'processing', 'needs_review')
      )
    order by ticket_orders.expires_at
    limit 200
    for update of ticket_orders skip locked
  loop
    perform public.refund_ticket_order(r.id, '결제 시간 만료 자동 취소');
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

revoke all on function public.expire_stale_checkouts()
  from public, anon, authenticated, service_role;
grant execute on function public.expire_stale_checkouts()
  to service_role;
