\set ON_ERROR_STOP on

begin;

select 1 / case when (
  has_function_privilege(
    'service_role',
    'public.prepare_goods_payment_attempt(uuid,uuid,public.payment_provider)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.bind_goods_payment_callback_nonce(uuid,text)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.claim_goods_payment_attempt(public.payment_provider,text,text,uuid)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.finalize_goods_payment_attempt(uuid,uuid,public.payment_attempt_state,text,text,text,text,text,text,timestamptz)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.prepare_goods_payment_attempt(uuid,uuid,public.payment_provider)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.prepare_goods_payment_attempt(uuid,uuid,public.payment_provider)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.claim_goods_payment_attempt(public.payment_provider,text,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.finalize_goods_payment_attempt(uuid,uuid,public.payment_attempt_state,text,text,text,text,text,text,timestamptz)',
    'execute'
  )
) then 1 else 0 end as assert_goods_payment_rpcs_are_service_only;

select 1 / case when (
  not has_function_privilege(
    'service_role',
    'private.goods_payment_attempt_json(public.payment_attempts)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'private.goods_order_snapshot_matches(uuid,bigint,bigint)',
    'execute'
  )
) then 1 else 0 end as assert_goods_payment_helpers_are_private;

select 1 / case when (
  select data_type = 'text'
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'payment_attempts'
    and column_name = 'callback_nonce_digest'
) then 1 else 0 end as assert_callback_nonce_digest_is_durable;

select 1 / case when not exists (
  select 1
  from pg_catalog.pg_proc as procedure
  where procedure.oid = 'public.finalize_goods_payment_attempt(uuid,uuid,public.payment_attempt_state,text,text,text,text,text,text,timestamptz)'::regprocedure
    and exists (
      select 1
      from pg_catalog.unnest(procedure.proargnames) as argument(name)
      where argument.name ilike any(array['%raw%', '%payload%', '%response%'])
    )
) then 1 else 0 end as assert_finalizer_has_no_raw_payload_parameter;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000002051',
    'authenticated', 'authenticated', 'goods-payment-owner@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000002052',
    'authenticated', 'authenticated', 'goods-payment-other@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (
  id, email, nickname, birth_date, consents, onboarded_at
)
values
  (
    '00000000-0000-4000-8000-000000002051',
    'goods-payment-owner@example.test', 'goods_payment_owner', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now()
  ),
  (
    '00000000-0000-4000-8000-000000002052',
    'goods-payment-other@example.test', 'goods_payment_other', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now()
  )
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at,
  suspended_at = null,
  suspension_reason = null;

insert into public.verticals (key, label, color)
values ('goods-payment-seam-test', '굿즈 결제 seam 테스트', '#000000')
on conflict (key) do nothing;

insert into public.ips (id, title, vertical_key)
values ('goods-payment-seam-ip', '굿즈 결제 seam IP', 'goods-payment-seam-test')
on conflict (id) do update set title = excluded.title;

insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values (
  'goods-payment-seam-good',
  'goods-payment-seam-ip',
  '굿즈 결제 seam 상품',
  '테스트',
  28000,
  'ok',
  100
)
on conflict (id) do update set
  ip_id = excluded.ip_id,
  name = excluded.name,
  type = excluded.type,
  price = excluded.price,
  stock = excluded.stock,
  stock_qty = excluded.stock_qty;

