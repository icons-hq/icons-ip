-- ==========================================================================
-- ICONS · 무통장 입금 결제수단과 미입금 확인 콘솔 (#256)
--
-- 결정 근거: docs/adr/0007-bank-transfer-payments.md. 코페이는 카드 인증결제
-- 하나뿐이라 가상계좌 경로가 없다. 자체 법인계좌로 받고, 입금 확인은 운영자가
-- 증빙을 남긴 뒤 **기존 finalize_goods_payment_attempt**를 호출한다 —
-- "callback body는 진실원이 아니다"는 원칙이 그대로 유지된다. PG 왕복이
-- 없을 뿐 확정 경로는 카드와 같은 함수다.
--
-- 이 마이그레이션이 DB 안에서 고정하는 것:
--   1. 결제수단은 주문 생성 시점에 고정된다 — 선점 창(15분 vs 24시간)이
--      그때 결정되므로 나중에 갈아탈 수 없다
--   2. 무통장 차단은 굿즈 단위다 — 한정 드롭이 24시간씩 묶이지 않는다
--   3. 확정은 운영자 액션이 아니라 finalizer가 한다 — 증빙 없이는 확정도 없다
--   4. 법인계좌 정보는 DB에 없다 — 서버 설정에서만 읽는다(#255 미해결)
-- ==========================================================================

-- ---------------------------------------------------------------------------
-- 1. 주문 결제수단
-- ---------------------------------------------------------------------------
-- payment_provider('korpay'·'bank_transfer')와 다른 축이다. provider는 원장이
-- 어느 경로로 확정됐는지를, payment_method는 구매자가 주문서에서 무엇을 골랐는지를
-- 가리킨다. 카드 provider가 하나 더 늘어도 주문 쪽 값은 'card'로 남는다.
create type public.order_payment_method as enum ('card', 'bank_transfer');

alter table public.orders
  add column payment_method public.order_payment_method not null default 'card',
  add column bank_transfer_extended_at timestamptz;

-- 기한 연장은 1회다. 별도 테이블 대신 주문 행에 두는 이유는 연장 판정이 항상
-- 주문 잠금 안에서 일어나기 때문이다 — 같은 행에 있으면 경합이 생기지 않는다.
comment on column public.orders.bank_transfer_extended_at is
  '무통장 입금 기한을 운영자가 연장한 시각. not null이면 추가 연장을 막는다.';

create index orders_bank_transfer_unpaid_idx
  on public.orders (expires_at)
  where status = 'pending' and payment_method = 'bank_transfer';

-- ---------------------------------------------------------------------------
-- 2. 굿즈별 무통장 허용
-- ---------------------------------------------------------------------------
-- 기본값은 허용이다. 무통장을 막는 쪽이 예외이고, 예외는 한정 드롭처럼 재고가
-- 24시간 묶이면 곤란한 굿즈에만 운영자가 건다.
alter table public.goods
  add column allow_bank_transfer boolean not null default true;

-- ---------------------------------------------------------------------------
-- 3. 입금자명 매칭 코드
-- ---------------------------------------------------------------------------
-- 주문 id는 UUID라 입금자명 칸에 들어가지 않는다. 앞 8자리(16^8)를 대문자로
-- 잘라 쓴다 — 동시에 열려 있는 미입금 주문 규모에서 충돌은 사실상 없고,
-- 충돌하더라도 확정은 사람이 금액까지 보고 누르는 수동 대조다.
create function private.bank_transfer_deposit_code(p_order_id uuid)
returns text
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select pg_catalog.upper(
    pg_catalog.left(pg_catalog.replace(p_order_id::text, '-', ''), 8)
  );
$function$;

revoke all on function private.bank_transfer_deposit_code(uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. 입금 확인 증빙
-- ---------------------------------------------------------------------------
-- 무통장 확정에는 PG 응답이 없다. 대신 "누가·언제·무엇을 보고" 확인했는지가
-- 원장 옆에 남아야 확정을 사후에 검증할 수 있다. 근거 메모를 필수로 두는 이유가
-- 이것이다 — 메모 없는 확정은 감사할 수 없는 확정이다.
create table public.bank_transfer_confirmations (
  id           uuid primary key default extensions.gen_random_uuid(),
  order_id     uuid not null unique references public.orders (id) on delete cascade,
  attempt_id   uuid not null references public.payment_attempts (id),
  confirmed_by uuid not null references public.profiles (id),
  confirmed_at timestamptz not null default now(),
  memo         text not null,
  constraint bank_transfer_confirmations_memo_valid check (
    pg_catalog.btrim(memo) = memo
    and pg_catalog.char_length(memo) between 5 and 200
  )
);

alter table public.bank_transfer_confirmations enable row level security;

create policy bank_transfer_confirmations_staff_read
on public.bank_transfer_confirmations
for select
to authenticated
using ((select public.is_staff()));

revoke all on table public.bank_transfer_confirmations
  from public, anon, authenticated, service_role;
grant select on table public.bank_transfer_confirmations to authenticated;

-- ---------------------------------------------------------------------------
-- 5. 알림 타입 확장
-- ---------------------------------------------------------------------------
-- 기존 정의에서 값을 읽어 덧붙인다. 목록을 손으로 다시 적으면 병렬 브랜치가
-- 추가한 타입을 조용히 지운다 — 각 브랜치는 단독으로 통과하고 리베이스 뒤에야
-- 드러나므로, 열거형 CHECK를 넓힐 때는 항상 이 형태를 쓴다.
do $$
declare
  v_def text;
  v_values text;
begin
  select pg_catalog.pg_get_constraintdef(constraint_row.oid)
  into v_def
  from pg_catalog.pg_constraint as constraint_row
  join pg_catalog.pg_class as table_row on table_row.oid = constraint_row.conrelid
  join pg_catalog.pg_namespace as schema_row on schema_row.oid = table_row.relnamespace
  where schema_row.nspname = 'public'
    and table_row.relname = 'notifications'
    and constraint_row.conname = 'notifications_type_check';

  select string_agg(distinct quote_literal(matched[1]), ', ')
  into v_values
  from regexp_matches(v_def, '''([a-z_]+)''::text', 'g') as matched;

  if v_values is null then
    raise exception 'notifications_type_check has no readable type list';
  end if;

  if position('''order_bank_transfer_pending''' in v_values) = 0 then
    v_values := v_values || ', ' || quote_literal('order_bank_transfer_pending');
  end if;

  execute 'alter table public.notifications drop constraint notifications_type_check';
  execute format(
    'alter table public.notifications add constraint notifications_type_check check (type in (%s))',
    v_values
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. 주문 생성 — 결제수단 분기
-- ---------------------------------------------------------------------------
create or replace function public.place_order(
  p_address jsonb,
  p_checkout_key uuid,
  p_payment_method public.order_payment_method
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- lib/shipping.ts의 SHIPPING_FEE · FREE_SHIPPING_THRESHOLD와 같은 값이어야 한다.
  c_shipping_fee constant bigint := 3000;
  c_free_shipping_threshold constant bigint := 50000;
  v_user uuid := (select auth.uid());
  v_order uuid;
  v_existing_address jsonb;
  v_existing_payment_method public.order_payment_method;
  v_expires_at timestamptz;
  v_subtotal bigint := 0;
  v_shipping_fee bigint := 0;
  v_item_count integer := 0;
  v_recipient_name text;
  v_phone text;
  v_postal_code text;
  v_address1 text;
  v_optional text;
  r record;
begin
  if v_user is null then
    raise insufficient_privilege using message = 'auth required';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    join auth.users as auth_user on auth_user.id = profile.id
    where profile.id = v_user
      and nullif(btrim(coalesce(profile.email, auth_user.email)), '') is not null
      and nullif(btrim(profile.nickname), '') is not null
      and profile.birth_date is not null
      and profile.birth_date <= current_date
      and profile.onboarded_at is not null
      and profile.consents ->> 'terms' = 'true'
      and profile.consents ->> 'privacy' = 'true'
  ) then
    raise insufficient_privilege using message = 'onboarding required';
  end if;

  if p_checkout_key is null then
    raise not_null_violation using message = 'checkout key required';
  end if;

  if p_address is null or jsonb_typeof(p_address) <> 'object' then
    raise check_violation using message = 'invalid checkout address';
  end if;

  if not (p_address ?& array['recipientName', 'phone', 'postalCode', 'address1'])
     or exists (
       select 1
       from jsonb_object_keys(p_address) as address_key(key)
       where address_key.key not in (
         'recipientName', 'phone', 'postalCode', 'address1', 'address2', 'deliveryNote'
       )
     )
     or exists (
       select 1
       from jsonb_each(p_address) as address_value(key, value)
       where jsonb_typeof(address_value.value) <> 'string'
     ) then
    raise check_violation using message = 'invalid checkout address';
  end if;

  v_recipient_name := p_address ->> 'recipientName';
  v_phone := p_address ->> 'phone';
  v_postal_code := p_address ->> 'postalCode';
  v_address1 := p_address ->> 'address1';

  if v_recipient_name <> btrim(v_recipient_name, E' \t\n\r\f\v')
     or length(v_recipient_name) not between 1 and 50
     or v_phone !~ '^[0-9]{8,15}$'
     or v_postal_code !~ '^[0-9]{5}$'
     or v_address1 <> btrim(v_address1, E' \t\n\r\f\v')
     or length(v_address1) not between 1 and 200 then
    raise check_violation using message = 'invalid checkout address';
  end if;

  if p_address ? 'address2' then
    v_optional := p_address ->> 'address2';
    if v_optional <> btrim(v_optional, E' \t\n\r\f\v') or length(v_optional) > 200 then
      raise check_violation using message = 'invalid checkout address';
    end if;
  end if;

  if p_address ? 'deliveryNote' then
    v_optional := p_address ->> 'deliveryNote';
    if v_optional <> btrim(v_optional, E' \t\n\r\f\v') or length(v_optional) > 200 then
      raise check_violation using message = 'invalid checkout address';
    end if;
  end if;

  -- 같은 사용자의 다른 탭 주문을 직렬화한다. 동일 키 재시도는 먼저 생성된
  -- 주문을 반환하고, 다른 키는 첫 주문이 비운 장바구니를 확인하게 된다.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  select orders.id, orders.address, orders.payment_method
    into v_order, v_existing_address, v_existing_payment_method
  from public.orders
  where orders.user_id = v_user
    and orders.checkout_key = p_checkout_key;

  if found then
    -- 같은 checkout key로 결제수단만 바꿔 다시 부르면 24시간 선점을 15분 주문에
    -- 덧씌우거나 그 반대가 된다. 주소와 같은 등급의 충돌로 막는다.
    if v_existing_address is distinct from p_address
      or v_existing_payment_method is distinct from p_payment_method
    then
      raise unique_violation using message = 'checkout key conflict';
    end if;
    return v_order;
  end if;

  -- 카드 15분 · 무통장 24시간. 무통장은 사람이 은행 앱을 열고 이체할 시간을
  -- 줘야 해서 선점 창이 길고, 그만큼 재고가 오래 묶인다 — 한정 드롭은
  -- goods.allow_bank_transfer로 아예 차단한다(ADR-0007).
  v_expires_at := case
    when p_payment_method = 'bank_transfer' then now() + interval '24 hours'
    else now() + interval '15 minutes'
  end;

  insert into public.orders (
    user_id, status, total, shipping_fee, address, expires_at, checkout_key, payment_method
  )
  values (v_user, 'pending', 0, 0, p_address, v_expires_at, p_checkout_key, p_payment_method)
  returning id into v_order;

  -- 카트와 재고를 같은 결정적 순서로 잠근 뒤 DB 값만으로 주문 스냅샷을 만든다.
  for r in
    select
      cart.good_id,
      cart.qty,
      good.price,
      good.stock,
      good.stock_qty,
      good.name,
      good.type,
      good.ip_id,
      good.allow_bank_transfer
    from public.cart_items as cart
    join public.goods as good on good.id = cart.good_id
    where cart.user_id = v_user
    order by cart.good_id
    for update of cart, good
  loop
    v_item_count := v_item_count + 1;

    if r.stock = 'soldout' or r.stock_qty < r.qty then
      raise check_violation using message = format('out of stock: %s', r.good_id);
    end if;

    if p_payment_method = 'bank_transfer' and not r.allow_bank_transfer then
      raise check_violation using message = format('bank transfer blocked: %s', r.good_id);
    end if;

    update public.goods
    set stock_qty = stock_qty - r.qty
    where id = r.good_id;

    insert into public.order_items (
      order_id,
      good_id,
      qty,
      unit_price,
      good_name_snapshot,
      good_type_snapshot,
      good_ip_id_snapshot
    )
    values (
      v_order,
      r.good_id,
      r.qty,
      r.price,
      r.name,
      r.type,
      r.ip_id
    );

    -- 조회 시 잠근 스냅샷 행만 지운다. 동시에 새로 담긴 다른 상품까지
    -- 마지막 broad delete가 없애지 않도록 상품 단위로 소비한다.
    delete from public.cart_items
    where user_id = v_user
      and good_id = r.good_id;

    v_subtotal := v_subtotal + (r.price::bigint * r.qty::bigint);
  end loop;

  if v_item_count = 0 then
    raise check_violation using message = 'cart empty';
  end if;

  if v_subtotal > 0 and v_subtotal < c_free_shipping_threshold then
    v_shipping_fee := c_shipping_fee;
  end if;

  update public.orders
  set total = v_subtotal + v_shipping_fee,
      shipping_fee = v_shipping_fee
  where id = v_order;

  -- 무통장에는 결제사 왕복이 없다. 그래서 원장 anchor(payment_attempts)를 여기서
  -- 바로 연다 — 없으면 운영자가 입금을 확인할 대상 자체가 없고, "결제 준비" 버튼을
  -- 눌러야 생기는 구조는 구매자가 이미 이체한 뒤에도 확인이 안 되는 창을 만든다.
  -- 새 함수를 두지 않고 카드와 같은 prepare를 부른다: 소유권·금액·스냅샷·정지
  -- 계정 검사가 한 곳에만 있어야 한다.
  if p_payment_method = 'bank_transfer' then
    perform public.prepare_goods_payment_attempt(v_user, v_order, 'bank_transfer');
  end if;

  -- 무통장 주문은 만든 순간이 안내 시점이다. 금액·입금자명 코드·기한이 모두
  -- 정해졌고, 이 알림을 놓치면 구매자는 어디로 얼마를 보낼지 알 수 없다.
  if p_payment_method = 'bank_transfer' then
    insert into public.notifications (
      user_id, type, title, body, link_path, source_type, source_id, dedupe_key
    )
    values (
      v_user,
      'order_bank_transfer_pending',
      '입금 안내를 확인해주세요',
      format(
        '%s원을 기한 안에 입금해주세요. 입금자명 끝에 주문코드 %s를 붙이면 확인이 빨라집니다.',
        to_char(v_subtotal + v_shipping_fee, 'FM999,999,999'),
        private.bank_transfer_deposit_code(v_order)
      ),
      '/checkout/' || v_order::text,
      'order',
      v_order::text,
      'order:bank_transfer_pending:' || v_order::text
    )
    on conflict (user_id, dedupe_key) do nothing;
  end if;

  return v_order;
end;
$$;

-- 기존 2-인자 시그니처는 카드로 위임한다. 기본값 인자로 한 함수에 합치면
-- 호출이 모호해지므로 시그니처를 나눈다.
create or replace function public.place_order(
  p_address jsonb,
  p_checkout_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.place_order(p_address, p_checkout_key, 'card'::public.order_payment_method);
end;
$$;

-- 브라우저는 주문 생성 RPC를 직접 부르지 못한다(20260722062300). 서버가 인증을
-- 확인한 뒤 service role로 사용자 id를 넘기는 이 래퍼만 실행 권한을 갖는다.
-- 결제수단도 같은 경계를 지나야 한다 — 열어 두면 브라우저가 24시간 선점을
-- 스스로 고를 수 있다.
create function public.place_order(
  p_user_id uuid,
  p_address jsonb,
  p_checkout_key uuid,
  p_payment_method public.order_payment_method
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  previous_subject text := pg_catalog.current_setting('request.jwt.claim.sub', true);
  placed_order_id uuid;
begin
  if p_user_id is null then
    raise not_null_violation using message = 'user required';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', p_user_id::text, true);
  placed_order_id := public.place_order(p_address, p_checkout_key, p_payment_method);
  perform pg_catalog.set_config('request.jwt.claim.sub', coalesce(previous_subject, ''), true);
  return placed_order_id;
exception
  when others then
    perform pg_catalog.set_config('request.jwt.claim.sub', coalesce(previous_subject, ''), true);
    raise;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. provider seam 확장
-- ---------------------------------------------------------------------------
-- prepare와 finalize만 넓힌다. claim_goods_payment_attempt와
-- bind_goods_payment_callback_nonce는 'korpay' 고정으로 남겨 둔다 — 무통장에는
-- 콜백이 없으므로, 콜백 경로가 무통장 attempt를 집어갈 수 있게 열어 둘 이유가
-- 없고 열면 공격 표면만 넓어진다.
create or replace function public.prepare_goods_payment_attempt(
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
  if p_user_id is null
    or p_order_id is null
    or p_provider not in ('korpay', 'bank_transfer')
  then
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

  -- 결제수단은 주문 생성 시점에 고정된다. 선점 창(카드 15분 · 무통장 24시간)이
  -- 그때 결정되므로, 여기서 수단을 갈아타게 두면 재고 보유 시간이 주문 기록과
  -- 어긋난다. 바꾸려면 취소하고 다시 주문해야 한다.
  if (p_provider = 'bank_transfer' and v_order.payment_method <> 'bank_transfer')
    or (p_provider <> 'bank_transfer' and v_order.payment_method <> 'card')
  then
    raise object_not_in_prerequisite_state using message = 'goods_payment_method_mismatch';
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
  -- 카드 action은 10분이면 충분하고 짧을수록 안전하다. 무통장은 attempt TTL이
  -- 곧 입금 기한이라 주문 선점 창과 같아야 한다 — 짧게 잡으면 입금 확인이
  -- 만료된 attempt를 붙잡고 실패한다.
  v_attempt_expires_at := case
    when p_provider = 'bank_transfer' then v_order.expires_at
    else least(
      v_order.expires_at,
      pg_catalog.clock_timestamp() + interval '10 minutes'
    )
  end;

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
create or replace function public.finalize_goods_payment_attempt(
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
    and attempt.provider in ('korpay', 'bank_transfer');

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
    and attempt.provider in ('korpay', 'bank_transfer')
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

-- ---------------------------------------------------------------------------
-- 8. 미입금 확인 콘솔 RPC
-- ---------------------------------------------------------------------------
-- 목록. staff RLS만으로는 주문·아이템·프로필을 한 번에 못 읽으므로 정의자
-- 권한으로 좁혀 돌려준다. 필요한 컬럼만 나가고 주소·연락처는 나가지 않는다 —
-- 입금 대조에 필요한 정보가 아니다.
create function public.admin_unpaid_bank_transfer_orders(
  p_query text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  order_id uuid,
  buyer_name text,
  buyer_id uuid,
  total bigint,
  created_at timestamptz,
  expires_at timestamptz,
  extended_at timestamptz,
  deposit_code text,
  item_summary text,
  attempt_state public.payment_attempt_state,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  return query
  with candidate as (
    select
      orders.id,
      orders.user_id,
      orders.total,
      orders.created_at,
      orders.expires_at,
      orders.bank_transfer_extended_at,
      private.bank_transfer_deposit_code(orders.id) as code,
      coalesce(nullif(btrim(profile.nickname), ''), 'fan_' || left(orders.user_id::text, 6))
        as buyer,
      (
        select attempt.state
        from public.payment_attempts as attempt
        where attempt.purpose = 'order'
          and attempt.ref_id = orders.id
      ) as attempt_state,
      (
        select string_agg(
          item.good_name_snapshot || ' × ' || item.qty::text,
          ', '
          order by item.good_name_snapshot
        )
        from public.order_items as item
        where item.order_id = orders.id
      ) as items
    from public.orders
    left join public.profiles as profile on profile.id = orders.user_id
    where orders.status = 'pending'
      and orders.payment_method = 'bank_transfer'
  ),
  filtered as (
    select *
    from candidate
    where v_query is null
      or candidate.code = upper(v_query)
      or candidate.id::text = lower(v_query)
      or candidate.buyer ilike '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  )
  select
    filtered.id,
    filtered.buyer,
    filtered.user_id,
    filtered.total,
    filtered.created_at,
    filtered.expires_at,
    filtered.bank_transfer_extended_at,
    filtered.code,
    coalesce(filtered.items, ''),
    filtered.attempt_state,
    count(*) over ()
  from filtered
  order by filtered.expires_at nulls last, filtered.created_at
  limit v_limit
  offset v_offset;
end;
$function$;

-- 입금 확인. 증빙을 남기고 attempt를 confirming으로 옮긴 뒤 **기존 finalizer**를
-- 부른다. 운영자 액션이 orders.status를 직접 건드리지 않는 것이 핵심이다 —
-- 재고·원장·뽑기권 부수효과가 전부 finalizer 한 곳에만 있다.
create function public.admin_confirm_bank_transfer_deposit(
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
  v_memo text := btrim(coalesce(p_memo, ''));
  v_order public.orders%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_claim_token uuid := extensions.gen_random_uuid();
  v_outcome public.payment_attempt_state;
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if char_length(v_memo) not between 5 and 200 then
    raise check_violation using message = 'invalid deposit memo';
  end if;

  -- 전역 잠금 순서: orders → payment_attempts → payments.
  select orders.* into v_order
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found then
    raise no_data_found using message = 'order_not_found';
  end if;

  if v_order.payment_method is distinct from 'bank_transfer' then
    raise check_violation using message = 'order_not_bank_transfer';
  end if;

  if v_order.status is distinct from 'pending' then
    raise object_not_in_prerequisite_state using message = 'order_not_unpaid';
  end if;

  select attempt.* into v_attempt
  from public.payment_attempts as attempt
  where attempt.purpose = 'order'
    and attempt.ref_id = v_order.id
    and attempt.provider = 'bank_transfer'
  for update;

  if not found then
    raise no_data_found using message = 'bank_transfer_attempt_not_found';
  end if;

  -- 만료 스윕이 이미 attempt를 닫았으면 여기서 멈춘다. finalizer는 종결 상태를
  -- 그대로 되돌려 주므로 그냥 부르면 "확인했는데 아무 일도 없다"가 된다.
  if v_attempt.state is distinct from 'prepared' then
    raise object_not_in_prerequisite_state using message = 'bank_transfer_attempt_not_confirmable';
  end if;

  update public.payment_attempts
  set
    state = 'confirming',
    claim_token = v_claim_token,
    claim_expires_at = now() + interval '5 minutes'
  where id = v_attempt.id;

  insert into public.bank_transfer_confirmations (order_id, attempt_id, confirmed_by, memo)
  values (v_order.id, v_attempt.id, v_actor, v_memo);

  v_outcome := public.finalize_goods_payment_attempt(
    v_attempt.id,
    v_claim_token,
    'approved',
    'bank_transfer:' || v_attempt.id::text,
    null,
    null,
    null,
    'bank_transfer',
    null,
    now()
  );

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.bank_transfer_confirmed',
    'order:' || v_order.id::text,
    jsonb_build_object(
      'attemptId', v_attempt.id,
      'amount', v_order.total,
      'depositCode', private.bank_transfer_deposit_code(v_order.id),
      'memo', v_memo,
      'outcome', v_outcome
    )
  );

  return v_outcome;
end;
$function$;

-- 기한 연장 1회. 사유는 필수다 — 연장은 재고를 하루 더 묶는 판단이라
-- 누가 왜 늘렸는지가 남지 않으면 나중에 검증할 수 없다.
create function public.admin_extend_bank_transfer_deadline(
  p_order_id uuid,
  p_reason text
)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_reason text := btrim(coalesce(p_reason, ''));
  v_order public.orders%rowtype;
  v_new_expiry timestamptz;
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if char_length(v_reason) not between 5 and 200 then
    raise check_violation using message = 'invalid extension reason';
  end if;

  select orders.* into v_order
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found then
    raise no_data_found using message = 'order_not_found';
  end if;

  if v_order.payment_method is distinct from 'bank_transfer' then
    raise check_violation using message = 'order_not_bank_transfer';
  end if;

  if v_order.status is distinct from 'pending' then
    raise object_not_in_prerequisite_state using message = 'order_not_unpaid';
  end if;

  if v_order.bank_transfer_extended_at is not null then
    raise object_not_in_prerequisite_state using message = 'bank_transfer_already_extended';
  end if;

  v_new_expiry := now() + interval '24 hours';

  update public.orders
  set expires_at = v_new_expiry,
      bank_transfer_extended_at = now()
  where id = v_order.id;

  -- attempt TTL이 곧 입금 기한이다. 주문만 늘리고 attempt를 두면 확인 시점에
  -- 만료된 attempt가 남는다.
  update public.payment_attempts
  set expires_at = v_new_expiry
  where purpose = 'order'
    and ref_id = v_order.id
    and provider = 'bank_transfer'
    and state = 'prepared';

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.bank_transfer_extended',
    'order:' || v_order.id::text,
    jsonb_build_object(
      'from', v_order.expires_at,
      'to', v_new_expiry,
      'reason', v_reason
    )
  );

  return v_new_expiry;
end;
$function$;

-- 즉시 취소. 미입금이라 환불할 돈이 없다 — 재고 복원만 하면 된다. 만료 스윕과
-- 같은 순서(attempt를 먼저 닫고 주문을 취소)를 따른다.
create function public.admin_cancel_unpaid_bank_transfer_order(
  p_order_id uuid,
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
  v_order public.orders%rowtype;
  v_attempt public.payment_attempts%rowtype;
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if char_length(v_reason) not between 5 and 200 then
    raise check_violation using message = 'invalid cancellation reason';
  end if;

  select orders.* into v_order
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found then
    raise no_data_found using message = 'order_not_found';
  end if;

  if v_order.payment_method is distinct from 'bank_transfer' then
    raise check_violation using message = 'order_not_bank_transfer';
  end if;

  if v_order.status is distinct from 'pending' then
    raise object_not_in_prerequisite_state using message = 'order_not_unpaid';
  end if;

  select attempt.* into v_attempt
  from public.payment_attempts as attempt
  where attempt.purpose = 'order'
    and attempt.ref_id = v_order.id
  for update;

  if found then
    if v_attempt.state is distinct from 'prepared' then
      raise object_not_in_prerequisite_state using message = 'bank_transfer_attempt_not_cancelable';
    end if;

    update public.payment_attempts
    set state = 'canceled',
        claim_token = null,
        claim_expires_at = null
    where id = v_attempt.id;
  end if;

  perform public.cancel_order(v_order.id, v_reason);

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.bank_transfer_canceled',
    'order:' || v_order.id::text,
    jsonb_build_object('reason', v_reason, 'amount', v_order.total)
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 9. 굿즈 무통장 토글
-- ---------------------------------------------------------------------------
-- admin_upsert_good에 인자를 더하지 않는 이유는, 그 RPC가 고시정보 7칸을
-- 필수로 받기 때문이다. 운영 스위치 하나를 끄려고 상품 정보 전체를 다시
-- 제출하게 만들면 한정 드롭 직전에 못 끄는 일이 생긴다.
create function public.admin_set_good_bank_transfer(
  target_id text,
  target_allowed boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if target_id is null or target_allowed is null then
    raise check_violation using message = 'invalid bank transfer toggle';
  end if;

  update public.goods
  set allow_bank_transfer = target_allowed,
      updated_at = now()
  where id = target_id;

  if not found then
    raise no_data_found using message = 'catalog_record_missing';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'catalog.good.bank_transfer_toggled',
    'goods:' || target_id,
    jsonb_build_object('allowBankTransfer', target_allowed)
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 10. ACL
-- ---------------------------------------------------------------------------
-- Supabase default privileges가 신규 public 함수에 anon/authenticated/service_role
-- execute를 자동 부여한다. `from public`만으로는 봉인되지 않는다.
-- 주문 생성 본문은 어떤 브라우저 롤도 부를 수 없다. service role 래퍼만 열린다.
revoke all on function public.place_order(jsonb, uuid, public.order_payment_method)
  from public, anon, authenticated, service_role;
revoke all on function public.place_order(uuid, jsonb, uuid, public.order_payment_method)
  from public, anon, authenticated, service_role;
grant execute on function public.place_order(uuid, jsonb, uuid, public.order_payment_method)
  to service_role;

revoke all on function public.admin_unpaid_bank_transfer_orders(text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_unpaid_bank_transfer_orders(text, integer, integer)
  to authenticated;

revoke all on function public.admin_confirm_bank_transfer_deposit(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_confirm_bank_transfer_deposit(uuid, text)
  to authenticated;

revoke all on function public.admin_extend_bank_transfer_deadline(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_extend_bank_transfer_deadline(uuid, text)
  to authenticated;

revoke all on function public.admin_cancel_unpaid_bank_transfer_order(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_cancel_unpaid_bank_transfer_order(uuid, text)
  to authenticated;

revoke all on function public.admin_set_good_bank_transfer(text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_set_good_bank_transfer(text, boolean)
  to authenticated;