insert into public.orders (
  id, user_id, status, total, shipping_fee, expires_at, checkout_key
)
values
  (
    '20000000-0000-4000-8000-000000002051',
    '00000000-0000-4000-8000-000000002051',
    'pending', 31000, 3000, now() + interval '15 minutes',
    '10000000-0000-4000-8000-000000002051'
  ),
  (
    '20000000-0000-4000-8000-000000002052',
    '00000000-0000-4000-8000-000000002051',
    'pending', 31000, 3000, now() + interval '15 minutes',
    '10000000-0000-4000-8000-000000002052'
  ),
  (
    '20000000-0000-4000-8000-000000002053',
    '00000000-0000-4000-8000-000000002051',
    'pending', 31000, 3000, now() + interval '15 minutes',
    '10000000-0000-4000-8000-000000002053'
  ),
  (
    '20000000-0000-4000-8000-000000002054',
    '00000000-0000-4000-8000-000000002051',
    'pending', 99999, 3000, now() + interval '15 minutes',
    '10000000-0000-4000-8000-000000002054'
  ),
  (
    '20000000-0000-4000-8000-000000002055',
    '00000000-0000-4000-8000-000000002051',
    'pending', 31000, 3000, now() + interval '15 minutes',
    '10000000-0000-4000-8000-000000002055'
  ),
  (
    '20000000-0000-4000-8000-000000002056',
    '00000000-0000-4000-8000-000000002051',
    'pending', 31000, 3000, now() + interval '15 minutes',
    '10000000-0000-4000-8000-000000002056'
  );

insert into public.order_items (
  order_id,
  good_id,
  qty,
  unit_price,
  good_name_snapshot,
  good_type_snapshot,
  good_ip_id_snapshot
)
select
  source.order_id,
  'goods-payment-seam-good',
  1,
  28000,
  '굿즈 결제 seam 상품',
  '테스트',
  'goods-payment-seam-ip'
from (
  values
    ('20000000-0000-4000-8000-000000002051'::uuid),
    ('20000000-0000-4000-8000-000000002052'::uuid),
    ('20000000-0000-4000-8000-000000002053'::uuid),
    ('20000000-0000-4000-8000-000000002054'::uuid),
    ('20000000-0000-4000-8000-000000002055'::uuid),
    ('20000000-0000-4000-8000-000000002056'::uuid)
) as source(order_id);

do $goods_payment_prepare_contract$
declare
  first_prepare jsonb;
  replay_prepare jsonb;
  owner_rejected boolean := false;
  toss_rejected boolean := false;
  snapshot_rejected boolean := false;
begin
  first_prepare := public.prepare_goods_payment_attempt(
    '00000000-0000-4000-8000-000000002051',
    '20000000-0000-4000-8000-000000002051',
    'korpay'
  );
  replay_prepare := public.prepare_goods_payment_attempt(
    '00000000-0000-4000-8000-000000002051',
    '20000000-0000-4000-8000-000000002051',
    'korpay'
  );

  if first_prepare ->> 'id' is distinct from replay_prepare ->> 'id'
    or first_prepare ->> 'provider' is distinct from 'korpay'
    or first_prepare ->> 'purpose' is distinct from 'order'
    or first_prepare ->> 'currency' is distinct from 'KRW'
    or (first_prepare ->> 'amount')::bigint <> 31000
    or first_prepare ->> 'provider_order_id' !~ '^O[0-9a-f]{32}$'
    or first_prepare ->> 'provider_product_code' !~ '^P[0-9a-f]{32}$'
  then
    raise exception 'prepared goods payment contract mismatch';
  end if;

  begin
    perform public.prepare_goods_payment_attempt(
      '00000000-0000-4000-8000-000000002052',
      '20000000-0000-4000-8000-000000002051',
      'korpay'
    );
  exception when no_data_found then
    owner_rejected := true;
  end;

  begin
    perform public.prepare_goods_payment_attempt(
      '00000000-0000-4000-8000-000000002051',
      '20000000-0000-4000-8000-000000002052',
      'toss'
    );
  exception when object_not_in_prerequisite_state then
    toss_rejected := true;
  end;

  begin
    perform public.prepare_goods_payment_attempt(
      '00000000-0000-4000-8000-000000002051',
      '20000000-0000-4000-8000-000000002054',
      'korpay'
    );
  exception when check_violation then
    snapshot_rejected := true;
  end;

  if not owner_rejected or not toss_rejected or not snapshot_rejected then
    raise exception 'goods payment server revalidation did not fail closed';
  end if;
end;
$goods_payment_prepare_contract$;

select 1 / case when (
  select count(*) = 1
  from public.payment_attempts
  where purpose = 'order'
    and ref_id = '20000000-0000-4000-8000-000000002051'
) then 1 else 0 end as assert_prepare_reuses_one_attempt;

select public.bind_goods_payment_callback_nonce(
  (
    select id
    from public.payment_attempts
    where ref_id = '20000000-0000-4000-8000-000000002051'
  ),
  repeat('a', 64)
);

select public.bind_goods_payment_callback_nonce(
  (
    select id
    from public.payment_attempts
    where ref_id = '20000000-0000-4000-8000-000000002051'
  ),
  repeat('a', 64)
);

do $goods_payment_nonce_contract$
declare
  conflict_rejected boolean := false;
  wrong_callback_rejected boolean := false;
  selected_attempt public.payment_attempts%rowtype;
begin
  select * into selected_attempt
  from public.payment_attempts
  where ref_id = '20000000-0000-4000-8000-000000002051';

  begin
    perform public.bind_goods_payment_callback_nonce(
      selected_attempt.id,
      repeat('b', 64)
    );
  exception when unique_violation then
    conflict_rejected := true;
  end;

  begin
    perform public.claim_goods_payment_attempt(
      'korpay',
      selected_attempt.provider_order_id,
      repeat('b', 64),
      '40000000-0000-4000-8000-000000002051'
    );
  exception when no_data_found then
    wrong_callback_rejected := true;
  end;

  if not conflict_rejected or not wrong_callback_rejected then
    raise exception 'callback nonce contract did not fail closed';
  end if;
end;
$goods_payment_nonce_contract$;

do $goods_payment_approved_flow$
declare
  selected_attempt public.payment_attempts%rowtype;
  first_claim jsonb;
  duplicate_claim jsonb;
  terminal_claim jsonb;
  finalized public.payment_attempt_state;
begin
  select * into selected_attempt
  from public.payment_attempts
  where ref_id = '20000000-0000-4000-8000-000000002051';

  first_claim := public.claim_goods_payment_attempt(
    'korpay',
    selected_attempt.provider_order_id,
    repeat('a', 64),
    '40000000-0000-4000-8000-000000002051'
  );
  duplicate_claim := public.claim_goods_payment_attempt(
    'korpay',
    selected_attempt.provider_order_id,
    repeat('a', 64),
    '40000000-0000-4000-8000-000000002059'
  );

  if first_claim ->> 'claim_status' is distinct from 'claimed'
    or duplicate_claim ->> 'claim_status' is distinct from 'in_progress'
  then
    raise exception 'goods payment claim was not atomic';
  end if;

  update public.orders
  set expires_at = now() - interval '10 minutes'
  where id = selected_attempt.ref_id;

  perform public.expire_stale_checkouts();
  if (select status from public.orders where id = selected_attempt.ref_id) <> 'pending' then
    raise exception 'confirming attempt must retain its inventory reservation';
  end if;

  finalized := public.finalize_goods_payment_attempt(
    selected_attempt.id,
    '40000000-0000-4000-8000-000000002051',
    'approved',
    null,
    'korpay-transaction-2051',
    'korpay-approval-2051',
    '0000',
    'CARD',
    '1234-****-****-5678',
    now()
  );
  if finalized <> 'approved' then
    raise exception 'claimed approval after expiry must finalize';
  end if;

  terminal_claim := public.claim_goods_payment_attempt(
    'korpay',
    selected_attempt.provider_order_id,
    repeat('a', 64),
    '40000000-0000-4000-8000-000000002058'
  );
  if terminal_claim ->> 'claim_status' is distinct from 'terminal'
    or terminal_claim ->> 'outcome' is distinct from 'approved'
  then
    raise exception 'terminal callback must replay without a provider call';
  end if;

  if public.finalize_goods_payment_attempt(
    selected_attempt.id,
    '40000000-0000-4000-8000-000000002051',
    'approved'
  ) <> 'approved' then
    raise exception 'lost finalizer response must replay terminal outcome';
  end if;
end;
$goods_payment_approved_flow$;

select 1 / case when (
  select order_record.status = 'paid'
    and order_record.expires_at is null
  from public.orders as order_record
  where order_record.id = '20000000-0000-4000-8000-000000002051'
) then 1 else 0 end as assert_approved_attempt_marks_order_paid;

select 1 / case when (
  select payment.provider = 'korpay'
    and payment.status = 'paid'
    and payment.amount = 31000
    and payment.raw is null
    and payment.payment_key = 'korpay-transaction-2051'
  from public.payments as payment
  where payment.idempotency_key = 'attempt:' || (
    select attempt.id::text
    from public.payment_attempts as attempt
    where attempt.ref_id = '20000000-0000-4000-8000-000000002051'
  )
) then 1 else 0 end as assert_approved_payment_is_provider_neutral_and_raw_free;

select 1 / case when (
  select attempt.state = 'approved'
    and attempt.payment_id is not null
    and attempt.claim_token is null
    and attempt.claim_expires_at is null
    and attempt.callback_nonce_digest = repeat('a', 64)
  from public.payment_attempts as attempt
  where attempt.ref_id = '20000000-0000-4000-8000-000000002051'
) then 1 else 0 end as assert_attempt_links_payment_and_clears_claim;

select 1 / case when (
  select count(*) = 1
    and max(evidence.provider_transaction_id) = 'korpay-transaction-2051'
    and max(evidence.provider_approval_reference) = 'korpay-approval-2051'
    and max(evidence.masked_payment_method) = '1234-****-****-5678'
  from private.payment_provider_evidence as evidence
  join public.payment_attempts as attempt
    on attempt.id = evidence.payment_attempt_id
  where attempt.ref_id = '20000000-0000-4000-8000-000000002051'
) then 1 else 0 end as assert_provider_evidence_is_allowlisted_once;

do $goods_payment_finalization_guard$
declare
  prepared jsonb;
  final_outcome public.payment_attempt_state;
begin
  prepared := public.prepare_goods_payment_attempt(
    '00000000-0000-4000-8000-000000002051',
    '20000000-0000-4000-8000-000000002055',
    'korpay'
  );
  perform public.bind_goods_payment_callback_nonce(
    (prepared ->> 'id')::uuid,
    repeat('f', 64)
  );
  perform public.claim_goods_payment_attempt(
    'korpay',
    prepared ->> 'provider_order_id',
    repeat('f', 64),
    '40000000-0000-4000-8000-000000002055'
  );

  -- Simulate any trusted-boundary drift after the provider call began. The DB
  -- must not turn a stale browser/provider success into fulfillment.
  update public.orders
  set total = 32000
  where id = '20000000-0000-4000-8000-000000002055';

  final_outcome := public.finalize_goods_payment_attempt(
    (prepared ->> 'id')::uuid,
    '40000000-0000-4000-8000-000000002055',
    'approved',
    null,
    'korpay-transaction-2055'
  );
  if final_outcome <> 'needs_review' then
    raise exception 'finalizer must downgrade a changed order contract';
  end if;
end;
$goods_payment_finalization_guard$;

select 1 / case when (
  select attempt.state = 'needs_review'
    and attempt.payment_id is null
    and order_record.status = 'pending'
    and not exists (
      select 1
      from public.payments as payment
      where payment.ref_id = order_record.id
    )
  from public.payment_attempts as attempt
  join public.orders as order_record on order_record.id = attempt.ref_id
  where attempt.ref_id = '20000000-0000-4000-8000-000000002055'
) then 1 else 0 end as assert_finalizer_revalidates_order_contract;

do $goods_payment_approval_requires_provider_identifier$
declare
  prepared jsonb;
  final_outcome public.payment_attempt_state;
begin
  prepared := public.prepare_goods_payment_attempt(
    '00000000-0000-4000-8000-000000002051',
    '20000000-0000-4000-8000-000000002056',
    'korpay'
  );
  perform public.bind_goods_payment_callback_nonce(
    (prepared ->> 'id')::uuid,
    repeat('e', 64)
  );
  perform public.claim_goods_payment_attempt(
    'korpay',
    prepared ->> 'provider_order_id',
    repeat('e', 64),
    '40000000-0000-4000-8000-000000002056'
  );

  final_outcome := public.finalize_goods_payment_attempt(
    (prepared ->> 'id')::uuid,
    '40000000-0000-4000-8000-000000002056',
    'approved'
  );
  if final_outcome <> 'needs_review' then
    raise exception 'approval without a provider identifier must not fulfill';
  end if;
end;
$goods_payment_approval_requires_provider_identifier$;

select 1 / case when (
  select attempt.state = 'needs_review'
    and attempt.payment_id is null
    and order_record.status = 'pending'
    and not exists (
      select 1
      from public.payments as payment
      where payment.ref_id = order_record.id
    )
  from public.payment_attempts as attempt
  join public.orders as order_record on order_record.id = attempt.ref_id
  where attempt.ref_id = '20000000-0000-4000-8000-000000002056'
) then 1 else 0 end as assert_approved_outcome_requires_provider_identifier;

do $goods_payment_nonapproval_flows$
declare
  selected_order_id uuid;
  selected_outcome public.payment_attempt_state;
  selected_digest text;
  selected_claim_token uuid;
  prepared jsonb;
  claimed jsonb;
begin
  for selected_order_id, selected_outcome, selected_digest, selected_claim_token in
    select * from (
      values
        (
          '20000000-0000-4000-8000-000000002052'::uuid,
          'unknown'::public.payment_attempt_state,
          repeat('c', 64),
          '40000000-0000-4000-8000-000000002052'::uuid
        ),
        (
          '20000000-0000-4000-8000-000000002053'::uuid,
          'declined'::public.payment_attempt_state,
          repeat('d', 64),
          '40000000-0000-4000-8000-000000002053'::uuid
        )
    ) as flow(order_id, outcome, digest, claim_token)
  loop
    prepared := public.prepare_goods_payment_attempt(
      '00000000-0000-4000-8000-000000002051',
      selected_order_id,
      'korpay'
    );
    perform public.bind_goods_payment_callback_nonce(
      (prepared ->> 'id')::uuid,
      selected_digest
    );
    claimed := public.claim_goods_payment_attempt(
      'korpay',
      prepared ->> 'provider_order_id',
      selected_digest,
      selected_claim_token
    );
    if claimed ->> 'claim_status' is distinct from 'claimed' then
      raise exception 'nonapproval attempt was not claimed';
    end if;
    if public.finalize_goods_payment_attempt(
      (prepared ->> 'id')::uuid,
      selected_claim_token,
      selected_outcome
    ) is distinct from selected_outcome then
      raise exception 'nonapproval attempt did not finalize';
    end if;
  end loop;
end;
$goods_payment_nonapproval_flows$;

update public.orders
set expires_at = now() - interval '10 minutes'
where id in (
  '20000000-0000-4000-8000-000000002052',
  '20000000-0000-4000-8000-000000002053'
);

select public.expire_stale_checkouts();

select 1 / case when (
  select status = 'pending'
  from public.orders
  where id = '20000000-0000-4000-8000-000000002052'
) then 1 else 0 end as assert_unknown_attempt_retains_inventory;

select 1 / case when (
  select status = 'canceled'
  from public.orders
  where id = '20000000-0000-4000-8000-000000002053'
) then 1 else 0 end as assert_declined_attempt_allows_expiry_restore;

select 1 / case when not exists (
  select 1
  from public.payments as payment
  where payment.ref_id in (
    '20000000-0000-4000-8000-000000002052',
    '20000000-0000-4000-8000-000000002053'
  )
) then 1 else 0 end as assert_nonapproval_outcomes_do_not_create_payments;

rollback;
